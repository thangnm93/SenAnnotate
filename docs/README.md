# Docs

Design record for SenAnnotate. Written during the work, not reconstructed afterwards —
so the changelogs include the things that went wrong, the assumptions that turned out
false, and the measurements that contradicted earlier notes.

One folder per task. The files at the top level belong to the 0.2.0 rebrand, which came
first and is the largest piece of the record.

## 0.2.0 — the rebrand (Vuetation → SenAnnotate)

Turning a Vue-specific annotator into one that works on any website.

| File | What it is |
|---|---|
| [`brief.md`](./brief.md) | What was built and why; scope in/out; success criteria |
| [`context.md`](./context.md) | Background and constraints: the verified rename inventory, why the `Vue*` types were kept, the colour and contrast reasoning, the icon geometry |
| [`plan.md`](./plan.md) | Strategy summary — the ordered approach |
| [`implementation-plan.md`](./implementation-plan.md) | The executable version: bite-sized steps with real code and a verification command per step |
| [`changelog.md`](./changelog.md) | What actually happened, including four surfaces the plan missed and the checks that had to be rewritten |

## [`framework-detectors/`](./framework-detectors/) — 0.3.0

Extending component and source detection from Vue only to Vue, React, Svelte and
Angular, by making the detector layer pluggable first. Its `context.md` has the table
of what each framework actually exposes — the reason the design does not flatten them
into one shape, and why Angular and React 19 report no source line at all.

## [`hardening/`](./hardening/) — 0.3.2

A full-codebase security and correctness review, then the fixes. All six confirmed
defects were in the 0.3.1 clean-room rewrite; its changelog explains why the freeze
timer design had to be replaced rather than patched.

## [`ci-cd/`](./ci-cd/) — GitHub Actions

Build/typecheck on every push, and a tag-triggered GitHub Release carrying the packed
zip. Its `context.md` explains why the Playwright suite is deliberately **not** run in
CI — it borrows Playwright and Vue from sibling monorepo directories that a bare
checkout does not have.

## [`marquee-select/`](./marquee-select/) — 0.4.0

Reworking drag-select to take what the box **fully contains**, at the shallowest level
contained, instead of everything it touches — plus the hint line under the toolbar,
added because a mode nothing on screen mentioned went unused for three releases.

## [`toolbar-collapse/`](./toolbar-collapse/) — 0.5.0

Collapsing the toolbar to a single handle, because it is docked in the corner pages use
for chat widgets and cookie bars. Its `changelog.md` is worth reading for two traps: the
keyboard focus ring that only a screenshot caught, and why the collapsed handle's count
badge could not reuse the `.count` class.

## [`modal-click-leak/`](./modal-click-leak/) — 0.5.1

Our own toolbar was retargeting to the shadow host on the way out, so every site that
dismisses a modal on an outside pointer event closed it the moment the toolbar was touched —
making a modal the one thing that could not be annotated. Reported as a freeze bug; freeze
was measured and cleared. Its `changelog.md` also records why `waitForFunction` can never
observe a frozen page.

## [`modal-focus-leak/`](./modal-focus-leak/) — 0.5.1

The other half: a toolbar click took focus off the page's dialog, so a modal that closes on
focus loss was dismissed and a modal with a focus trap fought the composer for focus and won —
notes typed into it were silently dropped. Its `changelog.md` records the `fill()`
measurement that nearly hid the second bug, and the one case that stays broken with the
alternatives rejected.

## [`chrome-store-publish/`](./chrome-store-publish/) — Web Store automation

Tagging a release now also uploads the packed zip to the Chrome Web Store and submits it for
review. Its `context.md` has the setup steps and two findings worth knowing before copying
any other recipe for this: the v1.1 API stops serving on 15 October 2026, and refresh tokens
expire after seven days while the OAuth consent screen is in "Testing".

## [`hover-label-clamp/`](./hover-label-clamp/) — 0.5.3

The hover label was anchored to the highlighted element's left edge with nothing bounding it
against the right of the viewport, so hovering anything near the edge cut off the source path.
Found while shooting the Web Store screenshots rather than from a bug report — its
`changelog.md` notes what that says about photographing your own product.

## [`screenshot-markup/`](./screenshot-markup/) — 0.6.0

