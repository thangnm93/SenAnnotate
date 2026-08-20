// =============================================================================
// Persistence
// =============================================================================
//
// Annotations are scoped to `origin + pathname` so that reloading the page you
// were reviewing brings your notes back, while navigating elsewhere starts clean.
// The query string is deliberately excluded — `?page=2` is the same screen.
//
// Settings go in `chrome.storage.sync` so they follow the user between machines;
// annotations stay in `local`, which has room for them.
// =============================================================================

import { ANNOTATION_PREFIX, DOCK_PREFIX, SETTINGS_KEY } from "../shared/protocol";
import { DEFAULT_SETTINGS, type Annotation, type Settings } from "../shared/types";

export function pageKey(): string {
  return `${ANNOTATION_PREFIX}${location.origin}${location.pathname}`;
}

// -----------------------------------------------------------------------------
// Annotations
// -----------------------------------------------------------------------------

export async function loadAnnotations(): Promise<Annotation[]> {
  try {
    const key = pageKey();
    const stored = await chrome.storage.local.get(key);
    const value = stored[key];
    return Array.isArray(value) ? (value as Annotation[]) : [];
  } catch {
    // Extension context invalidated (a reload while the page was open).
    return [];
  }
}

/**
 * Ceiling on one page's stored annotations.
 *
 * `chrome.storage.local` allows 10 MB across every key. An embedded screenshot is
 * 60-120 KB of base64 and there is one key per page, so a few heavily-photographed
 * pages could reach it — and `set()` failing here means *every* note on the page
 * silently stops persisting, not just the images. 4 MB leaves room for the other
 * pages and is far more than a review of one screen needs.
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
    const key = pageKey();
    if (!annotations.length) {
      await chrome.storage.local.remove(key);
      return { ok: true, droppedImages: 0 };
    }

    const { payload, dropped } = fitToQuota(annotations);
    await chrome.storage.local.set({ [key]: payload });
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
