// =============================================================================
// Debug log — a bounded record of what the overlay did, for bug reports
// =============================================================================
//
// "The page froze after I used inspect" cannot be diagnosed from a description: whether
// the freeze was engaged, whether a click was swallowed and which element it landed on
// are all invisible afterwards. With the setting on, this keeps the last few hundred
// facts of that kind so the reporter can save them and attach the file.
//
// Privacy is the same rule as the report's (see `output.ts`): elements are summarised as
// tag, id and a few class names — never text content, attribute values or field values.
// Off by default, and while off `debugLog()` is a single boolean check.
// =============================================================================

import type { DebugEntry, DebugLog, Settings } from "../shared/types";

const CAPACITY = 500;

let enabled = false;
let entries: DebugEntry[] = [];
let lastState = "";

export function setDebugEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  entries = [];
  lastState = "";
  if (enabled) debugLog("debug-on");
}

export function debugLog(kind: string, detail?: DebugEntry["detail"]): void {
  if (!enabled) return;
  entries.push({ t: Math.round(performance.now()), kind, detail });
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
}

/** Log only when the state differs from the last call, so `render()` can feed it freely. */
export function debugState(state: Record<string, string | number | boolean | null>): void {
  if (!enabled) return;
  const key = JSON.stringify(state);
  if (key === lastState) return;
  lastState = key;
  debugLog("state", state);
}

/** `tag#id.class.class` — enough to find the element, nothing that could hold content. */
export function summariseTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "(none)";
  const id = target.id ? `#${target.id.slice(0, 40)}` : "";
  const classes = [...target.classList]
    .slice(0, 3)
    .map((name) => `.${name.slice(0, 30)}`)
    .join("");
  return `${target.tagName.toLowerCase()}${id}${classes}`;
}

export function buildDebugLog(settings: Settings): DebugLog {
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    page: window.location.origin + window.location.pathname,
    userAgent: navigator.userAgent,
    settings,
    entries: [...entries],
  };
}
