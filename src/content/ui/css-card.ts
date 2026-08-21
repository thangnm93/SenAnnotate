// =============================================================================
// CSS editor card
// =============================================================================
//
// Two tabs on one card: the declarations of the element you clicked, and every override
// made on the page so far.
//
// The property list is **curated, not complete**. Showing every computed property is
// several hundred rows nobody reads, and showing the matched rules — what DevTools does
// — is not available to us: `sheet.cssRules` throws `SecurityError` for any stylesheet
// from another origin, which is most sites (`docs/css-editor/context.md`). So: the
// properties people actually reach for, plus a row to name any other one.
//
// This class owns no override state. It renders what it is handed and reports edits as
// callbacks; `content/css-edit.ts` is the only thing that touches the page.
// =============================================================================

import { nudge } from "../css-edit";
import type { CssOverride } from "../../shared/types";
import { dismissCard, h, icon, takeFocus } from "./dom";

export interface CssCardCallbacks {
  onClose(): void;
  onEdit(property: string, value: string): void;
  onRevert(property: string): void;
  onRevertAll(): void;
  onCopy(): void;
}

export interface CssCardSubject {
  label: string;
  selector: string;
  /** Computed value per property, already read by the caller. */
  values: Record<string, string>;
  overrides: CssOverride[];
}

/**
 * The properties worth a row before you have to type a name.
 *
 * Chosen as the ones a reviewer changes while looking at a page, in the order they tend
 * to be reached for — box first, because "it is the wrong size" outnumbers everything
 * else this extension has ever been pointed at.
 */
export const EDITABLE = [
  "width",
  "height",
  "padding",
  "margin",
  "display",
  "gap",
  "color",
  "background-color",
  "border",
  "border-radius",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "opacity",
];

const EDGE = 12;
const GAP = 8;
const CARD_WIDTH = 320;

export class CssCard {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly stylesTab: HTMLButtonElement;
  private readonly changesTab: HTMLButtonElement;
  private readonly title: HTMLElement;
  private tab: "styles" | "changes" = "styles";
  private subject: CssCardSubject | null = null;
  private all: { selector: string; label: string; overrides: CssOverride[] }[] = [];

  constructor(layer: HTMLElement, private readonly callbacks: CssCardCallbacks) {
    this.title = h("span", { class: "card__title", text: "CSS" });
    this.body = h("div", { class: "card__body css-card__body" });

    this.stylesTab = this.tabButton("Styles", "styles");
    this.changesTab = this.tabButton("Changes", "changes");

    this.element = h(
      "div",
      { class: "card css-card" },
      h(
        "div",
        { class: "card__header" },
        icon("pencil", 14),
        this.title,
        h(
          "button",
          { class: "icon-button", title: "Close", on: { click: () => callbacks.onClose() } },
          icon("close", 14),
        ),
      ),
      h("div", { class: "css-card__tabs" }, this.stylesTab, this.changesTab),
      this.body,
    );

    layer.append(this.element);
  }

  private tabButton(text: string, tab: "styles" | "changes"): HTMLButtonElement {
    return h("button", {
      class: "css-card__tab",
      text,
      attrs: { "data-tab": tab },
      on: {
        click: () => {
          this.tab = tab;
          this.paint();
        },
      },
    });
  }

  /** `subject` is null when nothing has been clicked yet — the Changes tab still works. */
  render(subject: CssCardSubject | null, all: { selector: string; label: string; overrides: CssOverride[] }[]): void {
    this.subject = subject;
    this.all = all;
    this.paint();
  }

  private paint(): void {
    this.title.textContent = this.subject ? this.subject.label : "CSS";
    this.stylesTab.setAttribute("aria-pressed", String(this.tab === "styles"));
    this.changesTab.setAttribute("aria-pressed", String(this.tab === "changes"));

    const count = this.all.reduce((sum, each) => sum + each.overrides.length, 0);
    this.changesTab.textContent = count ? `Changes (${count})` : "Changes";

    // Every edit repaints, and a repaint replaces the input the user is typing in. Note
    // where the caret was and put it back, or holding Up steps once and then does
    // nothing — the field it was stepping no longer exists.
    const root = this.element.getRootNode() as ShadowRoot;
    const focused = root.activeElement as HTMLInputElement | null;
    const property = focused?.dataset?.property;
    const caret = focused?.selectionStart ?? null;

    this.body.replaceChildren(...(this.tab === "styles" ? this.styleRows() : this.changeRows()));

    if (!property) return;
    const restored = this.body.querySelector<HTMLInputElement>(`input[data-property="${property}"]`);
    if (!restored) return;
    // `takeFocus` rather than `focus`, for the reason its own comment gives: a focus trap
    // on the page restores focus when it sees a `focusout` with a `relatedTarget` inside
    // the document, and blurring first is what stops it noticing.
    takeFocus(restored);
    if (caret !== null) restored.setSelectionRange(caret, caret);
  }

