// =============================================================================
// Persistence
// =============================================================================
//
// The list is per origin: every page of a site feeds the same list, so navigating
// does not reset it and only clearing it (Copy with "clear after copying", or Clear
// all) empties it. The storage layout did not change to get there — a note is still
// stored under `origin + pathname` (the query string is deliberately excluded:
// `?page=2` is the same screen), which is what keeps the popup's export, import and
// session copy working and means nothing written by an older build needs migrating.
// This module reads every key of the current origin as one list and writes it back
// split by page.
//
// Settings go in `chrome.storage.sync` so they follow the user between machines;
// annotations stay in `local`, which has room for them.
// =============================================================================

import { ANNOTATION_PREFIX, COMPOSER_DOCK_PREFIX, DOCK_PREFIX, SETTINGS_KEY } from "../shared/protocol";
import { DEFAULT_SETTINGS, groupByPage, type Annotation, type Settings } from "../shared/types";

function keyFor(pathname: string): string {
  return `${ANNOTATION_PREFIX}${location.origin}${pathname}`;
}

// -----------------------------------------------------------------------------
// Annotations
// -----------------------------------------------------------------------------

/**
 * The keys this tab read or wrote, so a save can remove a page that has just been
 * emptied without sweeping keys a second tab added in the meantime.
 */
let knownKeys = new Set<string>();

export async function loadAnnotations(): Promise<Annotation[]> {
  try {
    // The trailing slash keeps `https://a.com` from matching `https://a.com.evil/x`.
    const prefix = `${ANNOTATION_PREFIX}${location.origin}/`;
    const stored = await chrome.storage.local.get(null);
    const list: Annotation[] = [];
    knownKeys = new Set();

    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(prefix) || !Array.isArray(value)) continue;
      knownKeys.add(key);
      const pathname = key.slice(ANNOTATION_PREFIX.length + location.origin.length);
      for (const annotation of value as Annotation[]) list.push({ ...annotation, pathname });
    }

    return list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } catch {
    // Extension context invalidated (a reload while the page was open).
    return [];
  }
}

/**
 * Ceiling on one origin's stored annotations.
 *
 * `chrome.storage.local` allows 10 MB across every key. An embedded screenshot is
 * 60-120 KB of base64, so a few heavily-photographed sites could reach it — and
 * `set()` failing here means *every* note stops persisting, not just the images. 4 MB
 * leaves room for the other sites and is far more than a review of one needs.
 */
const MAX_STORED_BYTES = 4_000_000;

export interface SaveResult {
  ok: boolean;
  /** Embedded images dropped from the stored copy to stay under the quota. */
  droppedImages: number;
}

/**
 * Shed embedded images, oldest first, until the payload fits.
 *
 * Oldest first because the note being worked on right now is the one whose picture
 * the user still expects to see. The originals are untouched on disk in either
 * case — only the copy inside the report is lost, and only on reload.
 */
function fitToQuota(annotations: Annotation[]): { payload: Annotation[]; dropped: number } {
  let total = JSON.stringify(annotations).length;
  if (total <= MAX_STORED_BYTES) return { payload: annotations, dropped: 0 };

  const payload = annotations.map((annotation) => ({ ...annotation }));
  let dropped = 0;

  for (const annotation of payload) {
    if (total <= MAX_STORED_BYTES) break;
    if (!annotation.screenshotData) continue;
    total -= annotation.screenshotData.length;
    delete annotation.screenshotData;
    dropped += 1;
  }

  // Reference images go last, and only once every screenshot is already gone. A
  // screenshot can be taken again by standing on the page; an image pasted from
  // somewhere else cannot be recovered from anything this extension holds.
  for (const annotation of payload) {
    if (total <= MAX_STORED_BYTES) break;
    if (!annotation.referenceImages?.length) continue;
    total -= annotation.referenceImages.reduce((sum, uri) => sum + uri.length, 0);
    dropped += annotation.referenceImages.length;
    delete annotation.referenceImages;
  }

  return { payload, dropped };
}

