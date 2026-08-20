// =============================================================================
// Export / import — annotations as a file
// =============================================================================
//
// Lives in `shared/` rather than `content/storage.ts` because the popup is the only
// surface that offers it: it is the one with a real document to hang an
// `<input type="file">` off, and the one that already thinks cross-page. It touches
// nothing but `chrome.storage.local` and the key prefix, both of which every world
// already agrees on.
// =============================================================================

import { ANNOTATION_PREFIX, DOCK_PREFIX, NS } from "./protocol";
import type { Annotation } from "./types";

// Annotations could previously leave only as rendered Markdown on the clipboard —
// lossy and one-way. That left no backup before `Clear all`, no way to hand a review
// to a colleague, and no way to move one between machines (settings sync; annotations
// deliberately do not). A JSON round-trip answers all three.

export const EXPORT_FORMAT = `${NS}/annotations`;

export interface ExportFile {
  format: string;
  version: number;
  exportedAt: string;
  pages: { page: string; annotations: Annotation[] }[];
  /**
   * Where the toolbar was dragged to, per page — a fact about a screen's layout, so it
   * belongs in the same file as the notes taken on that screen.
   *
   * Additive and optional, and `version` deliberately stays at 1: `importAll` never reads
   * the version, so an older build simply ignores a field it does not know, and losing a
   * dock position on the way through an old importer costs nothing. Bumping it would only
   * mislead a future reader into thinking 1 and 2 need different handling.
   */
  docks?: { page: string; position: { x: number; y: number } }[];
}

export interface ImportSummary {
  pages: number;
  annotations: number;
  /** Entries dropped for failing the shape check. */
  skipped: number;
}

/** The pair of finite numbers a stored dock position has to be to be worth carrying. */
function looksLikePosition(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return Number.isFinite(x) && Number.isFinite(y);
}

export async function exportAll(): Promise<ExportFile> {
  const all = await chrome.storage.local.get(null);
  const pages = Object.entries(all)
    .filter(([key, value]) => key.startsWith(ANNOTATION_PREFIX) && Array.isArray(value))
    .map(([key, value]) => ({
      page: key.slice(ANNOTATION_PREFIX.length),
      annotations: value as Annotation[],
    }))
    .filter((entry) => entry.annotations.length > 0);

  const docks = Object.entries(all)
    .filter(([key, value]) => key.startsWith(DOCK_PREFIX) && looksLikePosition(value))
    .map(([key, value]) => ({
      page: key.slice(DOCK_PREFIX.length),
      position: value as { x: number; y: number },
    }));

  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    pages,
    docks,
  };
}

/**
 * Drop every page's annotations and dragged toolbar positions, and say how many pages
 * that was.
 *
 * Deliberately not a `storage.local.clear()`: settings live in `sync`, but anything
 * else that ever lands in `local` is not ours to delete.
 *
 * The dock positions go too. "Clear all pages" claiming a complete wipe while every
 * `senannotate:dock:*` entry survives leaves the pill parked wherever it was dragged, and
 * there is deliberately no reset control anywhere in the UI — so this sweep is the only
 * way back. The count stays the number of annotated *pages*, which is what the popup
 * reports; a page whose only customisation was a moved toolbar is not news.
 */
export async function clearAllPages(): Promise<number> {
  try {
    const all = await chrome.storage.local.get(null);
    const annotated = Object.keys(all).filter((key) => key.startsWith(ANNOTATION_PREFIX));
    const docks = Object.keys(all).filter((key) => key.startsWith(DOCK_PREFIX));
    const keys = [...annotated, ...docks];
    if (keys.length) await chrome.storage.local.remove(keys);
    return annotated.length;
  } catch {
    return 0;
  }
}

/**
 * The shape check every imported entry has to pass.
 *
 * Nothing here is an XSS guard — the UI has no HTML sink, by design (`ui/dom.ts`
 * offers `text` and deliberately no `html`). It is a *correctness* guard: an entry
 * without a `selector` throws inside `resolveElement`, and one without an `id`
 * collides with everything in the marker map.
 *
 * `referenceImages` earns its line for the same reason, and it is the only optional
 * field that does: three separate places iterate it. A hand-edited export carrying
 * `"referenceImages": "x"` passes the length check in `fitToQuota` and throws on
 * `.reduce`, inside `saveAnnotations`' `try` — so every note on that page silently stops
 * persisting. `output.ts` throws on `.forEach` and takes Copy report down with it, and
 * the composer renders one thumbnail per character. A string is the shape that gets
 * through; anything without a length just skips.
 */
function looksLikeAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.comment === "string" &&
    typeof candidate.element === "string" &&
    typeof candidate.selector === "string" &&
    (candidate.referenceImages === undefined ||
      (Array.isArray(candidate.referenceImages) &&
        candidate.referenceImages.every((uri) => typeof uri === "string")))
  );
}

/**
 * Merge an export back in.
 *
 * Merge, never replace: importing the wrong file should not be able to destroy a
 * review in progress. Where an id exists on both sides the imported copy wins —
 * that file is what the user just asked for.
 */
export async function importAll(data: unknown): Promise<ImportSummary | null> {
  if (typeof data !== "object" || data === null) return null;
  const file = data as Partial<ExportFile>;
  if (file.format !== EXPORT_FORMAT || !Array.isArray(file.pages)) return null;

  const summary: ImportSummary = { pages: 0, annotations: 0, skipped: 0 };

  for (const entry of file.pages) {
    if (!entry || typeof entry.page !== "string" || !Array.isArray(entry.annotations)) {
      summary.skipped += 1;
      continue;
    }

    const incoming = entry.annotations.filter((annotation) => {
      const ok = looksLikeAnnotation(annotation);
      if (!ok) summary.skipped += 1;
      return ok;
    });
    if (!incoming.length) continue;

    const key = `${ANNOTATION_PREFIX}${entry.page}`;
    const stored = await chrome.storage.local.get(key);
    const existing = Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : [];

    const byId = new Map(existing.map((annotation) => [annotation.id, annotation]));
    for (const annotation of incoming) byId.set(annotation.id, annotation);

    await chrome.storage.local.set({ [key]: [...byId.values()] });
    summary.pages += 1;
    summary.annotations += incoming.length;
  }

  // Positions replace rather than merge: there is one toolbar per page, so there is
  // nothing to reconcile, and the file is what the user just asked for. Absent from an
  // older export, in which case every page keeps the position it already had.
  if (Array.isArray(file.docks)) {
    for (const entry of file.docks) {
      if (!entry || typeof entry.page !== "string" || !looksLikePosition(entry.position)) {
        summary.skipped += 1;
        continue;
      }
      await chrome.storage.local.set({ [`${DOCK_PREFIX}${entry.page}`]: entry.position });
    }
  }

  return summary;
}

