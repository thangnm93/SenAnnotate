// =============================================================================
// Settings card — the popup's controls, next to the thing they change
// =============================================================================
//
// Every setting here is *about* the page you are looking at: how detailed the report
// will be, whether pins show, whether animations freeze. Reaching them meant leaving
// the page for the extension popup, changing something, dismissing it, and looking
// back to see what happened.
//
// This class owns no state. It renders the `Settings` it is handed and reports changes
// as a patch; `content/index.ts` remains the only thing that owns settings and the only
// thing that writes them. That is what keeps this card and the panel's own detail-level
// select from ever disagreeing — they read the same object.
//
// Help text lives beside the row it explains rather than in a table somewhere else,
// because the two go stale separately.
// =============================================================================

import { ACCENT_PRESETS, DEFAULT_ACCENT } from "../../shared/accent";
import {
  COMPONENT_OPTIONS,
  OUTPUT_DETAIL_OPTIONS,
  SCREENSHOT_OPTIONS,
  THEME_OPTIONS,
  type Settings,
} from "../../shared/types";
import { dismissCard, h, icon } from "./dom";
import { attachTooltip, hideTooltip } from "./tooltip";

export interface SettingsCallbacks {
  onClose(): void;
  onChange(patch: Partial<Settings>): void;
  /** Hide the whole overlay in this tab until the tab is closed. Not a stored setting. */
  onHideUntilRestart(): void;
}

type Option = { value: string; label: string };

/**
 * Anchored placement, in the units the stylesheet already uses.
 *
 * `GAP` is 8 because that is the gap the default corner has always had — the dock sits
 * `bottom: 20px` and is 44px tall, the card `bottom: 72px` — so a pill that has been
 * dragged looks exactly like one that has not. `EDGE` matches the composer's.
 */
const GAP = 8;
const EDGE = 12;
/** Fallback for `offsetWidth` on a card that has not been laid out yet; `.settings` in CSS. */
const CARD_WIDTH = 380;
/** Floor for the anchored `max-height`, so a pill in a tiny viewport cannot squeeze it shut. */
const MIN_HEIGHT = 160;

export class SettingsCard {
  readonly element: HTMLElement;

  private readonly selects = new Map<keyof Settings, HTMLSelectElement>();
  private readonly switches = new Map<keyof Settings, HTMLInputElement>();
  private readonly numbers = new Map<keyof Settings, HTMLInputElement>();
  /** Shown only while `showGrid` is on — three numbers for a grid nobody is drawing. */
  private readonly gridRows: HTMLElement[];
  /**
   * The two rows that only exist under `measureTools`, kept so `render` can take them
   * away together.
   *
   * They are the only rows in this card that depend on another one. A switch for a
   * surface the user has turned off is not a setting, it is a puzzle — and leaving one
   * visible but inert is worse than either showing or hiding it.
   */
  private readonly measureRows: HTMLElement[];
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private readonly accentCustom: HTMLInputElement;

