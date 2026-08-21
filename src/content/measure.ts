// =============================================================================
// Measuring — arithmetic over rects and computed styles
// =============================================================================
//
// This file reads the DOM and nothing else. No bridge, no framework knowledge, no
// state — the same contract `identify.ts` keeps, and for the same reason: a measured
// figure has to be exactly as trustworthy on a minified production build as on a dev
// server, and it is the only part of the report that can promise that.
//
// Sizes are **rendered** pixels — the box as it is actually painted — because that is
// what a reviewer is looking at when they say something is too small. The four bands are
// layout pixels, because `getComputedStyle` has no other kind. The two agree on every
// untransformed element, and `BoxModel.scaled` is set on the ones where they do not.
// =============================================================================

import type {
  BoxModel,
  Containment,
  ContrastReport,
  GapGeometry,
  Rgba,
  Sides,
  StyleSummary,
} from "../shared/types";

/** Everything with a viewport-space box. `DOMRect` satisfies it structurally. */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Two decimal places, trailing zeros gone, and never `-0`.
 *
 * Not `Math.round`. A browser's own inspector rounds to integers, which silently
 * turns the half-pixel seam a reviewer is pointing at into `0px` — the one figure
 * that would make them doubt their own eyes.
 */
export function roundPx(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `padding-top` … `padding-left`, or `border-top-width` … when `suffix` is given. */
function sides(style: CSSStyleDeclaration, prefix: string, suffix = ""): Sides {
  return {
    top: roundPx(px(style.getPropertyValue(`${prefix}-top${suffix}`))),
    right: roundPx(px(style.getPropertyValue(`${prefix}-right${suffix}`))),
    bottom: roundPx(px(style.getPropertyValue(`${prefix}-bottom${suffix}`))),
    left: roundPx(px(style.getPropertyValue(`${prefix}-left${suffix}`))),
  };
}

/**
 * The four bands, plus whether the element is drawn at these numbers.
 *
 * The border box is **read from the rect**, not derived from computed `width`. Computed
 * `width` respects `box-sizing`: it is the content box under `content-box` and the
 * border box under `border-box`, and Chrome's own UA stylesheet puts `<button>` in the
 * second group. Deriving from it therefore over-counts the padding on most of the
 * modern web — measured on a plain `<button>`, a 296px control reported 320px.
 *
 * So the rect is the one source of truth for the outside, and the content box is what
 * is left after the bands are taken off it.
 */
export function readBoxModel(
  element: Element,
  style: CSSStyleDeclaration = getComputedStyle(element),
): BoxModel {
  const padding = sides(style, "padding");
  const border = sides(style, "border", "-width");
  const margin = sides(style, "margin");

  const rect = element.getBoundingClientRect();
  const width = roundPx(rect.width);
  const height = roundPx(rect.height);

  const content = {
    width: roundPx(rect.width - padding.left - padding.right - border.left - border.right),
    height: roundPx(rect.height - padding.top - padding.bottom - border.top - border.bottom),
  };

  // `offsetWidth` is the layout border box, integer-rounded and immune to transforms;
  // the rect is the painted one. Comparing them catches a transform, a page zoom and a
  // scaled ancestor alike, without walking the tree. The 1px tolerance is the rounding
  // in `offsetWidth`, not slack. SVG has no `offsetWidth`, so it is never flagged.
  const layout =
    element instanceof HTMLElement
      ? { width: element.offsetWidth, height: element.offsetHeight }
      : null;
  const scaled =
    layout !== null &&
    (Math.abs(rect.width - layout.width) > 1 || Math.abs(rect.height - layout.height) > 1);

  return { width, height, content, padding, border, margin, scaled };
}

function contains(outer: RectLike, inner: RectLike): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

/**
 * The space between two rects, per axis.
 *
 * One expression covers apart, touching and overlapping, with no branch to get the
 * sign wrong in: the overlap along an axis is `min(rights) - max(lefts)`, so its
 * negation is the empty space — positive when they are apart, zero when they touch,
 * negative by the overlap when they are not.
 */
export function measureGap(a: RectLike, b: RectLike): GapGeometry {
  const gap = {
    x: roundPx(-(Math.min(a.right, b.right) - Math.max(a.left, b.left))),
    y: roundPx(-(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))),
  };

  const edges: Sides = {
    top: roundPx(b.top - a.top),
    right: roundPx(b.right - a.right),
    bottom: roundPx(b.bottom - a.bottom),
    left: roundPx(b.left - a.left),
  };

  const center = {
    x: roundPx((b.left + b.right) / 2 - (a.left + a.right) / 2),
    y: roundPx((b.top + b.bottom) / 2 - (a.top + a.bottom) / 2),
  };

  let containment: Containment = "none";
  if (contains(a, b)) containment = "b-inside-a";
  else if (contains(b, a)) containment = "a-inside-b";

  return { gap, edges, center, containment };
}

// -----------------------------------------------------------------------------
// Style summary — what the overlay shows next to the box
// -----------------------------------------------------------------------------

const RGB = /^rgba?\(([^)]+)\)$/;

/**
 * A computed `rgb()`/`rgba()` string as channels, or `null` when it is neither.
 *
 * Lifted out of `toHex` because contrast needs the numbers, not the string. Two callers
 * parsing the same value two different ways — one of them by parsing the other's output
 * back — is how they start disagreeing about what `transparent` means.
 *
 * Chrome has begun answering some declarations in `color(srgb …)`. Those return `null`
 * rather than a guess: a wrong swatch, or a wrong contrast figure, is worse than an
 * unfamiliar string the reader can still look up.
 */
