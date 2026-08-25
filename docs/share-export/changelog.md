# Changelog — share export and origin remap

## What shipped

`shared/share.ts` (new): `buildShareHtml(ExportFile)` → one self-contained document, both
colour schemes, screenshots inlined from `screenshotData`, no script and no external
reference.

`shared/archive.ts`: `importAll` takes an `ImportOptions` second argument with
`remapOrigin`, and `ImportSummary` gains `remapped`.

Popup: a **Save .html** button, an **Import onto this site** checkbox, and `download()`
extracted from the JSON export so both formats share one blob-and-anchor path.

Five files: `shared/share.ts`, `shared/archive.ts`, `popup/index.ts`, `static/popup.html`,
`test/e2e.mjs` — plus `shared/download.ts` and `content/screenshot.ts` after review, when the
popup's copy of the download helper became the original's new home.

## The one that would have shipped broken

The remap reads the **active tab's** origin. In the e2e suite the popup is an ordinary tab,
so the first version of the check clicked the checkbox — which made the popup itself the
active tab, and the origin came back as `chrome-extension://<id>`. The assertion passed the
wrong thing for the right-looking reason: notes were remapped, just onto the extension.

The check now sets the checkbox through `evaluate` and calls `bringToFront()` on the page
under review, and asserts the origin **by name** in the hint line rather than counting
remapped pages. `3 pages moved` cannot tell you they moved somewhere useless.

## Rejected

**Offering the remap automatically** when the file's origins differ from the current tab.
The popup closes the moment focus leaves it, so there is nowhere to ask — the same
constraint that put import results in the hint line instead of an `alert`.

**A per-page origin table.** The case that exists is one deployment moving to one dev
server. A mapping UI for the case that does not is a screen nobody asked for.

**Rendering screenshot *paths* as `<img>`.** They point at the reporter's Downloads folder.
In a document whose entire promise is that it always renders, a broken image icon is worse
than a sentence saying where the file is.

## Verification

`npm run typecheck` and `npm run build` clean. `npm test`: **218 e2e checks and 9 upgrade
checks pass** — six of them new:

- the popup saves a shareable HTML file
- the shared file carries the notes
- the shared file loads nothing from the network *(no `<script>`, no non-`data:` src/href)*
- an element name cannot close a tag in the shared file *(the escaping guard)*
- a remapped import says which origin it landed on
- a note captured on another origin arrives on this one

Not covered, and worth knowing: nothing asserts how the document **looks**. The check that
it parses as HTML is that a browser opens it, which is a human step.

## Review follow-ups (PR #13)

Fifteen review comments, fourteen of them acted on. What changed, and why.

### The document

**`esc()` per interpolation became an `html` tagged template.** The rule was enforced by a
module banner, a paragraph in `context.md` and one narrow e2e regex — three layers of
documentation guarding a mistake the construct could make impossible. Substitutions are now
escaped as they interpolate, nested fragments and arrays pass through, and inserting markup
requires saying `raw(...)`. Forgetting `raw` renders visible `&lt;`; there is no longer a way
to forget escaping.

**And it fixed a crash on the way.** `esc()` called `.replace()` on its argument, and
`elementPath` is read unconditionally while `looksLikeAnnotation` validates only `id`,
`comment`, `element` and `selector`. An imported note without one threw a `TypeError` inside
the popup's `try` and produced *"Could not build the file."* for the entire export — one bad
note, no review. `String(value)` in the template removes the class of failure (a non-string
`kind` did the same); the Location row is skipped rather than printed empty. Extending
`looksLikeAnnotation` was the other option offered and was rejected: dropping a whole note
over a missing label loses more than it protects.

**`isEmbeddable` was `startsWith("data:image/")`, which admits `data:image/svg+xml,<svg …>`.**
That field is fully attacker-controlled after an import, and it is the one interpolation that
reaches an active URL sink in a document promised to load nothing. Now
`/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/` — the shape `screenshot.ts` actually
writes. The same regex makes the value provably free of `&<>"'`, so it is interpolated with
`raw`: escaping it was five scans and five copies of a 60–120 KB payload per screenshot.

