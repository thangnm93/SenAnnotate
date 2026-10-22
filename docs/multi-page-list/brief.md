# Brief — one list per origin

## What

The annotation list belongs to the **origin**, not the page. Walking from `/cart` to
`/checkout` keeps every note; the toolbar count, the panel, Copy report and Clear all
operate on the whole site's list. Pins and highlights still appear only on the page a
note was made on.

## Why

A review is rarely one screen. Annotating a flow meant copying a report per page, or
visiting each page again from the popup's session copy, because moving to the next page
started an empty list. The request was to annotate across several pages at once and have
only an explicit clear (Copy with "clear after copying" on, or Clear all) empty it.

## Scope

In:

- One list per origin, gathering the notes of every path on it.
- The panel shows all of them, labelled by page once more than this page is involved;
  numbers restart per page, matching the pins.
- The report groups notes by page; a one-page list reads exactly as it did.
- Copy (with `clearOnCopy` on) and Clear all empty the whole origin's list.
- Notes already stored by older builds appear without any migration step.

Out:

- Notes across different origins. One list per origin is the agreed boundary.
- Changing the `clearOnCopy` default (still off) — see `context.md`.
- Jumping to another page from a panel row. Selecting a note that lives elsewhere says
  where it is rather than navigating a page the user may have unsaved work on.
- Syncing a second tab's edits into the first. See the risks in `changelog.md`.

## Success criteria

- A note made on page A is in the list, the count and the panel on page B of the same
  origin, after a real navigation and after an SPA `pushState`.
- Page B shows no pin for page A's note; page A shows it again on return.
- With "clear after copying" on, Copy empties the list on every page; Clear all does too.
- Export, import, the popup's session copy and the shared HTML review behave as before.
- Data written by the previous release is in the list on first load after upgrading.
- The suite passes with the new block in it, and no existing count assertion was weakened.
