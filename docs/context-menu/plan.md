# Plan

1. **`static/manifest.json`** — add `contextMenus` to `permissions`. Not sensitive, but a
   manifest change; see `context.md` on what that means for a Store submission.

2. **`src/shared/protocol.ts`** — `{ kind: "annotate-context"; selection: boolean;
   inFrame: boolean }` on `RuntimeMessage`, documented with *why* it carries no element.

3. **`src/background/index.ts`** — `createMenus()` behind `chrome.contextMenus.removeAll`,
   registered on `onInstalled` only. Three entries: element (`contexts: ["all"]`),
   selection (`contexts: ["selection"]`, `%s` in the title), toggle. `onClicked` maps the
   id to a message and always sends to `{ frameId: 0 }`, with `inFrame` set from
   `info.frameId`.

4. **`src/content/index.ts`**
   - `rightClicked` / `rightClickedText` module state, with the reason it is not cleared
     after use.
   - A **capture-phase, passive** `contextmenu` listener inside `installTopFrame()`, using
     `elementFromPoint` and `eligible`. Reads the selection there rather than at click time.
   - `annotateRightClicked({ selection, inFrame })`: the `inFrame` report, the
     `isConnected` guard, `closeComposer` + `clearPicked` + `resetMarquee` because a
     right-click is a fresh subject, then `beginAnnotation`.
   - A branch in the existing `chrome.runtime.onMessage` listener.

5. **`test/e2e.mjs` + `test/fixtures/context-menu.html`** — a real `contextmenu` event and
   a real message from the service worker. The fixture includes a card that cancels
   `contextmenu`, which is what the capture phase exists for.

6. **Docs** — `brief.md`, `context.md`, this file, `changelog.md`, the `docs/README.md`
   entry, and a README row plus a short section under *Use*.

## Things to get right

- **Capture phase.** A bubble listener sees nothing on any app with its own right-click
  menu, and the failure is "annotates the wrong element silently".
- **Never cancel `contextmenu`.** The page's own menu must still open. Passive, watching.
- **Do not arm inspect mode.** A right-click is one complete request; arming a mode makes
  the user's next ordinary click open a composer they did not ask for.
- **Validate at use time.** `isConnected` plus `eligible`, because the record outlives the
  menu by design.
- **Iframes: report, do not guess.** The top frame cannot map a `frameId` to an element.