  private styleRows(): HTMLElement[] {
    if (!this.subject) {
      return [h("p", { class: "css-card__empty", text: "Click an element to edit it." })];
    }

    const overridden = new Set(this.subject.overrides.map((each) => each.property));
    const rows = EDITABLE.map((property) =>
      this.declaration(property, this.subject!.values[property] ?? "", overridden.has(property)),
    );

    // Anything not on the curated list, typed by name. The input is cleared on commit so
    // the row is always ready for the next one.
    const name = h("input", {
      class: "css-card__name",
      attrs: { type: "text", placeholder: "property", "data-role": "new-property" },
    });
    const value = h("input", {
      class: "css-card__value",
      attrs: { type: "text", placeholder: "value", "data-role": "new-value" },
      on: {
        change: () => {
          const property = name.value.trim();
          if (!property || !value.value.trim()) return;
          this.callbacks.onEdit(property, value.value.trim());
          name.value = "";
          value.value = "";
        },
      },
    });
    rows.push(h("div", { class: "css-card__row css-card__row--new" }, name, value));

    return rows;
  }

  private declaration(property: string, value: string, isOverridden: boolean): HTMLElement {
    const input = h("input", {
      class: "css-card__value",
      attrs: { type: "text", value, "data-property": property },
      on: {
        change: () => {
          const next = input.value.trim();
          if (next) this.callbacks.onEdit(property, next);
          else this.callbacks.onRevert(property);
        },
        keydown: (event) => this.arrowStep(event, property, input),
      },
    });
    input.value = value;

    const row = h(
      "div",
      { class: "css-card__row" },
      h("span", { class: "css-card__name", text: property }),
      input,
    );
    if (isOverridden) {
      row.classList.add("css-card__row--overridden");
      row.append(
        h("button", {
          class: "icon-button css-card__revert",
          text: "↺",
          attrs: { title: `Revert ${property}`, "data-revert": property },
          on: { click: () => this.callbacks.onRevert(property) },
        }),
      );
    }
    return row;
  }

  /**
   * Up and Down step the number the caret is in; Shift by ten, Alt by a tenth.
   *
   * Applied on every press rather than on commit, because the point of holding Up is
   * watching the page move. `preventDefault` stops the caret jumping to the end of the
   * field, which is what an unhandled Up does in a text input — and the caret is what
   * decides *which* number `8px 12px` steps next time.
   *
   * A value with no number in it is left to the browser: swallowing Up on `auto` would
   * make the field feel broken for no gain.
   */
  private arrowStep(event: KeyboardEvent, property: string, input: HTMLInputElement): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    const size = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const delta = event.key === "ArrowUp" ? size : -size;
    const stepped = nudge(input.value, input.selectionStart ?? input.value.length, delta);
    if (!stepped) return;

    event.preventDefault();
    input.value = stepped.value;
    input.setSelectionRange(stepped.caret, stepped.caret);
    this.callbacks.onEdit(property, stepped.value.trim());
  }

  private changeRows(): HTMLElement[] {
    if (!this.all.length) {
      return [h("p", { class: "css-card__empty", text: "No changes yet." })];
    }

    const rows: HTMLElement[] = [];
    for (const element of this.all) {
      rows.push(h("div", { class: "css-card__group", text: element.selector }));
      for (const { property, from, to } of element.overrides) {
        rows.push(
          h(
            "div",
            { class: "css-card__change" },
            h("span", { class: "css-card__name", text: property }),
            h("span", { class: "css-card__from", text: from }),
            h("span", { class: "css-card__arrow", text: "→" }),
            h("span", { class: "css-card__to", text: to }),
          ),
        );
      }
    }

    rows.push(
      h(
        "div",
        { class: "css-card__actions" },
        h("button", {
          class: "button button--primary",
          text: "Copy CSS",
          attrs: { "data-action": "copy-css" },
          on: { click: () => this.callbacks.onCopy() },
        }),
        h("button", {
          class: "button button--ghost",
          text: "Revert all",
          attrs: { "data-action": "revert-all" },
          on: { click: () => this.callbacks.onRevertAll() },
        }),
      ),
    );
    return rows;
  }

  anchorTo(box: DOMRect | null): void {
    if (!box) {
      delete this.element.dataset.anchored;
      this.element.style.removeProperty("left");
      this.element.style.removeProperty("bottom");
      return;
    }
    this.element.dataset.anchored = "true";
    const width = this.element.offsetWidth || CARD_WIDTH;
    this.element.style.left = `${Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))}px`;
    this.element.style.bottom = `${Math.max(EDGE, window.innerHeight - box.top + GAP)}px`;
  }

  destroy(): void {
    dismissCard(this.element);
  }
}
