# Context — two kinds of image, and what a pasted one exposes

## Separate field, not a shared list

`referenceImages: string[]` sits beside `screenshotData`, and the temptation to merge
them into one `images` array with a `kind` was refused. They answer opposite questions:

| | question it answers |
|---|---|
| `screenshotData` | what does this element look like **now** |
| `referenceImages` | what should it look like **instead** |

An agent handed both under one heading has to infer which is the target, and inferring
wrong means implementing the current state on purpose — the one failure mode that looks
like success. Separate fields make that impossible to get wrong in the report, and the
heading spells it out anyway.

The split also decides the quota order (below), which a `kind` discriminator would have
left as a runtime filter.

## Quota: references outlive screenshots

`fitToQuota` sheds embedded images when a page's annotations outgrow the storage budget.
It now runs in two passes — **every** screenshot first, then reference images.

The rule is recoverability. A screenshot can be taken again by standing on the page and
pressing the camera. An image pasted from Figma exists nowhere this extension can reach;
dropping it destroys the only copy. Given a choice of what to lose, lose the one that
can be replaced.

## Encoding happens in the orchestrator, not the composer

The composer's `onAttach` hands back raw `File`s and `index.ts` encodes them, then calls
`addReferenceImages` with `data:` URIs. The UI layer draws and does not know what a
canvas is for — the same division that keeps `ShotEditor` out of the screenshot pipeline.

Everything goes through `encodeSuppliedImage`, which is `encodeForEmbed` with a decode in
front: the same 900px ceiling and the same JPEG quality as a captured screenshot. Not
tidiness — a full-size Figma export off the clipboard is megabytes, and three of them
would eat the page's whole budget before the user finished typing. One size of thing for
`fitToQuota` to reason about.

The scale is applied in the single `drawImage` rather than by allocating at natural size
and letting `encodeForEmbed` shrink afterwards. A 2× export of a desktop frame is
5120×8000 — 164 MB of RGBA — and Chrome's canvas area cap does not fail loudly: past it,
`drawImage` is a no-op and `toDataURL` answers the string `"data:,"`, which is truthy and
would have been stored and rendered as a broken thumbnail under a heading promising a
picture. `validEmbed` rejects anything that is not a `data:image/` URI for the same
reason: an SVG with no intrinsic size decodes to `naturalWidth === 0` and takes the same
route.

`attachReferenceImages` also asks the composer how much room is left *before* it encodes
anything. The picker is `multiple`, so "select all" in a screenshots folder hands it sixty
files; encoding all sixty concurrently and then discarding fifty-seven is the most
expensive possible way to discover the cap.

## `paste`, `ACTIVATION_EVENTS`, and which half of the threat model holds

`dom.ts` drops untrusted `click`, `mousedown`, `mouseup`, `pointerdown` and `pointerup`,
because the shadow root is open and a hostile page could otherwise "click" the screenshot
button or Clear all. `paste` is not on that list — and, more to the point, **adding it
would change nothing**.

`ACTIVATION_EVENTS` is consulted by exactly one function, `guarded()`, and `guarded()` is
applied in exactly one place: the `attrs.on` loop inside `h()`. The composer registers its
paste handler through `listen()`, which calls `addEventListener` directly and never goes
near either. So the untrusted-paste path is open by construction, not by a choice recorded
in a set — and anyone who adds `paste` to `ACTIVATION_EVENTS` believing they have closed
it is worse off than before, because they will believe it.

The first draft of this file claimed the decision was safe because "nothing leaves the
page". That is the half of the threat model that does not hold, and it is worth being
exact about which half is which.

**Injection — inward — is genuinely cheap.** A synthesised paste puts an image into a
composer the user has open, beside its own remove button. Nothing is destroyed and nothing
is written until the user saves the note. `attachReferenceImages` slices to the remaining
cap *before* encoding, so a paste carrying a hundred large files costs three decodes, not
a hundred.

**Disclosure — outward — is real, and this feature is what created it.** The shadow root
is `mode: "open"`; it has to be, or the suite's locators could not reach it. So any script
on the page can run

```js
document.querySelector("[data-senannotate-ui]").shadowRoot
  .querySelector(".composer__thumb").src
```

and read the full base64 of whatever was just pasted. Until this feature the shadow root
held screenshots *of the page itself* — which the page already has — and the user's typed
comment. It now holds an artefact from a different application: a frame out of a private
Figma file, an unreleased design, a competitor's page, pasted while the user stands on a
staging, vendor or customer site they may have no particular reason to trust. There is no
clean fix while the root stays open, so the exposure is recorded rather than closed, and
the next person weighing this weighs the right thing.

What *is* closed is the leak in the other direction, which was not a threat-model question
at all: the composer's handler calls `stopPropagation()` on every paste, unconditionally.
`ClipboardEvent` is `composed: true`, so without it a paste inside our card reached
`document` retargeted to our host, and every page that listens for `paste` there — every
rich-text editor, chat box and drag-drop uploader — received the clipboard and acted on
it. `preventDefault` does not help; it only suppresses the browser's own insertion. The
confidential frame the user was attaching to a review note got uploaded into the
application under review. Same shape as `docs/modal-click-leak/`, with a much worse
payload, and `reference.html` now carries a document-level `paste` listener that must
never fire.

The e2e check dispatches a synthetic `ClipboardEvent` because there is no way to put an
image on the OS clipboard from the suite. It sets `composed: true` deliberately: a real
paste carries it, and without it the event could not leave the shadow root at all, which
would make the containment assertion pass for the wrong reason.

## The three-image cap is a UI limit

`MAX_REFERENCE_IMAGES = 3` is not about storage — `fitToQuota` owns storage. Past three
pictures the note has stopped being one change, and the strip stops fitting across the
380px card without a scroller nobody wants inside a composer.
