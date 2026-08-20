# Changelog — design edits

## What shipped

`content/design.ts` (new): `DESIGN_FIELDS` — thirteen properties across Colour, Type,
Spacing, Layout and Size — plus `readDesign`, `previewDesign`, `previewText`,
`revertDesign` and `diffDesign`.

`content/ui/design-panel.ts` (new): the collapsed section inside the composer, generated
entirely from that table, with a badge carrying the pending count so a shut section
cannot hide edits.

`Annotation` gains `designChanges?: DesignChange[]` and `textChange?: { from, to }`. The
report prints a `| Property | From | To |` table and the text swap, under a line asking
the agent to express them in the project's own tokens.

Nine files: `content/design.ts`, `content/ui/design-panel.ts`, `content/index.ts`,
`content/ui/composer.ts`, `content/ui/styles.css`, `shared/types.ts`, `shared/output.ts`,
plus `test/e2e.mjs` and a fixture.

## Two things the tests caught

**`style=""` is not "left alone".** The revert cleared every property and passed its own
check — the element rendered identically — but the `style` attribute stayed on the node,
empty. It shows in devtools, and page code that tests for the attribute sees it. The
check that failed was `and leaves no inline style attribute behind`, which was written
expecting `null` for exactly this reason; the fix is one line at the end of
`revertDesign`.

**`.card` is our class too.** The fixture used `<div class="card">`, and `.card` is the
overlay's own card. Playwright's strict mode caught it as an ambiguous locator rather
than silently clicking the panel — the fixture element is now `.tile`. Worth knowing
before writing the next fixture: the suite queries page and shadow DOM through the same
locators.

## Rejected

**Keeping the preview after save.** The reference tool does. It would mean the reviewer
testing the app against a change that exists in their tab and in no codebase, until a
reload takes it away unannounced. `context.md` has the full argument — it is the one rule
here that could not bend.

**Letting the panel apply the styles.** Ten lines shorter and it would own an element
reference, leaving the revert — which must fire on paths the panel never hears about — to
reach back into it.

**A free-text CSS box.** It is the easiest control to build and the worst to consume: an
agent handed a CSS blob has to guess which declarations were deliberate.

## Verification

`npm run typecheck` and `npm run build` clean. `npm test`: **224 e2e checks and 9 upgrade
checks pass** — twelve new, in their own fixture:

- the design section is collapsed until it is asked for
- a typed value shows on the real element straight away
- rewriting the text replaces it on the page
- the collapsed section would still show how many properties are pending
- saving the note takes the preview back off the page
- and leaves no inline style attribute behind
- the report carries the deltas as a table
- the report carries the rewritten text with what it replaced
- the report tells the agent to use the project's own tokens
- reopening a note restores the edits it was saved with
- escaping out of an edit also puts the element back
- a multi-element note gets no design controls

Not covered: the `!important` priority actually beating a stylesheet rule that carries
one, and the alpha-colour fallback. Both are single expressions with no branch the suite
can reach without a fixture built solely to prove them.

The absent-controls rule was going to be checked through a *text selection*, which is the
other case it covers. Driving one turned out to need a real mouse gesture the suite has
no precedent for — `selectText()` sets a selection without the `mouseup` the extension
waits for — so the multi-element path stands in. Same branch, one condition.

## Review follow-ups (PR #15)

Sixteen review comments; fifteen were right. What each turned out to be is worth recording,
because three of them were the same mistake in different clothes: **a snapshot that cannot
describe what it found.**

### The revert was destroying styling it never recorded

`revertDesign` walked `DESIGN_FIELDS`, clearing each property and putting the snapshot's
inline value back. `padding`, `margin` and `gap` are shorthands, so an element carrying
`padding-left: 10px` snapshotted as `""` and had all four longhands cleared — and this loop
was unconditional, so it fired on every composer open and close whether the Design section
was ever opened or not. The same call dropped `!important`, which `getPropertyValue` does
not carry, so `color: red !important` came back as `color: red` and started losing to the
stylesheet rule it used to beat.

`DesignSnapshot.inline` is gone. It holds the `style` attribute verbatim now, and the revert
is `setAttribute`, or `removeAttribute` when there was none. The `style=""` special case the
tests caught during the original work stopped being a special case: restoring the
attribute's *absence* is the same operation as restoring its content.

### The panel opening another note was never a revert path

`brief.md` and `context.md` both listed it. `openComposer` began with `composer?.destroy()`,
not `closeComposer()`, and all three paths that reach it — a marker click, a panel row, a
draft from a child frame — reassign `composerTargets` first. So the previous element kept its
inline override for the rest of the page's life, unreachable. Annotate A, set `font-size`,
click another note in the panel: A stays 22px.

