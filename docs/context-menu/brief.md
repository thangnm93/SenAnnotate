# Brief — annotate from the right-click menu

## The problem

There are two ways into SenAnnotate today, and both ask you to change mode before you can
say anything about an element: click **Inspect** on the toolbar, or press
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>. Then click the element.

That is the wrong shape for how this tool is actually reached. It is a debugging tool, and
the gesture for a debugging tool is already established by the thing every user of this
extension has open in the next tab: **right-click the element, pick Inspect.** No mode, no
arming, no toolbar. One element, one menu, done.

The mode-first flow is right when you are working through a screen and annotating six
things. It is friction when you have spotted exactly one problem, which is the common case
and the one people bounce off.

There is a second, quieter cost. Inspect mode swallows the next click on the page — that is
what it is for — so someone who wants to note *one* thing has to remember to turn it back
off, and `toolbar-collapse/` exists partly because forgetting that made the next page's
click open a composer out of nowhere.

## What is being built

Three entries in the page's right-click menu:

- **Annotate this element** — the DevTools *Inspect* analogue, and the reason for the
  feature. Annotates whatever was under the pointer.
- **Annotate the text "…"** — shown only with a selection, and carries that text into the
  note the way mode <kbd>2</kbd> does.
- **Toggle inspect mode** — parity with the keyboard shortcut, for the mode-first flow.

None of them turn inspect mode on. Right-clicking one element is a complete request.

## The technical shape, because it decides everything else

`chrome.contextMenus` is the only API for this, and it hands an extension **no element and
no coordinates**. `OnClickData` carries the frame id, the page URL, any selection, and a
link or media URL — nothing about what was under the pointer.

So the element cannot come from the menu. It has to be recorded on the content side, on
`contextmenu`, which fires *before* the menu opens. The menu click is then only an
instruction to use what was recorded. That indirection is the feature, and `context.md`
covers the two things it has to get right: a page that cancels `contextmenu`, and a
right-click inside an iframe.

## Scope

**In.** The `contextMenus` permission, the three entries, the recorder, and the top-frame
handler. The recorded element is validated at use time rather than trusted.

**Out.** **Right-clicks inside an iframe.** The composer belongs to the top frame, and a
`frameId` is a number the DOM cannot be asked about — the top frame has no way to map it to
an iframe element, so annotating its own record would describe the wrong element with a
straight face. It is reported instead. `context.md` has the design that would fix it and why
it is a bigger change than it looks.

**Out.** *Don't run on this site*, which is the obvious fourth entry — it belongs with the
domain-rules work, which owns that setting.

## Success criteria

- The menu item annotates the element that was right-clicked, with inspect mode **off**,
  and leaves it off.
- What it stores is what it displayed — verified out of a generated report, not the UI.
- A page that calls `preventDefault` **and** `stopPropagation` on `contextmenu` — every app
  with a custom right-click menu — does not hide the element from us.
- The selection entry carries the text.
- A right-click in an iframe opens no composer and says why.
- The page's own context menu still opens. We watch the event; we never cancel it.
