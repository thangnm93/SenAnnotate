// =============================================================================
// Screen rulers, and the guides dragged out of them
// =============================================================================
//
// This is the only surface in the extension that takes a region of the page away from
// the page. The host is `pointer-events: none` and pieces opt back in; a guide has to be
// draggable, so the strips and the guides opt in — and anything that does is a hole the
// page never sees a click through. In mode 4 a click is how an element gets anchored, so
// a guide lying across a button means that button cannot be anchored while it is there.
//
// That is why none of this renders unless the user asks for it, and why the guide's hit
// area (7px, a usable drag target) is wider than the line it paints (1px, the truth
// about where it is).
//
// **Guides are stored in document coordinates and painted at `documentY - scrollY`.**
// A guide is aligned to something on the page; one that slides away on scroll is aligned
// to nothing. The rulers label document coordinates for the same reason — a ruler that
// reads 0 at the top of the viewport tells you where your eyes are, not where the
// element is. That is the opposite of the rule `grid.ts` follows, deliberately.
// =============================================================================

import { h } from "./dom";

/** Thickness of each strip. Also the size of the dead band it costs the page. */
export const RULER_SIZE = 20;
/** A 1px drag target is unusable; the painted line stays 1px regardless. */
const GUIDE_HIT = 7;
const MINOR_TICK = 10;
const MAJOR_TICK = 100;
/** Dropped back within this distance of its own ruler, a guide is being thrown away. */
const DELETE_ZONE = RULER_SIZE + 4;

export type Axis = "x" | "y";

export interface Guide {
  id: string;
  axis: Axis;
  /** Document coordinate — `x` for a vertical guide, `y` for a horizontal one. */
  at: number;
}

export interface RulerCallbacks {
  /** Fired on drop, never per frame: this is what reaches `sessionStorage`. */
  onGuidesChanged(guides: Guide[]): void;
}

export class Rulers {
  private readonly layer: HTMLElement;
  private readonly top: HTMLElement;
  private readonly left: HTMLElement;
  private readonly corner: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly lines = new Map<string, HTMLElement>();

  private guides: Guide[] = [];
  private visible = false;
  private dragging: { guide: Guide; element: HTMLElement } | null = null;
  private nextId = 0;

  constructor(layer: HTMLElement, private readonly callbacks: RulerCallbacks) {
    this.layer = layer;
    this.top = h("div", { class: "ruler ruler--top", style: { display: "none" } });
    this.left = h("div", { class: "ruler ruler--left", style: { display: "none" } });
    // Covers the square where the two strips cross, so the tick labels do not collide.
    this.corner = h("div", { class: "ruler-corner", style: { display: "none" } });
    this.readout = h("div", { class: "guide-readout", style: { display: "none" } });
    layer.append(this.top, this.left, this.corner, this.readout);

    this.top.addEventListener("pointerdown", (event) => this.beginNew(event, "y"));
    this.left.addEventListener("pointerdown", (event) => this.beginNew(event, "x"));
  }

  setGuides(guides: Guide[]): void {
    this.guides = guides.map((guide) => ({ ...guide }));
    this.nextId = this.guides.length;
    this.repaintGuides();
  }

  show(visible: boolean): void {
    this.visible = visible;
    const display = visible ? "block" : "none";
    this.top.style.display = display;
    this.left.style.display = display;
    this.corner.style.display = display;
    if (!visible) {
      this.readout.style.display = "none";
      for (const line of this.lines.values()) line.style.display = "none";
      return;
    }
    this.paintTicks();
    this.repaintGuides();
  }

  /** Ticks are viewport-positioned but document-labelled, so a scroll relabels them. */
  sync(): void {
    if (!this.visible) return;
    this.paintTicks();
    this.repaintGuides();
  }

  // ---------------------------------------------------------------------------
  // Ticks
  // ---------------------------------------------------------------------------

  private paintTicks(): void {
    this.top.replaceChildren(...this.ticksFor("x"));
    this.left.replaceChildren(...this.ticksFor("y"));
  }

