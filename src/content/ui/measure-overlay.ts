// =============================================================================
// Measurement overlay — bands, size badge, dimension lines
// =============================================================================
//
// Kept out of `overlay.ts` deliberately. That class owns the hover highlight and the
// marquee, and `showHighlights` runs at pointermove frequency — it pools its boxes
// specifically to avoid DOM churn there. Bands, a badge and two dimension lines are a
// third job with a different lifetime: they belong to one mode, not to every hover.
// Sharing the class would make every hover in `point` mode pay for code it never draws.
//
// The anchor lives here rather than in `content/index.ts` for the same reason the UI
// classes own their own state everywhere else in this folder: that file is 1800 lines,
// and every mode that put its state there is part of the reason.
//
// Every node is created once, in the constructor, and moved by style writes afterwards.
// =============================================================================

import type { BoxModel, GapGeometry, Sides, StyleSummary } from "../../shared/types";
import { h } from "./dom";

/** Viewport-space box. `DOMRect` satisfies it structurally. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Four strips make a band; the middle is left alone so the content stays readable. */
type Strips = [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

/** Which sides of a band ended up carrying their own figure. */
interface DrawnSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * How thick a strip has to be before a number is drawn inside it.
 *
 * A figure crammed into an 8px band is illegible and, worse, overflows into the content
 * it is describing. Thin bands are not left unlabelled though — the readout carries the
 * full `padding` and `margin` shorthands regardless, which is the other half of why
 * that panel exists.
 */
const LABEL_MIN_THICKNESS = 14;

/** Kept between the panel and the viewport edge. */
const EDGE = 8;
/** `.measure-readout` in CSS; the fallback before the panel has been laid out. */
const PANEL_WIDTH = 216;

function strips(layer: HTMLElement, variant: "padding" | "margin"): Strips {
  const one = () =>
    h("div", { class: `measure-band measure-band--${variant}`, style: { display: "none" } });
  // Written out rather than `Array.from(...) as Strips`: the tuple is what lets
  // `paintBand` destructure to top/right/bottom/left and be read as CSS shorthand.
  const made: Strips = [one(), one(), one(), one()];
  layer.append(...made);
  return made;
}

function place(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  // A zero-width strip is a band that is not there. Drawing it would leave a hairline
  // of colour on the edge, which reads as a 1px border the element does not have.
  if (width <= 0 || height <= 0) {
    element.style.display = "none";
    return;
  }
  element.style.display = "block";
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function hide(...elements: HTMLElement[]): void {
  for (const element of elements) element.style.display = "none";
}

export class MeasureOverlay {
  private readonly padding: Strips;
  private readonly margin: Strips;
  private readonly badge: HTMLElement;
  private readonly contentEdge: HTMLElement;
  private readonly marginEdge: HTMLElement;
  private readonly bandLabels: HTMLElement[] = [];
  private readonly readout: HTMLElement;
  private readonly anchorBox: HTMLElement;
  private readonly lineH: HTMLElement;
  private readonly lineV: HTMLElement;
  private readonly labelH: HTMLElement;
  private readonly labelV: HTMLElement;

  /** The element a gap is measured *from*, or null before the first click. */
  private anchored: Element | null = null;

  constructor(layer: HTMLElement) {
    // Margin first so padding paints over it where the two meet.
    this.margin = strips(layer, "margin");
    this.padding = strips(layer, "padding");

    this.anchorBox = h("div", { class: "measure-anchor", style: { display: "none" } });
    this.badge = h("div", { class: "measure-badge", style: { display: "none" } });
    // Where each region actually ends. The fills alone are translucent, so on a page
    // with a strong background colour they wash out and the bands read as a vague tint
    // rather than as a measured region — which is the whole thing being measured.
    this.contentEdge = h("div", {
      class: "measure-edge measure-edge--content",
      style: { display: "none" },
    });
    this.marginEdge = h("div", {
      class: "measure-edge measure-edge--margin",
      style: { display: "none" },
    });
    // Eight: four padding strips and four margin strips, in that order.
    for (let index = 0; index < 8; index++) {
      this.bandLabels.push(h("div", { class: "measure-band-label", style: { display: "none" } }));
    }
    this.readout = h("div", { class: "measure-readout", style: { display: "none" } });
    this.lineH = h("div", { class: "measure-line", style: { display: "none" } });
    this.lineV = h("div", { class: "measure-line measure-line--v", style: { display: "none" } });
    this.labelH = h("div", { class: "measure-label", style: { display: "none" } });
    this.labelV = h("div", { class: "measure-label", style: { display: "none" } });

    layer.append(
      this.anchorBox,
      this.badge,
      this.marginEdge,
      this.contentEdge,
      ...this.bandLabels,
      this.readout,
      this.lineH,
      this.lineV,
      this.labelH,
      this.labelV,
    );
  }

  get anchor(): Element | null {
    // A node the page has re-rendered away measures nothing; treat it as never set.
    if (this.anchored && !this.anchored.isConnected) this.anchored = null;
    return this.anchored;
  }

  setAnchor(element: Element | null): void {
    this.anchored = element;
    if (!element) {
      hide(this.anchorBox);
      this.hideGap();
      return;
    }
    this.syncAnchor();
  }

  /** Redraw the anchor outline where the element is now — after a scroll or a resize. */
  syncAnchor(): void {
    const element = this.anchor;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    place(this.anchorBox, rect.left, rect.top, rect.width, rect.height);
  }

  // ---------------------------------------------------------------------------
  // Box model
  // ---------------------------------------------------------------------------

  showBox(rect: Box, box: BoxModel, style: StyleSummary, label: string): void {
    // The readout dims whatever the bands managed to say for themselves, so it has to
    // run second and be told what they did.
    const drawn = {
      margin: this.paintBand(this.margin, rect, box.margin, "outside", 4),
      padding: this.paintBand(this.padding, this.paddingBox(rect, box.border), box.padding, "inside", 0),
    };

    this.paintEdges(rect, box);
    this.paintReadout(rect, box, style, drawn, label);

    this.badge.style.display = "block";
    this.badge.textContent = box.scaled
      ? `${box.width}×${box.height} (scaled)`
      : `${box.width}×${box.height}`;
    this.badge.style.left = `${rect.left}px`;
    // Under the box, unless the box is against the bottom of the viewport.
    const below = rect.bottom + 4;
    const fits = below + 18 < window.innerHeight;
    this.badge.style.top = `${fits ? below : Math.max(0, rect.top - 20)}px`;
  }

  hideBox(): void {
    hide(
      ...this.margin,
      ...this.padding,
      ...this.bandLabels,
      this.badge,
      this.readout,
      this.contentEdge,
      this.marginEdge,
    );
  }

  /**
   * The two boundaries the fills cannot draw for themselves.
   *
   * Three regions meet at two lines: margin ends where the border box begins, and
   * padding ends where the content begins. The border box already has a line — the
   * hover highlight's own accent border — so only these two are missing, and without
   * them a shaded band on a coloured page is a tint with no edge.
   *
   * Drawn even when the band either side is zero: an element with no padding still has
   * a content edge, and it is the same line either way.
   */
  private paintEdges(rect: Box, box: BoxModel): void {
    const { margin, padding, border } = box;
    place(
      this.marginEdge,
      rect.left - margin.left,
      rect.top - margin.top,
      rect.width + margin.left + margin.right,
      rect.height + margin.top + margin.bottom,
    );
    place(
      this.contentEdge,
      rect.left + border.left + padding.left,
      rect.top + border.top + padding.top,
      rect.width - border.left - border.right - padding.left - padding.right,
      rect.height - border.top - border.bottom - padding.top - padding.bottom,
    );
  }

  /**
   * Everything the bands cannot say: the shorthands in full, the type, and the colour
   * the element is actually painted on.
   *
   * Sits under the badge, and flips above the element when there is no room — the same
   * "prefer, flip" the highlight label already does, for the same reason.
   */
  /**
   * A grouped inspector panel: a header naming the element, then Box Model, Appearance
   * and Text.
   *
   * Grouped rather than a flat list, because a dozen `property: value` pairs in a column
   * are read linearly and therefore not read at all — the headings let the eye jump to
   * the third of it that matters. A row is emitted only when the property is in force: a
   * `gap` on a non-flex element, or a zero border, is a line that costs attention and
   * carries nothing.
   *
   * `padding` and `margin` keep their per-side treatment rather than the CSS shorthand
   * the rest of the panel uses. A shorthand only reads if you already know its order,
   * and the sides whose band was too thin to label are exactly what this panel exists to
   * show. Sides the band did label are dimmed.
   */
  private paintReadout(
    rect: Box,
    box: BoxModel,
    style: StyleSummary,
    drawn: { padding: DrawnSides; margin: DrawnSides },
    label: string,
  ): void {
    const rows: HTMLElement[] = [];
    const any = (sides: Sides) => sides.top || sides.right || sides.bottom || sides.left;

    rows.push(h("div", { class: "measure-readout__head", text: label }));

    rows.push(this.section("Box Model"));
    rows.push(this.pair("width", `${box.width}px`));
    rows.push(this.pair("height", `${box.height}px`));
    rows.push(this.pair("display", style.display));
    if (style.gap) rows.push(this.pair("gap", style.gap));
    if (any(box.padding)) rows.push(this.sideRow("padding", box.padding, drawn.padding));
    if (any(box.margin)) rows.push(this.sideRow("margin", box.margin, drawn.margin));
    if (any(box.border)) rows.push(this.pair("border", shorthand(box.border)));
    rows.push(this.pair("box-sizing", style.boxSizing));

    rows.push(this.section("Appearance"));
    if (style.radius) rows.push(this.pair("border-radius", style.radius));
    rows.push(this.pair("color", style.color, style.color));
    rows.push(
      this.pair(
        "background",
        style.backgroundIsImage
          ? "image"
          : style.backgroundInherited
            ? `${style.background} (inherited)`
            : style.background,
        style.backgroundIsImage ? undefined : style.background,
      ),
    );
    if (style.contrast) {
      const verdict = style.contrast.aaa
        ? "passes AA and AAA"
        : style.contrast.aa
          ? "passes AA"
          : "fails AA";
      const row = this.pair("contrast", `${style.contrast.ratio}:1 ${verdict}`);
      row.classList.add(
        style.contrast.aa ? "measure-readout__row--pass" : "measure-readout__row--fail",
      );
      rows.push(row);
    }

    rows.push(this.section("Text"));
    rows.push(this.pair("font-family", style.fontFamily));
    rows.push(this.pair("font-size", style.fontSize));
    rows.push(this.pair("font-weight", style.fontWeight));
    rows.push(this.pair("line-height", style.lineHeight));
    rows.push(this.pair("text-align", style.textAlign));

    this.readout.replaceChildren(...rows);

    // Measured after the rows are in: a panel whose contents have not been written yet
    // reports the height it is about to lose — the same trap `SettingsCard.anchorTo`
    // documents. Below the element by preference, above it when that does not fit, and
    // pinned to the viewport when neither does. An unreadable panel helps nobody.
    this.readout.style.display = "block";
    const width = this.readout.offsetWidth || PANEL_WIDTH;
    this.readout.style.left = `${Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE))}px`;

    const height = this.readout.offsetHeight;
    const below = rect.bottom + 24;
    if (below + height + EDGE <= window.innerHeight) {
      this.readout.style.top = `${below}px`;
      return;
    }
    const above = rect.top - height - 8;
    this.readout.style.top = `${above >= EDGE ? above : Math.max(EDGE, window.innerHeight - height - EDGE)}px`;
  }

  /** A heading inside the panel. */
  private section(title: string): HTMLElement {
    return h("div", { class: "measure-readout__section", text: title });
  }

  /** `property: value`, with an optional swatch when the value names a colour. */
  private pair(name: string, value: string, swatch?: string): HTMLElement {
    return h(
      "div",
      { class: "measure-readout__row" },
      h("span", { class: "measure-readout__key", text: name }),
      swatch && swatch !== "transparent"
        ? h("span", { class: "measure-readout__swatch", style: { background: swatch } })
        : null,
      h("span", { class: "measure-readout__value", text: value }),
    );
  }

  /** The border box shrunk by its own borders — where padding actually starts. */
  private paddingBox(rect: Box, border: Sides): Box {
    const left = rect.left + border.left;
    const top = rect.top + border.top;
    const width = rect.width - border.left - border.right;
    const height = rect.height - border.top - border.bottom;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  private paintBand(
    band: Strips,
    rect: Box,
    sides: Sides,
    side: "inside" | "outside",
    labelOffset: number,
  ): DrawnSides {
    const [top, right, bottom, left] = band;
    const outside = side === "outside";

    // Outside: the strips sit beyond the box, so the horizontal pair has to span the
    // widened box or the corners are left blank. Inside: they sit within it.
    const spanLeft = outside ? rect.left - sides.left : rect.left;
    const spanWidth = outside ? rect.width + sides.left + sides.right : rect.width;

    place(top, spanLeft, outside ? rect.top - sides.top : rect.top, spanWidth, sides.top);
    place(
      bottom,
      spanLeft,
      outside ? rect.bottom : rect.bottom - sides.bottom,
      spanWidth,
      sides.bottom,
    );
    place(left, outside ? rect.left - sides.left : rect.left, rect.top, sides.left, rect.height);
    place(
      right,
      outside ? rect.right : rect.right - sides.right,
      rect.top,
      sides.right,
      rect.height,
    );

    // A strip that is drawn and thick enough gets its figure written on it. The offset
    // separates the padding pool from the margin pool in the shared label array.
    const thickness = [sides.top, sides.right, sides.bottom, sides.left];
    const labelled = [false, false, false, false];
    band.forEach((strip, index) => {
      const label = this.bandLabels[labelOffset + index];
      if (strip.style.display === "none" || thickness[index] < LABEL_MIN_THICKNESS) {
        label.style.display = "none";
        return;
      }
      labelled[index] = true;
      const box = {
        left: Number.parseFloat(strip.style.left),
        top: Number.parseFloat(strip.style.top),
        width: Number.parseFloat(strip.style.width),
        height: Number.parseFloat(strip.style.height),
      };
      this.label(label, String(thickness[index]), box.left + box.width / 2, box.top + box.height / 2);
      label.className = "measure-band-label";
    });

    return { top: labelled[0], right: labelled[1], bottom: labelled[2], left: labelled[3] };
  }

  // ---------------------------------------------------------------------------
  // Gap
  // ---------------------------------------------------------------------------

  /**
   * Two lines at most: one per axis, and only where there is clear space to span.
   *
   * Overlapping or nested rects get no line — a dimension line drawn across an overlap
   * points at nothing a reader can act on. The two outlines already say what is going
   * on, and the report carries the edge deltas that are the real answer.
   */
  showGap(a: Box, b: Box, geometry: GapGeometry): void {
    const { gap } = geometry;

    if (gap.x > 0) {
      const left = Math.min(a.right, b.right);
      const overlapsVertically = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      const y = overlapsVertically
        ? (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2
        : (a.top + a.bottom + b.top + b.bottom) / 4;

      place(this.lineH, left, y, gap.x, 1);
      this.label(this.labelH, `${gap.x}px`, left + gap.x / 2, y);
    } else {
      hide(this.lineH, this.labelH);
    }

    if (gap.y > 0) {
      const top = Math.min(a.bottom, b.bottom);
      const overlapsHorizontally = Math.min(a.right, b.right) > Math.max(a.left, b.left);
      const x = overlapsHorizontally
        ? (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2
        : (a.left + a.right + b.left + b.right) / 4;

      place(this.lineV, x, top, 1, gap.y);
      this.label(this.labelV, `${gap.y}px`, x, top + gap.y / 2);
    } else {
      hide(this.lineV, this.labelV);
    }

    if (gap.x <= 0 && gap.y <= 0 && geometry.containment !== "none") {
      this.label(this.labelH, "inside", (b.left + b.right) / 2, b.top - 10);
    }
  }

  hideGap(): void {
    hide(this.lineH, this.lineV, this.labelH, this.labelV);
  }

  hideAll(): void {
    this.hideBox();
    this.hideGap();
    hide(this.anchorBox);
    this.anchored = null;
  }

  private sideRow(name: "padding" | "margin", sides: Sides, drawn: DrawnSides): HTMLElement {
    const cell = (initial: string, value: number, alreadyDrawn: boolean) =>
      h("span", {
        class: `measure-readout__side${alreadyDrawn ? " measure-readout__side--drawn" : ""}`,
        text: `${initial} ${value}`,
      });

    return h(
      "div",
      { class: "measure-readout__row" },
      h("span", { class: `measure-readout__dot measure-readout__dot--${name}` }),
      h("span", { class: "measure-readout__key measure-readout__key--side", text: name }),
      cell("T", sides.top, drawn.top),
      cell("R", sides.right, drawn.right),
      cell("B", sides.bottom, drawn.bottom),
      cell("L", sides.left, drawn.left),
    );
  }

  /** Centred on the point by a CSS transform, so no layout read is needed. */
  private label(element: HTMLElement, text: string, x: number, y: number): void {
    element.style.display = "block";
    element.textContent = text;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }
}

/** `8px 12px`, collapsed the way a stylesheet would write it. */
function shorthand(sides: Sides): string {
  const unit = (value: number) => (value === 0 ? "0" : `${value}px`);
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) return unit(top);
  if (top === bottom && left === right) return `${unit(top)} ${unit(right)}`;
  return `${unit(top)} ${unit(right)} ${unit(bottom)} ${unit(left)}`;
}