  /**
   * `version` is passed in rather than read here.
   *
   * Nothing else in `ui/` touches `chrome.*`, and the one fact this card needs from the
   * extension API is a string that never changes — cheaper to hand over than to make a
   * presentational module aware of the runtime it happens to be running in.
   */
  constructor(
    layer: HTMLElement,
    private readonly callbacks: SettingsCallbacks,
    version: string,
  ) {
    this.accentCustom = h("input", {
      class: "accent-custom",
      attrs: { type: "color", "aria-label": "Pick any accent colour" },
      // `input`, not `change`: the native picker streams the colour while it is being
      // dragged, and waiting for the dialog to close makes choosing feel like it did
      // nothing. Lifted verbatim from the popup, along with the reason.
      on: { input: () => this.emit({ accentColor: this.accentCustom.value }) },
    });

    this.gridRows = [
      this.number("gridColumns", "Columns", "How many columns the grid draws.", { min: 1, max: 24 }),
      this.number("gridGutter", "Gutter", "The gap between columns, in pixels.", { min: 0, max: 200 }),
      this.number("gridMargin", "Page margin", "The inset from each side of the viewport, in pixels.", { min: 0, max: 400 }),
    ];


    this.measureRows = [
      this.toggle(
        "measureDistances",
        "Measure distances",
        "Adds mode 4 to the toolbar: click two elements and the report carries the gap between them in pixels.",
      ),
      this.toggle(
        "showRulers",
        "Screen rulers and guides",
        "Rulers down the top and left edges; drag out of one to place a guide, drag a guide back onto it to remove it. The strips and the guides take the pointer, so the page cannot be clicked through them — which is why this is off unless you want it.",
      ),
      this.toggle(
        "showGrid",
        "Layout grid",
        "A column grid over the viewport, for checking whether things line up with anything at all.",
      ),
      // The grid's three numbers belong directly under the switch that draws them, not
      // after the next unrelated toggle. They are in `measureRows` for the master's sake
      // and in `gridRows` for their own — `render` applies the narrower rule second.
      ...this.gridRows,
      this.toggle(
        "showBoxModel",
        "Box model on hover",
        "Shades padding and margin on whatever the pointer is over, and puts the border-box size on a badge. Mode 4 shows them regardless of this.",
      ),
    ];
    for (const row of this.measureRows) row.classList.add("setting-row--child");
    // A second indent level, because these three are children of a child.
    for (const row of this.gridRows) row.classList.add("setting-row--grandchild");

    this.element = h(
      "div",
      { class: "card settings" },
      h(
        "div",
        { class: "card__header" },
        icon("gear", 14),
        h("span", { class: "card__title", text: "Settings" }),
        h(
          "button",
          { class: "icon-button", title: "Close", on: { click: () => callbacks.onClose() } },
          icon("close", 14),
        ),
      ),
      h(
        "div",
        { class: "card__body settings__body" },

        this.group("Report"),
        this.select(
          "detailLevel",
          "Detail level",
          "How much each annotation carries into the Markdown report. Forensic includes classes, box and props; compact is one line per note.",
          OUTPUT_DETAIL_OPTIONS.map(({ value, label }) => ({ value, label })),
        ),
        this.select(
          "componentMode",
          "Components",
          "Which framework components get named. Changing the detail level moves this to a matching preset, and you can override it afterwards.",
          COMPONENT_OPTIONS,
        ),
        this.toggle(
          "includeProps",
          "Include component props",
          "Adds the first few props of the component that owns the element. Values are recorded; a prop holding a secret would end up in the report.",
        ),
        this.select(
          "screenshotDelivery",
          "Screenshots",
          "A link to the file in your Downloads keeps the report small. Embedding survives being pasted somewhere the file cannot follow, at a few hundred kilobytes of base64.",
          SCREENSHOT_OPTIONS,
        ),

        this.group("Bug reports"),
        this.toggle(
          "captureDiagnostics",
          "Capture errors & steps",
          "Attaches console errors, failed requests and what you clicked. Field values are never recorded and request bodies never leave the page.",
        ),

        this.group("Behaviour"),
        this.toggle(
          "showMarkers",
          "Show numbered pins",
          "Draws a numbered pin over every annotated element. Turn it off when the pins are covering what you are trying to look at.",
        ),
        this.toggle(
          "freezeOnInspect",
          "Freeze animations on inspect",
          "Parks animations and timers as soon as inspect mode goes on, so a menu or a carousel holds still long enough to annotate.",
        ),
        this.toggle(
          "clearOnCopy",
          "Clear after copying",
          "Empties the page's annotations once a copy has reached the clipboard, ready for the next round. Off by default — a failed copy never clears.",
        ),
        this.hideUntilRestartRow(),

        this.group("Editing"),
        this.toggle(
          "cssEditor",
          "Live CSS editor",
          "Adds mode 5: click an element and change its CSS on the page, with a Changes tab that records every override so you can copy or revert it. This is the switch that lets this extension write to a page instead of only reading one — off by default for that reason.",
        ),

        this.group("Measuring"),
        this.toggle(
          "measureTools",
          "Measuring tools",
          "Off by default. On, it reveals the two switches below — measuring adds a fourth button to the toolbar and a fourth clause to the hint line, which is a cost paid by everyone who never measures anything.",
        ),
        ...this.measureRows,

        this.group("Appearance"),
        this.select("theme", "Theme", "The overlay's own colours. Match system follows your browser.", THEME_OPTIONS),
        this.accentRow(),
      ),
      // Which build you are looking at. The first question about any reported oddity is
      // "which version?", and until now the only answer was chrome://extensions.
      h(
        "div",
        { class: "card__footer settings__footer" },
        h("span", { class: "settings__version", text: `SenAnnotate ${version}` }),
      ),
    );

    for (const stale of layer.querySelectorAll('.settings[data-leaving="true"]')) stale.remove();
    layer.append(this.element);
  }

