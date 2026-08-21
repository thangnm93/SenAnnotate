// =============================================================================
// Shadow root host
// =============================================================================
//
// One fixed, full-viewport, `pointer-events: none` host holds the entire overlay.
// Individual pieces opt back into pointer events, so hovering the page still
// reaches the page.
//
// The host is attached to `document.documentElement`, not `body` — a Vue app that
// re-renders or replaces `body` would otherwise take the toolbar with it.
// =============================================================================

import { DEFAULT_ACCENT, accentTheme } from "../../shared/accent";
import { UI_ATTR } from "../../shared/protocol";
import type { ThemePreference } from "../../shared/types";
import styles from "./styles.css";
import { h, icon } from "./dom";

export interface UiRoot {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** Hover highlight and marquee rectangle. */
  overlayLayer: HTMLElement;
  /** Numbered pins. */
  markerLayer: HTMLElement;
  /** Toolbar, composer, panel. */
  cardLayer: HTMLElement;
  setTheme(preference: ThemePreference): void;
  /** Recolour the overlay. `#rrggbb`; anything else falls back to the default. */
  setAccent(color: string): void;
  toast(message: string, tone?: "success" | "error"): void;
  /** Re-check which top-layer element the host has to live inside, and re-fit it. */
  syncPlacement(): void;
  destroy(): void;
}

