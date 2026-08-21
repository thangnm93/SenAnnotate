// =============================================================================
// Layout grid overlay
// =============================================================================
//
// The question this answers is the one the other two measurement surfaces cannot:
// not *how far apart are these* or *is this readable*, but *is this aligned to
// anything at all*. A 24px gap tells you nothing if the column it belongs to starts
// three pixels off every other card.
//
// Viewport-relative and deliberately not document-relative — a page grid is a property
// of the window the design was drawn for, so it must not scroll away. That is the
// opposite of the rule guides follow, and the difference is the point: a guide is
// aligned to *content*, a grid is aligned to the *frame*.
//
// `pointer-events: none` throughout. Nothing here is interactive, so nothing here takes
// a region of the page away from the page.
// =============================================================================

import { h } from "./dom";

export interface GridConfig {
  columns: number;
  gutter: number;
  margin: number;
}

export class GridOverlay {
  private readonly root: HTMLElement;
  private readonly bands: HTMLElement[] = [];

  constructor(layer: HTMLElement) {
    this.root = h("div", { class: "grid-overlay", style: { display: "none" } });
    layer.append(this.root);
  }

  /**
   * Draw `columns` bands inside the margins.
   *
   * A column is what is left after the gutters: there are `columns - 1` of them between
   * `columns` bands, never one at each end — a grid with a gutter outside its first
   * column is a grid with a wider margin, and saying it twice is how the two numbers
   * start disagreeing with the stylesheet they are being checked against.
   */
  render({ columns, gutter, margin }: GridConfig): void {
    const available = window.innerWidth - margin * 2 - gutter * (columns - 1);
    const width = available / columns;

    // Narrow window, wide margins, many columns: the arithmetic goes negative long
    // before it looks wrong on screen. Drawing nothing is the honest answer.
    if (width <= 0) {
      this.hide();
      return;
    }

    while (this.bands.length < columns) {
      const band = h("div", { class: "grid-overlay__band" });
      this.bands.push(band);
      this.root.append(band);
    }
    for (let i = columns; i < this.bands.length; i++) this.bands[i].style.display = "none";

    this.root.style.display = "block";
    for (let i = 0; i < columns; i++) {
      const band = this.bands[i];
      band.style.display = "block";
      band.style.left = `${margin + i * (width + gutter)}px`;
      band.style.width = `${width}px`;
    }
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
