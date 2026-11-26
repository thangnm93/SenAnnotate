# Changelog — one list per origin

## What shipped

The notes list is per origin. The toolbar count, panel, report, Copy and Clear all work on
every page of the site; pins and highlights stay on the page a note was made on. Notes an
older build stored under other paths of the origin appear on first load — no migration, the
storage layout is unchanged.

Source: `shared/types.ts`, `content/storage.ts`, `content/index.ts`, `content/ui/panel.ts`
(+ `styles.css`), `shared/output.ts`, one settings hint. The popup, `archive.ts` and
`share.ts` were not touched and still work, because they key on the layout that did not move.

## Test suite

- **Baseline** (upstream/main, headless): 410/410 e2e, 9/9 upgrade.
- **Now**: 425/425 e2e, 12/12 upgrade, measure checks green.
- The per-origin list broke 19 assertions at first — every fixture shares one origin and
  each used to be isolated by its pathname. None was weakened. `e2e.mjs` now serves each
  fixture file from its own origin (`at("file.html")`), which restores exactly the old
  isolation; the SPA block's two badge assertions changed from 1 to 2 because the badge now
  counts both pages' notes (the pin counts are unchanged).
- New block: two real pages on one origin — the list follows a navigation, pins stay on
  their own page, the panel labels the other page and refuses to open an editor for it, the
  report groups by page, a clearing copy empties both pages, and Clear all does too.
- `upgrade.mjs` stores a note under a second path with the old layout and expects it in the
  list, the report and the count after the upgrade.
- One transient `.composer` timeout in the CSS-editor block appeared in one of five full
  runs and did not recur; that block does not touch the list.

## Things worth knowing

- **Two tabs on one origin can overwrite each other.** Each tab holds the list in memory and
  writes it on change; a second tab's note made after the first loaded is not seen until
  the first reloads, and the first's next save writes the page keys it holds. The same hazard
  existed per page; it now applies per origin. Not addressed here: syncing needs a
  `storage.onChanged` merge that has to tell its own writes from another tab's.
- Load reads all of `chrome.storage.local` once per page load (see `context.md`).
- `clearOnCopy` still defaults to off, so by default nothing but Clear all empties the list.
- No screenshots were captured for the panel headings.
