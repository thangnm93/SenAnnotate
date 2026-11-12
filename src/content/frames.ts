// =============================================================================
// Iframes — capturing in a document the top frame cannot reach into
// =============================================================================
//
// `document.elementFromPoint` in the top document stops at the `<iframe>` element,
// so the best annotation obtainable from up there is "iframe.preview". A same-origin
// frame could be walked via `contentDocument`, but a cross-origin one cannot — and
// the framework metadata would still be in the wrong JS heap. So the content script
// runs inside the frame too (`all_frames: true`) and hands its captures upward.
//
// The split:
//
//   top frame     toolbar, panel, composer, markers, storage, badge, diagnostics
//   child frame   hover highlight + capture, nothing else — no UI chrome, no storage
//
// Two things are deliberately not solved here, both recorded in
// `docs/session-and-frames/context.md`:
//
//   * A pin is stored in the top document's space. Scrolling *inside* the frame
//     afterwards moves the element and not the pin — the top frame cannot observe a
//     cross-origin frame's scroll offset. The report is unaffected, and the report is
//     the product.
//   * Only depth-1 frames are instrumented. An iframe inside an iframe falls back to
//     annotating the outer `<iframe>` element, which is at least honest.
//   * A child frame answers `point` and `text` mode only. `area` (marquee) is a
//     top-frame gesture: the live element count goes to `toolbar.setHint`, and there
//     is no toolbar in here to put it on. Dragging over a frame in `area` mode
//     therefore selects nothing — the click is still swallowed, exactly as it is over
//     the rest of the page in that mode, so the behaviour is consistent rather than
//     broken. Wiring it up means routing hint text up the same channel drafts use.
// =============================================================================

import { FRAME_CHANNEL } from "../shared/protocol";
import type { FrameRef, InspectMode, Rect } from "../shared/types";
import { captureDraft, type Draft } from "./capture";
import { buildSelector, isAnnotatable, isOurUi } from "./identify";
import type { Settings } from "../shared/types";
import { listen } from "./ui/dom";
import { Overlay } from "./ui/overlay";
import { createUiRoot } from "./ui/root";
import { identifyElement } from "./identify";

/**
 * Below this, a frame holds nothing anyone would annotate.
 *
 * Tracking pixels are 1×1, ad slots are frequently 0-sized until filled, and consent
 * and analytics beacons are a few pixels each. A news page carries dozens; each one
 * instrumented would mean another inspector + content script pair, another set of
 * diagnostics patches, for a document with no visible content at all.
 */
const MIN_FRAME_SIZE = 50;

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

/** top → child */
type FrameCommand =
  | { kind: "state"; active: boolean; mode: InspectMode }
  /** The `C` key was pressed while the pointer was over this frame. */
  | { kind: "capture-hover" };

/** child → top */
type FrameSignal =
  | { kind: "hello" }
  | {
      kind: "draft";
      draft: Draft;
      /** The child's scroll offset, so document-space rects can be un-scrolled. */
      scrollX: number;
      scrollY: number;
    };

interface Envelope<T> {
  channel: typeof FRAME_CHANNEL;
  payload: T;
}

function isEnvelope<T>(data: unknown): data is Envelope<T> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Envelope<T>).channel === FRAME_CHANNEL
  );
}

// -----------------------------------------------------------------------------
// Which frame am I?
// -----------------------------------------------------------------------------

export function isTopFrame(): boolean {
  // Identity comparison against `window.top` is permitted cross-origin; reading
  // properties off it is not, and nothing here does.
  try {
    return window.top === window;
  } catch {
    // Defensive: treat an unreadable `top` as "not the top", so we degrade to a
    // capture-only child rather than painting a second toolbar.
    return false;
  }
}

/** Depth-1 check: our parent is the top frame, so our offset is knowable. */
function isDirectChild(): boolean {
  try {
    return window.parent === window.top && window.parent !== window;
  } catch {
    return false;
  }
}

export function isFrameWorthInstrumenting(): boolean {
  if (!isDirectChild()) return false;
  return window.innerWidth >= MIN_FRAME_SIZE && window.innerHeight >= MIN_FRAME_SIZE;
}

// -----------------------------------------------------------------------------
// Top-frame side
// -----------------------------------------------------------------------------

