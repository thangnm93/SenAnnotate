// =============================================================================
// Element screenshots
// =============================================================================
//
// The service worker photographs the whole viewport (only it can call
// `captureVisibleTab`); everything after that happens here, because an MV3
// service worker has no canvas and no `URL.createObjectURL`.
//
// Split into four steps rather than one `cropAndDownload`, because the markup
// editor sits in the middle of them: crop → edit → encode → deliver. The editor
// needs a canvas it can draw on, and delivery needs to happen only if the user
// actually saves.
// =============================================================================

/** Padding around the element, so the crop has a little context. */
const BLEED = 8;

/**
 * Ceiling on the *embedded* copy's width, in canvas pixels.
 *
 * An embedded screenshot is base64 inside a Markdown report that is then put on the
 * clipboard, so its size is paid twice over. 900px keeps a UI screenshot readable
 * while landing around 60-120 KB — where a full-size PNG of the same crop is 400 KB
 * before base64's 33% overhead. The downloaded file is untouched by this.
 */
const MAX_EMBED_WIDTH = 900;
const EMBED_QUALITY = 0.72;

/**
 * Crop the element out of a viewport capture.
 *
 * Returns a canvas rather than a blob so the markup editor has something to draw on.
 */
export async function cropToCanvas(
  viewportPng: string,
  rect: { left: number; top: number; width: number; height: number },
): Promise<HTMLCanvasElement | null> {
  try {
    const image = await loadImage(viewportPng);

    // captureVisibleTab returns a device-pixel bitmap, but getBoundingClientRect
    // speaks CSS pixels. Derive the ratio from the image rather than trusting
    // devicePixelRatio — they disagree when the page is zoomed.
    const ratio = image.width / window.innerWidth;

    const left = Math.max(0, Math.round((rect.left - BLEED) * ratio));
    const top = Math.max(0, Math.round((rect.top - BLEED) * ratio));
    const width = Math.min(image.width - left, Math.round((rect.width + BLEED * 2) * ratio));
    const height = Math.min(image.height - top, Math.round((rect.height + BLEED * 2) * ratio));

    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, left, top, width, height, 0, 0, width, height);

    return canvas;
  } catch {
    return null;
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Downscale and re-encode for embedding in the report.
 *
 * JPEG, not PNG: this is a photograph of a screen going into a text document, and
 * PNG's lossless guarantee buys nothing there while costing 3-5×. Returns null
 * rather than throwing — an embed that could not be produced simply falls back to
 * the file path, which is always written.
 */
export function encodeForEmbed(canvas: HTMLCanvasElement): string | null {
  try {
    if (canvas.width <= MAX_EMBED_WIDTH) {
      return canvas.toDataURL("image/jpeg", EMBED_QUALITY);
    }

    const scale = MAX_EMBED_WIDTH / canvas.width;
    const scaled = document.createElement("canvas");
    scaled.width = MAX_EMBED_WIDTH;
    scaled.height = Math.max(1, Math.round(canvas.height * scale));

    const context = scaled.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);

    return scaled.toDataURL("image/jpeg", EMBED_QUALITY);
  } catch {
    return null;
  }
}

/**
 * Take an image the user supplied — pasted or attached — and put it through the same
 * downscale-and-re-encode the captured screenshots go through.
 *
 * Necessary rather than tidy: a Figma frame off the clipboard arrives as a full-size
 * PNG, and three of them would fill the page's whole storage budget on their own. The
 * ceiling is the same 900px, so a reference image and a screenshot cost the same and
 * `fitToQuota` has one size of thing to reason about.
 *
 * The scale is applied on the way *into* the canvas, which is why this does not simply
 * hand a natural-size canvas to `encodeForEmbed` and let that downscale. A 2× Figma
 * export of a desktop frame is 5120×8000 — 41M pixels, 164 MB of RGBA — and Chrome caps
 * canvas area at 268,435,456 px. Past the cap it does not throw: `getContext("2d")`
 * returns a context whose backing store failed, `drawImage` is a no-op, and `toDataURL`
 * answers `"data:,"`. Under the cap but over memory pressure, the tab just stalls.
 *
 * `createObjectURL` rather than a `FileReader` data URL: the file is decoded straight
 * into a canvas and the base64 round trip in between would be pure cost.
 */
export async function encodeSuppliedImage(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    // `accept="image/*"` admits SVG, and an SVG with no intrinsic width/height decodes
    // with `naturalWidth === 0` in Chrome. A zero-area canvas is the other route to
    // `"data:,"` — and that string is truthy, so nothing downstream would catch it.
    if (!image.naturalWidth || !image.naturalHeight) return null;

    const scale = Math.min(1, MAX_EMBED_WIDTH / image.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return validEmbed(encodeForEmbed(canvas));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * `null` is not the only way an embed fails.
 *
 * `toDataURL` answers the literal string `"data:,"` rather than throwing when the canvas
 * has nothing to encode, and that string passes every `!== null` check between here and
 * storage: the user gets a blank thumbnail with no error, and the report ships
 * `![… — reference 1](data:,)` under a heading promising a picture.
 */
function validEmbed(uri: string | null): string | null {
  return uri?.startsWith("data:image/") ? uri : null;
}

/**
 * Save a blob to the user's downloads.
 *
 * An anchor with `download`, deliberately — `chrome.downloads` would work but costs
 * the `downloads` permission, and `test/e2e.mjs` asserts we save a screenshot
 * without one. Do not "simplify" this to the extension API.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some Chrome builds.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the file most likely landed.
 *
 * Constructed, not observed: no API tells a content script Chrome's download
 * directory, and the one that would (`chrome.downloads`) costs a permission this
 * extension deliberately does without. Correct on a stock profile, wrong for anyone
 * who moved their download folder — which is why the report prints it as a path *and*
 * keeps the bare filename readable inside it.
 */
export function downloadPath(filename: string): string {
  return `~/Downloads/${filename}`;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("could not decode the captured tab"));
    image.src = source;
  });
}