The screenshot was captured, cropped and downloaded — and the report printed a bare
filename no reader could resolve. Adds a markup editor (box, arrow, destructive blur)
between capture and save, and a delivery choice: a path an agent can open, or an
embedded `data:` URI. Its `changelog.md` records why the editor had to take focus, and
why blur reads from the canvas rather than the original bitmap.

## [`hover-capture/`](./hover-capture/) — 0.6.0

<kbd>C</kbd> annotates whatever the pointer is over, because a *click* is the one thing
that closes a dropdown, a hover menu or a tooltip. Its `context.md` explains why freeze
does not help and why losing the hover state to the composer's focus is survivable.

## [`annotation-triage/`](./annotation-triage/) — 0.6.0

Type (`bug`/`ui`/`copy`/`question`) and status (`open`/`done`) on an annotation, a
filter in the panel, and a JSON export/import round-trip. Its `changelog.md` records
four test failures that all had one cause — a fixture another block had already
annotated — which is a standing trap for anyone adding to the suite.

## [`session-and-frames/`](./session-and-frames/) — 0.6.0

One report covering every annotated page, and annotation *inside* iframes. Its
`changelog.md` covers the restructure `all_frames: true` forced on `content/index.ts`,
the three child-frame problems the plan did not anticipate, and a permission-gated
clipboard read that hung the suite for ten minutes instead of failing.

## [`accent-color/`](./accent-color/) — 0.6.1

One setting for the extension's colour, reaching the four places that hold it and cannot see each
other: a shadow stylesheet, the popup's document, a service worker's badge and a canvas
`strokeStyle`. Its `context.md` explains why the text-on-accent shade cannot be a darken, why the
luminance threshold is 0.3 and not a rounder number, and why the default deliberately sets
nothing at all. Its `changelog.md` records an assertion that reported a working feature as broken
because `color-mix()` computes to `color(srgb …)`, not `rgb(…)`.

## [`multi-pick/`](./multi-pick/) — 0.6.1

⌘/Ctrl+click to collect elements that no rectangle can enclose without taking the page with
them, then one note for the set. Reuses the marquee's multi-element annotation end to end, so
nothing outside `content/index.ts` changed. Its `changelog.md` records the bug that reading
found and testing would not have: `updateHover`'s second, bridge-enriched draw would have wiped
the set ~100ms after every pick.

## [`modal-top-layer/`](./modal-top-layer/) — 0.6.1

The third modal task, and the first where the dialog was the aggressor: a `showModal()` dialog
enters Chrome's **top layer**, above every z-index, and makes everything outside it inert — so
with one open, no note could be added at all. Its `context.md` has the table of rejected fixes
(a popover host paints above the dialog and is still inert); its `changelog.md` has the trap
worth reading, which is that moving our host is useless on its own because every piece the
overlay draws is itself `position: fixed`.

## [`upgrade-persistence/`](./upgrade-persistence/) — 0.6.1

Notes and settings surviving a new version — which they already did, from 0.2.0 on, so this is
a test rather than a fix. `test/upgrade.mjs` performs a real upgrade over two launches sharing
one profile. Its `changelog.md` records why `chrome.runtime.reload()` cannot stand in for that
(Chrome drops a `--load-extension` extension instead of reloading it), and `context.md` states
the three-part compatibility contract a future release must not break.

## [`challenge-frames/`](./challenge-frames/) — 0.7.0

Why a Cloudflare challenge could not be verified with the extension merely *installed*:
diagnostics capture replaces `fetch`, `XHR` and `console.error` in the page's heap, and
`all_frames: true` was applying that inside the Turnstile widget's own iframe, where a
browser-integrity check reads it as tampering. `changelog.md` records that the capture
was never read outside the top frame in the first place, so the fix restricts rather
than trades off — and that a `grep` for a minified identifier is not a check against a
bundle. `context.md` lists the two gaps left open, the larger being that the
`captureDiagnostics` setting does not gate the MAIN-world patch at all.

## [`modifier-drag/`](./modifier-drag/) — 0.7.0

⌘/Ctrl+drag draws the marquee without switching to `area` mode. The modifier was already
taken by multi-pick, so `context.md` is mostly about telling one gesture from the other by
movement, and about why `area` mode was kept after all — the capability argument for it
turned out false and the discoverability argument saved it.

## [`collapse-dismisses/`](./collapse-dismisses/) — 0.7.0

