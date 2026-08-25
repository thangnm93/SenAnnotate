// =============================================================================
// Design edits — try the change on the page, report the delta
// =============================================================================
//
// A note says "tighten this and make it feel less heavy". Whoever reads it has to
// invent the numbers, and the person who wrote it never found out whether their
// idea was right. This module lets them try it on the real element first, and turns
// what they settled on into a list of `property: from → to` the agent can implement.
//
// Two rules shape everything here.
//
// **The page is never permanently modified.** Every override is an inline style, and
// `revertDesign` puts back the whole `style` attribute as it was found — including its
// absence, which is the usual case. The overlay's whole contract with the page it is
// standing on is "we do not touch it"; a preview is a loan, not an edit.
//
// The attribute is restored *wholesale* rather than property by property, because a
// per-property snapshot cannot describe what it found. `padding`, `margin` and `gap` are
// shorthands: `getPropertyValue("padding")` is `""` unless every longhand is declared
// inline, while `removeProperty("padding")` deletes all four — so an element that arrived
// with `padding-left: 10px` would have lost it with nothing recorded to put back. Nor does
// `getPropertyValue` carry `!important`, so `color: red !important` would have come back
// as `color: red` and started losing to the stylesheet rule it used to beat.
//
// **The report gets computed values, not inline ones.** `from` is what the element
// actually looked like — `16px`, `rgb(37, 99, 235)` — because an agent needs the
// state it is changing away from, and the inline style is empty on any element that
// gets its styling from a stylesheet, which is all of them.
// =============================================================================

import type { DesignChange } from "../shared/types";

export type DesignControl = "text" | "color" | "select";

export interface DesignField {
  /** CSS property, in the kebab-case form `getPropertyValue` speaks. */
  property: string;
  label: string;
  group: string;
  control: DesignControl;
  /** For `select`. The empty string is always first: it means "leave it alone". */
  options?: string[];
  placeholder?: string;
}

/**
 * The whole surface, as data.
 *
 * One table drives the controls, the preview, the diff and the report, so adding a
 * property is one entry rather than four edits — the same rule the framework
 * detectors follow. The set is deliberately small: these are the things a reviewer
 * actually re-types in DevTools before writing the note, and every addition costs
 * height in a 380px card.
 */
export const DESIGN_FIELDS: DesignField[] = [
  { property: "color", label: "Text", group: "Colour", control: "color" },
  { property: "background-color", label: "Background", group: "Colour", control: "color" },

  { property: "font-size", label: "Size", group: "Type", control: "text", placeholder: "16px" },
  {
    property: "font-weight",
    label: "Weight",
    group: "Type",
    control: "select",
    options: ["", "300", "400", "500", "600", "700", "800"],
  },

  { property: "padding", label: "Padding", group: "Spacing", control: "text", placeholder: "8px 12px" },
  { property: "margin", label: "Margin", group: "Spacing", control: "text", placeholder: "0 auto" },
  { property: "gap", label: "Gap", group: "Spacing", control: "text", placeholder: "8px" },

  {
    property: "display",
    label: "Display",
    group: "Layout",
    control: "select",
    options: ["", "block", "inline-block", "flex", "inline-flex", "grid", "none"],
  },
  {
    property: "flex-direction",
    label: "Direction",
    group: "Layout",
    control: "select",
    options: ["", "row", "row-reverse", "column", "column-reverse"],
  },
  {
    property: "justify-content",
    label: "Justify",
    group: "Layout",
    control: "select",
    options: ["", "flex-start", "center", "flex-end", "space-between", "space-around"],
  },
  {
    property: "align-items",
    label: "Align",
    group: "Layout",
    control: "select",
    options: ["", "flex-start", "center", "flex-end", "stretch", "baseline"],
  },

  { property: "width", label: "Width", group: "Size", control: "text", placeholder: "auto" },
  { property: "height", label: "Height", group: "Size", control: "text", placeholder: "auto" },
];

export interface DesignSnapshot {
  /** The `style` attribute verbatim, or `null` when the element carried none. */
  style: string | null;
  /** What the element actually rendered as, before anything was touched. */
  computed: Record<string, string>;
  /** The element's text, whitespace-normalised, when it is a run this can replace. */
  text: string | null;
  /** The same text exactly as the DOM held it, so the revert puts back the source form. */
  textRaw: string | null;
}

/**
 * Colours come back from `getComputedStyle` as `rgb(37, 99, 235)`, and
 * `<input type="color">` speaks nothing but `#rrggbb`.
 *
 * `null` — not a fallback colour — for anything `#rrggbb` cannot hold: any alpha
 * (`background-color` computes to `rgba(0, 0, 0, 0)` on most elements), and the
 * `oklch()` / `color(srgb …)` a Tailwind v4 page computes to. A fallback of `#000000`
 * would be a value the picker can also produce, so choosing black on a transparent
 * element would make `from === to` and drop a change the preview had visibly applied.
 * Callers decide what to do with "cannot be shown"; none of them may guess.
 */
