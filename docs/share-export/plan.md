# Plan

1. **Settle the escaping story before writing any markup** — this is the project's first
   and only HTML sink, so the construct has to make the safe thing the default one: an
   `html` tagged template that escapes every substitution, `raw(...)` as the spelled
   exception, and a CSP `<meta>` so the file states its own guarantee.
2. **Narrow the one field that reaches a URL sink.** `screenshotData` is attacker-supplied
   after an import; accept only the base64 `data:image/(png|jpeg|webp)` shape the extension
   itself writes, and nothing else. Everything else the renderer touches is text.
3. **Write `shared/share.ts`**: `buildShareHtml(ExportFile)` → one document, both colour
   schemes inline, screenshots embedded, notes grouped by page. Takes the export structure
   rather than reading storage, so the two formats cannot disagree about "everything".
4. **Add the remap to `importAll`** as an `ImportOptions.remapOrigin`: replace the origin,
   keep the path, count distinct keys written, and leave an unparseable key alone.
5. **Wire the popup**: a **Save .html** button, an **Import onto this site** checkbox read
   at import time, and one shared `downloadBlob` path in `shared/` — `popup/` may not import
   from `content/`, which is an argument for moving the existing helper, not copying it.
   The remap reads the *active tab's* origin, and refuses anything but `http`/`https`: a
   key no content script can reach is a review filed where nothing will ever find it.
6. **Say what happened, always.** Name the origin the notes landed on; and when the box was
   ticked and no origin resolved, say that instead of reporting an ordinary import.
7. **e2e**: the file is saved, carries the notes, embeds a `data:` screenshot, refuses an
   SVG payload, loads nothing from the network, cannot be closed out of by an element name,
   and reports the origin a remap used — plus the case where there is none.
8. **Verify** typecheck, build, then the whole suite plus upgrade.

## Rejected

- Offering the remap automatically, a per-page origin table, and rendering screenshot
  *paths* as `<img>` — reasons in `changelog.md`.
- Requiring `elementPath` in `looksLikeAnnotation` to stop the renderer throwing. That
  drops a whole note over a missing label; the renderer skips the row instead.
