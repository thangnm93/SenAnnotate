# Plan — strategy

Settings first this time, then the two drawing modules, then the interaction.

1. `Settings` rows and their gating — the whole feature hangs off `showRulers` and
   `showGrid`, and nothing can be seen until those exist.
2. `ui/grid.ts`. It is pure rendering with no interaction, so it proves the settings
   wiring end to end without any pointer handling in the way.
3. `ui/rulers.ts` — the two strips, in document coordinates, still read-only.
4. Guides: the drag out of the ruler, the move, the drag-back-to-delete, and the
   `sessionStorage` round trip.
5. Fixture and e2e, including the off state — criterion 1 is the one a user meets first.
