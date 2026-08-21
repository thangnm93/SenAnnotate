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
