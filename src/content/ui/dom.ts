// =============================================================================
// Tiny DOM helpers
// =============================================================================
//
// The extension ships no runtime dependencies, so this is the whole "framework".
// It is deliberately small: `h` for elements, `icon` for the SVG set, and a couple
// of event helpers that return their own teardown.
// =============================================================================

import { UI_ATTR } from "../../shared/protocol";

type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string;
  title?: string;
  /**
   * Text content. There is deliberately no `html` counterpart: everything this UI
   * renders is either a user's own comment or text scraped off the page, and
   * neither may ever reach an HTML parser.
   */
  text?: string;
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
  }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (attrs.class) element.className = attrs.class;
  if (attrs.title) element.title = attrs.title;
  if (attrs.text !== undefined) element.textContent = attrs.text;
  if (attrs.style) Object.assign(element.style, attrs.style);
  if (attrs.dataset) Object.assign(element.dataset, attrs.dataset);
  if (attrs.attrs) {
    for (const [key, value] of Object.entries(attrs.attrs)) element.setAttribute(key, value);
  }
  if (attrs.on) {
    for (const [event, handler] of Object.entries(attrs.on)) {
      element.addEventListener(event, guarded(event, handler as EventListener));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }

  return element;
}

/**
 * The shadow root is `mode: "open"` — it has to be, or the e2e suite's locators could
 * not reach it — which means page scripts can reach in and dispatch synthetic events at
 * our buttons: a hostile page could "click" the screenshot button and drop files into
 * the user's Downloads, or clear their annotations.
 *
 * Synthetic events carry `isTrusted: false`, so activation events from a script are
 * dropped here, centrally. Real input — mouse, keyboard, and automation via CDP, which
 * is how the tests click — is `isTrusted: true` and unaffected.
 */
const ACTIVATION_EVENTS = new Set(["click", "mousedown", "mouseup", "pointerdown", "pointerup"]);

function guarded(event: string, handler: EventListener): EventListener {
  if (!ACTIVATION_EVENTS.has(event)) return handler;
  return (domEvent: Event) => {
    if (!domEvent.isTrusted) return;
    handler(domEvent);
  };
}

export function clear(element: Element): void {
  while (element.firstChild) element.firstChild.remove();
}

/**
 * Take a card off screen with its exit animation, then remove it.
 *
 * The caller drops its reference synchronously, so from everywhere else the card is
 * already gone — this node is nothing but the tail of the animation. `data-leaving`
 * both drives the CSS and lets a card reopened mid-exit find and clear its predecessor,
 * and pointer events stop immediately: a card you can still click after asking for it
 * to close is worse than one that snaps away.
 *
 * The timeout is not belt-and-braces. `animationend` never fires if the animation is
 * cancelled — a display change on an ancestor is enough — and a stranded card would sit
 * over the page forever.
 */
export function dismissCard(element: HTMLElement): void {
  if (element.dataset.leaving === "true") return;
  element.dataset.leaving = "true";

  const remove = () => element.remove();
  element.addEventListener("animationend", remove, { once: true });
  window.setTimeout(remove, 400);
}

/**
 * Focus one of our own elements without a focus trap on the page noticing.
 *
 * A trap — Reka UI, Radix and Headless UI are the same code — restores focus when it sees a
 * `focusout` whose `relatedTarget` is outside the dialog. That event fires on the **page's**
 * element and never travels through our host, so the propagation guards in `createUiRoot`
 * have nothing to stop: measured, the composer's textarea lost focus back to the dialog
 * before the first keystroke and the note went nowhere.
 *
 * What every implementation of that pattern shares is an early return on
 * `relatedTarget === null` — focus that left the document is the browser's business, not the
 * trap's. Blurring first produces exactly that event, so the trap sits still. The page's own
 * element receives the same `blur` it would have received anyway; only the `relatedTarget`
 * differs. `docs/modal-trap-refocus/` has the measurement and the rejected alternatives.
 */
export function takeFocus(element: HTMLElement, options?: FocusOptions): void {
  const active = document.activeElement;
  // Only when focus is coming from the page. If it is already ours, `focusout` does travel
  // through the host and is stopped there, and the extra blur would cost a caret flicker for
  // nothing. `body` and `documentElement` mean nothing was focused; blurring them is noise.
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement &&
    !active.hasAttribute(UI_ATTR)
  ) {
    active.blur();
  }
  element.focus(options);
}

/** Adds a listener and hands back the function that removes it. */
export function listen<K extends keyof DocumentEventMap>(
  target: Document | Window | Element,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}

// -----------------------------------------------------------------------------
// Icons — 24×24 stroke paths, drawn with `currentColor`
// -----------------------------------------------------------------------------

const PATHS: Record<string, string> = {
  cursor: "M4 3l7.5 17 2.4-6.6L20.5 11z",
  text: "M5 5h14M9 5v14M15 5v6",
  marquee: "M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3",
  snowflake: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M12 7l-2.2-2.2M12 7l2.2-2.2M12 17l-2.2 2.2M12 17l2.2 2.2",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  copy: "M9 9h10v10a2 2 0 01-2 2H9a2 2 0 01-2-2V9z M5 15V5a2 2 0 012-2h10",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3",
  close: "M6 6l12 12M18 6L6 18",
  camera: "M4 8a2 2 0 012-2h1.5l1-2h7l1 2H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z M12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  check: "M5 13l4 4L19 7",
  s: "M15.03 6.75A3.5 3.5 0 1 0 12 12A3.5 3.5 0 1 1 8.97 17.25",
  gear: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 006 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14.9H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V4a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z",
  pencil: "M4 20h4L20 8a2.8 2.8 0 10-4-4L4 16z",
  bug: "M9 7a3 3 0 016 0M8 7h8v6a4 4 0 01-8 0zM4 11h4M16 11h4M5 6l2 2M19 6l-2 2M5 17l2.5-1.5M19 17l-2.5-1.5",
  chevron: "M6 9l6 6 6-6",
  download: "M12 4v11M8 11l4 4 4-4M5 19h14",
  // A double-headed arrow: this button measures the distance between two things.
  arrows: "M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4",
  // An eyedropper: barrel on the diagonal, bulb at the top right.
  eyedropper: "M4 20h3l9.5-9.5M4 20v-3l9.5-9.5M16.5 10.5l3-3a2.1 2.1 0 00-3-3l-3 3M13.5 7.5l3 3",
};

export function icon(name: keyof typeof PATHS | string, size = 16): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name] ?? PATHS.cursor);
  svg.append(path);

  return svg;
}
