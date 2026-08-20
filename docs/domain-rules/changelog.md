# Changelog — where the extension is allowed to run

## What shipped

`Settings.domainRuleMode` (`off` | `allowlist` | `blocklist`) and `Settings.domainRules`,
a list of host patterns. Evaluated in `shared/domain-rules.ts` before anything is built,
per document — so a child frame answers to its own host. Edited in the popup's **Sites**
section, which also names the pattern that decided the current tab.

Six files: `shared/domain-rules.ts` (new), `shared/types.ts`, `content/index.ts`,
`popup/index.ts`, `static/popup.html`, `README.md`. Plus a fixture and an e2e block.

## The decision that shaped everything else

The first sketch put this in the toolbar's settings card, beside the other switches, and
reused `hideUntilRestart`'s mechanism: build the overlay, then hide the host.

Both halves were wrong, and for the same underlying reason — **a blocked site is a site the
extension has no business on, and "no business" is not a statement about pixels.**

A hidden overlay is still a shadow host on `documentElement`, eleven listeners at that
host, a `chrome.runtime.onMessage` listener answering for the page, a document-level
pointer/click/keydown set, and — with `captureDiagnostics` on — `fetch`, `XHR` and
`console.error` replaced in the page's own heap. `challenge-frames/` already paid for that
lesson: patching page natives inside iframes broke Cloudflare challenges, and the fix was
to *not run*, not to run invisibly.

And the card cannot be the editor, because the card is drawn inside the overlay that a
blocked site does not have. Allowlist one host and every other site goes quiet — the popup
is then the only surface that still opens. So the popup writes these two fields, which is a
deliberate exception to the *one owner, one writer* invariant 0.7.0 established, and it is
recorded in that module's banner rather than left to be inferred.

The consequence is that `content/index.ts`'s entry is now `async`. That branch is the one
`CLAUDE.md` calls the most important line in the file, so the change is small on purpose:
the branch itself is unchanged, and the storage read wraps it.

## `*` matches one label, and that is a safety property

The greedy reading is more convenient. It is also unsafe in the direction that matters:
with it, an allowlist entry of `foo.*` would admit `foo.evil.example.com`. A pattern in an
allowlist must never match more hosts than it looks like it does, and because it is *one*
list read two ways, that constraint decides the blocklist semantics too.

The complementary rule goes the other way: a bare `example.com` **does** include its
subdomains, because someone excluding a company's site means the site rather than one
hostname of it. `*.example.com` stays available for the narrower reading.

## Fail open, deliberately

`loadSettings` returns `DEFAULT_SETTINGS` on a storage error and the default mode is `off`,
so an unreadable setting leaves the extension working. The opposite choice would make a
transient storage error indistinguishable from an uninstall — on every page at once, with
the popup reading the same broken storage and unable to explain it.

## Two smaller things worth writing down

**The list is saved on `change`, not on input.** `chrome.storage.sync` has a per-minute
write quota; saving per keystroke would burn it on one paragraph of typing.

**The textarea is not repainted while it has focus.** Rewriting `value` from the stored
list on every repaint moves the caret to the end, which is unusable on a multi-line field.

## Verification

`npm run typecheck` and `npm run build` clean.

```
219/219 checks passed
9/9 upgrade checks passed
```

212 of those are `main`'s; 7 are new.

The new block drives the popup and asserts on the **absence** of a toolbar, which is the
only honest way to test this:

- a blocklisted host gets no toolbar at all
- the popup says *off on this site by your rules* rather than the browser's *not
  available*, and names the pattern
- an allowlist that does not cover the host keeps it away
- a wildcard label matches, so `127.0.0.*` admits `127.0.0.1` — the part a string compare
  would miss
- a pattern **longer** than the host does not match it, which is the other half of the
  subdomain rule
- turning the rules off brings the toolbar back

Two traps this block had to be built around, both from `CLAUDE.md` and both real:

