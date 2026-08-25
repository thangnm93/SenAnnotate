# Context — where the extension is allowed to run

## Why the popup owns this setting, and not the settings card

0.7.0 moved every setting out of the popup into the toolbar's gear, and the module banner
in `popup/index.ts` states the invariant it bought: *one owner, one writer*. This feature
breaks it, deliberately, for one group of fields.

The settings card is drawn inside the overlay. The overlay is exactly what a blocked
domain does not get. A setting that can switch the UI off cannot be edited from inside
that UI — you would have to find an allowed site, open its toolbar, and edit the list from
there to give yourself back the site you were actually looking at. Worse in the failure
case people will hit first: someone allowlists one host, every other site goes quiet, and
the only surface that still opens is the popup.

So the popup writes `domainRuleMode` and `domainRules`, and nothing else. The write is a
read-modify-write of the whole settings object rather than a blind `set`, because the card
owns every other field and may have changed one while this popup was open.

## Why the rules are checked before the UI is built, not after

`hideUntilRestart` builds the whole overlay and then sets `display: none` on the host.
Copying that here would have been a two-line change and is wrong.

A hidden overlay is still: a shadow host attached to `documentElement`, nine pointer
listeners and two focus listeners at that host, a `chrome.runtime.onMessage` listener
answering for the page, a `document`-level `pointermove`/`click`/`keydown` set, and — with
`captureDiagnostics` on — `fetch`, `XHR` and `console.error` replaced in the page's own
heap by the MAIN-world inspector. Someone who says "not on this site" means all of that,
not the pixels. `challenge-frames/` is the precedent: patching page natives inside iframes
broke Cloudflare challenges, and the fix was to *not run*, not to run invisibly.

The cost is that `content/index.ts`'s entry becomes async — a `chrome.storage.sync` read
before our own first paint. On a path that already waits for `document_idle` that is a few
milliseconds, and the alternative is a flash of toolbar on a site the user excluded, which
is the single thing this feature exists to prevent.

Failing **open** on a storage error is the other half. `loadSettings` returns
`DEFAULT_SETTINGS` when the read throws, and the default mode is `off`, so an unreadable
setting leaves the extension working. The opposite choice would make a transient storage
error indistinguishable from an uninstall, on every page at once, with the popup — which
reads the same broken storage — unable to explain it.

## Why child frames answer to their own host

Both content scripts run with `all_frames: true`, and each document evaluates the rules
against its **own** `location.hostname`. So an excluded payment or analytics iframe stays
untouched on an allowed page, and an allowed app embedded in an excluded shell still gets
nothing, because the top frame is what owns the UI.

This falls out of the rules being written as hostnames rather than as "sites", and it is
the reading that matches what the list looks like. It also means an allowlist has to name
an embedded host explicitly if drafts are wanted from inside it — stated here because the
symptom (an iframe that will not highlight on an allowed page) has no other explanation.

## Why the rules take effect on the next load

Neither direction is safe to apply live.

**Turning off** mid-session means tearing down state the user may be halfway through —
notes typed, a composer open, a screenshot being marked up — with nothing left on screen
to say where it went. Storage changes arrive from another tab, so this could happen while
the user is mid-sentence in a page they are not even looking at.

**Turning on** mid-session is the harder half and the reason there is no argument here.
`installTopFrame` is not re-entrant: it registers `chrome.runtime.onMessage`, every
`listen()` and the three UI constructors exactly once, and `CLAUDE.md` singles that branch
out as the most important line in the file. The MAIN-world inspector has also already
decided what to patch, at `document_start`, and cannot be asked again.

A reload is one keystroke. The popup's hint says so rather than leaving it to be noticed.

## The matcher, and why `*` is one label

`shared/domain-rules.ts` is pure string work — no `location`, no `chrome`, no DOM — which
is what lets the content script and the popup reach the same verdict without either
importing from the other.

Two rules, and the second is a safety property rather than a convenience:

**A bare domain includes its subdomains.** `example.com` covers `app.example.com` and
`a.b.example.com`. Someone excluding a company's site means the site, not one hostname of
it, and a list that required `*.example.com` alongside `example.com` would be a list people
get wrong. `*.example.com` remains available for the narrower reading — subdomains but not
the apex — where that distinction is the point.

**`*` matches exactly one label, never several.** So `foo.*` matches `foo.com` and `foo.dev`
and *not* `foo.co.uk`. The greedy reading is more convenient and is unsafe in the direction
that matters: with it, an allowlist entry of `foo.*` would also admit
`foo.evil.example.com`. A pattern in an allowlist must never match more hosts than it looks
like it does, and that constraint decides the semantics for the blocklist too, because it
is one list.

`parsePattern` is deliberately forgiving about input — scheme, path, port, credentials, a
leading `.`, a trailing dot, and any case all reduce to the same pattern — because the
realistic gesture is pasting a URL out of the address bar. Strictness here would produce a
list that silently fails to match the thing the user copied from the tab in front of them.

## Known rough edges

**A hostname with no labels.** `file://` and `about:` documents have an empty
`location.hostname`, so no pattern except `*` can cover them: an allowlist turns the
extension off on local files unless `*` is listed. That is the safe direction for a list
whose whole meaning is "only these", and the popup says it in words rather than leaving it
to be discovered.

**IP addresses are matched as labels.** `127.0.0.1` is four labels, so `127.0.0.*` works
and `127.0.*` does not match `127.0.0.1` — the subdomain rule reads `127.0` as a parent of
`0.1.127.0`, which is meaningless for an address. Nobody has asked for CIDR and adding it
would mean a second matcher; the e2e block pins the behaviour that exists.

**Nothing prunes the list.** It is a user-maintained list of a handful of lines, and unlike
the dock positions in `draggable-toolbar/` there is a visible editor for it.