export async function saveAnnotations(annotations: Annotation[]): Promise<SaveResult> {
  try {
    const { payload, dropped } = fitToQuota(annotations);
    const pages: Record<string, Annotation[]> = {};
    for (const group of groupByPage(payload, location.pathname)) {
      pages[keyFor(group.pathname)] = group.annotations;
    }

    const emptied = [...knownKeys].filter((key) => !(key in pages));
    if (Object.keys(pages).length) await chrome.storage.local.set(pages);
    if (emptied.length) await chrome.storage.local.remove(emptied);
    knownKeys = new Set(Object.keys(pages));
    return { ok: true, droppedImages: dropped };
  } catch {
    // Nothing useful to do — the in-memory list is still intact.
    return { ok: false, droppedImages: 0 };
  }
}

// Cross-page reads and the "clear everything" sweep live in `shared/archive.ts`:
// the popup is their only caller, and it must not import from `content/`.

// -----------------------------------------------------------------------------
// Toolbar position
// -----------------------------------------------------------------------------
//
// Scoped to `origin + pathname`, exactly like the annotations, and for the same
// reason: the pill is moved because of what *this* screen has in the corner. A
// checkout page with a sticky summary panel needs it moved; the dashboard you
// visit next does not, and should not inherit the workaround.
//
// Only customised pages get an entry, so the default costs nothing to store.

export function dockKey(): string {
  return `${DOCK_PREFIX}${location.origin}${location.pathname}`;
}

export async function loadDockPosition(): Promise<{ x: number; y: number } | null> {
  try {
    const key = dockKey();
    const stored = (await chrome.storage.local.get(key))[key];
    if (typeof stored !== "object" || stored === null) return null;

    // Written by an older build, or hand-edited: anything not a pair of finite
    // numbers is discarded rather than fed to the clamp as `NaN`.
    const { x, y } = stored as { x?: unknown; y?: unknown };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x as number, y: y as number };
  } catch {
    return null;
  }
}

export async function saveDockPosition(position: { x: number; y: number }): Promise<void> {
  try {
    await chrome.storage.local.set({ [dockKey()]: position });
  } catch {
    // Over quota, or the extension context went away mid-drag. The pill is already
    // where it was dropped; only remembering it across a reload is lost.
  }
}

// -----------------------------------------------------------------------------
// Composer position
// -----------------------------------------------------------------------------
//
// Mirrors the toolbar dock persistence pattern exactly. The composer card opens
// near its target element by default; once the user has dragged it somewhere,
// that position is remembered for the rest of the session on this page so that
// every subsequent composer opens in the same spot rather than jumping around.
//
// Keyed on `origin + pathname` for the same reasons as the toolbar — layout
// choices are per-screen, not per-user, and the query string is the same screen.

export function composerDockKey(): string {
  return `${COMPOSER_DOCK_PREFIX}${location.origin}${location.pathname}`;
}

export async function loadComposerPosition(): Promise<{ x: number; y: number } | null> {
  try {
    const key = composerDockKey();
    const stored = (await chrome.storage.local.get(key))[key];
    if (typeof stored !== "object" || stored === null) return null;

    const { x, y } = stored as { x?: unknown; y?: unknown };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x as number, y: y as number };
  } catch {
    return null;
  }
}

export async function saveComposerPosition(position: { x: number; y: number }): Promise<void> {
  try {
    await chrome.storage.local.set({ [composerDockKey()]: position });
  } catch {
    // Over quota, or the extension context went away mid-drag. The card is already
    // where it was dropped; only remembering it across a reload is lost.
  }
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...((stored[SETTINGS_KEY] as Partial<Settings>) ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  } catch {
    // sync is disabled or over quota; the session keeps working with in-memory values
  }
}

/** Fires whenever settings change, including from the extension popup. */
export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return;
    callback({ ...DEFAULT_SETTINGS, ...((changes[SETTINGS_KEY].newValue as Partial<Settings>) ?? {}) });
  });
}