**It runs last and restores what it changed.** The rules live in `chrome.storage.sync`,
shared by every page in the suite's single profile — a rule left behind does not just
disturb the next block, it switches the extension off for the rest of the run, and the
symptom is a `.toolbar` locator timing out somewhere unrelated. The restore is asserted
rather than assumed.

**Absence needs a timeout, not a `waitFor`.** `waitFor` on `.toolbar` in a page where the
toolbar is correctly missing is just the failure, five seconds later. The probe waits a
fixed 2.5s and then counts.

## Review follow-ups (PR #16)

Fifteen findings on the first pass. Two changed the shape of the feature rather than fixing
a line; the rest were bugs, and one of them was in the test that was supposed to catch a
bug.

### The gate was in the wrong world

**The MAIN-world inspector was still injected and still patched the page's natives on an
excluded site.** The gate lived only in `content.js`; `inspector.js` was a separate
declarative content script registered on `<all_urls>` at `document_start`, and nothing in
the first version touched it. So a user who blocklisted their bank still got `fetch`, `XHR`
and `console.error` swapped in the page's heap and request URLs buffered, and a user who
blocklisted a site *because* SenAnnotate broke its bot check still got it broken — the
`challenge-frames/` failure this feature was built to give people an answer to. It also
failed success criterion #1 in `brief.md` outright, and `context.md` had argued the same
thing as the reason not to reuse `hideUntilRestart`.

This could not be fixed with one more `if`. The MAIN world has no `chrome` object, so the
inspector cannot read the rules; and it runs at `document_start` precisely so it is in place
before the page's first request, which is also before any answer could arrive. Having the
ISOLATED side tell it to stand down at `document_idle` would mean patching first and
unpatching a moment later, and an integrity check reading `fetch.toString()` inside that
window still sees tampering — the exact failure, only narrower.

So the registration now carries the rules. `inspector.js` came out of
`static/manifest.json`'s `content_scripts` and is registered by the service worker
(`background/inspector-script.ts`) with `matches`/`excludeMatches` derived from the list;
on an excluded host Chrome never fetches the bundle. That is the only reading of "nothing is
injected at all" that is actually true. It costs the `scripting` permission, which is
justified in `store/listing-privacy.md` and listed in `PRIVACY.md`.

Two things this design had to get right, both recorded in the module banner:

- **It fails open everywhere.** An untranslatable rule list, a storage read that throws, a
  `scripting` call Chrome rejects — each ends with the inspector registered for
  `<all_urls>`, which is the pre-feature behaviour. The opposite default would turn a
  transient error into an extension that looks uninstalled on every page at once, with
  nothing on screen to say why. `onInstalled` + `onStartup` + `onChanged` + one self-heal
  call per worker lifetime is what keeps a single failed `apply` from lasting until the next
  browser restart.
- **The translation is lossy in exactly one direction.** Chrome's match-pattern host grammar
  is `*`, `host` or `*.host`, so `foo.*` and `*.example.com` have no exact equivalent. A
  pattern that cannot be expressed contributes *nothing* rather than something close:
  under-restricting is recoverable, since the ISOLATED gate still keeps the UI away, while
  over-restricting silently breaks a site the user allowed. `context.md` now says which
  shapes get the weaker guarantee.

`world: "MAIN"` is still *declarative* — `chrome.scripting.registerContentScripts` is not an
injected `<script>` tag and keeps the CSP exemption the architecture depends on. Only the
place the declaration lives moved.

### Hostname-less frames were locked out with no way back in

`about:blank` and `about:srcdoc` documents have an empty `location.hostname` even when they
are same-origin with the parent, and `isFrameWorthInstrumenting()` has always instrumented
them — rich-text editors, ad slots and a lot of widget code live in exactly those frames.
Under an allowlist every one of them evaluated to "matches nothing", and no pattern could
fix it: a frame with no host has nothing to name, so only `*` would have worked, which
defeats the allowlist. `ruleHost()` now asks the parent when this document has no host of
its own, which is not a special case — a blank frame's real origin *is* its parent's.