Collapsing the toolbar now leaves inspect mode and closes the open card. Deletes
annotating while collapsed, knowingly. Its `changelog.md` is worth reading for where the
suite actually broke: not in the collapse block, whose assertions were rewritten first and
passed, but in the **modal** block, which has nothing to do with collapsing.

## [`panel-toolbar-motion/`](./panel-toolbar-motion/) — 0.7.0

The panel fades in and out; the toolbar folds into its handle. `context.md` explains why
every property choice was forced by one fact — Playwright counts `opacity: 0` as visible —
and `changelog.md` records the wrong turn: the fold was declared broken on the strength of
a screenshot taken 60ms in, which is far too slow to sample a 160ms animation. To check
motion, measure it; do not photograph it.

## [`toolbar-settings/`](./toolbar-settings/) — 0.7.0

Settings moved out of the popup and into a card behind a gear on the toolbar, with the
help text behind tooltips. `brief.md` lists the five decisions and what each one costs —
including the accepted hole: on `chrome://` pages there is no toolbar and therefore no
way to reach any setting. `context.md` has the constraint that shaped the CSS twice over
(Playwright counts `opacity: 0` as visible) and the `chrome.storage.sync` trap that makes
a test block which flips real settings dangerous to every block after it. `changelog.md`
records twenty minutes lost to reading event plumbing when the failing assertion, not the
code, was wrong.

## [`props-value-redaction/`](./props-value-redaction/) — unreleased

A full-codebase security pass, and the one confirmed exposure it found: `includeProps`
(default on) recorded a controlled input's typed value — a password included — into
storage, exports and forensic reports, past the "field values are never recorded"
guarantee. `context.md` traces every hop and explains why the fix sits in the detector
dispatcher rather than in each detector or on the content side. `changelog.md` records
what the sweep cleared as well as what it caught.

## [`hide-until-restart/`](./hide-until-restart/) — unreleased

A per-tab switch that hides the overlay until the tab is closed. Its `context.md` is
mostly about the one real decision — `sessionStorage`, not `chrome.storage`, because the
state is per-tab and per-session — and why there is deliberately no in-tab way back.
`changelog.md` has the miscounting-test wrong turn: a hidden node still counts.

## [`clear-on-copy/`](./clear-on-copy/) — unreleased

Copying the report can now empty the page's annotations, so the next round starts clean.
Its `context.md` is the one to read for the rule the rest of the overlay inherits: **only
two things ever remove annotations** — the explicit "Clear all" and this setting. A close
button that also cleared was designed and then cut, and the argument is recorded there
rather than lost. Its `changelog.md` records the copy shortcut this feature originally
carried, and the 0.6.0 binding it collided with.

## [`composer-retarget/`](./composer-retarget/) — unreleased

Clicking picks whatever is under the pointer, which is routinely one level off what you
meant — the `<span>` inside the button, the wrapper around the card. The arrow keys and
four buttons now walk the DOM from an open composer. Its `context.md` explains why the
DevTools bindings this came from could not be copied, and why the keys stop working
once the note has text.

## [`draggable-toolbar/`](./draggable-toolbar/) — unreleased

Collapsing stops helping when the bottom-right corner is the thing being reviewed, so
the pill can now be dragged anywhere. Its `context.md` is the one to read before
touching pointer handling again: it sets out why adding a drag did **not** reopen
`modal-click-leak/` or `modal-focus-leak/`, and which of those guarantees hold by
design and which hold by accident.

## [`modal-trap-refocus/`](./modal-trap-refocus/) — unreleased

The third act of the modal-focus story, and the one that contradicts the second: inside a
Reka UI / Radix / Headless UI dialog the composer took no typing at all, because those traps
restore focus from a `focusout` that fires on the *page's* element and never travels through
our host. `modal-focus-leak/` had called that case unfixable, having assumed such a page can
only close rather than re-focus. Its `context.md` quotes the library source; the `changelog.md`
explains the `relatedTarget === null` seam the fix uses, and why reparenting the host into the
dialog — which would cover more — was deliberately not done.

## [`escape-closes-cards/`](./escape-closes-cards/) — unreleased

<kbd>Esc</kbd> now closes the settings card and the annotations panel, innermost layer first.
Its `context.md` has the full order and the measurement behind the odd-looking rule that a
*hovered* tooltip does not answer Escape while a focused one does.

