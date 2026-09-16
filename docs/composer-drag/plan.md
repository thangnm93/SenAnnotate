# Plan — drag the composer card

## Steps

1. **`src/shared/protocol.ts`** — `COMPOSER_DOCK_PREFIX = ${NS}:composer-dock:`, beside
   `DOCK_PREFIX`, with a comment explaining the separate namespace.

2. **`src/content/storage.ts`** — import `COMPOSER_DOCK_PREFIX`; add `composerDockKey()`,
   `loadComposerPosition()`, `saveComposerPosition()`, mirroring the toolbar functions.
   `load` discards anything that is not a pair of finite numbers, same guard as
   `loadDockPosition`.

3. **`src/content/ui/composer.ts`**
   - Add `onMove(position)` to `ComposerCallbacks`, fired once on drop.
   - Add `private requested` and `private dragSize` fields.
   - Add `installDrag(header, callbacks)`: `pointerdown` on `.card__header`, threshold
     4px, `setPointerCapture` after threshold, `pointerup`/`pointercancel` end, capture-
     phase `click` guard.
   - Add `moveTo(x, y)` and `paintPosition()` — clamp with `Math.max(EDGE, Math.min(…))`.
   - Add `applyPosition(position | null)` — called after construction and on resize.
   - Add `ResizeObserver` on `this.element` that calls `paintPosition()`.
   - Move `destroy()` to disconnect the observer.

4. **`src/content/ui/styles.css`** — `cursor: grab` on `.composer .card__header` and the
   `.icon-button` inside it; `cursor: grabbing` and `transition: none` on
   `.composer[data-dragging="true"]`; `touch-action: none` on the header.

5. **`src/content/index.ts`**
   - Import `loadComposerPosition`, `saveComposerPosition`.
   - Add `composerPosition` module global (mirrors `dockPosition`).
   - Load it in `boot()` alongside `dockPosition`.
   - In `openComposer`, add `onMove` callback (persists and updates `composerPosition`),
     and call `composer.applyPosition(composerPosition)` after construction.
   - In `queueSync`, add `composer?.applyPosition(composerPosition)` alongside the
     toolbar re-clamp, guarded by `resizeQueued`.

6. **`src/shared/archive.ts`** — import `COMPOSER_DOCK_PREFIX`; add `composerDocks`
   field to `ExportFile`; sweep the prefix in `clearAllPages`; export and import it in
   `exportAll`/`importAll`, mirroring the `docks` handling.

7. **Verify** — `npm run typecheck`, `npm test` (headless).

8. **Document** — `docs/composer-drag/brief.md`, `context.md`, `plan.md`, `changelog.md`.

## What was not done (and why)

- No hint-flip equivalent: the toolbar flips its hint line above the pill when the pill
  is near the top. The composer has no such dependent element.
- No e2e scenario added for drag itself (drag is hard to assert on without a separate
  fixture, and the existing suite already loads time). A note in the changelog records this.
- The `isDragging()` method was not added to `Composer` — the hover path's early exit on
  `if (!active || composer)` already covers the case: when the composer is open, no hover
  updates run regardless of whether a drag is in progress.
