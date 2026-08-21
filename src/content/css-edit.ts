// =============================================================================
// Live CSS overrides
// =============================================================================
//
// The first code in this extension that changes the page rather than reading it. See
// `docs/css-editor/context.md` for why the change is an inline style and not an injected
// stylesheet: a sheet has to win a specificity fight against the page's own CSS, and the
// only way to win it every time is `!important` on every declaration — which corrupts
// the very text the Changes tab exists to let you copy out.
//
// Two values are recorded per property and they are not the same thing:
//
//   `from`         the **computed** value, which is what a reader needs — "it was 8px".
//   `priorInline`  the **inline** value, usually empty, which is what a revert needs.
//
// Confusing them is how a revert leaves the page in a state it was never in: an element
// that already carried `style="padding: 4px"` must get that back, not lose the property.
// =============================================================================

import type { CssOverride, ElementOverrides } from "../shared/types";
import { buildSelector } from "./identify";

/** Stamped so the registry can find its element again without holding it alive. */
const EDIT_ATTR = "data-senannotate-edit";

let counter = 0;
const registry = new Map<string, { element: WeakRef<Element>; entry: ElementOverrides }>();

function idFor(element: Element, label: string): string {
  const existing = element.getAttribute(EDIT_ATTR);
  if (existing && registry.has(existing)) return existing;

  const id = `e${counter++}`;
  element.setAttribute(EDIT_ATTR, id);
  registry.set(id, {
    element: new WeakRef(element),
    entry: { id, selector: buildSelector(element), label, overrides: [] },
  });
  return id;
}

/**
 * Set one property, remembering what was there.
 *
 * `from` is captured **only on the first override of that property**. Overriding
 * `padding` twice must still report the page's original value, not the previous edit —
 * a reader following the report needs the value the stylesheet had, and the intermediate
 * step is nobody's business.
 */
export function applyOverride(element: Element, label: string, property: string, value: string): void {
  const html = element as HTMLElement;
  const id = idFor(element, label);
  const entry = registry.get(id)!.entry;

  let record = entry.overrides.find((each) => each.property === property);
  if (!record) {
    record = {
      property,
      from: getComputedStyle(element).getPropertyValue(property).trim(),
      to: value,
      priorInline: html.style.getPropertyValue(property),
    };
    entry.overrides.push(record);
  }
  record.to = value;

  html.style.setProperty(property, value);
}

/** Put one property back exactly as it was — including an inline value it already had. */
export function revertOverride(element: Element, property: string): void {
  const html = element as HTMLElement;
  const id = element.getAttribute(EDIT_ATTR);
  const found = id ? registry.get(id) : undefined;
  if (!found) return;

  const record = found.entry.overrides.find((each) => each.property === property);
  if (!record) return;

  if (record.priorInline) html.style.setProperty(property, record.priorInline);
  else html.style.removeProperty(property);

  found.entry.overrides = found.entry.overrides.filter((each) => each.property !== property);
  if (!found.entry.overrides.length) forget(id!, element);
}

/** Put every override on the page back. Used by the Changes tab's "revert all". */
export function revertAll(): void {
  for (const [id, { element, entry }] of [...registry]) {
    const node = element.deref();
    if (!node) {
      registry.delete(id);
      continue;
    }
    for (const { property } of [...entry.overrides]) revertOverride(node, property);
  }
}

function forget(id: string, element: Element): void {
  element.removeAttribute(EDIT_ATTR);
  registry.delete(id);
}

/**
 * Everything overridden, for the Changes tab and the report.
 *
 * Elements the page has since thrown away are dropped on the way out rather than kept
 * as ghosts: a framework re-render replaces the node and takes the inline style with it,
 * so the record describes a change that is no longer applied. The alternative — keeping
 * it and pretending — would put a line in the report for CSS that is not on the page.
 */
export function listOverrides(): ElementOverrides[] {
  const out: ElementOverrides[] = [];
  for (const [id, { element, entry }] of [...registry]) {
    if (!element.deref()?.isConnected) {
      registry.delete(id);
      continue;
    }
    if (entry.overrides.length) out.push(entry);
  }
  return out;
}

/** What the card shows for one element: its current overrides, if any. */
export function overridesFor(element: Element): CssOverride[] {
  const id = element.getAttribute(EDIT_ATTR);
  const found = id ? registry.get(id) : undefined;
  return found ? found.entry.overrides : [];
}

// -----------------------------------------------------------------------------
// Arrow-key nudging
// -----------------------------------------------------------------------------

/** Every number in a value, with where it sits, so the caret can pick one. */
const NUMBER = /-?\d*\.?\d+/g;

/**
 * Step one number inside a CSS value, chosen by where the caret is.
 *
 * The caret matters because most values have more than one: `8px 12px` has two and
 * `rgb(37, 99, 235)` has three, and nudging all of them — or always the first — is not
 * what anyone means by pressing Up. The token under the caret wins; failing that, the
 * one that ends nearest before it, which is what you get after typing a number and
 * reaching for the arrow key.
 *
 * Decimal places are preserved, because `1.5rem` stepping to `2.5` and then to `3` reads
 * as the field losing precision rather than gaining a unit.
 *
 * Returns `null` when there is no number to step — `auto`, `inherit`, a bare colour name.
 * The caller leaves the key to the browser in that case rather than swallowing it.
 */
export function nudge(
  value: string,
  caret: number,
  delta: number,
): { value: string; caret: number } | null {
  const matches = [...value.matchAll(NUMBER)];
  if (!matches.length) return null;

  const under = matches.find(
    (match) => caret >= match.index! && caret <= match.index! + match[0].length,
  );
  const before = [...matches].reverse().find((match) => match.index! + match[0].length <= caret);
  const target = under ?? before ?? matches[0];

  const decimals = (target[0].split(".")[1] ?? "").length;
  const stepped = (Number.parseFloat(target[0]) + delta).toFixed(
    // A 0.1 step on an integer has to gain a decimal place, or Up does nothing visible.
    Math.max(decimals, delta % 1 === 0 ? 0 : 1),
  );

  const start = target.index!;
  const end = start + target[0].length;
  return {
    value: value.slice(0, start) + stepped + value.slice(end),
    caret: start + stepped.length,
  };
}
