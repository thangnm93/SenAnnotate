// =============================================================================
// Saving a file — one blob-and-anchor path for every surface that offers a download
// =============================================================================
//
// Lives in `shared/` for the same reason `archive.ts` does: the popup offers downloads
// too (the JSON export, the shareable `.html`) and `popup/` may not import from
// `content/`. That constraint is an argument for moving this out of
// `content/screenshot.ts`, where it started, rather than for keeping a second weaker
// copy beside it — which is what the popup briefly had, minus the `append`/`remove` and
// the `try/catch` that make this one work.
//
// Only imported by documents (content scripts, the popup). The service worker has no
// `document` and never asks.
// =============================================================================

/**
 * Save a blob to the user's downloads.
 *
 * An anchor with `download`, deliberately — `chrome.downloads` would work but costs
 * the `downloads` permission, and `test/e2e.mjs` asserts we save a screenshot
 * without one. Do not "simplify" this to the extension API.
 *
 * The anchor is attached to the document before the click and removed after: a click on
 * a *detached* `<a download>` happening to work is a Chrome-specific accident, and every
 * call site here hands it a multi-megabyte blob it cannot afford to lose silently.
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

/** The same, for the two surfaces whose payload is text they just built. */
export function downloadText(content: string, type: string, filename: string): boolean {
  return downloadBlob(new Blob([content], { type }), filename);
}
