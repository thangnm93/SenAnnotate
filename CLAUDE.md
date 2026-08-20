# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SenAnnotate — a Chrome MV3 extension: click any element on any page, annotate it, and copy a
Markdown report an AI coding agent can act on. Zero runtime dependencies; `esbuild` +
`typescript` at build time only. TypeScript `strict`, no test framework, no linter.

`README.md` is the user-facing reference (install, keybindings, framework support matrix,
production-build measurements). This file covers what you need to *change* the code.

## Commands

```bash
npm run dev          # esbuild watch → dist/ (reload the unpacked extension after each rebuild)
npm run typecheck    # tsc --noEmit — the only static gate
npm run build        # icons + three bundles + static passthrough
npm test             # build, then test/e2e.mjs and test/upgrade.mjs, headed Chromium
npm run test:upgrade # just the upgrade check, to iterate on it alone
npm run pack         # → senannotate-<version>.zip (dist/ + TESTER-GUIDE.md)
```

### Running the test suite on this machine

`npm test` needs Playwright with browsers, supplied by env var — the repo deliberately
records no default (see the header of `test/e2e.mjs` for the reasoning):

```bash
SENANNOTATE_PLAYWRIGHT_DIR=<path to playwright> npm test
```

Add `SENANNOTATE_HEADLESS=1` to run it **without a window on screen** — Chrome's *new* headless
does load extensions, run the service worker and answer `captureVisibleTab`, so all 220-odd
checks pass there. Prefer it when someone is using the machine: the default headed window
takes the screen and the keyboard focus for the whole run. It needs `channel: "chromium"`
alongside `headless: true`; the three launch sites set that themselves.

`SENANNOTATE_VUE_GLOBAL` is only needed on a fresh checkout —
`test/fixtures/vendor/vue.global.js` is gitignored but cached once copied.
`SENANNOTATE_PNPM_STORE` is only for `test/build-prod-fixtures.mjs`.

**There is no single-test filter.** `test/e2e.mjs` is one sequential `main()` driving ~220
`check()` assertions across a shared browser context; to iterate on one area, comment out the
page blocks above it. Extensions need a persistent context, which is why the launch is
`launchPersistentContext` and not `launch`.

`test/upgrade.mjs` is the one check that cannot live in that suite: it needs **two** launches
over one profile directory, with the version in `dist/manifest.json` bumped between them, to
observe a real upgrade. `chrome.runtime.reload()` is not a substitute — Chrome drops an
extension loaded with `--load-extension` when it calls that, and every later navigation to it
fails `ERR_BLOCKED_BY_CLIENT` (`docs/upgrade-persistence/`).

