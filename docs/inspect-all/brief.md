# Inspect All — brief

**Goal:** Merge the three primary inspect modes (point / text / area) into a single
"All" mega-mode. When the user activates inspect (toolbar click or keyboard shortcut),
they land in All mode, which automatically routes the gesture:

- **Click** → capture the element under the cursor (point behaviour)
- **Drag** → draw a marquee and capture every element it fully contains (area behaviour)
- **Text selection** → capture the highlighted text and its ancestor element (text behaviour)

The three explicit single-mode buttons stay on the toolbar as secondary controls for
power users who want to lock into one gesture type, but they are no longer the primary
UX: the user never has to choose a mode before starting to annotate.

**Keyboard shortcut added:** `0` returns to All mode from any explicit mode.

**Constraint:** zero runtime deps, no new permissions, no agentation source touched.