export function parseRgb(value: string): Rgba | null {
  const match = RGB.exec(value.trim());
  if (!match) return null;

  const parts = match[1].split(",").map((part) => Number.parseFloat(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;

  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** `rgb(37, 99, 235)` → `#2563eb`. Eight digits when it is not opaque. */
export function toHex(value: string): string {
  const colour = parseRgb(value);
  if (!colour) return value;
  if (colour.a === 0) return "transparent";

  const pair = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  const hex = `#${pair(colour.r)}${pair(colour.g)}${pair(colour.b)}`;
  return colour.a === 1 ? hex : `${hex}${pair(colour.a * 255)}`;
}

// -----------------------------------------------------------------------------
// Contrast
// -----------------------------------------------------------------------------

/** WCAG 2.x relative luminance. The 0.03928 knee and the 2.4 exponent are from the spec. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Source-over: what the eye actually sees when the foreground is not opaque. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/**
 * The WCAG ratio, 1 to 21, rounded to two places.
 *
 * The foreground is composited over the background first. Taking the ratio on a
 * half-transparent black would report 21:1 for text that is visibly grey — a checker
 * that errs in the *reassuring* direction is worse than no checker at all.
 */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = luminance(composite(foreground, background));
  const bg = luminance(background);
  const [lighter, darker] = fg > bg ? [fg, bg] : [bg, fg];
  return roundPx((lighter + 0.05) / (darker + 0.05));
}

/**
 * The ratio plus the two verdicts.
 *
 * "Large" is WCAG's definition and not the obvious one: **≥ 24px, or ≥ 18.66px when
 * bold** — not 18px, and bold means weight ≥ 700. Getting it wrong moves the pass mark
 * by 1.5:1 and quietly passes text that fails.
 */
export function contrastReport(
  foreground: Rgba,
  background: Rgba,
  fontSize: number,
  fontWeight: number,
): ContrastReport {
  const ratio = contrastRatio(foreground, background);
  const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);

  return {
    ratio,
    large,
    aa: ratio >= (large ? 3 : 4.5),
    aaa: ratio >= (large ? 4.5 : 7),
  };
}

/**
 * The first background actually painted behind this element.
 *
 * Most elements declare none, so a swatch showing the element's own `background-color`
 * says `transparent` on nearly everything — true, and useless. Walking up until
 * something opaque appears is what a reader means by "what colour is it on".
 *
 * A gradient or an image cannot be reduced to one swatch, so it is reported as a flag
 * rather than sampled. Sampling a pixel is the eyedropper's job, not this one's.
 */
function effectiveBackground(element: Element): {
  color: string;
  rgba: Rgba | null;
  inherited: boolean;
  image: boolean;
} {
  let current: Element | null = element;
  let inherited = false;

  while (current) {
    const style = getComputedStyle(current);
    if (style.backgroundImage !== "none") {
      return { color: toHex(style.backgroundColor), rgba: null, inherited, image: true };
    }
    const rgba = parseRgb(style.backgroundColor);
    if (rgba && rgba.a > 0) {
      return { color: toHex(style.backgroundColor), rgba, inherited, image: false };
    }

    current = current.parentElement;
    inherited = true;
  }

  return { color: "transparent", rgba: null, inherited: false, image: false };
}

/**
 * Does this element paint any text of its own?
 *
 * A direct child text node, not `textContent` — that would inherit every descendant's
 * words and hand back a contrast figure for a whole page section whose wrapper paints
 * nothing. `color` on a wrapper colours nothing, and a ratio for it is a number with no
 * referent.
 */
function hasOwnText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) return true;
  }
  return false;
}

/**
 * `style` is threaded in so the caller can share one declaration with `readBoxModel`.
 * Reading a property off it is what forces the style recalculation, and this runs at
 * pointermove frequency.
 */
export function readStyleSummary(
  element: Element,
  style: CSSStyleDeclaration = getComputedStyle(element),
): StyleSummary {
  const background = effectiveBackground(element);
  // A whole font stack does not fit and does not help; the first family is the answer.
  const family = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
  const radius = style.borderRadius;

  // `gap` computes to `normal` on everything that is not a flex or grid container, and
  // reporting it there would be reporting a property with no effect — the panel's job is
  // what is in force, not what the cascade happens to hold.
  const laysOut = style.display.includes("flex") || style.display.includes("grid");
  const gap = laysOut && style.gap && style.gap !== "normal" && style.gap !== "0px" ? style.gap : "";

  // Withheld rather than guessed at whenever it cannot be taken honestly: no text of its
  // own, nothing painted behind it, an image behind it, or a colour we could not parse.
  const foreground = parseRgb(style.color);
  const contrast =
    foreground && background.rgba && hasOwnText(element)
      ? contrastReport(
          foreground,
          background.rgba,
          Number.parseFloat(style.fontSize) || 0,
          Number.parseInt(style.fontWeight, 10) || 400,
        )
      : undefined;

  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontFamily: family,
    fontWeight: style.fontWeight,
    color: toHex(style.color),
    background: background.color,
    backgroundInherited: background.inherited,
    backgroundIsImage: background.image,
    contrast,
    display: style.display,
    radius: radius === "0px" ? "" : radius,
    gap,
    boxSizing: style.boxSizing,
    textAlign: style.textAlign,
  };
}
