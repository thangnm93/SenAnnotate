# Changelog — annotate from the right-click menu

## What shipped

Three entries in the page's right-click menu — *Annotate this element*, *Annotate the text
"…"* (with a selection), *Toggle inspect mode*. The first two open the composer without
arming inspect mode.

Five files: `static/manifest.json` (`contextMenus`), `shared/protocol.ts`,
`background/index.ts`, `content/index.ts`, `README.md`. Plus a fixture and an e2e block.

## The API forced the design

`chrome.contextMenus.onClicked` hands you `menuItemId`, `frameId`, `pageUrl`, `linkUrl`,
`srcUrl`, `mediaType`, `selectionText`, `editable` — and **no element, no coordinates.**
There is no API that provides them; DevTools can do it because DevTools is the browser.

The first sketch assumed `OnClickData` would carry at least a position and planned to
`elementFromPoint` it in the content script. It does not, and once that is understood the
rest follows: the element has to be recorded in the page on `contextmenu` — which fires
before the menu opens — and the menu click becomes an instruction rather than data. The
message ends up carrying two booleans, because there is nothing else to carry.

## Capture phase is the load-bearing detail

Every app with its own right-click menu calls `preventDefault` **and** `stopPropagation` on
`contextmenu`. A bubble-phase listener on `document` would see nothing on any of them — and
the failure mode is not "does nothing", it is **annotates whatever was recorded last**, with
no signal that it is the wrong element. That is the same class of bug the `composer-retarget`
review spent most of its findings on, so it is guarded by a fixture (`#ctxmenu-eater`) that
cancels the event both ways.

The listener is passive and cancels nothing. The page's own menu still opens; so does
Chrome's, because the browser draws the extension's entries from the registration rather than
from the event. A right-click that shows both is the correct outcome.

## What it deliberately does not do

**It does not turn inspect mode on.** Inspect mode swallows the next click on the page, so
arming it as a side effect means the user's next ordinary click opens a composer they did not
ask for — the surprise `toolbar-collapse/` exists partly to remove. A right-click on one
element is a complete request, and nothing in `beginAnnotation`, the composer, the markers or
the report needs the mode.

**It does not clear the recorded element after use.** Reopening the menu on the same element
and picking the item twice has to work. What catches a stale record is `isConnected` at use
time plus `eligible`, not an eager reset.

**It does not handle a right-click inside an iframe.** This is the honest gap and it is a
scope cut rather than an oversight. The composer is the top frame's, and the top frame cannot
map a `frameId` to an iframe element — there is no DOM API for it, and
`webNavigation.getAllFrames` returns URLs, which do not identify an element either. So
annotating the top frame's own record would describe the wrong element with a straight face.
It reports instead.

`context.md` records the design that would fix it, because the blocker is not the plumbing —
`installChildFrame` already has a `capture()` that posts a draft up. The blocker is that
`onFrameDraft` ignores drafts while inspect mode is off, deliberately, so a hostile embedded
frame cannot pop a composer on a page the user is only reading — and this feature is
*defined* by inspect mode being off. Relaxing that needs a one-shot expectation token in the
top frame, which is a security-relevant change to the frame boundary and deserves its own
review.

## A trap in the menu lifecycle

Menu entries persist across browser restarts, and `onInstalled` fires on **update** as well
as install — so a naive `create` on the second install throws a duplicate-id error and leaves
the *previous* version's entries in place, pointing at a handler that may be gone.
`createMenus` calls `removeAll` first and creates inside its callback. `onStartup` is
deliberately not wired: the entries persist, so recreating them per launch is work for no
change.

## Verification

`npm run typecheck` and `npm run build` clean.

```
221/221 checks passed
9/9 upgrade checks passed
```

212 of those are `main`'s; 9 are new.

What the suite can and cannot reach is worth being explicit about, because a reader could
reasonably assume more is covered than is:

**Not covered.** The menu entries themselves. Playwright cannot open a native context menu
and `chrome.contextMenus` has no query API, so their titles, contexts and ordering are
unverified — the block asserts only that the worker can create one without error.

**Covered, and genuinely.** The `contextmenu` event is real and hits the real capture-phase
listener; the `annotate-context` message is sent from the real service worker over
`chrome.tabs.sendMessage` with `{ frameId: 0 }`. Only the native menu widget is stood in for.
On that path:

- the element that was right-clicked is the one annotated
- inspect mode is off before **and after** — the property the feature is built on
- what it stored is what it displayed, read out of a generated report
- a page that cancels `contextmenu` both ways does not hide the element from us
- the selection entry carries the text
- an `inFrame` click opens no composer and says why

## The test was wrong twice before the feature was right once

Worth recording in full, because both are traps rather than slips.

**`page.dispatchEvent(selector, "contextmenu", { clientX, clientY })` does not produce a
`MouseEvent`.** Playwright synthesises it as a plain `Event`, so `clientX` and `clientY` are
`undefined`, `document.elementFromPoint` resolves nothing, the recorder stores `null`, and the
menu item silently no-ops. The first run failed on a `.composer__meta` that never appeared,
with no error anywhere — the message was delivered and answered `{ ok: true }`.

What found it was a throwaway probe that logged the recorder's own view: *did the listener
run, was the target eligible, was anything recorded*. The listener had not run at all. A
`locator.click({ button: "right" })` goes through CDP and produces a real event with real
coordinates, and the same path worked first time.

**That fix has a consequence, and it is why the fixture cancels `contextmenu` at the document
level.** A real right-click also opens *Chrome's own* context menu — an OS-level widget
Playwright cannot dismiss — and this suite runs **headed**. `preventDefault` stops the menu
without stopping the event, so the capture-phase listener still sees exactly what it would on
a real page. It is also the realistic shape rather than a workaround: any app with its own
right-click menu does precisely this.

**And the fixture's three blocks needed distinct class names.** They started as three
`.ctxcard`s, which all identify as `div.ctxcard` — so the assertion about the element that
cancels `contextmenu` would have passed for the wrong reason. The same trap `retarget.html`
hit one branch earlier, which suggests it is worth a line in `CLAUDE.md` rather than a third
rediscovery.

## One flake observed, not reproduced

An earlier run of this branch reported `collapsing hides the toolbar controls` failing — a
check in `main`'s Collapse block that this branch does not touch. It did not recur on a clean
re-run of the same commit, and the `domain-rules` branch off the same `main` passed it. Noted
rather than explained: nothing here plausibly affects that path, but a reviewer seeing it once
should know it has been seen.
