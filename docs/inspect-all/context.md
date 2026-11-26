# Inspect All — context

## Problem

The three-button row (Click / Text / Area) forced users to decide the interaction
type before starting to annotate.  Most review sessions need all three, and the mental
overhead of switching — especially for the marquee — meant the area and text modes
went largely unused.

## Design constraints

1. **The toolbar drag conflict.** The whole pill is a drag handle (`DRAG_THRESHOLD = 4 px`
   movement separates a click from a move). In the new All mode a drag on the *page*
   must start a marquee, not move the pill. The toolbar's own drag starts on the pill
   element; a page drag starts on `document`. No conflict.

2. **Modifier picks (`⌘/Ctrl+click`).** Point mode already accumulates picked elements
   via modifier. In All mode the same path is preserved: any click with `⌘/Ctrl` held
   toggles the element in or out of the pick set. Plain drag promotes the existing
   `marqueePending` mechanic to fire on *any* pointerdown (not only modifier-down), so
   the marquee still collects alongside earlier picks.

3. **Text selection vs. page click.** Swallowing `mousedown`/`mouseup` prevents native
   text selection. We already exempt `mode === "text"` from those swallows. All mode is
   given the same exemption. The click handler guards against double-annotation by
   checking `window.getSelection().toString().trim()`: if text is still selected when
   the click fires, the element-pick branch is skipped (the `mouseup` handler already
   called `beginAnnotation` with the text).

4. **Frames.** Child frames run only highlight+capture; they never change mode. All mode
   broadcasts the same way as the other modes via `broadcastFrameState`. No new wire
   protocol needed.

5. **Freeze / hover / `C` key.** The `captureHovered` path was guarded by
   `mode !== "point"`. That guard now includes `mode !== "all"` so `C` still works.
   The `pointermove` hover path gets the same treatment.

## Alternatives rejected

- **Auto-detect mode inside each handler without a new type value.** Would scatter
  logic across six handlers without a single source of truth. Adding the `"all"` type
  keeps the type system as the single authority.

- **Replace all mode buttons with "All" only.** The e2e suite clicks them to switch to
  explicit modes. Removing them would need heavier test rewrites and removes a
  genuine power-user control.
