# Changelog

- Reproduced: with *Freeze animations on inspect* on, leaving inspect left the page's
  timers parked. Fixed in `content/index.ts` (`frozenByInspect`).
- Added the debug log: `content/debug-log.ts`, `Settings.debugMode`, a toggle in the
  settings card, `get-debug-log` and a *Save .json* button in the popup.
- New fixture `test/fixtures/inspect-freeze.html` and an e2e block, 10 checks.

## What the plan got wrong

- The request said "toggle in the popup settings". Settings no longer live in the popup;
  the toggle is in the settings card and the popup only saves the file.

## Verification

- `npm run typecheck`: clean.
- `npm test` headless: `test/measure.mjs` all passed, e2e 420/420, upgrade 9/9.
- The popup's *Save .json* click is not driven by the suite — the popup tab is itself the
  "active tab", so it has no content script to ask. The message it sends is covered from the
  service worker; the button is type-checked only.
