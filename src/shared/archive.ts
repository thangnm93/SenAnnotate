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

/**
 * Notes across a set of pages.
 *
 * Every surface that reports a number reports this one — the popup's export line, its
 * session copy, and the shared HTML document's title. They were three identical reduces
 * that could drift apart; `unknown[]` because the callers hold three different shapes of
 * annotation and none of them needs to be read to be counted.
 */
export function countNotes(pages: { annotations: unknown[] }[]): number {
  return pages.reduce((total, entry) => total + entry.annotations.length, 0);
}

export interface ImportSummary {
  /** Distinct page keys written, which after a remap is fewer than the entries read. */
  pages: number;
  annotations: number;
  /** Entries dropped for failing the shape check. */
  skipped: number;
  /** Pages whose origin was rewritten on the way in. */
  remapped: number;
}

export interface ImportOptions {
  /**
   * Rewrite every page's origin to this one — `https://shop.example` becomes
   * `http://localhost:3000`, path kept.
   *
   * Annotations are keyed on `origin + pathname`, which is right while one person
   * reviews one deployment and wrong the moment the file crosses a machine: a review
   * captured on staging imports into a key nobody's dev server will ever open, and
   * the notes look like they were lost. The paths are the part that survives the
   * move, so only the origin is replaced.
   */
  remapOrigin?: string;
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
 */
function looksLikeAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.comment === "string" &&
    typeof candidate.element === "string" &&
    typeof candidate.selector === "string"
  );
}

/**
 * Move a stored page key onto another origin, keeping its path.
 *
 * A key that will not parse as a URL is left exactly as it is: it came from a scheme
 * this build does not know about, and guessing where its path starts would be worse
 * than importing it where it was.
 */
function remap(page: string, origin: string | undefined): string {
  if (!origin) return page;
  try {
    const url = new URL(page);
    return `${origin}${url.pathname}`;
  } catch {
    return page;
  }
}

/**
 * Merge an export back in.
 *
 * Merge, never replace: importing the wrong file should not be able to destroy a
 * review in progress. Where an id exists on both sides the imported copy wins —
 * that file is what the user just asked for.
 */
export async function importAll(
  data: unknown,
  options: ImportOptions = {},
): Promise<ImportSummary | null> {
  if (typeof data !== "object" || data === null) return null;
  const file = data as Partial<ExportFile>;
  if (file.format !== EXPORT_FORMAT || !Array.isArray(file.pages)) return null;

  const summary: ImportSummary = { pages: 0, annotations: 0, skipped: 0, remapped: 0 };
  // Counted as a set of keys, not as a count of entries read: a remap can send
  // `https://staging.example/checkout` and `https://prod.example/checkout` to the same
  // `http://localhost:3000/checkout`, and "across 2 pages" would then describe a file
  // rather than this browser. The merge itself is already right — the awaits are
  // sequential, so the second pass reads what the first wrote — but two captures
  // interleaving on one screen is exactly the fact the user needs told.
  const written = new Set<string>();

  for (const entry of file.pages) {
    if (!entry || typeof entry.page !== "string" || !Array.isArray(entry.annotations)) {
      summary.skipped += 1;
      continue;
    }

    const page = remap(entry.page, options.remapOrigin);
    if (page !== entry.page) summary.remapped += 1;

    const incoming = entry.annotations.filter((annotation) => {
      const ok = looksLikeAnnotation(annotation);
      if (!ok) summary.skipped += 1;
      return ok;
    });
    if (!incoming.length) continue;

    const key = `${ANNOTATION_PREFIX}${page}`;
    const stored = await chrome.storage.local.get(key);
    const existing = Array.isArray(stored[key]) ? (stored[key] as Annotation[]) : [];

    const byId = new Map(existing.map((annotation) => [annotation.id, annotation]));
    for (const annotation of incoming) byId.set(annotation.id, annotation);

    await chrome.storage.local.set({ [key]: [...byId.values()] });
    written.add(key);
    summary.pages = written.size;
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

