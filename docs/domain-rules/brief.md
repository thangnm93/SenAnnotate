# Brief — where the extension is allowed to run

## The problem

SenAnnotate installs on every page the browser lets it, which is the right default for a
tool you reach for constantly and the wrong one for three situations people actually hit:

- **A customer's production site.** Consultants and agencies run the extension all day on
  their own staging and then browse a client's live site with it still installed. Nothing
  is captured without a click, but "the annotation tool is loaded on our production
  checkout" is a conversation nobody wants to have.
- **Sites the overlay breaks, or that break the overlay.** A page with its own bottom-right
  fixed UI, a heavily animated canvas, an app that fights the shadow host for focus. The
  answer today is *Hide until restart*, per tab, every tab, forever.
- **Banking, health, internal admin.** Pages where the honest preference is that no
  extension code runs at all, not that it runs quietly.

`captureDiagnostics` makes this sharper: with it on, the inspector replaces `fetch`, `XHR`
and `console.error` in the page's own heap. That is exactly what `challenge-frames/` had to
back out of inside iframes, and it is a good reason to want a way to say "not here".

## What is being built

One list of host patterns and one three-way switch: **every site** (the default and
unchanged), **only these sites**, **every site except these**.

Patterns support the two shapes that make a host list usable rather than a chore:

- a bare domain covers its subdomains — `example.com` covers `app.example.com`
- `*` stands for one label anywhere — `*.staging.example.com`, `foo.*`, `*` for everything

The list is edited **in the popup**, not in the toolbar's settings card. That is the one
structural decision here and `context.md` argues it: the card lives inside the overlay, and
the overlay is what a blocked site does not have.

## Scope

**In.** `Settings.domainRuleMode` and `Settings.domainRules`, both synced. A matcher in
`shared/`. The content script refusing to install — top frame *and* child frames, each
judged on its own host. The popup: the editor, and a verdict line naming the pattern that
decided the current tab.

**Out.** Per-path rules: annotations are keyed on `origin + pathname`, but "run here at
all" is a property of a site, and a path list would need a second matcher and a second
explanation. Out too: turning the overlay off mid-session (see `context.md`), and a
right-click "disable on this site" shortcut — worth having, but it belongs with the context
menu work rather than here.

## Success criteria

- A blocklisted host gets **no UI, no listeners and no MAIN-world patching** — not a hidden
  toolbar.
- An allowlist that does not name the host does the same.
- `*` in a label position matches exactly one label, so an allowlist entry can never match
  more hosts than it looks like it does.
- The popup, on a page it cannot reach, says whether that was the browser's rule or the
  user's, and names the pattern when it was the user's.
- Default `off` with an empty list: an upgrade changes nothing about where the extension
  runs.
- An unreadable setting fails **open**. A storage error must not look like an uninstall.