### Bugs

- **Rule-list edits were lost if the popup was dismissed while the textarea had focus.**
  `change` on a textarea fires on blur, and an extension popup is destroyed the moment it
  loses focus — so the commonest gesture there is, "open the popup, type `example.com`,
  click back on the page", wrote nothing and left the user believing the site was excluded.
  Now a debounced `input` (400 ms, which keeps the `sync`-quota argument that made `change`
  the right choice) plus a `pagehide` flush. The flush skips the read-modify-write on
  purpose: `pagehide` allows one synchronous call and an awaited `get` would not resolve.
- **A failed write was swallowed and then painted over with a success verdict.** `settings`
  was patched optimistically, so after the `catch` the popup re-rendered from the *unsaved*
  value and announced a rule that was not in storage. `sync` caps writes per minute, so this
  is reachable by editing the list a few times in a row. The optimistic value is now rolled
  back and the failure is stated.
- **Picking "Only these sites" wrote immediately, with the list still empty** — which
  switched the extension off on every site in one click, and `sync` carried it to every
  other machine on the account. There was no ordering in which the user could have supplied
  a pattern first, because the textarea is only enabled once the mode is stored. The mode is
  now never stored alone: it goes in together with the active tab's host, which is also the
  gesture people mean by "only these sites", and when there is no host to seed with it is
  held until the first rule arrives. The blocklist direction needs none of this — an empty
  blocklist runs everywhere.
- **In allowlist mode the popup blamed the user for pages that were the browser's.**
  `chrome://extensions`, the Web Store, a PDF viewer and `view-source:` all fail to answer
  *and* all evaluate to "not on the list", so every one of them read "Off on this site by
  your rules" and the Sites section offered a pattern that would change nothing. That
  inverted the one distinction the message exists to draw, for as long as an allowlist was
  active. `isInjectable()` gates it now, and the same test stops the allowlist being seeded
  with a host the extension could never run on.
- **The verdict was written in the present tense about a rule that needs a reload.** "is off
  here" while the toolbar was still on the page, still listening, still answering the popup.
  `refreshStatus` already knew whether a content script had answered, so it hands that over
  and the sentence says "will be off here after a reload" whenever the two disagree.
- **Any stored mode that was not `off` or `allowlist` got blocklist semantics** from a bare
  fallthrough, and nothing validates the value on the way in. The field is *synced*: a newer
  build with a fourth mode, or a garbled record, would reach an older client and be read as
  "run everywhere except these" — the inverse of what an `allowlist` user asked for. The
  union is exhaustive now and anything unrecognised reads as `off`.
- **`loadSettings()` ran twice on every allowed top-frame load.** `domainAllowsRunning`
  assigns the settings and `boot()` re-read them, so two sequential
  `chrome.storage.sync.get` round trips sat on the critical path before the overlay's first
  paint — and each can wake a sleeping service worker, so the tail is far worse than the
  median. `boot()` no longer reads.
- **The child-frame handshake could be missed entirely.** `liveFrames` is populated only by
  the child's `hello`, and the child's retry window is a fixed 1200 ms from *its* install —
  not a function of when the parent finished. Both sides now sit behind their own storage
  read and those resolve independently, so a cold service worker on the top frame outlasted
  the retries: `liveFrames` stayed empty for the life of the page, the `<iframe>` highlighted
  as one opaque box, hovering inside it never captured, and the symptom looked like a
  detector failing. The handshake is now also pull-based — the top frame sends `who` as soon
  as `onFrameDraft` is listening, and children answer `hello`. Between the two, whichever
  side is later starts the exchange.
- **The three option `hint` strings were never readable by anyone.** They rendered as
  `option.title`, and no browser shows a `title` tooltip for an `<option>` in a closed
  select; macOS's native menu does not show one open either. They were also the only place
  the popup explained what the two readings do to the *unlisted* sites, which is the part
  users get wrong — so they now render into a line of their own under the select.

