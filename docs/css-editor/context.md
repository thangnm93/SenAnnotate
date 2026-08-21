# Context — what constrains live CSS editing

## Three things measured before any of this was designed

**No web API can force a pseudo-state.** `CSS.forcePseudoState` is a DevTools Protocol
command, not a web platform one. An extension can only reach it with the `debugger`
permission, which puts a persistent *"SenAnnotate started debugging this browser"* banner
on the tab and restarts Chrome Web Store review. Verified: nothing in `window.CSS` or on
the element exposes it.

**Cross-origin stylesheets are opaque.** The obvious workaround — read the `:hover` rules
out of CSSOM and re-apply their declarations under a forced class — dies on
`sheet.cssRules`, which throws `SecurityError` for any sheet served from another origin.
Verified against a CDN stylesheet. Most real sites load CSS from a CDN, so the fallback
fails exactly where it is needed.

Together those two are why `@media` and pseudo-state forcing are out of this slice rather
than merely deferred: they need a permission decision, not more code.

**There is no side panel, and adding one is not free.** `chrome.sidePanel` needs its own
permission and Chrome 114; the manifest currently declares 111 and three permissions. A
side panel is also a separate document, so every DOM change would cross a message
boundary. The card system already in `ui/` costs none of that.

## Why overrides are inline styles

A stylesheet injected into the page has to win a specificity fight against the page's own
CSS, and the only way to win it every time is `!important` on every declaration — which
corrupts the very text the Changes tab exists to let you copy out.

Inline is what DevTools' `element.style` pane does, it beats everything except
`!important`, and it is the model users already have.

**The cost, stated rather than discovered:** a framework re-render replaces the node and
the override goes with it. DevTools has the same hole. The Changes tab keeps the record,
so re-applying is possible — it is not automatic, and pretending otherwise would need a
`MutationObserver` re-attaching styles to elements that may no longer be the same element.

## Reverting has to restore, not just clear

An element may already have had an inline `style` when it was first overridden.
`element.style.removeProperty()` would leave the page in a state it was never in.

So the first override of a property records the **prior inline value specifically** —
`element.style.getPropertyValue(prop)`, which is empty when the value came from a
stylesheet — alongside the computed value shown in the UI. Revert puts the inline value
back when there was one, and removes the property when there was not.

## Traps carried forward

- **A presence assertion is not a rendering assertion**, and a count is not a state.
  Anything drawn gets a computed-style check; anything toggled gets checked from the
  *on* state, not the initial one.
- **Verify a regression check by breaking the fix.** Three checks in the measurement work
  were worthless until they were watched failing.
- **Never slice code between two string anchors**; brace-match from the brace that opens
  the body.
- **Read the first compiler error.** The tail is cascade noise.
- **Own fixture** — this work gets `test/fixtures/css-edit.html`.
