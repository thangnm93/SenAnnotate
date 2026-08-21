# Changelog

## The fix — three parts, each closing a different half of the hole

1. **`data-theme` → `data-sa-theme`** (`root.ts`, five selectors in `styles.css`).
   Removes the collision that was actually firing. A bare `data-theme` is what daisyUI,
   Tailwind theme setups and most hand-rolled dark modes select on; our own attribute had
   no business claiming that name.

2. **`background: transparent !important`, inline on the host** (`root.ts`), alongside the
   `position` / `inset` / `pointer-events` / `z-index` that were already pinned there.
   Inline beats page rules, so this closes the general case — the fixture proves `div
   { background-color: … }` alone reproduces the blank page, with no `data-theme` involved.
   This is the declaration that makes the class of bug impossible, rather than this instance
   of it.

3. **Inherited properties re-declared on the layers**, inside the shadow tree
   (`styles.css`). `font-family`, `font-size`, `line-height`, `color` and
   `-webkit-font-smoothing` now sit on `.layer` / `.markers`, where page CSS has no reach,
   instead of relying on `:host` to hold them.

`:host { all: initial }` stays. It is still right when no page rule matches — it is only
insufficient, not wrong.

## Verification

`test/fixtures/themed-host.html` carries daisyUI's `:root, [data-theme] { … }` verbatim
plus a bare `div { background-color: … }`, and three checks in `test/e2e.mjs` assert the
host stays transparent, the overlay keeps its own colour and font, and the page still
annotates. Measured against the fixture, before and after:

```
PRE-FIX:  bg rgb(255, 0, 0)     colour rgb(255, 0, 0)  font "Comic Sans MS"
POST-FIX: bg rgba(0, 0, 0, 0)   colour rgb(28, 37, 48) font ui-sans-serif
```

Suite: 322/322 e2e + 9/9 upgrade, headless. Live site re-checked — the signup form renders
with the toolbar over it.

## What went wrong in the investigation, worth remembering

- The first instinct was freeze CSS, then diagnostics' `console.error` patch — goaffpro runs
  a devtools-detection routine that spams every console method, which reads like a smoking
  gun and is not one. `senannotate-freeze-styles` was absent the whole time.
- Enumerating page stylesheets and testing `host.matches(rule.selectorText)` from a content
  script returned **nothing** — the page's rules live in the page's tree and the isolated
  world's view found no match for the host. `CSS.getMatchedStylesForNode` over CDP answered
  in one call. Reach for the protocol, not a hand-rolled cascade walk.
- The tell was in the numbers before it was in the reasoning: identical DOM, identical
  computed styles, identical layout, blank screenshot. That combination can only be paint.
