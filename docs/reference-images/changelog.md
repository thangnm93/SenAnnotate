# Changelog — reference images

## What shipped

`Annotation.referenceImages?: string[]`, filled from a paste into the composer or from
the new attach button, capped at three, rendered as thumbnails with a remove control and
restored when a note is reopened.

`encodeSuppliedImage` in `content/screenshot.ts` puts them through the same 900px JPEG
re-encode as a captured screenshot. `fitToQuota` sheds them only after every screenshot
is gone. The report gives them their own heading — *Reference — how it should look, not
how it looks now* — and a line telling the agent to use the project's own tokens rather
than the values it can read off the picture.

Eight files: `shared/types.ts`, `shared/output.ts`, `content/screenshot.ts`,
`content/storage.ts`, `content/index.ts`, `content/ui/composer.ts`, `content/ui/dom.ts`
(one icon), `content/ui/styles.css`, plus `test/e2e.mjs` and a fixture.

## What the first cut got wrong

**Encoding in the composer.** The first version imported `encodeForEmbed` into
`ui/composer.ts` and did the canvas work there. It typechecked and it worked, and it put
image processing inside the layer whose entire job is to draw — the composer would have
been the second module in `ui/` to know what a `data:` URI is for. Moved behind an
`onAttach(files)` callback, which is also what made the encode failure path (`Could not
read that image`) land in the one place that already owns toasts.

**Storing `[]`.** Submitting with no images wrote `referenceImages: []` onto every new
note, changing the stored shape of annotations that have nothing to do with this feature
and making the upgrade fixture's "0.2.0 shape still renders" check a slightly different
question. It is `undefined` when empty.

## Rejected

**One `images` array with a `kind` field.** Loses the quota ordering (see `context.md`)
and moves the "which of these is the target" question from the type system into a
runtime filter, in a report where getting it wrong means implementing the bug.

**Marking up a reference.** The markup editor exists to blur customer data out of a
photograph of our own page. A pasted Figma frame is someone else's artefact.

## Verification

`npm run typecheck` and `npm run build` clean. `npm test`: **218 e2e checks and 9 upgrade
checks pass** — six new, in their own fixture (`reference.html`) because the report
assertions read whatever the page holds:

- an attached image appears in the composer *(real `setInputFiles`)*
- a pasted image joins the attached one *(synthetic `ClipboardEvent` — see `context.md`)*
- an image can be taken back out
- the report says the reference is a target, not the current state
- the reference image itself travels in the report
- reopening a note brings its reference images back

Not covered: `fitToQuota` shedding references last. Reaching 4 MB of images needs a page
with dozens of photographed notes, which is minutes of a suite that runs in one context.

## Review follow-ups (PR #14)

Fifteen review comments; fourteen fixed, one part of one rejected with reasoning. Branch
merged with `upstream/main` at 0.8.2 first — clean merge, and the toolbar's `title=` →
`aria-label=` rename landed there, so this block's `.tool[title^="Annotations"]` locator
became `.tool[aria-label^="Annotations"]`.

### The paste event was leaving the page

The worst of them, and not the one the feature was worried about. `ClipboardEvent` is
`composed: true`, so a paste into the composer reached `document` retargeted to our host,
and `preventDefault()` did nothing about it — it only suppresses the browser's own
insertion. Every page that listens for `paste` on `document` (rich-text editors, chat
boxes, drag-drop uploaders — effectively all of them) received the clipboard and acted on
it, which means the confidential Figma frame the user was attaching *to a review note* got
uploaded into the application under review. Same shape as `docs/modal-click-leak/`.

`stopPropagation()` now runs first and unconditionally: a pasted paragraph of text is no
more the page's business than a pasted image. `reference.html` carries a document-level
`paste` listener and a new check asserts it never fires — with `composed: true` added to
the synthetic dispatch, without which the check would have passed for the wrong reason,
since a non-composed event cannot leave the shadow root at all.

### A mixed clipboard lost its text

`preventDefault()` fired on sight of an image, but a clipboard is not one thing: a copy out
of Figma — or Excel, Word, Preview — carries `text/plain` beside the bitmap. The feature's
own headline source therefore attached the picture and silently ate the sentence that came
with it. The default is now cancelled only when there is no text item.

### Canvas allocation, and the failure that is not `null`

`encodeSuppliedImage` created the canvas at natural size and let `encodeForEmbed` downscale
*afterwards*. A 2× export of a desktop frame is 5120×8000 — 164 MB of RGBA, and over
Chrome's 268,435,456 px canvas area cap for anything larger. Over the cap Chrome does not
throw: `drawImage` becomes a no-op and `toDataURL` returns the literal string `"data:,"`,
which is truthy and sailed through the `!== null` filter into storage and into the report
as `![… — reference 1](data:,)`. The scale is now applied in the single `drawImage`, and
`validEmbed` rejects anything that is not a `data:image/` URI — which also catches the
other route to `"data:,"`: `accept="image/*"` admits SVG, and an SVG with no intrinsic size
decodes with `naturalWidth === 0`.

### Sixty files, sixty canvases

The picker is `multiple`, so "select all" in a screenshots folder handed
`attachReferenceImages` sixty files. All sixty were decoded and JPEG-encoded concurrently
and then all but three discarded by the cap. It was also the amplifier for the synthetic
paste this feature waved off as harmless: one hostile `paste` carrying a hundred large
files bought a hundred concurrent decodes. `Composer.referenceImageRoom()` is now asked
first and the file list sliced before any encoding happens.

### Three toasts that told the user the wrong thing

