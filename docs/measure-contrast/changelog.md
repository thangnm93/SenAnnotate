# Changelog — contrast

Written during the work.

## What shipped

`parseRgb`, `contrastRatio` and `contrastReport` in `content/measure.ts`; a
`ContrastReport` on `StyleSummary` and on `Measurements`; a coloured row on the readout
and a `**Contrast:**` line in the report at `detailed` and above.

Small, because `measure-core` had already paid for the hard part: resolving what colour
an element is *actually* painted on needs an ancestor walk, and `effectiveBackground`
already did it.

## Three test expectations I got wrong, and the code was right each time

Recording these because the pattern is the point — every one was me asserting a number I
had guessed rather than worked out.

1. **`rgba(0,0,0,0.5)` on white is 3.98:1, not the 5.32 I wrote.** Composited it is
   `rgb(127.5)`, luminance 0.2139, so `1.05 / 0.2639`. Worked by hand afterwards; the
   check now carries that derivation in a comment, because a number copied out of the
   implementation only asserts that the code agrees with itself.
2. **`#757575` on white is 4.61:1 and passes AA.** I picked it as "a grey that fails at
   body size and passes at large", which is exactly what it is not — it is the classic
   *just clears AA* grey. `#8a8a8a` at 3.45:1 sits in the only band where `large` changes
   the answer, which is the only band worth testing it in.
3. **The report assertion demanded a failing verdict from an annotation on `#save`**,
   which is white on `#2563eb` — 5.17:1, passes AA and misses AAA. Fixing the expectation
   rather than the code turned out to complete the set: the two readout checks cover an
   outright fail and a pass of both, so the report check now covers the middle verdict.

## The probe that tested the wrong element

The first run showed `#wrapper` — a `div` whose text lives in a `<span>` — producing a
verdict, which `hasOwnText` exists to prevent. The guard was fine. `elementFromPoint` at
the centre of the div lands on the span, and the span genuinely does have text of its own.

The fixture now gives the wrapper 24px of padding and the check hovers that, so the
pointer is over div and not child. Verified the other way too: with `hasOwnText` removed,
the check fails with `4.49:1 · fails AA` on the wrapper.

## Decisions worth keeping

**Alpha is composited before the ratio.** `rgba(0,0,0,0.5)` on white is not black on
white. Taking the ratio on the raw foreground reports 21:1 for text that is visibly grey —
a checker that errs in the *reassuring* direction is worse than no checker.

**WCAG's "large" is not the obvious threshold.** ≥ 24px, or ≥ 18.66px at weight ≥ 700.
Not 18px. Getting it wrong moves the pass mark by 1.5:1 and silently passes failing text,
so all four boundary cases have their own check.

**No suggested colours.** The report names the ratio and the threshold missed. Proposing
a replacement is a design decision and not one a number should be making.

**The verdict row is coloured outside the accent system.** Pass green, fail red and bold.
A red accent must not make a passing check look failed, so these two do not derive from
`--sa-accent` — the same exception, for the same reason, as the band colours.

## Verification

- `node test/measure.mjs` — 52 checks, up from 37.
- `npm run typecheck` — clean.
- `npm test` — **316/316** e2e, **9/9** upgrade.
- The `hasOwnText` guard was verified by deleting it and watching the wrapper check fail.

## The readout became a grouped inspector panel

Asked for with a screenshot of a panel laid out in sections. The compact five-row readout
is now a header naming the element in CSS terms — `div.card` — followed by **Box Model**,
**Appearance** and **Text**, in `property: value` rows with a fixed value column and
swatches on the colours.

Three deliberate departures from the reference, each stated rather than silently taken:

- **No close button.** The whole overlay is `pointer-events: none`, and letting the panel
  take the pointer would make it swallow clicks on the page beneath — in mode 4, a click
  is how you anchor an element. It follows the hover instead, so there is nothing to
  close.
- **`padding` and `margin` keep their per-side `T R B L` cells** rather than the CSS
  shorthand the rest of the panel uses. The shorthand was explicitly rejected earlier in
  this work: it only reads if you already know its order, and the sides whose band was
  too thin to label are exactly what the panel exists to show.
- **Rows are conditional.** No `gap` on a non-flex element, no `border` at zero, no
  contrast where none can be taken honestly. A row that is always present and usually
  empty trains the reader to skip the group.

### The edit that went wrong twice, the same way

Replacing `paintReadout` meant cutting one method out of a 560-line file. The first
attempt sliced from the method's doc comment to the next member's header and swallowed
`paintBand`, `paddingBox`, `showGap`, `hideGap` and `hideAll` — precisely the failure
recorded in `docs/measure-core/changelog.md` about deleting code by index slicing.

The second attempt used brace matching, which is the right idea and was still wrong: it
took the **first** `{` after the doc comment, and this method's parameter list contains
`{ padding: DrawnSides; margin: DrawnSides }`. Matching from that brace closed inside the
signature, leaving the old body's tail behind and producing a syntax error 200 lines away
from the actual damage.

The working version anchors on `): void {` — the brace that opens the *body* — and the
helper carries that reasoning in its docstring. Worth internalising: brace matching is
only as good as the brace you start from, and a TypeScript parameter list is full of
decoys.

Diagnosing it also cost time because the first look was at `npm run typecheck | tail -4`.
The last four errors were cascade noise 200 lines below the cause; the **first** error
named the line. Read the first error.

### Verification

- `npm test` — **319/319** e2e, **9/9** upgrade, **52/52** unit.
- Read off the built extension in a screenshot: header, three sections, both swatches,
  the dimmed side cells, and no contrast row on an element with no text of its own.
- Nine readout assertions were rewritten to read `key`/`value` spans rather than a row's
  concatenated `textContent` — `background` and `#fffbe0` have no separator between them
  in the DOM, which is the same trap the per-side cells sprang earlier.
