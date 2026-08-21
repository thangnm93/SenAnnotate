# Why the page's stylesheet can style our host at all

The shadow boundary is not symmetrical, and this is the half that surprises:

- Page CSS **cannot** reach *inside* the shadow tree. That part held; our overlay's own
  markup was never at risk.
- Page CSS **can** style the **host element**, because the host lives in the page's tree.
  And on the host, outer-tree declarations *win*: per CSS Scoping, a declaration from the
  outer tree beats a `:host` rule from the shadow tree regardless of specificity.

So `:host { all: initial }` in `styles.css` — written precisely to "reset anything the page
might have set on our host" — is a best-effort default, not the guarantee its comment
claimed. Any page rule matching the host overrides it silently.

## What made that fatal rather than cosmetic

The host is `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647`. It is a
full-viewport sheet at the top of the z order that happens to be invisible only because it
has no background. Give it one and it is a perfect opaque cover for the entire site.

Two page rules landed on it. daisyUI's base:

```css
:root, [data-theme] { background-color: var(--fallback-b1, oklch(var(--b1)/1)); color: … }
```

matched because `root.ts` set **`data-theme`** on the host to drive its own dark mode —
the same attribute name daisyUI, and most themed sites, select on. Confirmed with
`CSS.getMatchedStylesForNode`: the winning declaration was that rule, computed
`background-color: oklch(1 0 0)` — white.

The `color` half of the same rule leaked further: it is inherited, so it reached every
descendant in the shadow tree that takes `color: inherit`. The overlay was being tinted by
the page as well as hiding it.

## What was rejected

- **Dropping the attribute and switching on a class instead.** Same problem one step over:
  page rules match classes too, and a class is *more* likely to collide than a namespaced
  data attribute.
- **`all: initial !important` inline on the host.** It would win, but it also resets
  `position`, `inset` and `z-index` — the four properties already pinned inline for exactly
  this reason — and the interaction between an inline `all` and inline longhands is the kind
  of subtlety that breaks quietly a year later.
- **Moving the reset from `:host` to a wrapper element inside the shadow tree** for
  *everything*. Correct in principle, but it means every layer gains a parent and every
  fixed-position coordinate in the overlay resolves against a new box. Not worth it for
  properties no page rule can currently reach.