/** Child windows that have said hello, so we know not to highlight their `<iframe>`. */
const liveFrames = new Set<Window>();

/** True once the frame at this element is running its own capture. */
export function isLiveChildFrame(element: Element): boolean {
  if (!(element instanceof HTMLIFrameElement)) return false;
  const view = element.contentWindow;
  return view !== null && liveFrames.has(view);
}

function eachFrame(callback: (view: Window) => void): void {
  for (const frame of document.querySelectorAll("iframe")) {
    const view = frame.contentWindow;
    if (!view) continue;
    callback(view);
  }
}

export function broadcastFrameState(active: boolean, mode: InspectMode): void {
  eachFrame((view) => post(view, { kind: "state", active, mode } satisfies FrameCommand));
}

/** Ask the frame under the pointer to capture what *it* is hovering. */
export function requestFrameHoverCapture(element: Element): boolean {
  if (!(element instanceof HTMLIFrameElement)) return false;
  const view = element.contentWindow;
  if (!view || !liveFrames.has(view)) return false;
  post(view, { kind: "capture-hover" } satisfies FrameCommand);
  return true;
}

function post(view: Window, payload: FrameCommand | FrameSignal): void {
  try {
    view.postMessage({ channel: FRAME_CHANNEL, payload }, "*");
  } catch {
    // A frame that navigated away mid-broadcast. Nothing to recover.
  }
}

/** Match a `message` event back to the `<iframe>` element that sent it. */
function frameElementFor(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source) return null;
  for (const frame of document.querySelectorAll("iframe")) {
    // Window identity comparison is allowed cross-origin — unlike reading any
    // property off `contentWindow`, which is what makes the rest of this necessary.
    if (frame.contentWindow === source) return frame;
  }
  return null;
}

function describeFrame(frame: HTMLIFrameElement): FrameRef {
  const src = frame.getAttribute("src") ?? "";
  let label = frame.getAttribute("name") || frame.getAttribute("title") || "";

  if (!label && src) {
    try {
      label = new URL(src, location.href).pathname;
    } catch {
      label = src;
    }
  }

  return {
    label: (label || "iframe").slice(0, 80),
    url: src.slice(0, 300),
    selector: buildSelector(frame),
  };
}

function shift(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/**
 * Subscribe to captures coming out of child frames.
 *
 * The translation is the whole job. A child's draft is in the child document's
 * coordinate space; the top frame stores document-space rects of its own. So:
 *
 *   child document → child viewport   (subtract the child's scroll)
 *   child viewport → top viewport     (add the `<iframe>` element's rect)
 *   top viewport   → top document     (add the top frame's scroll)
 *
 * `isFixed` is forced off on the way through: an element fixed inside a frame is
 * still carried up and down by the top page's scroll, so from up here it is not
 * fixed at all.
 */
export function onFrameDraft(callback: (draft: Draft) => void): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isEnvelope<FrameSignal>(event.data)) return;

    const frame = frameElementFor(event.source);
    // A message from a window that is not one of our own iframes is not ours.
    if (!frame) return;

    const signal = event.data.payload;

    if (signal?.kind === "hello") {
      if (frame.contentWindow) liveFrames.add(frame.contentWindow);
      return;
    }

    if (signal?.kind !== "draft" || !signal.draft) return;

    const box = frame.getBoundingClientRect();
    const dx = box.left + window.scrollX - signal.scrollX;
    const dy = box.top + window.scrollY - signal.scrollY;

    const draft = signal.draft;
    const bounding = draft.boundingBox ? shift(draft.boundingBox, dx, dy) : undefined;

    callback({
      ...draft,
      isFixed: false,
      boundingBox: bounding,
      elementBoundingBoxes: draft.elementBoundingBoxes?.map((rect) => shift(rect, dx, dy)),
      // The marker rides on the translated box, not on the child's own percentage —
      // that was a fraction of the *frame's* width and means nothing up here.
      x: bounding ? ((bounding.x + bounding.width - window.scrollX) / window.innerWidth) * 100 : 50,
      y: bounding ? bounding.y : window.scrollY,
      frame: describeFrame(frame),
    });
  });
}

// -----------------------------------------------------------------------------
// Child-frame side
// -----------------------------------------------------------------------------

