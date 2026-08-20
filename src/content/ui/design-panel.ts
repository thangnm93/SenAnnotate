// =============================================================================
// The design section inside the composer
// =============================================================================
//
// Every control is generated from `DESIGN_FIELDS`, so this file has no list of
// properties in it and adding one never touches this module. It draws, reports what
// the user typed, and owns nothing else: applying a value to the page and working out
// the diff both live in `content/design.ts`, and the element itself is the
// orchestrator's business.
//
// Collapsed by default. Most notes are a sentence, and a card that opens with
// thirteen inputs in it makes the common case worse to serve the rarer one.
// =============================================================================

import { DESIGN_FIELDS, rgbToHex, type DesignField, type DesignSnapshot } from "../design";
import { h, icon } from "./dom";

export interface DesignPanelCallbacks {
  /** An empty value means "stop overriding this property". */
  onChange(property: string, value: string): void;
  onTextChange(text: string): void;
  /** The section opened or shut, so the card is a different height than it was placed at. */
  onToggle(): void;
}

export class DesignPanel {
  readonly element: HTMLElement;
  /** Property → what the user has asked for. Untouched fields stay out of it. */
  private readonly values: Record<string, string> = {};
  private text: string | null = null;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;

  constructor(
    private readonly snapshot: DesignSnapshot,
    private readonly callbacks: DesignPanelCallbacks,
    initial?: { changes?: { property: string; to: string }[]; text?: string },
  ) {
    for (const change of initial?.changes ?? []) this.values[change.property] = change.to;
    if (initial?.text !== undefined) this.text = initial.text;

    this.count = h("span", { class: "design__count" });
    this.body = h("div", { class: "design__body" });

    const toggle = h(
      "button",
      {
        class: "design__toggle",
        attrs: { "aria-expanded": "false" },
        on: {
          click: () => {
            const open = this.element.dataset.open === "true";
            this.element.dataset.open = String(!open);
            toggle.setAttribute("aria-expanded", String(!open));
            this.callbacks.onToggle();
          },
        },
      },
      icon("chevron", 12),
      h("span", { text: "Design" }),
      this.count,
    );

    this.element = h("div", { class: "design", dataset: { open: "false" } }, toggle, this.body);

    this.build();
    this.updateCount();
  }

  /** What the user asked for, for `diffDesign`. */
  currentValues(): Record<string, string> {
    return { ...this.values };
  }

  /** The replacement text, or null when it was left alone. */
  currentText(): string | null {
    return this.text !== null && this.text !== this.snapshot.text ? this.text : null;
  }

  /**
   * Put the restored values back on the page.
   *
   * Reopening a saved note seeds the controls and the badge from `designChanges`, but the
   * preview only ever happens through these callbacks — so without this the badge says
   * three properties are pending while the element renders none of them, and nudging one
   * control would apply that one alone. Reopening has to mean what opening means.
   *
   * Kept out of the constructor so the composer is built and placed before the page
   * starts moving under it.
   */
  replay(): void {
    for (const [property, value] of Object.entries(this.values)) {
      this.callbacks.onChange(property, value);
    }
    const text = this.currentText();
    if (text !== null) this.callbacks.onTextChange(text);
  }

  private build(): void {
    let group = "";

    for (const field of DESIGN_FIELDS) {
      if (field.group !== group) {
        group = field.group;
        this.body.append(h("h4", { class: "design__group", text: group }));
      }
      this.body.append(this.row(field));
    }

    if (this.snapshot.text !== null) {
      this.body.append(h("h4", { class: "design__group", text: "Content" }));

      const input = h("input", {
        class: "design__control design__control--text",
        attrs: { type: "text", "data-design": "text", "aria-label": "Replacement text" },
        on: {
          input: () => {
            this.text = input.value;
            this.callbacks.onTextChange(input.value);
            this.updateCount();
          },
        },
      });
      input.value = this.text ?? this.snapshot.text;

      this.body.append(this.labelled("Text", input));
    }
  }

  private row(field: DesignField): HTMLElement {
    const control =
      field.control === "select" ? this.select(field) : this.input(field);
    return this.labelled(field.label, control, this.unshowable(field));
  }

  private labelled(
    label: string,
    control: HTMLElement,
    note: HTMLElement | null = null,
  ): HTMLElement {
    return h(
      "div",
      { class: "design__row" },
      h("span", { class: "design__label", text: label }),
      control,
      note,
    );
  }

  /**
   * The element's real colour, printed beside the swatch when the swatch cannot hold it.
   *
   * `<input type="color">` has no empty state — it must open on some `#rrggbb` — and
   * `background-color` computes to `rgba(0, 0, 0, 0)` on most elements, so the picker would
   * open on black for an element that has no background at all. That is the first thing
   * read off the control and it would be false. Saying `rgba(0, 0, 0, 0)` next to it costs
   * one span and is true.
   */
  private unshowable(field: DesignField): HTMLElement | null {
    if (field.control !== "color") return null;
    const computed = this.snapshot.computed[field.property] ?? "";
    if (rgbToHex(computed)) return null;
    return h("span", { class: "design__unset", text: computed || "unset" });
  }

  private input(field: DesignField): HTMLElement {
    const isColour = field.control === "color";
    const input = h("input", {
      class: `design__control design__control--${field.control}`,
      attrs: {
        type: isColour ? "color" : "text",
        "data-design": field.property,
        "aria-label": field.label,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      },
      on: {
        // `input`, not `change`: a preview that only appears once the field loses
        // focus is a preview nobody sees while they are deciding. The same reason
        // the accent picker in the settings card listens to `input`.
        input: () => this.set(field.property, input.value),
      },
    });

    // A colour picker has no empty state to open on, so it opens on the element's own
    // colour — while `values` stays empty until it is actually moved. When that colour has
    // no hex form the swatch has to show something anyway; `unshowable` puts the real
    // value beside it so the black is labelled rather than passed off as the element's.
    if (isColour) {
      input.value =
        this.values[field.property] ||
        rgbToHex(this.snapshot.computed[field.property] ?? "") ||
        "#000000";
    } else {
      input.value = this.values[field.property] ?? "";
    }

    return input;
  }

  private select(field: DesignField): HTMLElement {
    const select = h("select", {
      class: "design__control design__control--select select",
      attrs: { "data-design": field.property, "aria-label": field.label },
      on: { change: () => this.set(field.property, select.value) },
    });

    for (const option of field.options ?? []) {
      // The blank option reads as the element's own value rather than as nothing,
      // because that is what leaving it alone means.
      const label = option || `— ${this.snapshot.computed[field.property] ?? "unset"}`;
      select.append(h("option", { text: label, attrs: { value: option } }));
    }

    select.value = this.values[field.property] ?? "";
    return select;
  }

  private set(property: string, value: string): void {
    if (value) this.values[property] = value;
    else delete this.values[property];

    this.callbacks.onChange(property, value);
    this.updateCount();
  }

  private updateCount(): void {
    const changed = Object.keys(this.values).length + (this.currentText() === null ? 0 : 1);
    this.count.textContent = changed ? String(changed) : "";
  }
}
