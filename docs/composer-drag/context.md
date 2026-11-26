# Context — drag the composer card

## Why the header and not the whole card

The toolbar pill uses the whole pill as a drag handle, because there is nothing *else*
on it — every pixel is chrome, and a threshold separates a click from a drag. The
composer is different: the `<textarea>` occupies most of the card, and dragging inside
a textarea selects text. The kind chips and footer buttons need their clicks too.

The `.card__header` row is the right handle: it is visually "chrome", has room for the
grab cursor, and contains nothing the user types into. The cancel `×` button inside it
keeps working — the 4px `DRAG_THRESHOLD` keeps a click distinct from a drag, exactly as
the toolbar does.

## Why a new storage key prefix

`DOCK_PREFIX` (`senannotate:dock:`) is the toolbar's namespace. Reusing it would work
numerically but conflates two different things: "where the pill lives on this screen"
(persistent, survives a re-render) and "where I last put the composer" (session-like,
scoped to review work). Separating them means they can be cleared independently in the
future, and export/import round-trips them to different fields without a schema bump.

`COMPOSER_DOCK_PREFIX` (`senannotate:composer-dock:`) follows the same keying convention
— `origin + pathname`, query excluded.

## How the default interacts with a saved position

When no saved position exists, `Composer.position()` anchors the card near the target
element (below-right, flip and clamp if it would go off-screen). That is unchanged.

Once a position has been saved, `openComposer` calls `composer.applyPosition(composerPosition)`
*after* the constructor, which overwrites the anchor position. The card jumps to the
saved spot; the user sees it exactly where they left it.

The anchor is still computed in the constructor every time, because the card always
starts positioned before storage is consulted: if `composerPosition` is `null` the
`applyPosition` call is a no-op and the anchor wins.

## Pointer capture and the page's event rules

The drag logic follows `docs/draggable-toolbar/context.md` precisely:

- **`setPointerCapture` after the threshold**, not at `pointerdown`. Taking it at
  `pointerdown` retargets the compatibility mouse events and would deliver every header
  click to the header element itself rather than to the button that was pressed, breaking
  the cancel button.
- **`buttons === 0` bail-out** on `pointermove`. A press released within 4px of the
  header edge never reaches `end()`, so `origin` stays set. The next plain *hover* would
  then drag the card with no button held; checking `buttons` is the only reliable witness
  that the press is over.
- **Capture-phase `click` guard**. A drag that ends inside the header would also press
  the button under the pointer (the cancel `×`). The guard runs before the button's own
  listener and clears `moved` via `setTimeout` rather than immediately, because a drag
  does not always produce a click (release outside the card dispatches none).
- **`try/catch` around `setPointerCapture`**. It throws for an inactive pointerId or a
  disconnected element. Either is rare but leaves `moved` and `data-dragging` set,
  which would stick the grabbing cursor and swallow the next genuine click. The drag
  continues uncaptured — degraded, not broken.
- **`touch-action: none`** on the header. Without it, browser claims the gesture for
  panning and answers `pointercancel`, killing the drag entirely on touch/pen.

## `pointer-events` and the overlay rules

`createUiRoot` stops `pointerdown`, `pointerup`, and several other types at the shadow
host in the bubble phase. The drag listeners are on `.card__header`, inside the shadow
root and below the host, so they run first. The host stops the event before `document`
sees it — exactly the same seam as the toolbar drag.

`pointermove` is not stopped at the host (`root.ts` deliberately lets it through), so a
fast composer drag that outruns the card still delivers its moves to the captured target
while also reaching `document`. The hover path already consults `toolbar.isDragging()`;
adding a check for the composer drag is not necessary — the composer being open already
causes `if (!active || composer)` to return early on `pointermove`.

## Resize re-clamping

The toolbar's `ResizeObserver` re-clamps when the dock's own size changes (collapse,
hint line, stack badge). The composer does not have the same size variability, but a
`ResizeObserver` is still attached so that a row of meta-data expanding or the textarea
being resized vertically never pushes the card partially off-screen.

Viewport resize re-clamp follows the same `queueSync`/`resizeQueued` path as the
toolbar: `composer?.applyPosition(composerPosition)` is called alongside
`toolbar.applyPosition(dockPosition)` only when `resizeQueued` is set, so the scroll
path — which shares that rAF — never pays for a forced layout it cannot use.

## Stored positions are swept, not orphaned

"Clear all pages" removes both `DOCK_PREFIX` and `COMPOSER_DOCK_PREFIX` keys.
`exportAll`/`importAll` round-trip them in a `composerDocks` array alongside `docks`.
The format `version` stays at 1 — an older build ignores a field it does not know, and
losing a composer position through an old importer costs nothing worth a schema bump.