**A CSP `<meta>`** (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`) makes the
"nothing loads from the network" promise a property of the file rather than a convention
enforced by remembering. The popup's "with their screenshots" line now asks `share.ts`
(`hasEmbeddedShot`) rather than testing `screenshotData` for truthiness, so it cannot claim a
picture the renderer's gate refused.

**The grep-handle Source row leaked Markdown.** `formatSource` returns ``(no path — grep for
`[handle]`)`` — correct in the `.md` report, literal backticks in the one format whose promise
is that it reads properly to someone who has never seen this project's Markdown. It renders as
`<code>` here, like the screenshot-path line above it.

### The import

**`activeTabOrigin` accepted any scheme that parsed.** `chrome://settings`,
`chrome-extension://…`, `devtools://`, `view-source:` and `file:` (origin `"null"`) all parse.
Remapping onto one of those files the review where no content script can ever read it, while
the hint says it worked. `http:`/`https:` only now, and `null` otherwise.

**A tick that could not be honoured was silent.** `?? undefined` collapsed "no origin" into
"not asked for", so the message read like an ordinary import. It now says *"Could not move
them: this tab has no site."*, in the error tone.

**`summary.pages` counted source entries, not keys written.** After a remap,
`staging/checkout` and `prod/checkout` both land on `localhost:3000/checkout` — "across 2
pages" then describes the file, not this browser, in the very case where the user needs to
know two captures merged. Counted as a `Set` of written keys.

**The popup's Pages list went stale exactly when it mattered.** The `finally` refreshed the
status line but not `sessionPages`, so after remapping a staging review onto this site the
list still showed `staging.example.test` — and **Copy session report**, which reads the same
array, emitted the pre-import set.

### Duplication and paperwork

**`download()` in the popup was a second, weaker `downloadBlob`** — no `append`/`remove`
around the click, no `try/catch`. A detached `<a download>` click working is a Chrome-specific
accident, and both call sites ship multi-megabyte blobs. The original moved to
`shared/download.ts` (the popup may not import from `content/`, which is an argument for
moving it, not for copying it) and both surfaces call it; a failed save is now reported.

**`countNotes` had been extracted and two of its three copies left behind.** It lives in
`archive.ts` taking `{ annotations: unknown[] }[]`, and the popup's session copy and the
shared document's title both use it. `buildShareHtml` also re-filtered empty pages that
`exportAll` had already dropped; removed, with a note saying so.

**The remap's only explanation lived inside `#archive-hint`**, which `reportArchive`
overwrites on the first Export or Import — so the sentence describing the checkbox vanished
for the rest of that popup session. It has its own `<p class="hint">` under the checkbox now,
and `#archive-hint` is left as the disposable status line it already was.

**`plan.md` was missing** from this folder. Written, after the fact and marked as such by
being consistent with what shipped.

### The tests

**The embedded-screenshot path — the headline of the feature — was never executed.** Nothing
in the suite sets delivery to `embed` (line ~1269 asserts the default does *not*), so every
annotation had `screenshotData === undefined`: neither the `<img>` branch nor the
`.note__shot-missing` branch ran, and *"the shared file loads nothing from the network"*
passed trivially on a document with no images at all. Two `screenshotData` values are now
seeded into storage before the share click — a real base64 JPEG, and the SVG payload only an
import could produce — and five checks cover what they render: the `<img src="data:image/jpeg`
is present, the SVG reaches neither `src` nor the file, the un-embeddable one is named as a
path, the popup says the screenshots travelled, and the CSP is in the head. A sixth covers the
remap with nowhere to land.

Also: `.tool[title^="Annotations"]` → `.tool[aria-label^="Annotations"]`, following 0.8.1's
rename of the toolbar tooltips.

### Rejected

Nothing in the fifteen was rejected as wrong. The only recommendation *not* taken as written
is requiring `elementPath` in `looksLikeAnnotation` — the reviewer offered "guard the read, or
extend the gate", and the read is guarded, for the reason above.

### Verification of the follow-ups

`npm run typecheck` and `npm run build` clean, and `node --check test/e2e.mjs` passes.
`buildShareHtml` was also rendered outside the browser against a note carrying a hostile
element name, a missing `elementPath`, a non-string `kind`, a grep-handle source and both
`data:` payloads — the escaping, the skipped row, the `<code>` handle and the refused SVG all
hold. The suite itself was **not** re-run here: it needs a headed (or new-headless) browser
and is run centrally. The six new checks bring the block to eleven; the counts quoted above
are from before them.

### Applied on the maintainer's sign-off

`CLAUDE.md` carries both edits now. The Architecture list names `share.ts` and `download.ts`,
with `download.ts` written up as the second worked example of the rule that put `archive.ts`
in `shared/` — the popup saves files too, so the saver cannot live in `content/`. *Conventions
and traps* gains the sentence that matters more: `shared/share.ts` is the only HTML sink,
everything goes through the `html` template, `raw()` is the spelled exception and its argument
is validated first. A second sink is an XSS hole in a file people forward to colleagues.