  private ticksFor(axis: Axis): HTMLElement[] {
    const scroll = axis === "x" ? window.scrollX : window.scrollY;
    const extent = axis === "x" ? window.innerWidth : window.innerHeight;
    const ticks: HTMLElement[] = [];

    // Start at the first whole tick at or after the scroll offset, so the ticks stay on
    // round document numbers rather than on round viewport ones.
    const first = Math.ceil(scroll / MINOR_TICK) * MINOR_TICK;
    for (let at = first; at < scroll + extent; at += MINOR_TICK) {
      const offset = at - scroll;
      const major = at % MAJOR_TICK === 0;
      const tick = h("div", {
        class: `ruler__tick${major ? " ruler__tick--major" : ""}`,
        style: axis === "x" ? { left: `${offset}px` } : { top: `${offset}px` },
      });
      if (major) tick.append(h("span", { class: "ruler__label", text: String(at) }));
      ticks.push(tick);
    }
    return ticks;
  }

  // ---------------------------------------------------------------------------
  // Guides
  // ---------------------------------------------------------------------------

  private repaintGuides(): void {
    for (const [id, line] of this.lines) {
      if (!this.guides.some((guide) => guide.id === id)) {
        line.remove();
        this.lines.delete(id);
      }
    }
    for (const guide of this.guides) this.paintGuide(guide);
  }

  private paintGuide(guide: Guide): void {
    let line = this.lines.get(guide.id);
    if (!line) {
      line = h("div", { class: `guide guide--${guide.axis}` });
      line.addEventListener("pointerdown", (event) => this.beginMove(event, guide));
      this.lines.set(guide.id, line);
      this.layer.append(line);
    }
    line.style.display = this.visible ? "block" : "none";
    const offset = guide.at - (guide.axis === "x" ? window.scrollX : window.scrollY);
    if (guide.axis === "x") line.style.left = `${offset - (GUIDE_HIT - 1) / 2}px`;
    else line.style.top = `${offset - (GUIDE_HIT - 1) / 2}px`;
  }

  /** Dragging out of a strip: the guide exists from the first pointermove, not the drop. */
  private beginNew(event: PointerEvent, axis: Axis): void {
    if (!this.visible) return;
    const guide: Guide = { id: `g${this.nextId++}`, axis, at: this.documentAt(event, axis) };
    this.guides = [...this.guides, guide];
    this.paintGuide(guide);
    this.startDrag(event, guide);
  }

  private beginMove(event: PointerEvent, guide: Guide): void {
    if (!this.visible) return;
    this.startDrag(event, guide);
  }

  private startDrag(event: PointerEvent, guide: Guide): void {
    const line = this.lines.get(guide.id);
    if (!line) return;

    event.preventDefault();
    this.dragging = { guide, element: line };
    line.classList.add("guide--dragging");
    line.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => {
      guide.at = this.documentAt(moved, guide.axis);
      this.paintGuide(guide);
      this.showReadout(moved, guide);
    };
    const end = (ended: PointerEvent) => {
      line.removeEventListener("pointermove", move);
      line.removeEventListener("pointerup", end);
      line.removeEventListener("pointercancel", end);
      line.classList.remove("guide--dragging");
      this.readout.style.display = "none";
      this.dragging = null;

      // Dropped back on its own ruler: thrown away. Measured in viewport space, because
      // the ruler is where the pointer is, not where the document is.
      const viewport = guide.axis === "x" ? ended.clientX : ended.clientY;
      if (viewport < DELETE_ZONE) this.remove(guide);

      this.callbacks.onGuidesChanged(this.guides.map((each) => ({ ...each })));
    };

    line.addEventListener("pointermove", move);
    line.addEventListener("pointerup", end);
    line.addEventListener("pointercancel", end);
  }

  private remove(guide: Guide): void {
    this.guides = this.guides.filter((each) => each.id !== guide.id);
    const line = this.lines.get(guide.id);
    line?.remove();
    this.lines.delete(guide.id);
  }

  private documentAt(event: PointerEvent, axis: Axis): number {
    return axis === "x" ? event.clientX + window.scrollX : event.clientY + window.scrollY;
  }

  private showReadout(event: PointerEvent, guide: Guide): void {
    this.readout.style.display = "block";
    this.readout.textContent = `${Math.round(guide.at)}px`;
    this.readout.style.left = `${event.clientX + 12}px`;
    this.readout.style.top = `${event.clientY + 12}px`;
  }

  isDragging(): boolean {
    return this.dragging !== null;
  }
}
