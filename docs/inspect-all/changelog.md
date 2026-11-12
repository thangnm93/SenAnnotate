# Inspect All — changelog

## 2026-09-04

- Opened worktree `feat/inspect-all` from `main` (0.8.4).
- Designed All mode: click = element, drag = area, text selection = text.
- Decision: keep explicit mode buttons as secondary controls; do not remove them —
  avoids heavier e2e test rewrites and preserves the power-user shortcut.
- Decision: add `0` keyboard shortcut to return from an explicit mode to All.
- Decision: `"all"` extends `InspectMode` union rather than a separate field —
  keeps the type system as single authority and avoids parallel state.
- Identified 4 exact hint-text assertions in `test/e2e.mjs` that must be updated.
