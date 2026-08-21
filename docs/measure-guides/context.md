# Context — what constrains rulers, guides and the grid

## Pointer events are the whole design

`createUiRoot` sets `pointer-events: none` on the host and stops nine pointer event types
there, so events that *do* reach our own elements never continue to the page
(`src/content/ui/root.ts:185`). Cards already opt back in with `pointer-events: auto`.

So a draggable guide is possible. What it costs is exact and worth writing down: **an
element with `pointer-events: auto` is a hole in the page.** Clicks, hovers and drags in
that region belong to us and the page never sees them. For a 1px guide that is nearly
free; for two 20px ruler strips it is a permanent dead band down two edges — and in mode
4, a click is how an element gets anchored, so a guide lying across a button means that
button cannot be anchored while the guide is there.

Mitigations, in order of how much they matter:

1. **None of it renders unless `showRulers` is on**, under a master that is off by
   default. Nobody pays who has not asked.
2. **The guide's hit area is 7px, not 1px** — a 1px drag target is unusable — but the
   *painted* line stays 1px so it does not lie about where it is.
3. **Rulers do not overlap the toolbar.** The dock is bottom-right; the rulers are top and
   left. That is luck rather than design, and worth not disturbing.

## Coordinates: document, not viewport

The overlay is `position: fixed`, so everything drawn in it is in viewport space. Guides
must not be: a guide is aligned to something on the page, and a guide that slides away
when you scroll is aligned to nothing.

So guides are **stored in document coordinates** and painted at `documentY - scrollY`.
The rulers label document coordinates for the same reason — a ruler reading 0 at the top
of the viewport tells you where your eyes are, not where the element is.

`queueSync` already runs on scroll and resize; the repaint hangs off it.

## Persistence: `sessionStorage`, not `chrome.storage`

Guides are per-page scratch, like a pencil line. Three options were weighed:

- **In memory** — lost on reload, and a reload is the most common thing that happens
  during a review.
- **`chrome.storage.local`** — survives everything, costs a new key, a quota to think
  about, and cross-tab collisions on the same URL.
- **`sessionStorage`, keyed on pathname** — survives a reload, dies with the tab, no
  quota worth worrying about, no cross-tab surprise. The repo already uses it for
  `HIDDEN_KEY`.

The third. It throws in a sandboxed frame or with storage disabled, so every access is
wrapped — the same way `isHiddenThisSession()` does it.

## Traps carried forward from the first two releases

- **A presence assertion is not a rendering assertion.** An entire block of stylesheet
  went missing once while nine `:visible` counts stayed green. Anything drawn here gets a
  computed-style check.
- **Verify a regression test by breaking the fix.** Two checks in `measure-core` passed
  against broken builds until they were watched failing.
- **Never delete code by slicing between two string anchors**, and when brace-matching,
  anchor on the brace that opens the *body* — a TypeScript parameter list is full of
  decoys (`docs/measure-contrast/changelog.md`).
- **Read the first compiler error, not the last.** The tail is cascade noise.
- **The e2e fixture must be its own.** This work gets `test/fixtures/rulers.html`.
