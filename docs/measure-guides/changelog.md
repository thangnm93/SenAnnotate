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

## The grid's numbers were in the wrong place

Reported while the branch was open: the three grid numbers sat below *Box model on
hover* instead of under the switch that draws them. They were spread into the card after
`measureRows` rather than inside it, which put them last.

Now interleaved directly after the *Layout grid* toggle and indented a second level, with
an e2e that asserts the whole group's row order as one string — the kind of thing that
drifts silently every time a row is added.

## The eyedropper, and the one thing in this extension with no e2e

Closes the half of release 2 that was left open.

`EyeDropper` is available and needs no permission, but **its core cannot be tested by
this suite.** The picker is browser chrome: Playwright cannot click it, and in headless
it aborts before drawing (`AbortError: The user canceled`). Measured before designing
anything, which changed the design — `content/eyedropper.ts` is deliberately the thinnest
file in the repo, four lines of logic returning a hex or `null`, so the untestable
surface is as small as it can be. Formatting, storing and rendering all live where they
can be checked.

What *is* tested: the button appears with the master, nothing shows until something is
picked, and a **dismissed** pick leaves no result and does not disturb the card. That
last one is free in headless, where every open aborts — the same path a user pressing
Escape takes.

**It exists for a narrower reason than it first looked.** Release 2 already reports any
element's text colour and its real background by walking ancestors. The eyedropper only
adds something where that walk gives up: a gradient, an image or a canvas, reported as
`image` rather than guessed at. Worth saying in the help text, because a control that
duplicates something automatic is a control people stop trusting.

`onPickColour` is passed through `settingsCallbacks` with nothing in front of it. The API
needs the click's transient activation and an `await` on the way would spend it — the
same rule that already makes copying a report touch the clipboard before it awaits.

## Verification

- `npm test` — **338/338** e2e, **9/9** upgrade, **52/52** unit.
- Row order read off the built extension, not assumed:
  `Measuring tools · Measure distances · Screen rulers and guides · Layout grid ·
  Columns · Gutter · Page margin · Box model on hover · Pick a colour`, at indents
  0 / 16 / 16 / 16 / 32 / 32 / 32 / 16 / 16 px.

## The picker moved to the toolbar

Asked for immediately after it shipped in Settings: put it on the pill.

The trade was named when the two options were offered — a fourth non-mode button on a
toolbar that docks over someone else's page, against opening Settings for every pick —
and having used it, opening Settings each time lost. Worth recording as a pattern rather
than a one-off: **of the four UI placements decided by asking during this work, two were
reversed after the thing was in someone's hands.** A described cost and a felt one are
not the same, and the cheap way to tell them apart is to ship the smaller one first.

Mechanically the move is small. What changed with it:

- **The result no longer has a home**, so it copies instead. `copyText` falls back to
  `execCommand` when `navigator.clipboard` refuses, which it may: awaiting the picker has
  already spent the click's transient activation, and that is the same rule that makes
  copying a report touch the clipboard before it awaits anything. The toast distinguishes
  `#2563eb copied` from a bare `#2563eb`, so a failed copy is visible rather than silent.
- **`ToolbarState.colourPicker` is separate from `measureMode`.** The picker belongs to
  the measuring master, not to the distance mode — switching mode 4 off must not take it
  away. One field would have coupled them, and the coupling would have looked like a bug
  in whichever one you noticed second.
- The e2e moved with it, and gained a check that the master takes the picker off the pill
  too. The button order was read off the built extension rather than assumed.