  // ---------------------------------------------------------------------------
  // Row builders
  // ---------------------------------------------------------------------------

  private group(title: string): HTMLElement {
    return h("h3", { class: "settings__group", text: title });
  }

  /**
   * A label, its `ⓘ`, and a control.
   *
   * The help button is built here rather than by each caller so that no row can quietly
   * ship without one — an unexplained setting is the thing this card exists to fix.
   */
  private row(label: string, help: string, control: HTMLElement): HTMLElement {
    return h("div", { class: "setting-row" }, this.labelFor(label, help), control);
  }

  private labelFor(label: string, help: string): HTMLElement {
    const dot = h("button", {
      class: "hint-dot",
      text: "?",
      attrs: { type: "button", "aria-label": `What does "${label}" do?` },
    });
    attachTooltip(dot, help);

    return h("span", { class: "setting-row__label" }, h("span", { text: label }), dot);
  }

  private select(key: keyof Settings, label: string, help: string, options: Option[]): HTMLElement {
    // `select` is the overlay's existing control style — the panel's detail picker uses
    // it, and a second look for the same widget would be a bug you can see.
    const select = h("select", {
      class: "select setting-row__control",
      // Named after the setting it writes. Four selects sharing one class would be
      // indistinguishable to a test, and to anyone reading the DOM to work out which
      // row is misbehaving.
      attrs: { "data-setting": String(key) },
      on: { change: () => this.emit({ [key]: select.value } as unknown as Partial<Settings>) },
    });

    for (const option of options) {
      select.append(h("option", { text: option.label, attrs: { value: option.value } }));
    }

    this.selects.set(key, select);
    return this.row(label, help, select);
  }

  /**
   * A bounded number. Clamped here rather than trusted: `min`/`max` on the element stop
   * the spinner going out of range but not a typed value, and a grid of zero columns
   * divides by zero two files away.
   */
  private number(
    key: keyof Settings,
    label: string,
    help: string,
    range: { min: number; max: number },
  ): HTMLElement {
    const input = h("input", {
      class: "select setting-row__control setting-row__number",
      attrs: {
        type: "number",
        min: String(range.min),
        max: String(range.max),
        "data-setting": String(key),
      },
      on: {
        change: () => {
          const value = Math.min(range.max, Math.max(range.min, Number(input.value) || range.min));
          input.value = String(value);
          this.emit({ [key]: value } as unknown as Partial<Settings>);
        },
      },
    });

    this.numbers.set(key, input);
    return this.row(label, help, input);
  }

  private toggle(key: keyof Settings, label: string, help: string): HTMLElement {
    const input = h("input", {
      attrs: { type: "checkbox", "data-setting": String(key) },
      on: { change: () => this.emit({ [key]: input.checked } as unknown as Partial<Settings>) },
    });

    this.switches.set(key, input);
    return this.row(
      label,
      help,
      h("label", { class: "switch" }, input, h("span", { class: "switch__track" })),
    );
  }

  /**
   * Not in the `switches` map and not a `Settings` key: this is a per-tab, per-session
   * act, not a preference. Flipping it hides the card it lives in, so the control is
   * never seen in its "on" state — the row is a button wearing a switch's clothes,
   * which is also how the reference design presents it.
   */
  private hideUntilRestartRow(): HTMLElement {
    const input = h("input", {
      attrs: { type: "checkbox", "data-action": "hide-until-restart" },
      on: { change: () => this.callbacks.onHideUntilRestart() },
    });

    return this.row(
      "Hide until restart",
      "Hides the toolbar and everything else in this tab. It stays hidden here — reloads included — until the tab is closed; other tabs are untouched.",
      h("label", { class: "switch" }, input, h("span", { class: "switch__track" })),
    );
  }

