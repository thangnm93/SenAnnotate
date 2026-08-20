// =============================================================================
// Wire protocol
// =============================================================================
//
// Two hops:
//
//   content (ISOLATED) ←window.postMessage→ inspector (MAIN)
//   content (ISOLATED) ←chrome.runtime→     background (service worker)
//
// DOM nodes cannot cross `postMessage`, so the content script stamps the target
// element with PROBE_ATTR and sends the id; the inspector re-resolves it with
// `querySelector` and the attribute is removed straight afterwards.
// =============================================================================

import type { ComponentDetectionMode, Diagnostics, PageFrameworkInfo, ElementFrameworkInfo } from "./types";

export const NS = "senannotate";

export const BRIDGE_REQUEST = `${NS}:request`;
export const BRIDGE_RESPONSE = `${NS}:response`;
/** One-way, inspector → content. No request, no id. */
export const BRIDGE_EVENT = `${NS}:event`;

/**
 * Third channel: top frame ↔ the content scripts running inside its iframes.
 *
 * Same transport as the MAIN↔ISOLATED bridge and for the same reason — an iframe's
 * document is a different world with a different `elementFromPoint`, and only the
 * script inside it can see what the pointer is actually over.
 */
export const FRAME_CHANNEL = `${NS}:frame`;

/** Temporary marker used to hand an element reference across worlds. */
export const PROBE_ATTR = `data-${NS}-probe`;
/** Marks our own shadow host so page scripts and freeze CSS can exclude it. */
export const UI_ATTR = `data-${NS}-ui`;
/** Emitted by `vite-plugin-vue-inspector` / Nuxt DevTools: "src/App.vue:12:5". */
export const INSPECTOR_ATTR = "data-v-inspector";

/**
 * Storage keys. Declared here rather than in `content/storage.ts` because the popup
 * needs the same two strings, and two copies of a namespaced key are two chances to
 * drift on the next rename.
 */
export const ANNOTATION_PREFIX = `${NS}:page:`;
/**
 * Where the toolbar was dragged to, per page. Keyed like the annotations and stored
 * beside them in `local` rather than in `sync`: it is a fact about one screen's
 * layout, not a preference, and syncing it would move the pill on every machine.
 */
export const DOCK_PREFIX = `${NS}:dock:`;
export const SETTINGS_KEY = `${NS}:settings`;

/**
 * "Hide until restart" — a `sessionStorage` key, not a `chrome.storage` one.
 *
 * The other stores are wrong for it: `sync` or `local` would hide the extension in
 * every tab, when the request is "get out of *this* tab". `sessionStorage` is scoped to
 * one tab, survives that tab's reloads, and evaporates when the tab closes — which is
 * exactly what "restart" means here. The page can see and clear the key; it guards a
 * UI preference, not anything worth guarding.
 */
export const HIDDEN_KEY = `${NS}:hide-until-restart`;

// -----------------------------------------------------------------------------
// content → inspector
// -----------------------------------------------------------------------------

export type BridgeRequest =
  | { kind: "detect" }
  | {
      kind: "inspect";
      probeId: string;
      mode: ComponentDetectionMode;
      maxComponents: number;
      includeProps: boolean;
    }
  | { kind: "freeze" }
  | { kind: "unfreeze" }
  | { kind: "diagnostics" }
  | { kind: "clear-diagnostics" };

export type BridgeResult =
  | { kind: "detect"; page: PageFrameworkInfo }
  | { kind: "inspect"; info: ElementFrameworkInfo | null }
  | { kind: "diagnostics"; diagnostics: Diagnostics }
  | { kind: "ack" };

/**
 * Pushed whenever the diagnostics buffers change.
 *
 * The content script keeps a mirror so that copying a report needs no `await`
 * before touching the clipboard — an await there costs the click's user
 * activation and `navigator.clipboard.writeText` silently stops working.
 */
export type BridgeEvent = { kind: "diagnostics"; diagnostics: Diagnostics };

export interface BridgeEnvelope<T> {
  channel: typeof BRIDGE_REQUEST | typeof BRIDGE_RESPONSE;
  id: number;
  payload: T;
}

export function isBridgeEnvelope<T>(
  data: unknown,
  channel: string,
): data is BridgeEnvelope<T> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as BridgeEnvelope<T>).channel === channel &&
    typeof (data as BridgeEnvelope<T>).id === "number"
  );
}

export function isBridgeEventMessage(
  data: unknown,
): data is { channel: typeof BRIDGE_EVENT; payload: BridgeEvent } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { channel?: string }).channel === BRIDGE_EVENT
  );
}

// -----------------------------------------------------------------------------
// content ↔ background
// -----------------------------------------------------------------------------

export type RuntimeMessage =
  /**
   * Photograph the visible tab and hand back a PNG data URL of the whole viewport.
   * Only the service worker can call `captureVisibleTab`; cropping and saving stay
   * in the content script, which — unlike an MV3 service worker — has a canvas,
   * `URL.createObjectURL`, and a document to hang a download anchor off.
   */
  | { kind: "capture" }
  /** Reflect the annotation count on the toolbar icon. */
  | { kind: "badge"; count: number }
  /** background → content, when the keyboard command fires or the popup asks. */
  | { kind: "toggle-inspect" }
  /** background/popup → content, after settings changed. */
  | { kind: "settings-changed" }
  /** popup → background, asking for the active tab's annotation count. */
  | { kind: "get-status" }
  /**
   * background → content, from the right-click menu.
   *
   * Carries no element and no coordinates, because `chrome.contextMenus` gives an
   * extension neither: `OnClickData` has the frame, the page URL and any selection, and
   * nothing about what was under the pointer. The content script therefore records the
   * element on `contextmenu` — which fires *before* the menu opens — and this message is
   * only the instruction to use what was recorded.
   *
   * `selection` distinguishes the two menu items: the element one annotates what was
   * right-clicked, the selection one annotates the highlighted text.
   *
   * `inFrame` is true when the click happened inside an iframe. The composer is a
   * top-frame thing, so that case is reported rather than half-handled — see
   * `docs/context-menu/context.md`.
   */
  | { kind: "annotate-context"; selection: boolean; inFrame: boolean };

export type RuntimeResponse =
  | { ok: true; dataUrl?: string; count?: number; active?: boolean }
  | { ok: false; error: string };
