# Plan — one list per origin

1. `shared/types.ts`: `Annotation.pathname`, `pathOf`, `groupByPage`.
2. `content/storage.ts`: `loadAnnotations` reads every key of the origin and stamps the
   path; `saveAnnotations` writes the list split by page and removes emptied keys;
   `saveAnnotationsForUrl` removed.
3. `content/index.ts`: stamp `pathname` on new notes; `onThisPage()` gates pins, hover and
   the editor; `onUrlChange` stops swapping lists.
4. `content/ui/panel.ts` + `styles.css`: group by page, per-page numbers, page headings
   once another page is involved; the clear button says "site".
5. `shared/output.ts`: group the report by page.
6. Wording: the `clearOnCopy` hint says "this site's annotations, on every page".
7. Tests: per-fixture origins in `e2e.mjs`; a multi-page block with two new fixtures; the
   SPA block's expectations; `upgrade.mjs` gains a note stored under a second path.
8. Docs and wiki.

Not touched: `shared/archive.ts`, `shared/share.ts`, the popup. They key on the storage
layout, which did not change.