export function rgbToHex(value: string): string | null {
  const parts = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!parts) return null;

  const hex = parts
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/**
 * Whether this element's text can be replaced without destroying anything.
 *
 * One text node and nothing else. A `<p>` containing a `<strong>` is refused: setting
 * `textContent` on it would delete the element the emphasis lives in, which is not an
 * edit anyone asked for and is not recoverable by putting a string back.
 *
 * Two forms come back. `text` is whitespace-collapsed, because source-formatted markup
 * gives `"\n      Hello\n    "` and both consumers mishandle that: the report prints it
 * inline as `**Text:** "from" → **"to"**`, where a newline breaks the Markdown, and
 * setting `.value` on a one-line `<input>` strips CR/LF per spec — so comparing the field
 * against the raw string records pure whitespace as an edit the moment it is focused.
 * `raw` is kept so the revert hands the page back its own formatting, not our tidied one.
 */
export function editableText(element: Element): { text: string; raw: string } | null {
  if (element.childNodes.length !== 1) return null;
  const only = element.childNodes[0];
  if (only.nodeType !== Node.TEXT_NODE) return null;

  const raw = only.textContent ?? "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? { text, raw } : null;
}

export function readDesign(element: Element): DesignSnapshot {
  const computedStyle = getComputedStyle(element);

  const computed: Record<string, string> = {};
  for (const field of DESIGN_FIELDS) {
    computed[field.property] = computedStyle.getPropertyValue(field.property);
  }

  const editable = editableText(element);
  return {
    style: element.getAttribute("style"),
    computed,
    text: editable?.text ?? null,
    textRaw: editable?.raw ?? null,
  };
}

/**
 * Show one property's new value on the page.
 *
 * `important`, because the point of a preview is that it is visible: a stylesheet
 * rule carrying `!important` would otherwise beat the inline value and the control
 * would appear to do nothing. `revert` removes the property outright, so the priority
 * leaves no trace either.
 *
 * An empty value means "stop overriding this one", which is how a control returns to
 * its untouched state without a separate reset button.
 *
 * `removeProperty` first, always: `setProperty` with a value the CSS parser rejects is a
 * silent no-op, so mid-edit text like `1` on the way to `12px` would leave the *previous*
 * override standing while the field showed the new string. Clearing first makes an
 * unparseable value show as nothing, so the page always agrees with what was typed.
 */
export function previewDesign(element: Element, property: string, value: string): void {
  const style = (element as HTMLElement).style;
  style.removeProperty(property);
  if (value) style.setProperty(property, value, "important");
}

export function previewText(element: Element, text: string): void {
  const only = element.childNodes[0];
  if (only?.nodeType === Node.TEXT_NODE) only.textContent = text;
}

/**
 * Put the element back exactly as it was found — including the text.
 *
 * Restoring the attribute rather than each property is what preserves inline longhands
 * the shorthand fields would have deleted, declaration order, and `!important`. When the
 * element had no `style` at all the attribute is *removed*, not blanked: an element that
 * gained a bare `style=""` has still been modified — visibly in devtools, and to any page
 * code that tests for the attribute.
 */
export function revertDesign(element: Element, snapshot: DesignSnapshot): void {
  if (snapshot.style === null) element.removeAttribute("style");
  else element.setAttribute("style", snapshot.style);

  if (snapshot.textRaw !== null) previewText(element, snapshot.textRaw);
}

/**
 * What actually changed, in the order the fields are declared.
 *
 * A value equal to what was already computed is dropped rather than reported: typing
 * `16px` into a box that already reads `16px` is not a change, and a report full of
 * no-ops is one an agent has to check line by line before it can trust any of it.
 */
export function diffDesign(
  snapshot: DesignSnapshot,
  values: Record<string, string>,
): DesignChange[] {
  const changes: DesignChange[] = [];

  for (const field of DESIGN_FIELDS) {
    const to = values[field.property] ?? "";
    if (!to) continue;

    // A value the CSS parser rejects never reached the element — it is a typo caught
    // mid-edit, not an intent — and handing an invalid declaration to the agent as the
    // change to make is worse than saying nothing.
    if (!CSS.supports(field.property, to)) continue;

    // Colours are compared and reported in the notation the control speaks. The
    // computed side is `rgb(37, 99, 235)` and the picker only ever produces
    // `#2563eb`, so without this every colour reads as changed and the report puts
    // two notations for the same colour on one line. When the computed side has no
    // hex form the raw string is reported as-is: it can never equal a `#rrggbb`, so
    // the row survives instead of being dropped as a no-op.
    const raw = snapshot.computed[field.property] ?? "";
    const from = field.control === "color" ? rgbToHex(raw) ?? raw : raw;
    if (from === to) continue;

    changes.push({ property: field.property, from, to });
  }

  return changes;
}
