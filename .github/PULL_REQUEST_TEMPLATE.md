<!--
  Thanks for the PR.

  Two things about this repo that are easy to miss, and expensive to get wrong. Both are
  in the checklist below; they are repeated here because the checklist is easy to tick
  without reading.

  1. YOUR COMMIT SUBJECT IS A RELEASE NOTE. CHANGELOG.md is generated from Conventional
     Commit subjects between tags — your subject ships verbatim to users and cannot be
     edited afterwards.

  2. A GREEN TICK DOES NOT MEAN THE TESTS PASSED. CI runs typecheck + build + pack. The
     Playwright suite needs a browser and never runs there — you have to run it.
-->

## What and why

<!-- What changes, and the problem it solves. If there is a linked issue, "Closes #12". -->

## Design record

<!--
  Every non-trivial change gets docs/<task-slug>/ with brief.md, context.md, plan.md and
  changelog.md, written during the work — that is where the reasoning lives, including
  what went wrong. Link it here so a reviewer has the context.

  Not required for a typo or a one-line fix. Required for a feature, a bug fix of any
  substance, a refactor touching 3+ files, or a dependency change.
-->

`docs/<task-slug>/`

## How it was verified

<!-- What you actually ran and what you actually saw. "Should work" is not a line item. -->

- [ ] `npm run typecheck` — the only static gate in this repo
- [ ] `npm test` — **CI does not run this.** Needs a browser:
      `SENANNOTATE_PLAYWRIGHT_DIR=<dir with playwright + browsers> npm test`
      (add `SENANNOTATE_HEADLESS=1` to keep your screen)
- [ ] Loaded the built `dist/` unpacked in Chrome and used the thing that changed
- [ ] N/A — docs, comments or CI only

## Screenshots

<!-- Required for any change to src/content/ui/. Before and after if you changed something that existed. -->

---

## Checklist

- [ ] **Branch** is `feature/<slug>`, `fix/<slug>` or `chore/<slug>`
- [ ] **Commit subjects are [Conventional Commits](https://www.conventionalcommits.org/)**
      (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`) **and read as release
      notes** — `CHANGELOG.md` is generated from them, so the subject is what users see
- [ ] No debug statements — no `console.log`, no commented-out code
- [ ] New or changed modules open with a banner comment explaining **why**, not what —
      match the density of the file next to it
- [ ] `CHANGELOG.md` **not** hand-edited (it is generated; the next release overwrites it)
- [ ] Version **not** bumped — releases are a separate commit, and `package.json` is the
      only place a version lives

### If you touched the UI in `src/content/ui/`

- [ ] I know the e2e suite asserts on shadow-DOM **class names** (`.tool--brand`,
      `.composer`, `.stack-badge`, `.count`, …) **and on the exact text of
      `.toolbar-hint`** — a rename or a reworded hint breaks tests that look unrelated

### If you added an e2e block

- [ ] It uses **its own fixture** if it asserts on a count. `chrome.storage.local` is
      shared across the suite's single browser context and the notes list is per origin,
      so a shared fixture opens with whatever an earlier block left on it (`at("x.html")`
      in `e2e.mjs` gives each fixture file an origin of its own)
- [ ] It does not call a permission-gated API from the extension popup — the grant covers
      the fixture origin, not `chrome-extension://`, and the suite **hangs** rather than
      failing

### If you touched `static/manifest.json`

- [ ] I did not "fix" the `"version"` there — it is dead; `build.mjs` stamps
      `dist/manifest.json` from `package.json`
- [ ] **If this adds a permission:** the Chrome Web Store manual review restarts (days,
      not minutes), and `PRIVACY.md` plus `store/listing-privacy.md` both need a
      justification block — a permission without one gets the version rejected

### If you touched `content/identify.ts`, `inspector/freeze.ts` or `shared/output.ts`

- [ ] **My work was not informed by upstream
      [`agentation`](https://github.com/benjitaylor/agentation) source.** It is PolyForm
      Shield — source-available, not open source. These three modules were reimplemented
      from scratch in 0.3.1 so this repo could be MIT. See
      [`NOTICE.md`](../blob/main/NOTICE.md)

### If you changed behaviour a user can see

- [ ] The [wiki](https://github.com/thangnm93/SenAnnotate/wiki) is updated — its source
      is [`wiki/`](../tree/main/wiki) in this repo, not the wiki repository
- [ ] `README.md` is updated if it stated the old behaviour

<!--
  New here? .github/CONTRIBUTING.md has the whole picture, and the wiki's Development
  page covers the traps: https://github.com/thangnm93/SenAnnotate/wiki/Development
-->
