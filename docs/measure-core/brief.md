# Brief — Measuring, and putting the numbers in the report

> **Superseded in two places, deliberately left as written.** The Measure card described
> below was built and then removed, and the feature is now off by default behind a
> *Measuring tools* switch in Settings. This file is the record of what was decided at
> the time; [`changelog.md`](./changelog.md) says what changed and why.

## What

A fourth inspect mode and a measurement engine, so an annotation can carry the
numbers instead of describing them in prose.

- **Box model on hover.** The highlight gains a `320×48px` badge and shaded
  padding/margin bands, the way a browser's own element inspector draws them.
  A toggle, off by default.
- **Mode `measure` (key `4`).** Click one element to anchor it, hover a second, and
  the overlay draws the gap between the two rects with the pixel figures on it.
  A second click opens the composer with both elements captured and the figures
  attached.
- **A Measure card.** A new toolbar button opens a small card, built on the same
  anchored-placement pattern as the settings card. In this release it holds one row —
  the box-model toggle. It exists now because it is where the next two releases put
  their controls, and retrofitting a home for them later means moving rows a user
  has already learned.
- **`**Gap:**`, `**Edges:**` and `**Box:**` in the Markdown report**, gated by
  detail level.

## Why

Every UI note this extension exists to produce is, underneath, a claim about a
number: *this is too tight*, *these are not aligned*, *that is the wrong size*. The
report currently carries none of them. It says `button "Save"` and repeats whatever
the reviewer typed, and the agent on the other end has to re-derive the geometry
from a screenshot — or guess.

`**Position:**` already ships a bounding box at `detailed`, which is the shape of the
answer but not the answer: a single element's box says nothing about the *relationship*
that almost every spacing complaint is actually about. Two elements and the space
between them is the unit of a layout bug.

The second reason is that reviewing a page and measuring it are currently two tools.
A reviewer who wants a number closes the overlay, opens devtools, reads the number,
closes devtools, reopens the overlay, and retypes the number into a comment. Each of
those steps is a chance to annotate the wrong element.

## What gets measured, and what the report says

```ts
interface Sides { top: number; right: number; bottom: number; left: number }

interface BoxModel {
  width: number; height: number;              // border-box, as the rect gives it
  content: { width: number; height: number };
  padding: Sides; border: Sides; margin: Sides;
}

interface GapMeasurement {
  gap: { x: number; y: number };   // + apart, - overlapping, 0 touching
  edges: Sides;                    // B's edge minus A's edge; 0 is aligned
  center: { x: number; y: number };
  containment: "none" | "b-inside-a" | "a-inside-b";
}
```

One expression covers all three gap cases on an axis, with no branching:

```ts
gap.x = -(Math.min(a.right, b.right) - Math.max(a.left, b.left));
```

When `containment` is not `"none"` the gap is meaningless — one rect is inside the
other — and the report prints `**Edges:**` alone.

Report lines, by detail level:

| Line | compact | standard | detailed | forensic |
|---|:-:|:-:|:-:|:-:|
| ` · gap 24×0px` appended to the one-line bullet | ✓ | | | |
| `**Measured to:**` and `**Gap:**` | | ✓ | ✓ | ✓ |
| `**Edges:**` | | | ✓ | ✓ |
| `**Box:**` | | | ✓ | ✓ |
| `**Centres:**` | | | | ✓ |

```markdown
**Measured to:** button "Cancel" (`.actions > button.secondary`)
**Gap:** 24px horizontal, 0px vertical
**Edges:** top aligned, bottom aligned, left +8px, right -12px
**Box:** 320×48px · content 296×32 · padding 8px 12px · margin 0 0 16px · border 1px
```

## Interaction

Mode `measure`, key `4`. Hover reads, click commits — the same contract as mode
`point`, deliberately not a new one.

| Gesture | Result |
|---|---|
| hover | highlight + size badge + box-model bands |
| click | anchor that element; the hint changes to name the next step |
| hover, anchored | gap drawn between the two rects, figures on the lines |
| click, anchored | composer opens with both elements and the figures attached |
| `C`, anchored | same, without clicking — a click destroys hover states worth measuring |
| `Esc` | clears the anchor, stays in the mode |

Changing mode, leaving inspect mode, and the existing `resetMarquee()`/`clearPicked()`
path all clear the anchor.

## Scope

**In**

- `readBoxModel(el)` and `measureGap(a, b)` — a pure, DOM-only engine
- Box-model overlay drawing, behind a setting
- Mode `measure`: anchor, hover, gap drawing, capture
- `Annotation.measurements`, and its three report lines
- A Measure card with one row
- A dedicated e2e fixture with deterministic geometry

**Out — deliberately**

- **Cross-frame measuring.** Anchoring in the top document and targeting inside an
  iframe would need the frame protocol extended to carry rects both ways. The
  overlay still highlights inside frames; the badge does not appear there.
- **Colour sampling and contrast** — the next release.
- **Page rulers, guides, layout grid** — the release after. Those never enter the
  report, which is why they rank last despite being the cheapest.
- Anything that *edits* the page. This tool reads.
  > **No longer true, as of `docs/css-editor/`.** The read-only rule shaped the whole
  > architecture and is worth knowing as history, but anything quoting it from here on is
  > quoting history. Left in place rather than deleted: this file records what was decided
  > at the time.

## Success criteria

1. Selecting two elements 24px apart on the fixture puts `**Gap:** 24px` in the
   report, verbatim, with no reviewer arithmetic.
2. A 0.5px gap reports as `0.5px`, not `0px`. Sub-pixel gaps are real bugs and
   rounding them away is the failure mode this must not have.
3. `npm run typecheck` clean; `npm test` green, including the six hint-text
   assertions this change knowingly breaks.
4. No new manifest permission, and no new bridge RPC. If either becomes necessary,
   the design was wrong.
5. `src/content/index.ts` grows by roughly the wiring and no more — the mode's state
   and pointer logic live in their own module.
