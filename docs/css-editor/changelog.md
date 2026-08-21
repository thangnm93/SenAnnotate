# Changelog — live CSS editing

Written during the work.

_(Implementation starting 2026-08-21.)_

## What shipped

`content/css-edit.ts` (apply, revert, the registry), `ui/css-card.ts` (Styles and Changes
tabs), mode 5 behind `Settings.cssEditor`, and a `## CSS changes` section in the report.

## The distinction the whole feature turns on

An override records **two** previous values, and confusing them is the bug this design
exists to avoid:

- `from` — the **computed** value, which is what a reader needs. "It was `8px 12px`."
- `priorInline` — the **inline** value, usually empty, which is what a revert needs.

An element that already carried `style="padding: 4px 6px"` must get that back. Clearing
the property would leave the page in a state it was never in — and it looks correct on
every element that had no inline style, which is most of them.

The fixture carries both cases on purpose, and the check was verified by breaking the
fix: replacing the restore with a bare `removeProperty` fails with `8px 12px | -` where
`4px 6px | 4px 6px` was expected. Without that fixture the bug ships.

`from` is also captured **only on the first override of a property**. Editing `padding`
twice must still report the stylesheet's value, not the previous edit — the reader is
following the report to change the source, and the intermediate step is nobody's
business.

## Two anchor mistakes in one session, both the same shape

Both while editing the wiki, both caught by an assertion rather than by the result:

- `s.count("## Measuring") == 1` failed because `### Measuring tools` **contains** it as a
  substring. Substring anchors do not know what a heading is.
- The mode 4 keyboard row had been reworded two releases ago, so the exact-string anchor
  matched nothing.

Both fixed by matching whole lines and asserting the hit count first. This is the third
distinct time in this project's history that an index- or substring-based edit has hit
something it did not mean to; the earlier two are in `docs/measure-core/changelog.md` and
`docs/measure-contrast/changelog.md`.

## Decisions worth keeping

**Inline styles, not an injected stylesheet.** A sheet has to win a specificity fight
against the page's own CSS, and the only way to win every time is `!important` on every
declaration — which corrupts the text the Changes tab exists to let you copy out. The
cost is that a framework re-render takes the override with it; DevTools has the same hole,
and the Changes tab keeps the record so re-applying is possible. Nothing re-applies
automatically, because that would mean a `MutationObserver` re-attaching styles to nodes
that may no longer be the same element.

**Switching the editor off does not revert anything.** The edits are the user's work, not
the mode's. Throwing them away because a panel closed would be the worst possible reading
of a settings toggle — so `enforceCssSetting` closes the card and leaves the mode, and
touches nothing on the page.

**The report section is top-level, keyed on the selector.** An override is not a note
about an element; it is an instruction about one, and it exists whether or not anybody
wrote a sentence beside it. The heading is the selector rather than the friendly label
because this is the one part of the report meant to be acted on mechanically.

**Elements the page has thrown away are dropped from the list**, not kept as ghosts. A
re-render removes the node and the inline style with it, so the record describes CSS that
is no longer applied — printing it would put a line in the report for a change that is
not on the page.

## Verification

- `npm test` — **354/354** e2e, **9/9** upgrade, **57/57** unit.
- Driven by hand on the built extension across both revert cases before any e2e existed.
- The restoring revert was verified by breaking it and watching the check fail.
