# Context — annotate from the right-click menu

## The API gives you no element, and that is the whole design

`chrome.contextMenus.onClicked` hands you an `OnClickData`. It has `menuItemId`,
`frameId`, `pageUrl`, `linkUrl`, `srcUrl`, `mediaType`, `selectionText` and `editable`.

It does **not** have the element, and it does not have coordinates. There is no API that
provides them; DevTools' own *Inspect* can do it because DevTools is the browser.

So the element is recorded where it is knowable — in the page, on `contextmenu`, which
fires before the menu opens — and the menu click is only the instruction to use it. The
message carries a `selection` flag and an `inFrame` flag and nothing else, because there is
nothing else to carry.

Two consequences worth stating, because both look like bugs if you do not know the shape:

**The record outlives the menu.** It is not cleared after use. Opening the menu again on the
same element and picking the item twice should work, and a `rightClicked` that cleared itself
would make the second pick fail for no visible reason. What guards against a *stale* record
is `isConnected` at use time — the same guard `captureHovered` calls "the guard that matters"
— plus `eligible`, which refuses our own overlay, a `<script>`, and the `<html>` element.

**The selection is read at right-click time, not at click time.** Opening a context menu can
collapse the selection depending on platform and page, and `OnClickData.selectionText` is
truncated. Reading `window.getSelection()` in the recorder gets the untruncated text while it
still exists.

## Capture phase, and why it is not optional

Every app with a custom right-click menu — an editor, a file tree, a canvas, a data grid —
does this:

```js
element.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
  showMyOwnMenu(event);
});
```

A bubble-phase listener on `document` never runs. The extension's menu entry would then act
on whatever was recorded *last*, which is the wrong element, silently — the exact class of
failure `composer-retarget/` spent a review on.

So the listener is capture-phase on `document`, where it runs before the page's own handler
regardless of what that handler does.

It is also **passive, and never cancels anything.** We are watching an event, not claiming
it. The page's own menu still opens, and so does Chrome's — a right-click that shows our
entry *and* the page's menu is the correct outcome, because the browser draws its menu from
the extension registration rather than from the event.

`elementFromPoint(clientX, clientY)` rather than `event.target`, for the reason the click
handler already uses it: it is the one lookup that sees through our `pointer-events: none`
overlay to what the user was actually pointing at.

## Why it does not turn inspect mode on

Tempting, and wrong. Inspect mode swallows the next click on the page; that is its job. A
right-click on one element is a complete request, and arming a mode as a side effect of it
means the user's next ordinary click opens a composer they did not ask for — which is the
surprise `toolbar-collapse/` went out of its way to remove ("collapsing means *get out of
the way*, not merely *get smaller*").

Nothing needs the mode anyway: `beginAnnotation`, the composer, the markers and the report
all work with it off. The only thing inspect mode adds is hover highlighting and the click
handler, and this path uses neither.

## Iframes are reported, not half-handled

A right-click inside an iframe arrives with a non-zero `frameId`, and that is where this
stops.

The composer, the annotation store and the markers are the top frame's. The top frame is the
only one that can open a composer — and it cannot find out *which* iframe a `frameId`
refers to. There is no DOM API mapping the two; `chrome.webNavigation.getAllFrames` gives
URLs, which do not identify an element either. Annotating the top frame's own `rightClicked`
would silently describe whatever the main page was last pointed at.

So the message goes to frame 0 carrying `inFrame: true`, and the top frame says so.

**The design that would fix it**, recorded because it is not obvious and because the pieces
are already there: send `annotate-context` to the clicked frame (`{ frameId }`) rather than
to frame 0; give the child-frame path a `chrome.runtime.onMessage` listener that calls the
`capture()` it already has, which posts a draft up through the existing `postMessage`
channel. The obstacle is the guard on the receiving side. `onFrameDraft` ignores drafts
while inspect mode is off — deliberately, so a hostile embedded frame cannot pop a composer
on a page the user was only reading — and this path is *defined* by inspect mode being off.
Relaxing it safely means a one-shot "I am expecting a context draft" token in the top frame,
set only when the background says a context click just happened. That is a security-relevant
change to the iframe boundary and it deserves its own review rather than a corner of this
one.

## `removeAll` before `create`

Menu entries persist across browser restarts, and `onInstalled` fires on **update** as well
as install. Creating an entry whose id already exists fails, and what would be left behind
is the *previous* version's entry, pointing at a handler that may no longer exist. So
`createMenus` calls `chrome.contextMenus.removeAll` first and creates inside its callback.

`onStartup` deliberately does not also create them: they persist, so recreating them per
launch would be work for no change.

## The permission

`contextMenus` is a new entry in `manifest.json`. It is not a sensitive permission — it adds
no warning to the install prompt and does not require existing users to re-consent — but it
is a manifest change, so a Web Store submission carrying it is worth expecting to take the
normal review rather than a fast one.

## What the e2e block can and cannot reach

Playwright cannot open a native context menu, and `chrome.contextMenus` has no query API, so
the entries themselves are unverifiable from the suite. The block asserts the worker can
create one without error and leaves it there.

Everything with behaviour in it is real, though, and this is the part worth knowing when
reading the test: the `contextmenu` event is a genuine event hitting the genuine
capture-phase listener, and the `annotate-context` message is sent from the genuine service
worker over `chrome.tabs.sendMessage`. Only the native menu widget is stood in for.
