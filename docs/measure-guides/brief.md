# Brief — Rulers, guides and a layout grid

## What

The third and last measurement release, and the only one that never reaches the report.

- **Screen rulers** down the top and left edges, labelled in document coordinates, so the
  numbers still mean something after a scroll.
- **Guides** dragged out of those rulers, moved by dragging, deleted by dragging back.
  Positioned in document space, so they stay on the thing they were aligned to.
- **A layout grid** — N columns, a gutter and a page margin — laid over the viewport.

## Why

The first two releases answered *how far apart are these two things* and *is this text
readable*. Neither answers the question a designer asks first: **is this aligned to
anything at all.** A gap of 24px tells you nothing if the column it belongs to starts
3px off the grid every other card.

Rulers and guides are how that question has been answered in every design tool for
thirty years, and there is no version of it that fits in a report — which is why this
release is scoped last and stays out of `Measurements` entirely.

## The constraint that shapes all of it

The overlay host is `pointer-events: none`, and individual pieces opt back in. That is
load-bearing: without it a click on our toolbar reads to the page as a click outside its
modal and dismisses it (`docs/modal-click-leak/`).

Guides have to be draggable, so the ruler strips and the guides themselves must opt in —
and **anything that opts in is dead to the page underneath**. You cannot click page
content through a ruler strip or a guide.

That cost is accepted, with one mitigation that makes it acceptable: **none of it exists
unless you switch rulers on.** A reviewer who never wants guides never loses a pixel of
the page.

## Scope

**In**

- Two ruler strips, ticks every 10px, labels every 100px, in document coordinates
- Drag out to create, drag to move, drag back onto the ruler to delete
- The dragged coordinate shown while dragging
- A column grid with `columns`, `gutter` and `margin`, all three editable
- All of it under the existing `Measuring tools` master, off by default

**Out — deliberately**

- **The report.** A guide is a thing you put on the page to look at; it describes nothing
  about the element under it, and nothing here is worth an agent's attention.
- **Snapping.** Guides that jump to element edges need a hit-test on every drag frame and
  a rule for what counts as an edge. Worth doing, not worth doing first.
- **Cross-page persistence.** Guides live in `sessionStorage`, so they survive a reload
  and die with the tab — see `context.md`.
- **The eyedropper**, still. It is release 2's remaining half and has no home yet.

## Success criteria

1. With `Measuring tools` off, nothing here renders and no region of the page stops
   taking clicks.
2. A guide dragged from the ruler lands on the document coordinate the ruler labels, and
   is still on it after scrolling.
3. Dragging a guide back onto the ruler removes it.
4. The grid draws exactly `columns` bands, and changing any of the three numbers redraws
   it without a reload.
5. `npm run typecheck` clean, `npm test` green.