/**
 * Everything a framed document runs: a highlight overlay and a capture path.
 *
 * No toolbar, no panel, no composer, no storage, no badge — one of each of those
 * exists, in the top frame, and a second would be both wrong and visible.
 */
export function installChildFrame(getSettings: () => Settings): void {
  let active = false;
  let mode: InspectMode = "point";
  let hovered: Element | null = null;

  const ui = createUiRoot();
  const overlay = new Overlay(ui.overlayLayer);

  const eligible = (element: Element): boolean => isAnnotatable(element) && !isOurUi(element);

  const clearHover = (): void => {
    overlay.hideHighlights();
    hovered = null;
  };

  const capture = async (element: Element, selectedText?: string): Promise<void> => {
    const draft = await captureDraft([element], { settings: getSettings(), selectedText });
    if (!draft) return;
    post(window.parent, {
      kind: "draft",
      draft,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    } satisfies FrameSignal);
    clearHover();
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (!isEnvelope<FrameCommand>(event.data)) return;
    // Only our own parent gets to drive this frame.
    if (event.source !== window.parent) return;

    const command = event.data.payload;

    if (command?.kind === "capture-hover") {
      if (hovered?.isConnected) void capture(hovered);
      return;
    }

    if (command?.kind !== "state") return;

    active = command.active;
    mode = command.mode;

    if (active) {
      document.body?.style.setProperty("cursor", "crosshair", "important");
    } else {
      document.body?.style.removeProperty("cursor");
      clearHover();
    }
  });

  listen(
    document,
    "pointermove",
    (event) => {
      // `all` routes hover the same way as `point` — highlight what the pointer is over.
      if (!active || (mode !== "point" && mode !== "all")) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !eligible(target)) {
        clearHover();
        return;
      }
      if (target === hovered) return;
      hovered = target;
      overlay.showHighlights([target.getBoundingClientRect()], {
        primary: identifyElement(target).name,
      });
    },
    { passive: true },
  );

  listen(
    document,
    "click",
    (event) => {
      // `text` and `all`-with-selection let clicks through for native selection to finish.
      if (!active || mode === "text") return;
      if (mode === "all" && window.getSelection()?.toString().trim()) return;
      if (isOurUi(event.target as Element)) return;

      event.preventDefault();
      event.stopPropagation();

      // `all` routes element capture the same way as `point` inside a child frame.
      if (mode !== "point" && mode !== "all") return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !eligible(target)) return;
      void capture(target);
    },
    { capture: true },
  );

  // Same reason as the top frame: the page must never see half a click.
  // `text` and `all` are exempt so the browser can start/settle a text selection.
  for (const type of ["mousedown", "mouseup"] as const) {
    listen(
      document,
      type,
      (event) => {
        if (!active || mode === "text" || mode === "all") return;
        if (isOurUi(event.target as Element)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true },
    );
  }

  listen(document, "mouseup", () => {
    // Fire in both explicit text mode and all-mode, where text selection is one gesture.
    if (!active || (mode !== "text" && mode !== "all")) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!selection || !text) return;

      const container = selection.getRangeAt(0).commonAncestorContainer;
      const element =
        container.nodeType === Node.ELEMENT_NODE
          ? (container as Element)
          : container.parentElement;

      if (!element || !eligible(element)) return;
      void capture(element, text);
    }, 0);
  });

  // Focus can genuinely be inside a frame — the user clicked into it before turning
  // inspect mode on — in which case `C` arrives here rather than in the top frame.
  listen(document, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    // `all` also enables the C / Enter capture shortcuts inside the child frame.
    if (!active || (mode !== "point" && mode !== "all")) return;
    if (keyboard.metaKey || keyboard.ctrlKey || keyboard.altKey) return;
    if (keyboard.key !== "c" && keyboard.key !== "C" && keyboard.key !== "Enter") return;

    const target = keyboard.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

    if (hovered?.isConnected) void capture(hovered);
  });

  // Announce ourselves, and again once the parent has certainly booted — the top
  // frame runs at `document_idle` too and may not have been listening yet.
  const hello = () => post(window.parent, { kind: "hello" } satisfies FrameSignal);
  hello();
  window.setTimeout(hello, 300);
  window.setTimeout(hello, 1200);
}