Two extra checks are kept out of the suite because each needs something it cannot guarantee:
`npm run verify:sites` (network) and `npm run verify:tracer` (a Nuxt dev server on :3005, and
`TMPDIR=/tmp/nx` on macOS or vite-node's socket path silently exceeds 104 bytes).

## Architecture

Frameworks write their metadata (`__vueParentComponent`, `__reactFiber$…`, `__svelte_meta`)
as JS properties on DOM nodes, and Chrome gives each isolated world its own view of those.
That single fact forces the three-context split:

| Bundle | World | Entry | Owns |
|---|---|---|---|
| `inspector.js` (IIFE) | MAIN, `document_start` | `src/inspector/` | framework detectors, motion freeze, diagnostics capture |
| `content.js` (IIFE) | ISOLATED, `document_idle` | `src/content/` | shadow-DOM UI, element identification, storage, clipboard, screenshot crop |
| ↳ same bundle, child frames | ISOLATED, `document_idle` | `src/content/frames.ts` | highlight + capture only; hands drafts up to the top frame |
| `background.js` (ESM) | service worker | `src/background/` | `captureVisibleTab`, toolbar badge, keyboard command |
| `popup.js` (IIFE) | popup page | `src/popup/` | settings |

`src/shared/` is the only code all four import: `types.ts`, `protocol.ts` (wire protocol +
storage keys), `output.ts` (the Markdown report), `archive.ts` (export/import), `accent.ts`
(the accent colour and the two shades derived from it). Nothing in `popup/` or `background/`
may import from `content/` — that inversion is what put `archive.ts` in `shared/` rather than
next to `content/storage.ts`, and it is why `accent.ts` returns colours rather than CSS
variable names: the overlay calls them `--sa-accent*` and the popup calls them `--accent*`.

**Both content scripts run with `all_frames: true`.** `src/content/index.ts` therefore
ends in a branch, and it is the most important line in the file:

```ts
if (isTopFrame()) installTopFrame();
else if (isFrameWorthInstrumenting()) installChildFrame(() => settings);
```

Everything with a side effect — `createUiRoot()`, the three UI constructors,
`chrome.runtime.onMessage`, every `listen()`, `boot()` — lives inside `installTopFrame()`
for that reason. Adding a new module-scope `listen(...)` or constructor to that file
puts it in every iframe on the page: a second toolbar, a second answer to the popup's
`get-status`, a second owner of the annotations. Put it inside `installTopFrame()`.

Rules that fall out of this and are easy to violate:

- **`world: "MAIN"` is declared in the manifest, never injected at runtime.** Declarative
  content scripts are exempt from the page's CSP; an injected `<script>` is not.
- **The inspector must not snapshot anything at module load** — it runs before the app mounts.
  It is purely reactive: it sits on the bridge and answers.
- **Freeze and diagnostics have to live in MAIN.** Patching `setTimeout` from ISOLATED patches
  only that script's own timers; the page's animation loops are in another heap.
- **DOM nodes cannot cross `postMessage`.** The content script stamps the target with
  `data-senannotate-probe="<id>"` (reference-counted — a hover lookup and a click capture can
  be in flight on the same element) and sends the id; the inspector re-resolves via
  `querySelector`. Bridge RPC times out at 500 ms and resolves `null`.
- **The content script mirrors the diagnostics buffers.** Copying a report must not `await`
  before touching the clipboard — an await spends the click's user activation and
  `navigator.clipboard.writeText` silently stops working.
- The whole overlay lives in one `pointer-events: none` shadow host attached to
  `documentElement` (not `body`, which an app may replace), marked `data-senannotate-ui` so
  freeze CSS and hit-testing can exclude it.

### Adding or changing a framework detector

`src/inspector/detectors/index.ts` is the only module that knows which frameworks exist.
Adding one should mean **one new file implementing `FrameworkDetector` + one line in
`DETECTORS`**. If it forces edits to `shared/output.ts`, `content/ui/toolbar.ts` or
`content/source.ts`, the abstraction has leaked — fix that instead of working around it.

`detect()` and `inspect()` must not throw, and must return `null` when the framework does not
own the page/element so the dispatcher can try the next one. Returning a mostly-empty object
stops the search — that is what would break a Vue island inside a React page. Detection is
per-element by design; the page-level answer only picks which detector to try first.

`src/content/identify.ts` (labels, selectors, DOM paths) reads only the DOM, needs no bridge
round-trip, and works identically with no framework at all. Keep it that way.

## Conventions and traps

- **Version lives only in `package.json`.** `build.mjs` stamps `dist/manifest.json` from it, so
  the `"version"` in `static/manifest.json` is dead and will look stale — do not "fix" it there.
- **Every module opens with a banner comment explaining *why*, not what.** Match that density;
  the comments are load-bearing documentation here, not decoration.
- **The e2e suite asserts on shadow-DOM class names** (`.tool--brand`, `.composer`,
  `.stack-badge`, `.toolbar-hint`, `.count`, …) *and* on the exact text of `.toolbar-hint`.
  Renaming a class — or rewording a hint — in `src/content/ui/` breaks tests that look
  unrelated.
- **A fixture another block annotates cannot carry a count assertion.**
  `chrome.storage.local` is shared across every page in the suite's single browser context
  and annotations are keyed on `origin + pathname`, so a page opens with whatever an earlier
  block left on it. Four assertions failed exactly this way in 0.6.0
  (`docs/annotation-triage/changelog.md`); the fix is a fixture of your own.
- **Never call a permission-gated API from the extension popup in the suite.**
  `context.grantPermissions(…, { origin: base })` covers the fixture origin, not
  `chrome-extension://`, and `navigator.clipboard.readText()` there raises a prompt nothing
  answers — the suite *hangs* rather than failing. Drive the popup, observe from a page.
- **Our UI must never deliver pointer events, or take focus, from the page.** `createUiRoot`
  stops nine pointer event types plus `focusin`/`focusout` at the shadow host, and cancels
  `mousedown` (text fields exempted) so a click takes no focus. Without these a toolbar click
  reads as an "outside click" and dismisses the page's modal, or trips its focus trap into
  stealing the composer's keystrokes (`docs/modal-click-leak/`, `docs/modal-focus-leak/`).
  Keyboard events and `pointermove` are deliberately excluded. `paste` is stopped too, but in
  the composer rather than at the host, because only the composer has a paste handler — so the
  host's list is not the whole story, and a reader counting it will miss one.
- **An event our UI handles must be *stopped* before it reaches `document`, and
  `preventDefault` is not that.** Cancelling the default action still lets the page's own
  listener run and see a paste, a click or a focus change that was never the page's business.
  This is the shape behind `docs/modal-click-leak/`, `docs/modal-focus-leak/` and the
  reference-image paste — three occurrences, so assume the next new input surface in the
  overlay has it too until a test says otherwise. `stopPropagation` first and unconditionally;
  decide about `preventDefault` afterwards.
- **`waitForFunction` cannot observe a frozen page.** Freeze parks `requestAnimationFrame`
  *and* `setTimeout`, so any in-page polling loop — including Playwright's, whichever
  `polling` you pass — is held by the state it is waiting for. Use a Node-side
  `waitForTimeout` plus one `evaluate`.
- **Privacy guarantees have tests and must not regress:** field *values* are never recorded
  (the trail says `Edited Password`), request/response bodies are never recorded, and
  credential-looking query params are `[redacted]` before storage.
- Annotations are keyed on `origin + pathname` — query string deliberately excluded. Settings
  go in `chrome.storage.sync`, annotations in `local`. Both keys live in `shared/protocol.ts`
  because the popup needs the same strings.
- Chrome 111 minimum (`world: "MAIN"`); esbuild targets `chrome111`.

## Opening an issue or a pull request

`.github/` holds the templates. **Fill the existing one in — do not invent a structure.**
An agent writing its own PR body is the most common way the four rules below get skipped,
because a body you wrote yourself never asks you the question you did not think of.

**Pull requests.** `.github/PULL_REQUEST_TEMPLATE.md` pre-fills the body in the web UI,
and `gh pr create` pre-fills its editor from it too — but **only when it runs
interactively**. An agent passing `--body` or `--body-file` bypasses it entirely, which
is exactly the path an agent takes, so start from the file on purpose:

```bash
gh pr create --body-file .github/PULL_REQUEST_TEMPLATE.md   # then edit
# or: cp it to a scratch file, fill it in, pass that
```

Keep every heading and every checklist item, including the conditional sections; delete a
section only when the change genuinely does not touch it. Tick a verification box **only
after running the command** — an unticked box is information, a wrongly ticked one is a
false claim to a reviewer, and `npm test` in particular cannot be inferred from a green
CI tick.

**Issues.** `.github/ISSUE_TEMPLATE/` holds three YAML forms — bug, framework detection,
feature. `gh issue create --template <name>` uses one; if the gh version in front of you
will not take a YAML form, read the file and answer every field it asks for. The required
fields are required because triage stalls without them: the version, the install route,
and whether the page is a production build. `blank_issues_enabled` is `false` on purpose.

**The four things the PR template exists to stop.** They are in the template; they are
here because an agent that reads this file may not open the template first:

1. **A commit subject is a release note.** `CHANGELOG.md` is generated from Conventional
   Commit subjects between tags — see *Releasing* below.
2. **A green CI tick is not a test run.** CI is typecheck + build + pack. `npm test`
   needs a browser and never runs there; run it yourself and say so.
3. **`docs/<task-slug>/` is expected** on anything non-trivial, and reviewers read it.
4. **Three modules carry a licensing constraint** — the next section.

Conventions the template checks: branch `feature/<slug>`, `fix/<slug>` or `chore/<slug>`;
Conventional Commit subjects; no version bump (releases are their own commit); no
hand-edited `CHANGELOG.md`; `wiki/` updated when user-visible behaviour changed.

`.github/CONTRIBUTING.md` is the prose version of all of this, and the wiki's
*Development* page has the traps.

## Licensing constraint

The project began as a port of [`agentation`](https://github.com/benjitaylor/agentation), which
is **PolyForm Shield** — source-available, not open source. Three modules were reimplemented
from scratch in 0.3.1 so this repo could be MIT. **Do not consult or copy upstream
`agentation` source** when working on `content/identify.ts`, `inspector/freeze.ts` or
`shared/output.ts`. See `NOTICE.md`.

## Releasing

CI (`.github/workflows/ci.yml`) runs typecheck + build + pack on every push to `main` and
attaches the zip as a 14-day artifact. It deliberately does **not** run `npm test` — a runner
has nothing to point the env vars at, and the suite needs a headed browser. `npm test` is a
manual gate before tagging (`docs/ci-cd/context.md` has the full argument).

```bash
npm test                                    # 1. run it yourself
# edit "version" in package.json            # 2. the only place that matters
npm run changelog                           # 3. regenerate CHANGELOG.md
git commit -am "chore: release 0.6.0"
git tag v0.6.0 && git push && git push --tags   # 4. commit first, then the tag
```

`release.yml` refuses to release if the tag and `package.json` disagree, before installing
anything. To fix: correct `package.json`, then
`git tag -d v0.6.0 && git push origin :refs/tags/v0.6.0`.

It refuses for a second reason too: `node scripts/changelog.mjs --extract "$TAG"` runs in the
same pre-install position, and exits non-zero when `CHANGELOG.md` has no section for the tag.
Forgetting step 3 costs a deleted tag, not a bad release.

**`CHANGELOG.md` is generated — never edit it.** `scripts/changelog.mjs` rebuilds the whole
file from the tags and the Conventional Commit subjects between them, so a hand edit survives
until the next release and no longer. The consequence worth internalising: **a commit subject
is a release note.** `feat: screenshot markup, hover capture, triage, session reports and
iframes` ships verbatim, as one bullet, for five features. Write the subject you would want to
read in the release.

The generator strips two kinds of bookkeeping from subjects — a trailing `; 0.5.3`, and a
`release <version>` prefix on a `chore:` — and drops a commit whose subject is *only* the
version bump. Anything it cannot parse lands in an `Other` section; if that section ever
appears, the fix is the commit message, not the generator.

## Design record

`docs/` is one folder per task (`brief.md`, `context.md`, `plan.md`, `changelog.md`), written
during the work — the changelogs include what went wrong and which assumptions turned out
false. **Read `docs/README.md` first**; it says which folder covers what and gives a reading
order. `docs/history/vuetation/context.md` is the best explanation of the three-world split and
ranks the four Vue source-resolution strategies best-to-worst.

Some of these files also exist as copies at the monorepo root and can drift — the copy in this
repo is canonical.
