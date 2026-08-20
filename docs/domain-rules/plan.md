# Plan

Matcher first, because it is the only part with interesting behaviour and the only part
that can be reasoned about without a browser.

1. **`src/shared/domain-rules.ts`** — `DomainRuleMode`, `DOMAIN_RULE_OPTIONS`,
   `parsePattern`, `hostMatchesPattern`, `matchingRule`, `evaluateHost`, `parseRuleList`.
   Pure: no `location`, no `chrome`, no DOM. In `shared/` because the content script and
   the popup both need the same verdict and neither may import from the other.

2. **`src/shared/types.ts`** — `domainRuleMode: DomainRuleMode` and
   `domainRules: string[]` on `Settings`; `"off"` and `[]` in `DEFAULT_SETTINGS`, so an
   upgrade changes nothing about where the extension runs.

3. **`src/content/index.ts`** — `domainAllowsRunning()` loads settings and evaluates
   `location.hostname`. The entry branch becomes async: the top frame installs only if
   allowed, and a child frame is judged on **its own** host. Nothing is built when the
   answer is no — not built-and-hidden.

4. **`static/popup.html`** — a `Sites` section: the mode `<select>`, a monospace
   `<textarea>` for the list, the syntax hint, and a `.verdict` line. Styles for
   `.rules` and `.verdict`, including the tinted `[data-state="off"]`.

5. **`src/popup/index.ts`** — paint the mode and list, save on `change` (not per
   keystroke — `sync` is quota'd per minute), and a read-modify-write so the settings
   card's fields survive. `activeTabHost()` reads the hostname off the tab's URL rather
   than asking the content script, because the case being described is the one where no
   content script exists. `refreshStatus` distinguishes "off by your rules" from the
   browser's own "not available".

6. **`test/e2e.mjs` + `test/fixtures/rules.html`** — a block that drives the popup and
   asserts on the *absence* of a toolbar. **Last in the run**, restoring `off` and an
   empty list, and asserting the restore worked: the rules are in
   `chrome.storage.sync`, so one left behind switches the extension off for every later
   block and the symptom is an unrelated `.toolbar` timeout.

7. **Docs** — `brief.md`, `context.md`, this file, `changelog.md`, the `docs/README.md`
   entry, and a README section under *Use*.

## Things to get right

- **Fail open.** A storage error must leave the extension working, or it looks like an
  uninstall on every page at once.
- **No HTML sink.** The verdict line is built with `createElement` +
  `replaceChildren()`; `ui/dom.ts` offers `text` and deliberately no `html`, and the
  popup should not be the place that breaks that.
- **`*` is one label.** The greedy reading would let an allowlist entry match more hosts
  than it looks like it does.
- **The textarea is not rewritten while it has focus**, or the caret jumps to the end on
  every repaint.