The snapshot now travels with a `designTarget`, and both `closeComposer` and the top of
`openComposer` go through one `revertPreview()`. Documentation that described a path the code
did not have is the kind of error only a reader can find.

### Reopening a note showed a badge over an element rendering nothing

The controls and the count were rehydrated from `designChanges`; the preview was not, because
it only ever happens through the panel's callbacks. Badge of 3, three populated fields, an
untouched element — and nudging one control would apply that one alone. `DesignPanel.replay()`
now runs from the end of the composer's constructor. The existing check asserted only that the
badge read `"3"`, which is exactly why it passed.

### Two ways an invalid value reached the report

`setProperty` with an unparseable value is a silent no-op, so `22px` → select-all → `1` left
the element at 22px while the field read `1`, and `diffDesign` reported `font-size: 16px → 1`.
`previewDesign` clears the property before setting it, so the page always agrees with the
field, and `diffDesign` drops anything `CSS.supports` refuses.

### The colour fallback was a value the user could also pick

`rgbToHex` returned `#000000` for anything its `rgb()` regex missed, which is most elements'
`background-color` (`rgba(0, 0, 0, 0)`). Two failures from one line: the Background swatch
opened on black for an element with no background — the exact lie the comment above it claimed
to avoid — and picking black made `from === to`, so a change the reviewer had watched being
applied was dropped from the report. It returns `null` now; `diffDesign` falls back to the raw
computed string, which can never equal a `#rrggbb`, and the panel prints that string beside
the swatch.

### Saving an unresolvable note wiped its recorded edits

`existing.designChanges = designChanges` ran unconditionally. When `resolveElement` returns
`null` — an SPA re-render is enough — there is no snapshot, so both deltas are `undefined` and
both were written through. The trigger was wanting to fix a typo in the comment; the section
is not drawn in that state, so nothing suggested saving would discard anything. Guarded on
`designSnapshot`.

### Untrimmed text was two bugs

Source-formatted markup gave `"\n      Hello\n    "` as `snapshot.text`. The report prints it
inline, so one line became three and the Markdown broke; and setting `.value` on a one-line
`<input>` strips CR/LF per spec, so typing one character and deleting it recorded a
`textChange` of pure whitespace. `editableText` now returns both forms — normalised for the
field, the report and the comparison; raw so the revert hands back the page's own formatting
rather than our tidied version of it.

### Escape closed the composer when it was meant to close a dropdown

The five `<select>` controls and the colour picker dismiss their own popups with Escape, and
that keydown bubbles to the composer's handler, which read every Escape as cancel: the typed
comment gone and every preview reverted for shutting a dropdown. The handler checks
`composedPath()[0]` and lets those two controls keep the key.

### The card grew after it was placed

`position()` runs once, while `.design__body` is `display: none`. Opening the section adds
~216px, and the `max-height` the CSS comment cited caps how much it grows rather than stopping
it — anchored low on a short viewport, the footer with the Save button ended up below the fold,
inside a `pointer-events: none` layer with nothing to scroll. The composer keeps its anchor and
re-runs `position()` from the toggle. The CSS comment that made the wrong claim is corrected.

### The three small ones

`onTextPreview` did not redraw the highlight while `onDesignPreview` did, for a reason that
applies identically — replacing `Upgrade plan` with a longer label resizes the element as
surely as padding does. Both now call one local.

`DesignChange` was declared in both `content/design.ts` and `shared/types.ts`; structurally
identical, so TypeScript said nothing while both were live in the same call chain.
`content/design.ts` imports the shared one.

`dataset.changed` was written and never read — no CSS rule, no check, no other reader. Dropped;
the badge already carries it for both.

### `plan.md` was missing

The folder shipped three of the four files. Written from what the work actually decided before
any code, including the three decisions that were fixed in advance and the three things left
out on purpose.

## Rejected

Nothing. One comment — the `!important` preview beating a stylesheet rule — was raised in the
original changelog as *untested*, not as wrong; there is now a check for it, on a fixture
element carrying its own inline declaration.

## Verification after the follow-ups

`npm run typecheck` and `npm run build` clean. Four checks added, all in the design block:

- and puts them back on the element, not just into the controls
- a colour the swatch cannot hold is named beside it rather than shown as black
- the preview beats the element's own inline declaration
- the revert hands back inline longhands and !important, not just the fields it knows

The fixture gains one element — `.keep`, a `<p style="padding-left: 10px; color: red
!important">` with no background of its own — which is the only shape that can prove the
attribute-restore, the priority and the unrepresentable colour at once.

Still not covered: the alpha-colour path through `diffDesign` (the swatch has to be driven and
the report re-copied, which needs a second annotation and would disturb the entry order the
block's later assertions depend on).
