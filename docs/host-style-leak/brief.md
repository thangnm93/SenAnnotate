# The page's CSS painting our shadow host

**Reported:** the extension turns `https://goaffpro.com/signup` into a blank white page —
the signup form disappears the moment the overlay is on the page.

**Not what it looked like.** Nothing was hidden. The DOM was untouched (identical
`body.innerHTML` length with and without the extension), every input still had a real
bounding box, and the page's own computed styles were byte-identical. The site was simply
*behind* something: our own shadow host, painted opaque white across the viewport at
`z-index: 2147483647`.

**Scope.** Every site whose CSS has a rule broad enough to match a bare `<div>` on
`documentElement`. daisyUI — a Tailwind plugin, and what goaffpro uses — ships the
rule that triggered it, so this is a whole family of sites, not one page.

## What it looked like

The signup page with the extension loaded, before and after the fix. Same DOM in both,
same computed styles, same layout — the only difference is what paints.

| Before | After |
|---|---|
| ![blank](./blank-before.png) | ![fixed](./fixed-after.png) |
