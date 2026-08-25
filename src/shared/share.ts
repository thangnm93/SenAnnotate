// =============================================================================
// The shareable review — every annotation as one self-contained HTML file
// =============================================================================
//
// The Markdown report is written for an agent, and the JSON export is written for
// another copy of this extension. Neither is written for a person who has neither:
// a designer signing off, a PM reading on a phone, anyone outside the repo. That
// reader wants to *look* at what was reported, and the screenshots are the report.
//
// So: one file, no external references, opens anywhere. Screenshots are already
// `data:` URIs when the delivery setting is `embed`, so the whole thing is built
// from what storage already holds — nothing is fetched and no file is read.
//
// This is the only module in the project that produces HTML from page-derived
// strings. `ui/dom.ts` offers `text` and deliberately no `html` precisely so that
// the overlay can never grow an injection sink; this file is the exception, and it
// pays for it by never concatenating HTML by hand. Everything goes through the
// `html` tagged template below, which escapes each substitution as it interpolates,
// so a `${}` someone adds in a hurry is safe by default and the only way to insert
// markup is to say `raw(...)` out loud. An element name is scraped off someone
// else's page; nothing here is trusted because it looks harmless.
//
// The document also states its own rules: a CSP `<meta>` with `default-src 'none'`
// means a `<script>` or a remote reference that ever slips through is inert in the
// recipient's browser rather than live. The promise is a property of the file, not a
// habit of this repo.
// =============================================================================

import { countNotes, type ExportFile } from "./archive";
import { formatSource } from "./output";
import { isDone, kindOf, type Annotation, type SourceRef } from "./types";

/**
 * Markup that is already safe to insert — produced by `html` or asserted by `raw`.
 *
 * A distinct shape rather than a bare string so the template can tell "HTML I built"
 * from "text someone typed", and escape the second without being asked.
 */
interface Html {
  readonly html: string;
}

/**
 * Escape for text and for a double-quoted attribute in one pass.
 *
 * `&` first or it would double-escape the entities the others introduce.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * "Insert this verbatim" — the one deliberate exception, and it has to be spelled.
 *
 * Only ever called on markup this module wrote (the stylesheet) or on a value a
 * regex has already proved cannot contain any of the five characters.
 */
function raw(value: string): Html {
  return { html: value };
}

function isHtml(value: unknown): value is Html {
  return typeof value === "object" && value !== null && typeof (value as Html).html === "string";
}

/**
 * One substitution.
 *
 * `String(value)` rather than a typed parameter on purpose: an *imported* annotation is
 * whatever the JSON said, and `looksLikeAnnotation` (`archive.ts`) validates four fields
 * of it. A note whose `elementPath` is missing or whose `kind` is a number used to throw
 * inside `esc` and take the whole document down with it — one bad note, no export.
 */
function interpolate(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isHtml(value)) return value.html;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return esc(String(value));
}

/**
 * The only way HTML is built here.
 *
 * Escaping per interpolation is a rule that has to be remembered; escaping *inside* the
 * construct is one that cannot be forgotten. Nested `html` results and arrays of them
 * pass through untouched, so a page renders its notes by interpolating them.
 */
function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    out += interpolate(values[index]) + (strings[index + 1] ?? "");
  }
  return raw(out);
}

/**
 * Base64 `data:` images only, and only the types this extension itself writes.
 *
 * `screenshotData` is the one interpolation that reaches an active URL sink, and after an
 * import it is whatever the file said — `looksLikeAnnotation` never inspects it. A bare
 * `startsWith("data:image/")` admits `data:image/svg+xml,<svg …>`, which the parser hands
 * the browser as a document to render inside a file whose whole promise is that it renders
 * nothing of anyone's. Chrome blocks scripts in an `<img>`-loaded SVG today; the gate does
 * not depend on that staying true. `screenshot.ts` produces `image/jpeg` and nothing else.
 *
 * Matching this shape also means the value provably contains none of `&<>"'`, so it can be
 * interpolated with `raw` — five full scans of a 60–120 KB payload per screenshot, inside a
 * popup Chrome tears down on blur, buy nothing.
 */