- `composer?.addReferenceImages(…) ?? 0` collapsed "the composer closed during the encode"
  into the same `0` the cap produces, so pressing Esc while a 4 MB PNG encoded produced
  *"Three reference images is the limit"* on a composer that was nowhere near the limit and
  no longer existed. `composer` is re-checked explicitly and that case now returns quietly.
- The cap was only reported when *nothing* was kept. Five files with three slots said
  "Attached 3 images" and two vanished unexplained; three files where one was a corrupt PNG
  said "Attached 2 images" for a 3-file selection. The count is now compared against what
  the user handed over.
- `MAX_REFERENCE_IMAGES` is exported and interpolated instead of the number three being
  spelled out in prose in `index.ts`, which would have kept insisting on three the day the
  strip grows to four.

### The card grew and stayed where it was

`position()` ran once, in the constructor, against a card measured before any image
existed — and it has a real branch for a card that would fall off the bottom. Attaching an
image added a 54px strip plus margin to a card that had been placed to just fit, so a note
taken in the lower third of the viewport pushed its own footer — Save, camera, attach,
delete — under the fold, in a `pointer-events: none` layer with no scroller. ⌘/Ctrl+Enter
was the only way out and nothing said so. The anchor is retained and the placement retaken
after the strip renders. Removal deliberately does not reposition: shrinking cannot hide
anything, and moving the card out from under the finger that just clicked remove would.

### An imported string would have stopped the page persisting

`looksLikeAnnotation` validated `id`, `comment`, `element` and `selector` only. An export
hand-edited to carry `"referenceImages": "x"` passed, and then three separate places
iterate that field: `fitToQuota` reaches `.reduce` on a string and throws inside
`saveAnnotations`' `try`, which is caught — so every note on that page silently stops
persisting, the exact outcome `MAX_STORED_BYTES` exists to avoid; `output.ts` throws on
`.forEach` and takes Copy report down with it; the composer renders one thumbnail per
character. One clause in the guard closes all three, and it is the only optional field that
earns one.

### Compact dropped references without saying so

Both compact paths — the page report and the session report — render one line per note and
never touch images, so a user on Compact who pasted a Figma frame copied a report with no
trace of it. This file already refuses that failure for console errors, and a reference
image is the one attachment nobody can regenerate. Both now name it in the withheld line;
the session report gained the same "switch off Compact" sentence the page report had.

**Partly rejected:** the same comment asked for `renderDone` too. It drops `screenshotData`
identically and always has — a fixed note is rendered as one line of context in *every*
detail level, not just Compact, and that is the existing contract rather than a regression
this feature introduced. Changing it would put images under "Already fixed" in a report
whose numbered list is the work to do. The compact withheld count deliberately spans done
notes as well as open ones, so nothing goes unmentioned there.

### A fallback that could never fire

`initialImages: existing?.referenceImages ?? draft.referenceImages` looked load-bearing and
was not: `openEditor` passes the same object as both `draft` and `existing`, and
`beginAnnotation` passes a fresh `captureDraft` result that never writes the field — it
only exists on `Draft` because `Omit<Annotation, …>` keeps it. It typechecked, which is
what made it convincing. Now `existing?.referenceImages`, with the reason recorded.

### Documentation that described a safeguard that does not exist

`context.md` claimed adding `paste` to `ACTIVATION_EVENTS` would break the e2e check.
`ACTIVATION_EVENTS` is read by one function, `guarded()`, applied in one place — the
`attrs.on` loop inside `h()`. The composer registers its handler through `listen()`, which
calls `addEventListener` directly. So adding `paste` to that set changes nothing at all,
and anyone who did it believing they had closed the untrusted-paste path would be worse off
than before. The section now says the path is open *by construction*.

The same section's "nothing leaves the page" was the wrong half of the threat model. The
shadow root is `mode: "open"` — it has to be, for the suite's locators — so any page script
can read `.composer__thumb`'s `src` and walk off with the base64 of whatever was just
pasted. That is genuinely new: until this feature the root held screenshots *of the page
itself*, which the page already has. Now it can hold a frame from a private Figma file
while the user stands on a staging or vendor site. No clean fix while the root stays open,
so it is recorded honestly and `PRIVACY.md` states it in the user's own terms.

### `plan.md` was missing

The folder shipped `brief.md`, `context.md` and `changelog.md`. Every peer folder has four.
Reconstructed after the fact and labelled as such — and the omission was not bookkeeping:
the two reversals under *What the first cut got wrong* are precisely the decisions a plan
holds, and both were taken twice because nothing held the first answer.

### Paperwork

No permission was added, so no new justification block is needed. Two existing claims
became false and were corrected:

- `PRIVACY.md` said flatly *"It does not read your clipboard."* It now distinguishes
  programmatic reading (still none, and no permission for it) from a paste the user
  performs, states that the text half of a mixed clipboard is never inspected, discloses
  stored reference images in the "saved on your device" list — which also caught a
  pre-existing gap, the embedded screenshot copy was never listed either — and states the
  open-shadow-root exposure plainly.
- `store/listing-privacy.md`: the same sentence in the `clipboardWrite` justification, and
  the `storage` justification, which described notes and selectors but no images at all.

## Applied on the maintainer's sign-off

`CLAUDE.md` now says both halves. The `createUiRoot` bullet notes that `paste` is stopped in
the composer rather than at the host, so a reader counting the host's listeners does not
conclude it is unhandled. And the rule this review produced has its own bullet: **an event our
UI handles must be stopped before it reaches `document`, and `preventDefault` is not that** —
named as the shape behind `modal-click-leak/`, `modal-focus-leak/` and this paste, with the
instruction to assume the next input surface in the overlay has it too.
