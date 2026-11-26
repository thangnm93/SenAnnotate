# Plan

1. Reproduce on a fixture of its own with a ticking interval, with `freezeOnInspect` on and
   off.
2. Release inspect's own freeze in `setActive(false)`; keep a manual one.
3. Add `debugMode` to `Settings`, `content/debug-log.ts`, the `get-debug-log` message, the
   settings-card toggle and the popup button.
4. e2e block: freeze while inspecting, release on leaving, manual freeze kept, log kinds,
   target without content, page without query, log discarded when off.
5. `npm run typecheck`, then the full suite headless.
