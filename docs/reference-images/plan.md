# Plan

Reconstructed after the fact. The work was done without this file, which is the omission
the review caught — and the omission cost something real: the two mid-flight reversals in
`changelog.md` ("What the first cut got wrong") are exactly the decisions a plan is for,
and both were taken twice because nowhere held the first answer. Written here in the order
the work should have gone, with the revisions folded in where they belong.

## 1. Type first — `shared/types.ts`

`Annotation.referenceImages?: string[]`, its own field beside `screenshotData`, never a
shared `images` array with a `kind` discriminator. The argument is in `context.md`; it has
to be settled before anything reads or writes, because it decides the quota ordering, the
report heading and the composer's state shape all at once.

Optional, and `undefined` rather than `[]` when empty. A note that never touched this
feature must serialise to byte-identical storage — the upgrade fixture reads the 0.2.0
shape and should be asking the same question afterwards as before.

## 2. Encoding — `content/screenshot.ts`

`encodeSuppliedImage(file)`: decode via `createObjectURL`, draw into a canvas, hand to
`encodeForEmbed`. Same 900px ceiling and JPEG quality as a captured screenshot, so
`fitToQuota` has one size of thing to reason about.

Constraints that belong here and nowhere else, because this is the only module that
touches a canvas:

- **Scale on the way in.** `canvas.width = naturalWidth` first would allocate 164 MB for a
  2× Figma export and can exceed Chrome's canvas area cap, which fails silently.
- **Reject what cannot be encoded.** Zero-dimension input (an SVG with no intrinsic size)
  and an over-cap canvas both produce the literal string `"data:,"` from `toDataURL`.
  Truthy, so every `!== null` filter downstream keeps it. Guard on the way out.

## 3. Composer — `content/ui/composer.ts`

Owns the strip, the thumbnails, the remove control, the hidden file input, the paste
handler, and the cap. **Does not own encoding** — `onAttach(files)` hands raw `File`s to
the orchestrator. The composer draws; it does not know what a `data:` URI is for. (This is
the first thing the initial cut got wrong.)

Cap: `MAX_REFERENCE_IMAGES = 3`, exported, because the toast that names it is written at
the call site and the slice that enforces it happens before encoding.

Two things the card's geometry forces:

- The paste handler `stopPropagation()`s unconditionally. `ClipboardEvent` is
  `composed: true` and a page listening on `document` would otherwise receive the
  clipboard. `preventDefault` is a separate question and fires only when there is no
  `text/plain` beside the image — a Figma or Excel copy carries both, and cancelling on
  sight of the image eats the text half.
- Adding an image makes the card ~62px taller than it was when `position()` placed it, so
  the anchor is retained and the placement retaken. Otherwise a note taken low in the
  viewport puts its own Save button under the fold, in a layer with no scroller.

## 4. Orchestration — `content/index.ts`

`attachReferenceImages(files)`: ask the composer for room, slice to it, encode, re-check
that the composer still exists, add, report. Every branch has to say something true —
"the cap swallowed some", "the composer closed", "one file would not decode" are three
different outcomes and only the first is about the cap.

## 5. Storage and import — `content/storage.ts`, `shared/archive.ts`

`fitToQuota` sheds screenshots in full before it touches a single reference image;
recoverability is the rule and `context.md` has the argument.

`looksLikeAnnotation` validates the field. It is the only optional field that needs it:
three separate places iterate it, and a hand-edited export carrying a string passes a
`.length` check and throws inside `saveAnnotations`' `try` — which silently stops every
note on the page from persisting.

## 6. Report — `shared/output.ts`

Own heading, saying what the image is *for*, plus the design-token nudge. Compact renders
one line per note and cannot show images, so it names them in the `withheld` list rather
than dropping them silently — the one attachment the user cannot regenerate is the one
that must not vanish without a word. Both compact paths: the page report and the session
report.

## 7. Verify

- `npm run typecheck`, `npm run build`.
- `test/fixtures/reference.html`, its own fixture because the report assertions read
  whatever the page holds and a shared fixture carries other blocks' notes.
- Checks: attach via real `setInputFiles`; paste via a synthetic `ClipboardEvent`
  (`composed: true`, or the containment check passes for the wrong reason); the page's own
  document `paste` listener never fires; remove; the report's heading; the embedded image;
  reopening restores.
- Not coverable here: `fitToQuota` shedding references last needs 4 MB of images, which is
  dozens of photographed notes.
