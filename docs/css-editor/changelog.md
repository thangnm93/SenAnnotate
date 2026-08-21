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

## The bug the CSS card exposed was two releases old

Reported: with the CSS card open, digits do not reach its fields — they switch mode
instead.

**Root cause, measured rather than guessed:** `event.target` is **retargeted to the
shadow host** for anything inside our shadow root. The keydown guard tested
`target.tagName` against `input|textarea|select`, and for every field this extension owns
that tag is `DIV`. The guard has never worked on our own UI.

```
target=DIV[host]   composedPath()[0]=INPUT
```

So it was not a CSS-card bug. The same hole swallowed digits typed into the grid's
**Columns** field, added two releases earlier in `feature/measure-guides` — typing `3`
there switched to mode 3 behind the open card, silently. Nobody noticed because a column
count is usually set once and the mode change is invisible while a card covers the page.

Fixed at the source with `composedPath()[0]`, which is the element actually focused on
both sides of the boundary. Both fields now have a regression check; breaking the fix
fails them.

**Then the fix was too wide.** Guarding every form control meant that after clicking a
checkbox in Settings — which keeps focus — the mode keys went dead for the rest of the
session. A checkbox takes no text, so a digit pressed on one is a mode key. `isTextEntry`
now excludes checkbox, radio, button, colour, range and file, and keeps `select`, where
letters and arrows genuinely navigate.

## Arrow keys, and the repaint that made them useless once

<kbd>↑</kbd>/<kbd>↓</kbd> step the number the caret is in; Shift by ten, Alt by a tenth.
`nudge()` is pure and unit-tested across fifteen cases — the caret choosing between the
two numbers of `8px 12px`, a single channel of `rgb(37, 99, 235)`, decimals preserved,
a fine step on an integer gaining a place, and no-number values left to the browser.

**The interesting part is why one press was not enough to test.** Every edit repaints the
card, and the repaint replaces the input being typed in — so the first Up worked and the
second did nothing, because the field it had focus in no longer existed. The card now
records the focused property and caret before `replaceChildren` and restores them after,
with `takeFocus` rather than `focus` for the reason that helper's own comment gives.

The check that catches it is **three presses in a row**. One press passes against the
bug. Verified by removing the restore: three assertions fail, all reporting the value
after the first step.

That is the same shape as the ruler check in `docs/measure-guides/changelog.md` — an
assertion that is true of the broken build because it never reaches the state that
breaks. Worth naming as a pattern: **if a fix is about continuing, the test has to
continue.**

## Verification

- `npm test` — **362/362** e2e, **9/9** upgrade, **72/72** unit.
- Both fixes verified by breaking them: `composedPath` (1 failure) and the focus restore
  (3 failures).