function isEmbeddable(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

/** Whether any note in an export will actually show a picture — what the popup reports. */
export function hasEmbeddedShot(file: ExportFile): boolean {
  return file.pages.some((entry) =>
    entry.annotations.some((annotation) => isEmbeddable(annotation.screenshotData)),
  );
}

function row(label: string, value: unknown): Html {
  return html`<div class="row"><span class="row__label">${label}</span><span class="row__value">${value}</span></div>`;
}

/**
 * The Source row, which is the one field a Markdown formatter is borrowed for.
 *
 * `formatSource` spells a grep handle in backticks — correct for the `.md` report, literal
 * backtick characters here, in the one format whose entire promise is that it reads properly
 * to someone who has never seen this project's Markdown. So that branch is rendered as
 * `<code>` instead, the way the screenshot-path line already is.
 */
function sourceRow(source: SourceRef | undefined | null): Html | null {
  if (!source) return null;
  if (source.origin === "grep-handle") {
    return row("Source", html`no path — grep for <code>[${source.file}]</code>`);
  }
  const text = formatSource(source);
  return text ? row("Source", text) : null;
}

function renderAnnotation(annotation: Annotation, number: number): Html {
  const kind = kindOf(annotation);
  const done = isDone(annotation);

  const meta: Html[] = [];
  const source = sourceRow(annotation.source);
  if (source) meta.push(source);
  if (annotation.framework?.path) meta.push(row("Components", annotation.framework.path));
  if (annotation.frame) meta.push(row("Frame", annotation.frame.label));
  // Skipped rather than printed empty when an imported note has no `elementPath`: the
  // Markdown report degrades to `**Location:** undefined` on the same input, and a labelled
  // row with nothing beside it is worse than no row.
  if (annotation.elementPath) meta.push(row("Location", annotation.elementPath));
  if (annotation.selectedText) meta.push(row("Selected text", `"${annotation.selectedText}"`));

  const shot = annotation.screenshotData;
  const path = annotation.screenshotPath ?? annotation.screenshot;
  let picture: Html | null = null;
  if (isEmbeddable(shot)) {
    // `raw` because `isEmbeddable` has already proved the payload is base64 — see there.
    picture = html`<img class="note__shot" src="${raw(shot)}" alt="${annotation.element}" loading="lazy" />`;
  } else if (path) {
    picture = html`<p class="note__shot-missing">Screenshot saved as <code>${path}</code> on the reporter's machine — not embedded.</p>`;
  }

  return html`<article class="note${done ? " note--done" : ""}"><header class="note__head"><span class="note__number">${number}</span><h3 class="note__title">${annotation.element}</h3><span class="chip chip--${kind}">${kind}</span>${done ? raw(`<span class="chip chip--done">fixed</span>`) : null}</header><p class="note__comment">${annotation.comment}</p>${meta.length ? html`<div class="note__meta">${meta}</div>` : null}${picture}</article>`;
}

function renderPage(entry: { page: string; annotations: Annotation[] }): Html {
  const notes = entry.annotations.map((annotation, index) => renderAnnotation(annotation, index + 1));
  return html`<section class="page"><h2 class="page__title">${entry.page}</h2>${notes}</section>`;
}

/**
 * Everything the recipient's browser needs, inline.
 *
 * Both colour schemes, because there is no settings surface in a file someone was
 * emailed — it follows their system and that is the end of it. No script at all: a
 * document that arrives by email and runs nothing is one nobody has to trust.
 */
const STYLES = `
:root { color-scheme: light dark; --bg: #ffffff; --card: #f7f8fa; --fg: #1c2530; --muted: #64748b; --line: rgba(20,30,45,0.12); --accent: #ea580c; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --card: #161b22; --fg: #e6edf3; --muted: #8b949e; --line: rgba(240,246,252,0.14); --accent: #f97316; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 820px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 22px; }
.sub { margin: 0 0 32px; color: var(--muted); font-size: 13px; }
.page__title { margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-size: 14px; font-weight: 600; color: var(--muted); word-break: break-all; }
.note { margin: 0 0 16px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.note--done { opacity: 0.62; }
.note__head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.note__number { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; }
.note__title { margin: 0; font-size: 15px; font-weight: 600; }
.chip { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.chip--done { border-color: var(--accent); color: var(--accent); }
.note__comment { margin: 0 0 12px; white-space: pre-wrap; }
.note__meta { display: grid; gap: 3px; margin-bottom: 12px; font-size: 12.5px; }
.row { display: flex; gap: 8px; }
.row__label { flex: 0 0 96px; color: var(--muted); }
.row__value { word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.note__shot { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
.note__shot-missing { margin: 0; color: var(--muted); font-size: 12.5px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
footer { margin-top: 48px; color: var(--muted); font-size: 12px; text-align: center; }
`.trim();

/**
 * The document's own guarantee.
 *
 * `default-src 'none'` with only `img-src data:` and inline styles allowed is the same
 * claim the footer makes, enforced by the reader's browser instead of by this repo's
 * discipline. Kept as one line here rather than argued about in a review: a later edit
 * that grows a sink is then a rendering bug, not a fetch.
 */
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/**
 * `raw` for the same reason `STYLES` is: it is a constant in this file, and escaping it
 * would spell the policy's quotes as `&#39;` — which the parser decodes back, so it works,
 * but the head of a document a person may read the source of should say what it means.
 */
const CSP_META = raw(`<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);

/**
 * Build the document.
 *
 * Takes the same `ExportFile` the JSON export produces rather than reading storage
 * itself, so the two formats can never disagree about what "everything" is. `exportAll`
 * has already dropped pages with no notes, so there is nothing to filter or recount here.
 */
export function buildShareHtml(file: ExportFile): string {
  const pages = file.pages;
  const notes = countNotes(pages);
  const when = file.exportedAt.slice(0, 10);
  const title = `SenAnnotate review — ${notes} note${notes === 1 ? "" : "s"}`;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
${CSP_META}
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${raw(STYLES)}</style>
</head>
<body><main>
<h1>${title}</h1>
<p class="sub">${pages.length} page${pages.length === 1 ? "" : "s"} · exported ${when}</p>
${pages.map(renderPage)}
<footer>Generated by SenAnnotate. Screenshots are embedded; nothing is loaded from the network.</footer>
</main></body>
</html>`.html;
}
