# Changelog — rulers, guides and the grid

Written during the work.

## What shipped

`ui/grid.ts` (viewport-relative column bands), `ui/rulers.ts` (two strips plus the guides
dragged out of them, in document coordinates), five settings under the existing
`Measuring tools` master, and guide persistence in `sessionStorage`.

## The test that proved nothing, and how it was caught

The block opens with *"nothing is drawn while the master is off"* — the check that
protects the one real cost of this feature, two dead bands down the edges of someone
else's page.

Deleting `settings.measureTools &&` from the rulers gate left the suite **green at
333/333.** The check runs before anything has been switched on, so `showRulers` is false
and the rulers are hidden whether or not the master is wired in at all. It asserted a
true thing about a state that could not fail.

The state that can fail is the other one: rulers on, then the master off. The teardown
originally turned the rulers off first — the tidy order — and never visited it.
Reordered so the master goes first while both switches are still on, the same deletion
now fails with `{"rulers":2,...}`.

Two things worth keeping from that:

- **An off-by-default feature needs its off state tested from the on state**, not from
  the initial one. Starting state passes for free.
- This is the third regression check in this work that had to be verified by breaking
  the fix, and the second that was worthless until it was. The step is not ceremony.

## A second assertion that was measuring the wrong thing

The visibility helper filtered on `getComputedStyle(node).display !== "none"`. The grid
hides by hiding its container, so all twelve bands still compute to `display: block` on a
blank screen — and the teardown check reported twelve bands drawn when nothing was.

`node.getClientRects().length > 0` answers the question actually being asked: is this on
screen. Its ancestors count, which is the whole point.

## Vertical ruler labels: three attempts, each measured

A four-digit document coordinate does not fit across a 20px strip, so the labels are
rotated. Getting them *inside* the strip took three goes, and none of them by eye:

1. `rotate(-90deg)` at `left: -12px` — box at x −1 to 7, eaten by `overflow: hidden`.
2. `rotate(90deg)` at `left: 11px` — box at 14 to 22, over the right edge.
3. `rotate(90deg)` at `left: -1px` — box at 2 to 10, inside.

The reason the numbers look arbitrary is that the label is a child of the **tick**, which
sits at the strip's right edge, not a child of the strip. The offsets are relative to
that. The check now asserts the label's box against the strip's, so the next person who
adjusts the rotation finds out immediately.

## Decisions worth keeping

**Guides are document coordinates; the grid is viewport coordinates.** Opposite rules, on
purpose: a guide is aligned to *content* and must scroll with it, a grid is aligned to
the *frame* the design was drawn for and must not. Both files say so in their headers,
because the inconsistency is the kind that gets "fixed" by someone tidying up.

**`sessionStorage`, not `chrome.storage`.** In-memory loses guides on the most common
event in a review. `chrome.storage.local` costs a key, a quota and cross-tab collisions
on the same URL. `sessionStorage` survives a reload and dies with the tab, which is
exactly the lifetime a pencil line deserves. Wrapped in `try`, like `HIDDEN_KEY` — it
throws in a sandboxed frame.

**Bands are `columns - 1` gutters, never one at each end.** A gutter outside the first
column is a wider margin, and saying it twice is how two numbers start disagreeing with
the stylesheet they are checking.

## Verification

- `npm test` — **333/333** e2e, **9/9** upgrade, **52/52** unit.
- Driven by hand on the built extension: drag out, scroll, drag back, and a screenshot.
- The master gate was verified by deleting it, twice — once to discover the check was
  worthless, once to confirm the rewritten one is not.
