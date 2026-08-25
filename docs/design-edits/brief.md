# Brief — try the change, then report the delta

## The problem

"Tighten this and make it feel less heavy" is the note people actually write, and it
fails twice. The agent has to invent the numbers, and the reviewer never found out
whether their own idea was right — they are describing a change they have not seen.

Anyone who has done this properly has already opened devtools, typed `20px` into the
padding box, looked at it, and then written the sentence anyway. The values they settled
on are the useful part of that work, and they are thrown away.

## What ships

A **Design** section inside the composer, collapsed by default:

- **Colour** — text, background
- **Type** — size, weight
- **Spacing** — padding, margin, gap
- **Layout** — display, flex direction, justify, align
- **Size** — width, height
- **Content** — the element's text, when it is a single run that can safely be replaced

Every control previews on the real element as it is changed. On save, the note carries a
list of `property: from → to` — with `from` being what the element actually rendered as —
and the report prints them as a table, under a line telling the agent to express them
with the project's own tokens rather than pasting the literal values.

The preview is **always undone** when the composer closes, saving included.

## Not in scope

- Anything that outlives the composer. The extension does not modify the page; see
  `context.md` for why this is the one rule that could not bend.
- Editing text that is not a single text node. Replacing the contents of a `<p>` that
  holds a `<strong>` deletes the emphasis, which is not an edit anyone asked for.
- Generating CSS to paste. The delta is a description of intent; the patch is the
  agent's job, in the repo's own idiom.
