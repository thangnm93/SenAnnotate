# Brief — drag the composer card

## Problem

The annotation composer card always opens anchored to the element that was clicked.
On a crowded page — a sidebar on the left, a sticky header at the top, or a fixed
overlay that the page itself uses — the card lands somewhere the user cannot see or
read without first scrolling the card out of the way by hand. There is no hand-move
gesture: the card cannot be dragged at all.

## Goal

Make the composer draggable by its header and remember the dropped position per page.
Opening the composer again, or reloading the page, brings it back where it was left.

## Non-goals

- The toolbar pill (`.toolbar-dock`) is already draggable. This is a separate surface.
- No drag handle on the textarea — dragging there selects text, which is more useful.
- No per-user setting: position is a per-page layout fact, exactly like the toolbar dock.
- No reset button: "Clear all pages" sweeps the position, as it does for the toolbar.
