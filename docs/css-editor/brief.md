# Brief — Live CSS editing, and the changes it records

## What

The first slice of turning SenAnnotate from a tool that reads a page into one that can
also change it.

- **Mode 5, `edit`.** Click an element to load it into a card of its declarations.
- **Editing applies instantly**, as an inline style, with the previous value kept.
- **A Changes tab** listing every override made on the page, per element, with copy and
  revert — one property or all of them.
- **A `## CSS changes` section in the report.**

## Why

Every release so far made an annotation more precise about *what is wrong*. None of them
made it more precise about *what to do instead* — that has always been prose, and prose
is where the reader has to guess whether `12px` meant padding or gap, and on which
element.

An override list is the same sentence with the guessing removed:

```markdown
### `.actions > button.primary`
- `padding`: `8px 12px` → `12px 20px`
```

That is the most directly actionable thing this extension can emit, and it costs nothing
to say once the edit has been made — the reviewer had to decide the new value anyway.

## What this changes about the project

`docs/measure-core/brief.md` said **"Anything that *edits* the page. This tool reads."**
That is no longer true, and the line has been amended to point here rather than left to
rot. Worth stating plainly rather than burying: the read-only rule shaped the whole
architecture, and anything that quotes it from here on is quoting history.

What does *not* change: the overlay still never delivers pointer events to the page, the
inspector still snapshots nothing at load, and every surface added here is off by default
behind its own master switch.

## Scope

**In**

- A curated list of the properties people actually edit, each with its computed value,
  each editable — plus a free-form "add a property" row for everything else
- Apply on change; keep the prior value; revert one or all
- The Changes tab, and the report section
- `Settings.cssEditor`, off by default, gating the mode and its button

**Out — deliberately**

- **`@media` editing and pseudo-state forcing.** Measured before scoping: no web API can
  force `:hover`, DevTools uses CDP `CSS.forcePseudoState` behind the `debugger`
  permission, and the CSSOM fallback cannot read cross-origin stylesheets at all
  (`SecurityError`) — which is most sites. Both need their own decision; see
  `context.md`.
- **HTML tools and text editing.** Separate slices, separate risks.
- **Persistence.** Overrides live in memory for the page's life. They survive into the
  report and the clipboard, which is where they are meant to end up.

## Success criteria

1. With `CSS editor` off, no mode 5, no button, no hint clause, and no page is touched.
2. Editing a property changes the page immediately and records the previous value.
3. Reverting restores exactly what was there — including an original inline value, not
   merely "no inline value".
4. The report names the selector, the property, and both values.
5. `npm run typecheck` clean, `npm test` green.