## [`toolbar-legibility/`](./toolbar-legibility/) — unreleased

Toolbar buttons name themselves on hover through the overlay's own tooltip instead of `title=`,
and the mode hint stopped running off the right edge of the screen. Its `context.md` records
why the name moved to `aria-label` (37 e2e locators matched on `title`, and an attribute that
vanishes under the pointer is a flaky suite) and why the hint stays one line.

## [`settings-card-follows-dock/`](./settings-card-follows-dock/) — unreleased

`draggable-toolbar/` let the pill go anywhere and left its settings card in the corner it
came from. The card now anchors to the dock's measured box and tracks it through a drag;
the annotations panel deliberately does not. Its `context.md` is worth reading for two
things: why a card this tall cannot use the composer's "prefer, flip, clamp" placement, and
why the default corner is left entirely to CSS. The `changelog.md` records the e2e trap —
a vertical drag gesture whose first step leaves the pill never starts one.

## [`freeze-frame-scope/`](./freeze-frame-scope/) — issue #24

`freeze.ts` was monkey-patching five native timer functions in every iframe at
`document_start` — the same native-identity tampering that broke Turnstile once already.
The brief records why the fix is a one-line top-frame guard rather than a design
decision: `freeze()` provably cannot run in a child frame, so the wrap was dead weight.
Read it before adding cross-frame freeze; it says where that work attaches.

## [`release-changelog/`](./release-changelog/) — generated release notes

`CHANGELOG.md`, rebuilt from the tags and the Conventional Commit subjects between them,
and a release that fails before installing anything when its tag has no section. Its
`context.md` reverses the "generated release notes are enough" call made in
`ci-cd/brief.md` and says what changed to justify that.


## [`measure-core/`](./measure-core/) — measurement, in the report

A fourth inspect mode that measures the gap between two elements, a box-model overlay,
and the three report lines that carry the figures. Its `context.md` argues why none of
it touches the MAIN world — measurement reads the shared DOM, so it needs no bridge and
no permission — and records the two decisions that look arbitrary: fixed band colours
instead of accent-derived ones, and why `**Gap:**` prints a detail level earlier than
`**Box:**`. First of three planned measurement releases; `plan.md` has the ordering.


## [`host-style-leak/`](./host-style-leak/) — unreleased

Why goaffpro.com/signup went blank the moment the overlay loaded: page CSS cannot reach
*into* a shadow tree, but it can style the **host**, and there outer-tree declarations beat
`:host` rules — so daisyUI's `:root, [data-theme] { background-color: … }` matched the
`data-theme` we set for our own dark mode and painted our full-viewport, top-of-the-z-order
host opaque white over the site. Its `context.md` explains the asymmetry and why
`:host { all: initial }` was never the guarantee its comment claimed; its `changelog.md`
records the two false leads (freeze CSS, the `console.error` patch) and the one that
matters for next time — enumerating page stylesheets from the isolated world finds no match
for the host, while `CSS.getMatchedStylesForNode` over CDP answers in one call.


## [`history/vuetation/`](./history/vuetation/) — the predecessor

Where the three-world architecture, the port map from
[`agentation`](https://github.com/benjitaylor/agentation), and the source-resolution
strategy were worked out, for v0.1.0. Still load-bearing; left unedited.

## Reading order

New to the project: `history/vuetation/context.md` explains **why** the extension is
split across three JavaScript contexts, which is the one non-obvious thing about it.
Then `context.md` here for what the 0.2.0 rebrand changed.

Debugging source resolution: `history/vuetation/context.md` has the four strategies
ranked best-to-worst, and the note about measuring the installed package rather than
trusting blog posts — that one cost a detour.

## Provenance

The 0.2.0 and `history/vuetation/` files were authored at the monorepo root (under
`docs/senannotate/`, `docs/vue-chrome-annotator/`, and `docs/superpowers/plans/`),
following the monorepo's task documentation convention, then copied here once the
project got its own remote. Their cross-references were rewritten to be repo-relative at
that point.

**Those monorepo copies still exist**, so the two can drift. Treat the copy in this repo
as canonical — it travels with the code it describes.

`ci-cd/` and `release-changelog/` were written here directly and have no monorepo
counterpart.