export function createUiRoot(): UiRoot {
  const host = document.createElement("div");
  host.setAttribute(UI_ATTR, "");
  // Belt and braces: the stylesheet positions the host, but if the page somehow
  // wins the cascade before our styles load, these keep it out of the layout.
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  // Not paranoia — measured. A page rule matching the host beats every `:host` rule, and
  // this host is fixed, full-viewport and at the top of the z order: one page rule giving
  // it a background paints an opaque sheet over the entire site. daisyUI's
  // `:root, [data-theme] { background-color: … }` did exactly that.
  host.style.setProperty("background", "transparent", "important");

  const shadow = host.attachShadow({ mode: "open" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [sheet];

  const overlayLayer = h("div", { class: "layer layer--overlay" });
  const markerLayer = h("div", { class: "markers" });
  const cardLayer = h("div", { class: "layer layer--cards" });
  shadow.append(overlayLayer, markerLayer, cardLayer);

  // ---------------------------------------------------------------------------
  // The top layer — the one thing `z-index: 2147483647` cannot outrank
  // ---------------------------------------------------------------------------
  //
  // `dialog.showModal()` and `requestFullscreen()` move page content into Chrome's *top
  // layer*, which is painted above the whole normal stacking order. Our maximum z-index does
  // not reach it, and while a modal dialog is open every element outside it is **inert** —
  // not hit-tested, not focusable, receiving no keystrokes. On `documentElement` the overlay
  // was therefore both hidden behind such a dialog and dead to the pointer: the toolbar could
  // not be clicked, and a composer opened before the dialog took no typing at all.
  //
  // Painting above it is not enough and was measured: promoted to `popover="manual"` the host
  // rendered over the dialog and stayed inert. Only a flat-tree descendant of the topmost
  // modal escapes, so that is where the host goes — in the top layer with it, where our
  // z-index applies again, and where the dialog's own content still hit-tests as itself so
  // hover and identification keep working. `docs/modal-top-layer/context.md` has the table of
  // rejected alternatives.

  /** The top-layer element the host must live inside, or `null` for `documentElement`. */
  const topLayerParent = (): Element | null => {
    // `:modal` matches both entrances: a dialog opened with `showModal()`, and the fullscreen
    // element. Document order is not top-layer order and the platform exposes no way to read
    // the real order, so the last match is the best approximation — and with the single modal
    // pages actually open, an exact one.
    const modals = document.querySelectorAll(":modal");
    for (let index = modals.length - 1; index >= 0; index -= 1) {
      const candidate = modals[index];
      if (candidate && candidate !== host && !host.contains(candidate)) return candidate;
    }
    return null;
  };

  // `position: fixed` resolves against the nearest ancestor that is a containing block for
  // fixed positioning. On `documentElement` that is always the viewport; inside a dialog it
  // is the *dialog* the moment the dialog has a `transform`, a `filter` or `contain: paint` —
  // all routine on an animated one. Measured, `inset: 0` then sized the host to the dialog,
  // which silently moves every coordinate we draw, since highlights are positioned inside
  // this box in viewport coordinates. So: set the simple case, measure it, and replace it
  // with explicit offsets when the measurement disagrees.
  //
  // `clientWidth/clientHeight`, not `innerWidth/innerHeight`: the containing block for a
  // fixed box is the initial containing block, which excludes the scrollbar. Comparing
  // against `innerWidth` would chase a ~15px phantom offset on every scrollable page.
  const fitToViewport = (): void => {
    host.style.setProperty("inset", "0", "important");
    host.style.removeProperty("width");
    host.style.removeProperty("height");
    host.style.removeProperty("transform");

    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const rect = host.getBoundingClientRect();
    const off = (a: number, b: number) => Math.abs(a - b) >= 1;
    if (!off(rect.left, 0) && !off(rect.top, 0) && !off(rect.width, width) && !off(rect.height, height)) {
      return;
    }

    // Moving the host is not enough on its own, and measuring proved it: every piece the
    // overlay draws — `.highlight`, `.marquee`, `.markers`, every `.card` — is itself
    // `position: fixed`, so each one resolves against the *nearest* fixed containing block,
    // which is the dialog, not this host. A transform here makes the host that containing
    // block, so all of them land back in the coordinate system we compute in. Without it a
    // highlight was drawn 398px right and 320px down of the element it named, and the
    // toolbar was dragged into the middle of the dialog — where the hover path then
    // correctly refused to highlight our own UI, so nothing highlighted at all.
    host.style.setProperty("transform", "translate(0)", "important");
    host.style.setProperty("inset", "auto", "important");
    host.style.setProperty("left", `${-rect.left}px`, "important");
    host.style.setProperty("top", `${-rect.top}px`, "important");
    host.style.setProperty("width", `${width}px`, "important");
    host.style.setProperty("height", `${height}px`, "important");
  };

  // An app that re-renders a dialog's children can take the host with it — a `childList`
  // observer scoped to the parent we moved into is cheap, where one over the whole document
  // would see every re-render on the page.
  const removalObserver = new MutationObserver(() => {
    if (!host.isConnected) syncPlacement();
  });

  const syncPlacement = (): void => {
    const parent = topLayerParent() ?? document.documentElement;
    if (host.parentElement !== parent) {
      parent.append(host);
      removalObserver.disconnect();
      if (parent !== document.documentElement) removalObserver.observe(parent, { childList: true });
    }
    fitToViewport();
  };

  syncPlacement();

  // No polling: `showModal()` and `close()` both toggle the `open` attribute, and fullscreen
  // announces itself. `attributeFilter` keeps this to records we asked for, so a busy app's
  // re-renders cost nothing here.
  const modalObserver = new MutationObserver(syncPlacement);
  modalObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("fullscreenchange", syncPlacement, true);

  // ---------------------------------------------------------------------------
  // Containment — our clicks are not the page's clicks
  // ---------------------------------------------------------------------------
  //
  // Pointer events are `composed: true`: a click on a toolbar button leaves the shadow
  // root, reaches `document`, and is **retargeted to the host** — which hangs off
  // `documentElement`, outside every dialog on the page. Any site that dismisses on "a
  // pointer event outside the dialog", far and away the most common pattern, therefore
  // closed its modal the moment the toolbar was touched, making a modal the one thing
  // that could not be annotated.
  //
  // Bubble phase on the host is the only seam that works. The capture-phase handlers in
  // `content/index.ts` run before the event reaches our shadow root, so stopping there
  // would cancel our own buttons instead; here, our inner listeners have already run and
  // `document` has not been reached yet.
  //
  // `stopPropagation`, never `stopImmediatePropagation` — other listeners on the host are
  // also ours.
  //
  // Keyboard events are deliberately absent: `keydown` on `document` is what implements
  // f / a / h / 1-2-3, and focus sits inside this shadow root after any toolbar click, so
  // stopping keystrokes here would disable every shortcut. The composer stops its own,
  // which is the right scope. `pointermove` is absent too — not a dismissal trigger, and
  // the hover path reads `elementFromPoint` rather than the event target.
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
    "touchend",
  ] as const) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  // Focus is the *default action* of `mousedown`, so cancelling it there is what keeps
  // `document.activeElement` where it was — inside the page's dialog. Without this, a
  // toolbar click moves focus into this shadow root, and a modal that closes when focus
  // leaves it is dismissed exactly as if we had clicked outside.
  //
  // Text fields are exempt: the composer's textarea has to be focusable and its caret
  // placeable. `composedPath()[0]` rather than `event.target`, which retargets to the host
  // and would hide which inner element was actually hit.
  //
  // Buttons still fire `click` after a cancelled `mousedown`; the cost is that text inside
  // the panel can no longer be selected by dragging, which nothing depends on.
  host.addEventListener("mousedown", (event) => {
    const hit = event.composedPath()[0];
    if (hit instanceof Element && hit.closest("input, textarea, select, [contenteditable]")) {
      return;
    }
    event.preventDefault();
  });

  // A focus trap — `focus-trap`, Radix, Headless UI all work this way — watches `focusin`
  // on `document` and pulls focus back when it lands outside the dialog. Ours lands in
  // this shadow root and retargets to the host, so without this the page fights the
  // composer for focus and wins: measured, every keystroke of the note went to the dialog
  // and the textarea stayed empty.
  //
  // What this cannot fix: a dialog's own `focusout` fires on the dialog, not in here, so a
  // modal that closes on focus loss still closes once the composer takes focus. Typing
  // requires focus, so that one is not solvable — but the annotation is captured before
  // the composer opens, so the report is complete either way.
  for (const type of ["focusin", "focusout"] as const) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = "auto";

  const applyTheme = () => {
    const dark = preference === "dark" || (preference === "auto" && darkQuery.matches);
    // Namespaced: a bare `data-theme` is what daisyUI and many themed sites select on.
    host.setAttribute("data-sa-theme", dark ? "dark" : "light");
  };

  darkQuery.addEventListener("change", applyTheme);
  applyTheme();

  // ---------------------------------------------------------------------------
  // Accent
  // ---------------------------------------------------------------------------
  //
  // Inline on the host, so it beats the `:host` rule the same way the positioning does.
  // The default is a deliberate no-op: the stylesheet's three oranges are hand-picked and
  // a derivation cannot reproduce them exactly, so leaving the setting alone has to leave
  // the shipped look untouched down to the pixel.
  const applyAccent = (color: string) => {
    if (color === DEFAULT_ACCENT) {
      for (const property of ["--sa-accent", "--sa-accent-strong", "--sa-accent-ink"]) {
        host.style.removeProperty(property);
      }
      return;
    }

    const { accent, strong, ink } = accentTheme(color);
    host.style.setProperty("--sa-accent", accent);
    host.style.setProperty("--sa-accent-strong", strong);
    host.style.setProperty("--sa-accent-ink", ink);
  };

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastElement: HTMLElement | null = null;
  let toastTimer: number | undefined;

  const toast = (message: string, tone: "success" | "error" = "success") => {
    toastElement?.remove();
    window.clearTimeout(toastTimer);

    toastElement = h(
      "div",
      { class: "toast", dataset: { tone } },
      icon(tone === "success" ? "check" : "close", 14),
      h("span", { text: message }),
    );
    cardLayer.append(toastElement);

    toastTimer = window.setTimeout(() => {
      toastElement?.remove();
      toastElement = null;
    }, 2200);
  };

  return {
    host,
    shadow,
    overlayLayer,
    markerLayer,
    cardLayer,
    setTheme(next) {
      preference = next;
      applyTheme();
    },
    setAccent: applyAccent,
    toast,
    syncPlacement,
    destroy() {
      darkQuery.removeEventListener("change", applyTheme);
      modalObserver.disconnect();
      removalObserver.disconnect();
      document.removeEventListener("fullscreenchange", syncPlacement, true);
      window.clearTimeout(toastTimer);
      host.remove();
    },
  };
}
