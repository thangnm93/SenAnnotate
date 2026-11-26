# Inspect All — plan

## Files changed

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `"all"` to `InspectMode` union |
| `src/content/ui/toolbar.ts` | Add "All" mode button and `MODE_HINTS.all` |
| `src/content/index.ts` | Default mode = `"all"`, unify event handlers |
| `test/e2e.mjs` | Update 4 exact hint-text assertions |

## Steps

1. `InspectMode` → `"point" | "text" | "area" | "measure" | "all"`
2. `MODE_HINTS.all = "Click element · drag area · select text · C hover"`
3. `MODES` prepend `{ mode: "all", iconName: "cursor", title: "All modes (0)" }`
4. `hintFor`: `"all"` also gets `MEASURE_HINT` appended when measure is on
5. `toolbar.update`: modeGroup always visible when active; no new display logic
6. `index.ts` default `mode = "all"`
7. `pointermove` hover guard: `mode === "point" || mode === "all"`
8. `click` handler: allow "all"; skip element pick if text is already selected
9. `mousedown`/`mouseup` swallow: skip for "all" (same as text)
10. `mouseup` text selection: fire for `mode === "all"` too
11. `pointerdown`: set `marqueePending` for "all" unconditionally (any drag = marquee)
12. `queueSync` sync path: include "all" alongside "point"
13. `captureHovered`: allow "all"
14. Keydown `"0"`: set mode to "all", reset, render
15. `test/e2e.mjs`: update 4 assertions (lines 463-465, 620, 648, 764)

## Success criteria

- `npm run typecheck` passes
- `npm test` passes (all ~220 checks)
- Activating inspect lands in All mode (hint = "Click element · drag area · select text · C hover")
- Click captures element; drag captures area; text selection captures text
- Explicit mode buttons still switch to their mode
- `0` key returns to All mode