### Two test findings, and both were the test's fault

- **"the popup names the pattern that decided it" could not fail.** `paintVerdict` always
  writes the host into `.verdict__host`, and the pattern under test was `127.0.0.1` — the
  same string as the host. The assertion passed with `matchingRule` broken outright and
  passed with the rule name dropped from the sentence entirely. It now asserts on
  `matches 127.0.0.*`, a pattern that is *not* the hostname, so the two are distinguishable.
- **The teardown did not restore the empty list it claimed to restore.** The block header,
  the fixture comment and the PR description all said it did. `setRules("off", "")` hit a
  `mode !== "off"` guard and skipped the `fill`, so `domainRules: ["sub.127.0.0.1"]` was left
  in `chrome.storage.sync`; only the mode was reset. Harmless only because the block runs
  last and the profile is `rmSync`'d — which is exactly why it would not have been noticed
  when a block was appended after it, and the symptom it was written to prevent is a
  `.toolbar` locator timing out for no visible reason. `setRules` now fills before selecting
  the mode, except when coming *out* of `off`, where the field is still disabled and the mode
  has to go first.

### The install race is real, and it was measured

The registration approach was signed off with one unverified risk: that
`chrome.scripting.registerContentScripts` might not be in place before the first page loads.
The reasoning at the time was that `onInstalled` fires long before a user can navigate and
`persistAcrossSessions` covers restarts, so the window looked theoretical.

**It is not.** Running the suite on this branch failed seven checks in the Vue block, all one
cause: the *first* navigation after install reports no framework, and every later navigation
reports it correctly. A two-build comparison isolates it — same page, same fixture, one
Chromium:

| Build | 1st navigation | 2nd navigation |
|---|---|---|
| declarative manifest (`main`) | `Vue 3 3.5.41` | `Vue 3 3.5.41` |
| runtime registration (this branch) | *empty* | `Vue 3 3.5.41` |

`registerContentScripts` only governs navigations that **begin** after it resolves. The gap is
worker startup + a `chrome.storage.sync` read + the call itself, and a navigation issued inside
it produces a page with no MAIN world: no framework detection, no freeze, no diagnostics.

Nothing can close it from the extension side — that is the property a declarative content
script has and a registered one does not, and it is the cost of the gate, not a bug in it. What
follows from it:

- **The suite waits for the registration** before its first fixture navigation, rather than
  reloading inside the Vue block. Every framework block needs that world, so the condition
  belongs at launch, once.
- **The product cost is one reload.** A page that loads in the moment after an install or an
  update has no inspector until it is reloaded. Already-open tabs needed a reload before this
  change too, so the new part is narrow: the window immediately *after* install. It wants a
  line in the README and a decision on whether to backfill open tabs with
  `chrome.scripting.executeScript` — which is a MAIN-world injection whose CSP standing is
  exactly what `CLAUDE.md` warns about, so it is not a change to make casually.

## Applied on the maintainer's sign-off

**`CLAUDE.md`, two lines.** The entry-branch quote now shows the real
`domainAllowsRunning().then(...)` shape, with the precondition the old text left unsaid
spelled out: a new side effect goes *inside* the `then`, because one placed beside it runs on
every page including the excluded ones — the feature defeated, silently. And
**`world: "MAIN"` is described as a declarative registration rather than a manifest entry**:
still declarative, still CSP-exempt, but declared in `background/inspector-script.ts` so the
rules can keep it off an excluded host at all, with the readiness window named and pointed
back here.

**The install race is accepted rather than engineered around**, on the maintainer's call. The
README says to reload the tab you want to work on after an install or update, framed as the
same reload an already-open tab has always needed. The alternative considered and declined was
backfilling open tabs with `chrome.scripting.executeScript` in the MAIN world: that is a
runtime injection, whose CSP standing is exactly what `CLAUDE.md` warns about, and it would
want verifying against a strict-CSP fixture before it could be trusted — a change with its own
review, not a corner of this one.