  private accentRow(): HTMLElement {
    const presets = h("div", { class: "swatches" });

    for (const { value, label } of ACCENT_PRESETS) {
      const button = h("button", {
        class: "swatch",
        title: label,
        style: { background: value },
        attrs: { type: "button", "aria-label": label, "aria-pressed": "false" },
        on: { click: () => this.emit({ accentColor: value }) },
      });
      this.swatches.set(value, button);
      presets.append(button);
    }

    return h(
      "div",
      { class: "setting-row" },
      this.labelFor(
        "Accent colour",
        "Colours the overlay, the pins and the markup pen. The two shades either side of it are derived, so one colour is all you pick.",
      ),
      h(
        "div",
        { class: "accent-controls" },
        presets,
        this.accentCustom,
        h("button", {
          class: "link-button",
          text: "Reset",
          attrs: { type: "button" },
          on: { click: () => this.emit({ accentColor: DEFAULT_ACCENT }) },
        }),
      ),
    );
  }

  private emit(patch: Partial<Settings>): void {
    this.callbacks.onChange(patch);
  }

  // ---------------------------------------------------------------------------

  render(settings: Settings): void {
    for (const [key, select] of this.selects) select.value = String(settings[key]);
    for (const [key, input] of this.switches) input.checked = Boolean(settings[key]);

    for (const [key, input] of this.numbers) input.value = String(settings[key]);

    for (const row of this.measureRows) {
      row.style.display = settings.measureTools ? "" : "none";
    }
    // The three grid numbers need both: a grid nobody is drawing has no columns to set,
    // and neither does a measuring surface that is switched off entirely.
    for (const row of this.gridRows) {
      row.style.display = settings.measureTools && settings.showGrid ? "" : "none";
    }

    this.accentCustom.value = settings.accentColor;
    for (const [value, button] of this.swatches) {
      button.setAttribute("aria-pressed", String(value === settings.accentColor));
    }
  }

  /**
   * Place the card against the toolbar's dock, or hand it back to the stylesheet.
   *
   * `null` — the pill is in its CSS corner — removes everything this method writes. The
   * default placement is written in `styles.css` (`bottom: 72px`, the `104px` inspect
   * variant, the `max-height`) and measured there by the suite; re-deriving it here would
   * be a second copy that can only drift in the state nobody re-checks.
   *
   * With a box: right edges aligned with the dock, above it by `GAP`, flipped underneath
   * when the card does not fit above, and clamped to the viewport on both axes. Same
   * "prefer, flip, clamp" shape as `Composer.position()` — two cards placing themselves
   * by different rules is how an interface starts to feel arbitrary.
   */
  anchorTo(box: DOMRect | null): void {
    if (!box) {
      delete this.element.dataset.anchored;
      this.element.style.removeProperty("left");
      this.element.style.removeProperty("top");
      this.element.style.removeProperty("max-height");
      return;
    }

    // Before measuring: the flag releases the `bottom`/`right` the stylesheet sets, and a
    // card still held by both edges reports a height it is about to lose.
    this.element.dataset.anchored = "true";

    // This card is nearly as tall as the viewport — the stylesheet caps it at
    // `100vh - 92px` and its body scrolls. So "prefer above, flip below" is not enough on
    // its own: with the pill anywhere near the middle *neither* side fits, and a card
    // placed by its own height would detach from the pill and clamp to the bottom of the
    // screen. It takes the roomier side and is capped to fit there, which is what keeps
    // the pill and its card visibly one thing.
    const roomAbove = box.top - GAP - EDGE;
    const roomBelow = window.innerHeight - box.bottom - GAP - EDGE;
    const goesAbove = roomAbove >= roomBelow;

    // A floor, for the pathological case of a pill filling a very short viewport: a
    // `max-height` of nothing would leave the header alone on screen with no way back.
    this.element.style.maxHeight = `${Math.max(MIN_HEIGHT, goesAbove ? roomAbove : roomBelow)}px`;

    const width = this.element.offsetWidth || CARD_WIDTH;
    const height = this.element.offsetHeight;

    const left = Math.max(EDGE, Math.min(box.right - width, window.innerWidth - width - EDGE));
    const top = Math.max(
      EDGE,
      Math.min(
        goesAbove ? box.top - GAP - height : box.bottom + GAP,
        window.innerHeight - height - EDGE,
      ),
    );

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  destroy(): void {
    // The card is going; a tooltip anchored to one of its rows would outlive its trigger.
    hideTooltip();
    dismissCard(this.element);
  }
}
