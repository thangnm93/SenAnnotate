# SenAnnotate

A Chrome extension that turns "fix the blue button in the sidebar" into a report
your AI coding agent can act on without guessing.

Click any element on **any** website, type a note, and copy a Markdown report
naming the element, its DOM path, a re-resolvable selector, and — with diagnostics
on — the console errors, failed requests and steps that led there. No
`npm install`, no code in your bundle: it works against local dev, staging and
production, on any stack.

It also **measures** and, since the CSS editor, **changes** the page. Neither is the
point on its own — both exist to make the report less vague. A note that says *"too
tight"* becomes `**Gap:** 24px horizontal`; a note that says *"try more padding"* becomes
`- \`padding\`: \`8px 12px\` → \`12px 20px\``, which is the instruction with the
guessing already removed. Everything beyond annotating is **off by default**, behind two
switches in settings.

When the page is built with **Vue, React, Svelte or Angular**, the report gains two
more lines for free: the component ancestry, and the source file that rendered the
element — as precisely as `src/components/BaseButton.vue:12:5` where the framework
records it. Nothing requires any of them; see [Framework support](#framework-support)
for what each one can actually give you.

The idea comes from [`agentation`](https://github.com/benjitaylor/agentation) by Benji
Taylor, which does the same job for React as an npm component you import into your app.
This project started as a Vue-oriented answer to it and has since been reimplemented —
see [`NOTICE.md`](./NOTICE.md) for the provenance, which is worth reading before
vendoring any of this.

MIT licensed. See [`LICENSE`](./LICENSE).

**[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/senannotate-%E2%80%94-visual-anno/nfplcbaoccfdgfpbkjiigfdpmjphbjla)**

---

## What it looks like

Hovering names the component and the file that rendered it, before you commit to
anything:

![Inspect mode: the hovered element labelled with its component and source line](./store/screenshots/inspect.jpg)

Clicking opens the composer, already carrying the element, its source, the component
chain and the owner's props — you only supply the sentence, and the type:

![The composer, showing element, source, component chain, props and the type chips](./store/screenshots/composer.jpg)

The panel is the list, the filter, and the button that produces the report:

![The annotations panel with the All/Open/Done filter and captured diagnostics](./store/screenshots/panel.jpg)

Drag-select takes everything a box fully contains, at the shallowest level contained:

![Marquee selection across three cards, counted live under the toolbar](./store/screenshots/marquee.jpg)

The camera on the composer crops the element and opens a markup editor first, so the
image you attach points at the thing you mean — box, arrow, or a blur that is permanent:

![The markup editor over a cropped screenshot, with a box drawn on it](./store/screenshots/markup.jpg)

Settings live on the toolbar, next to the work: how much detail the report carries,
whether errors and steps are captured, the accent colour, and a per-tab way out:

![The settings card, showing the report, bug-report, behaviour and appearance groups](./store/screenshots/settings.jpg)

And this is what comes out — the thing you paste into your agent:

![The generated Markdown report](./store/screenshots/report.jpg)

---

## Install

**Chrome 111 or newer.** The Web Store listing is the route for everyone who is not
changing the code.

### From the Chrome Web Store

[**SenAnnotate — visual annotator**](https://chromewebstore.google.com/detail/senannotate-%E2%80%94-visual-anno/nfplcbaoccfdgfpbkjiigfdpmjphbjla)
→ **Add to Chrome**. It updates itself from there; nothing below is needed.

### From a release — no Node, no build

For a version newer than the Store has reviewed, or for an air-gapped machine.

1. Download `senannotate-<version>.zip` from the
   [latest release](https://github.com/thangnm93/SenAnnotate/releases/latest).
2. Unzip it into a folder you intend to **keep** — not `Downloads`, which gets
   swept. Chrome loads the extension off disk on every launch, so moving or
   deleting that folder breaks it.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**, top-right.
5. Click **Load unpacked** and choose the unzipped folder — the one with
   `manifest.json` directly inside it.

An orange **S** appears in the toolbar. That is the whole install.

### From source — for working on the extension

```bash
npm install
npm run build
```

Then steps 3–5 above, choosing the `dist/` folder instead of an unzipped one.

### If you installed unpacked

Neither of these applies to the Web Store install.

**Chrome will nag.** A "Disable developer mode extensions" popup appears on every
launch. Click **Cancel**, not Disable. Chrome shows it for any unpacked extension;
nothing is wrong.

**To update:** replace the files in the same folder, click ⟳ on SenAnnotate's card
in `chrome://extensions`, then reload the tabs you had open — the old content
script is still running in them until you do.

Handing this to someone who does not write code? Point them at the
[Web Store listing](https://chromewebstore.google.com/detail/senannotate-%E2%80%94-visual-anno/nfplcbaoccfdgfpbkjiigfdpmjphbjla).
[`TESTER-GUIDE.md`](./TESTER-GUIDE.md) covers the reporting workflow itself, in
English and Vietnamese.

### Getting line numbers out of a Nuxt project

One optional setting, in *your* app rather than the extension. `@nuxt/devtools`
already bundles the tracer, so there is nothing to install — just make sure
DevTools is on in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  devtools: { enabled: true },   // often left off — check yours
})
```

With it off you still get the component ancestry and the `.vue` file, just not
the line and column.

## Use

| | |
|---|---|
| Toggle inspect mode | click **Inspect**, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> |
| Annotate an element | click it |
| Annotate what you are hovering | <kbd>C</kbd> — no click, so the menu stays open |
| Fix a mis-click | arrow keys while the note is empty, or its ↑ ↓ ← → buttons at any time |
| Annotate some text | mode <kbd>2</kbd>, then select the text |
| Annotate several elements near each other | <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+drag a box around them — or mode <kbd>3</kbd> and drag |
| Annotate several elements anywhere | <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+click each one, then click the last normally — or <kbd>Enter</kbd> |
| Measure the gap between two elements | switch on **Measuring tools** in settings, then mode <kbd>4</kbd>: click one, then the other |
| See an element's size, padding, margin, type and colours | **Box model on hover** in settings — or just enter mode <kbd>4</kbd> |
| Check a contrast ratio | hover anything with text once measuring is on — the verdict is on the panel and in the report |
| Rulers, guides and a column grid | **Screen rulers and guides** / **Layout grid** in settings. Drag out of a ruler to place a guide |
| Sample a colour anywhere on screen | the ⬥ button, once measuring is on — the hex is copied for you |
| Change an element's CSS on the page | switch on **Live CSS editor** in settings, then mode <kbd>5</kbd> and click it |
| Nudge a CSS number | <kbd>↑</kbd>/<kbd>↓</kbd> in a value — <kbd>Shift</kbd> by 10, <kbd>Alt</kbd> by 0.1 |
| See or undo everything you changed | the **Changes** tab on the CSS card — copy it, or revert one property or all of them |
| Freeze animations | <kbd>F</kbd> |
| Open the list | <kbd>A</kbd> |
| Open settings | the gear on the toolbar |
| Hide the overlay on this tab | **Hide until restart** in settings — back on any other tab, or when this one is closed |
| Collapse the toolbar | <kbd>H</kbd>, or the `»` button — this also leaves inspect mode and closes the open card |
| Move the toolbar | drag it anywhere |
| Copy the report | **Copy report** in the panel |
| Save the report as a file | **.md** in the panel |
| Copy every page at once | **Copy session report** in the extension popup |
| Cancel / exit | <kbd>Esc</kbd> — closes the innermost thing first: tooltip, then the open card, then a half-built pick set or measuring anchor, then the panel, then inspect mode |

The line under the toolbar always names what the current mode does and which keys
switch to the others, so nothing above needs memorising. Every button on the pill names
itself on hover — and on keyboard focus — so the icons do not have to be learned either.

<kbd>C</kbd> is the one worth knowing about. Clicking is how you annotate, and clicking
is also what closes the thing you wanted to annotate — a dropdown, a hover menu, a
tooltip, anything styled `:hover`. <kbd>C</kbd> captures whatever the pointer is over
without pressing anything, so the menu is still open while you type the note. Freeze
does not help here: it parks timers and animation frames, and those surfaces are driven
by pointer events rather than by time.

Mode <kbd>4</kbd> is the other one worth knowing, and it is **off by default** —
switch on *Measuring tools* in settings to get it. Most UI feedback is a claim about a
number — *too tight*, *not aligned*, *wrong size* — and typing that claim in prose
leaves the reader to re-derive the geometry from a screenshot. Click one element, hover
a second, and the gap is drawn between them with the figure on it; click again and the
note carries `**Gap:** 24px horizontal` into the report. Hovering alone costs nothing,
so reading a number never creates an annotation. Figures keep two decimals: a `0.5px`
seam reports as `0.5px` rather than rounding to nothing.

The toolbar is docked bottom-right, which is exactly where a page tends to put its
chat widget, cookie bar or footer actions. <kbd>H</kbd> collapses it to a single dot
that still carries the annotation count.

Collapsing means *get out of the way*, not merely *get smaller*: it leaves inspect mode
and closes whichever card is open. A toolbar you have just dismissed that is still
swallowing every click — so the next one opens a composer for no reason the screen can
explain — is the thing that behaviour exists to prevent. Expanding gives none of it
back; <kbd>H</kbd> asks for the toolbar, so <kbd>H</kbd> returns the toolbar. Freeze is
untouched, because it is a property of the page rather than of the toolbar.

The collapsed state is a setting rather than a session flag, so a reload does not put
the pill back over the corner you were looking at. <kbd>H</kbd> works whether or not
inspect mode is on, unlike the mode keys.

If collapsing is not enough — the corner itself is what you need to look at — **drag
the toolbar anywhere**. Grab it by any part of the pill, buttons included; a press
that travels more than a few pixels moves it instead of clicking it.

The position is remembered **per page**, the same way annotations are: move it out of
the way of the checkout page's order summary and it stays there on that page, while
every other page keeps the default corner. It is clamped back into view if you later
open the same page in a narrower window.

Dragging a box selects **everything it fully contains**, at the shallowest level
contained — draw around three cards and you get three cards, not the `<div>`s
inside them. Hold <kbd>⌘</kbd>/<kbd>Ctrl</kbd> and drag to do it without leaving the
default mode; the box only starts once the pointer has actually moved, so a modifier
click with a shaky hand still collects a single element rather than drawing a box. Elements the box merely clips are left out. The selection is
highlighted live while you drag and counted in the line under the toolbar, so you
can adjust before letting go.

When the things you mean are nowhere near each other — a badge in the header, a label in
the form, a button in the footer, all the wrong grey — <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+click
them one at a time instead. Each stays highlighted and the count sits under the toolbar;
clicking one again takes it back out. Finish by clicking the last element normally, which
adds it and opens the composer, or by pressing <kbd>Enter</kbd> to take the set as it
stands. <kbd>Esc</kbd> drops the set without leaving inspect mode. On macOS use
<kbd>⌘</kbd>: <kbd>Ctrl</kbd>+click there is a right-click.

Annotations are stored per `origin + pathname`, so they survive a reload and come
back when you return to the same screen. Settings and notes both survive an upgrade —
Chrome keeps them, and the storage keys have not moved since 0.2.0.

**Accent colour.** The extension is orange by default; the settings card's *Appearance* section
has six presets, a picker for an exact brand colour, and a Reset. The colour applies to the highlight,
the toolbar, the pins, the count badge on the extension icon, the popup itself, and the boxes and
arrows you draw on a screenshot — live, in every open tab. Screenshots you already saved keep the
colour they were drawn in. The text-on-accent shade is derived from the colour's brightness, so a
dark colour gets light text rather than unreadable dark-on-dark.

**Settings.** The gear on the toolbar opens them, next to the page they describe rather
than behind the extension icon: detail level, which components get named, props,
screenshots, diagnostics, pins, freeze-on-inspect, clear-after-copy, theme and accent. Each row carries a
`?` explaining what it does, because a setting whose effect you have to guess is one you
leave alone. They apply everywhere, so you set them once.

The one place this costs something: on `chrome://` pages, the Web Store and the PDF
viewer the extension has no toolbar, so there is nothing to open — including for theme
and accent, which are otherwise global. Open any ordinary page instead.

**Hide until restart** is the exception to "set it once": it is per-tab, not a
preference. Turn it on and the overlay disappears from *this* tab — reloads included —
and stays gone until you close the tab; every other tab is untouched. It is for the
moment a demo or a screen-share needs the page clean without turning the extension off
everywhere. The card's footer shows which version you are running, so a bug report can
name it.

**Clear after copy** is off by default. Turned on, the page's notes are emptied once a
copy has actually reached the clipboard — not merely once you asked for one — so the next
round starts clean. It drops the action trail and the diagnostics with them, exactly as
*Clear all* does.

**Modals and dialogs** are annotated like anything else, including the two shapes that
used to be impossible: a `showModal()` dialog, which Chrome paints in its *top layer*
above every z-index and makes everything outside it inert, and a library dialog with a
focus trap — Reka UI, Radix and Headless UI all restore focus when it leaves the dialog,
which silently swallowed everything typed into the composer until 0.8.1.

One case is left, and it is unavoidable: a dialog that closes when focus leaves it closes
when the composer opens, because typing requires focus. The annotation is captured before
the composer appears, so the element, its selector, its component chain and the report are
complete either way.

## Triage

Each note carries a **type** — Bug, UI, Copy, Question — picked in the composer, and a
**status** you tick off in the panel once it is fixed. The type reaches the report
heading (`### 1. [bug] button "Save"`); a done note moves out of the numbered list into
an `## Already fixed` section rather than disappearing, because "this was already
handled" is context worth having.

The panel filters by `All · Open · Done`, and the pins take a colour per type.

Notes are only in `chrome.storage.local` until you move them, so the popup offers
**Export** and **Import**: every page's notes as one JSON file, for a backup before
*Clear all*, for handing a review to someone else, or for moving between machines.
Import merges — it never replaces what is already there.

## Screenshots

The camera button in the composer photographs the element and opens a small editor
first: **box**, **arrow**, and **blur**. Blur resamples the region rather than filtering
it, so the pixels are genuinely gone from the saved file — which matters, because a
tester photographing a real screen is photographing real customer data.

How the shot reaches the report is a setting:

| | |
|---|---|
| **Link to the saved file** (default) | the report names `~/Downloads/senannotate-….png`, which a coding agent opens with its own file tool. Costs a few dozen bytes. |
| **Embed in the report** | a downscaled JPEG goes into the Markdown as a `data:` URI, so the report survives a paste into Slack or Jira. Around 60–120 KB a shot. |

The PNG is saved either way.

## Iframes

Elements inside an iframe are annotated like any other — a Storybook preview, an
embedded dashboard, a hosted checkout. The extension runs inside frames too, and hands
each capture up to the top frame, which owns the toolbar and the storage. The report
names which frame the element came from.

Frames smaller than 50×50 are skipped entirely, so the tracking pixels and empty ad
slots on a news page cost nothing. Three limits worth knowing:

- a pin placed inside a frame does not follow that frame's *own* scrolling — the
  report is unaffected;
- a frame nested inside another frame falls back to annotating the outer `<iframe>`;
- drag-select (mode <kbd>3</kbd>) stops at the frame boundary. Click and text
  selection work inside frames; the marquee does not.

## What the report looks like

```markdown
## Page feedback: /dashboard
**Stack:** Vue 3 3.5.35 · pinia  ·  **Viewport:** 1512×860

### 1. [bug] button "Save changes"
**Source:** src/components/BaseButton.vue:12:5
**Components:** <App> <TheSidebar> <BaseButton>
**Location:** .sidebar > .base-button
**Screenshot:** ~/Downloads/senannotate-1763029180000.png
**Feedback:** Make this the primary action and move it above the divider.
```

Four detail levels, chosen in the panel or the settings card:

| Level | Adds |
|---|---|
| Compact | one line per note |
| Standard | source file, component ancestry |
| Detailed | selector, props, classes, bounding box, nearby text |
| Forensic | full DOM path, computed styles, accessibility, environment |

## Framework support

Annotating works on **any** page. What a framework adds is the component ancestry and
the source location — and how much of that is available differs a lot by framework,
because each records different things. Rather than flatten them to a lowest common
denominator, the report carries what is actually there:

| | Components | Source | Props |
|---|---|---|---|
| **Vue** 2, 3, Nuxt 2, 3/4 | ✅ | `file:line:col` with the tracer, filename otherwise | ✅ |
| **Svelte**, SvelteKit | ✅ from `loc.file` | ✅ `file:line:col`, no plugin needed | ❌ |
| **React**, Next.js | ✅ | `file:line:col` on React ≤18; **none on React 19** | ✅ |
| **Angular** | ✅ | ❌ none — Angular records no authoring positions | ✅ |

Detection is **per-element**, so a page mixing frameworks — a Svelte widget in a React
app, a Vue island in server-rendered markup — works. A page with no framework at all
simply reports no component data, with no badge and no warning.

On a **production build** names and paths are stripped in every framework. The toolbar
badge turns amber and says so rather than quietly emitting a weaker report; you still
get selectors, DOM paths, classes and computed styles.

<details>
<summary>How each framework is read, and why</summary>

**Vue** — four strategies, best first:

1. **`vite-plugin-vue-tracer`**, what current Nuxt DevTools (v3+) ships. Writes
   **nothing to the DOM**; positions live in a global WeakMap,
   `globalThis.__vue_tracer__.vnodeToPos`, keyed by each vnode's `props` object. Exact
   file, line and column. Requires `devtools: { enabled: true }`.
2. **`data-v-inspector`**, from the older `vite-plugin-vue-inspector`. Exact, readable
   straight off the DOM. Nuxt has since moved off it.
3. **`__file`** on the component options — any dev build of Vue 2 or 3. File-level only.
4. **Scoped-style hash** `data-v-7ba5bd90`. No path, but survives production and is a
   unique `grep -r` handle.

**Svelte** has no component instance tree on the DOM at all — there is no
`__svelteComponent` to walk. What it has, compiled with `dev: true`, is
`el.__svelte_meta.loc` giving the exact authoring file, line and char per element. That
is *better* than a component tree here, since it needs no name-to-file mapping and no
build plugin. The ancestry is recovered by walking up and collecting distinct
`loc.file` values, which for Svelte is nearly the instance tree since one file is one
component. Props are not exposed anywhere, so none are reported.

**React** attaches its fiber under a randomised key (`__reactFiber$<random>`), so it is
found by prefix scan, then `fiber.return` gives the ancestry. Source came from
`fiber._debugSource`, which **React 19 removed** — so on React 19 you get the component
chain and no source line, unless the app runs its own babel plugin. `elementType` is
preferred over `type` so `memo` and `forwardRef` wrappers report what the author wrote.

**Angular** is the only one with a documented debug API: `window.ng.getComponent(el)`,
installed outside production mode. It answers only for elements that *are* component
hosts, so the chain is built by walking up and asking about each ancestor. Angular
records no authoring positions anywhere, not even in dev, so there is no source line to
give.

</details>

## Architecture

A content script cannot see `element.__vueParentComponent`, `__reactFiber$…` or
`__svelte_meta`. Chrome gives each isolated world its own view of JS properties on DOM
nodes, and every framework writes its metadata there. So the extension is split across
three contexts:

```
┌─ MAIN world · src/inspector ─────────────┐  the page's own JS heap
│  detectors/ read framework internals     │
│  patches setTimeout/rAF to freeze motion │
└──────────────┬───────────────────────────┘
               │  window.postMessage bridge
┌──────────────┴───────────────────────────┐
│  ISOLATED world · src/content            │  chrome.* APIs
│  shadow-DOM toolbar, overlays, markers   │
│  storage, clipboard, screenshot cropping │
└──────────────┬───────────────────────────┘
               │  chrome.runtime
┌──────────────┴───────────────────────────┐
│  service worker · src/background         │
│  captureVisibleTab, toolbar badge        │
└──────────────────────────────────────────┘
```

Two details worth knowing:

- **DOM nodes cannot cross `postMessage`.** The content script stamps the target
  with `data-senannotate-probe="<id>"`, sends the id, and the inspector re-resolves
  it with `querySelector`. Stamps are reference-counted, because a hover lookup
  and a click capture can be in flight on the same element at once.
- **`world: "MAIN"` is declared in the manifest**, not injected at runtime.
  Declarative content scripts are exempt from the page's CSP, so this still works
  on apps with a strict `script-src`.

The whole overlay lives in a shadow root with `pointer-events: none`, so the
page's styles cannot reach it and it never blocks a real click.

## Handing it to testers

```bash
npm run pack     # → senannotate-<version>.zip, guide included
```

The zip is the same artifact the release workflow attaches, so testers can equally
fetch it themselves from the [latest release](https://github.com/thangnm93/SenAnnotate/releases/latest).
Either way they install it as [above](#from-a-release--no-node-no-build). The full
walkthrough — install plus the reporting workflow, in English and Vietnamese — is
[`TESTER-GUIDE.md`](./TESTER-GUIDE.md), which `npm run pack` includes in the zip.

### What gets captured automatically

With `captureDiagnostics` on (the default), the report also carries:

- **Console errors** — uncaught throws, unhandled promise rejections,
  `console.error` calls, and failed resource loads, with stack traces at
  Detailed/Forensic.
- **Failed requests** — every `fetch` and `XHR` returning 4xx/5xx or failing
  outright, with method, path, status and duration.
- **Steps to reproduce** — a trail of clicks, field edits, submits and
  navigations, timestamped relative to page load.

All three are installed at `document_start` in the MAIN world, so they are in
place before the app's first line runs. Recording pauses while inspect mode is
on — annotating is not a reproduction step.

**Two things are never recorded:** values typed into fields (the trail says
*"Edited Password"*, never the password), and request or response bodies.
Credential-looking query params (`access_token`, `api_key`, `signature`, …) are
replaced with `[redacted]` before storage. Both guarantees have tests.

### What you actually get on a production build

Measured, not assumed — `test/build-prod-fixtures.mjs` produces three minified
production builds of the same app and the suite asserts on each.

| | stock prod | `+ __VUE_PROD_DEVTOOLS__` | `+ tracer` |
|---|---|---|---|
| Element name, selector, DOM path, classes | ✅ | ✅ | ✅ |
| Console errors, failed requests, repro steps | ✅ | ✅ | ✅ |
| Component tree (`<App> <TheSidebar> <BaseButton>`) | ❌ | ✅ | ✅ |
| Source filename (`BaseButton.vue`) | ❌ | ✅ | ✅ |
| Full path + line + column | ❌ | ❌ | ✅ |
| Bundle cost | — | +1.7 KB | +2.6 KB |

The middle column is the interesting one. `__name` — the component's real,
unminified name — **is emitted by the SFC compiler in production too**, and
`@vitejs/plugin-vue` re-attaches `__file` once devtools are on. In a production
build it deliberately stores only the basename
(`isProduction ? path.basename(filename) : filename`), so you get a filename to
grep for without publishing your directory structure:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  vite: { define: { __VUE_PROD_DEVTOOLS__: true } },
})
```

That is the flag Vue's own runtime checks before writing `__vnode` /
`__vueParentComponent` onto DOM nodes (`runtime-core.esm-bundler.js:1949`).

For exact `file:line:column` as well, add the tracer — **and turn sourcemaps on**:

```ts
import VueTracer from 'vite-plugin-vue-tracer'

export default defineNuxtConfig({
  vite: {
    define: { __VUE_PROD_DEVTOOLS__: true },
    plugins: [VueTracer({ enabled: true })],
  },
  // REQUIRED. The tracer maps generated positions back through the upstream
  // sourcemap; with sourcemaps off it finds no map, transforms nothing, and
  // fails completely silently. `hidden` emits the maps it needs without
  // referencing them from the shipped bundle.
  sourcemap: { client: 'hidden' },
})
```

**This last one exposes every source path and component name** to anyone who opens
the page. Fine for a QA/staging host, a deliberate decision for real production.

## Development

```bash
npm run dev        # esbuild watch — reload the unpacked extension after a rebuild
npm run typecheck
npm run test       # builds, then drives a real Chromium against the fixtures
npm run build
```

`npm run test` launches Chromium with the extension loaded and asserts on the
actual rendered UI and the actual clipboard contents — see `test/e2e.mjs`.

The suite needs three things this package deliberately does not depend on, supplied by
environment variable so nothing machine-specific is baked in:

| Variable | Points at |
|---|---|
| `SENANNOTATE_PLAYWRIGHT_DIR` | a directory whose `node_modules` has `playwright` + browsers |
| `SENANNOTATE_VUE_GLOBAL` | a `vue.global.js` dev build (copied in once, then cached) |
| `SENANNOTATE_PNPM_STORE` | a `node_modules/.pnpm` with `vite`, `@vitejs/plugin-vue`, `vite-plugin-vue-tracer` — only for the production fixtures |

Each is checked with an actionable error rather than a default guess: a hardcoded path
works on exactly one machine, and a wrong one fails later and more confusingly than an
unset variable.

`SENANNOTATE_HEADLESS=1` runs the whole suite **without a window on screen**. Chrome's
*new* headless does load extensions, run the service worker and answer
`captureVisibleTab`, so every check passes there — worth using, because the default headed
window takes the screen and the keyboard focus for the length of the run.

Fixtures under `test/fixtures/` reproduce what `@vitejs/plugin-vue` emits
(`__name`, `__file`, `data-v-inspector`) so the source-resolution path is
exercised end to end.

### The two `verify-*` scripts

`npm test` is hermetic — it serves its own fixtures and always runs. Two extra
checks cover what fixtures cannot, and are kept out of the suite because each needs
something it cannot guarantee:

```bash
npm run verify:sites     # needs network
npm run verify:tracer    # needs a running Nuxt dev server
```

- **`verify:sites`** drives the extension against real third-party pages
  (`example.com`, `react.dev`) and asserts the no-framework path: the toolbar
  appears, no stack badge, and the copied report never says "Vue" nor carries a
  `Stack:` line. Assertions are loose on purpose — an upstream redesign should not
  read as a regression.
- **`verify:tracer`** confirms `file:line:column` against a **real**
  `vite-plugin-vue-tracer`, by reading the plugin's own
  `globalThis.__vue_tracer__` store out of the page. A `:12:5` in a report does not
  by itself prove the tracer produced it, and this is precisely the path the first
  version got wrong. Start a dev server first:

  ```bash
  # in any Nuxt project with devtools enabled
  TMPDIR=/tmp/nx ./node_modules/.bin/nuxt dev --port 3005
  ```

  The short `TMPDIR` is required on macOS — Nuxt's vite-node socket path otherwise
  exceeds the 104-byte limit, fails to bind silently, and every request 500s. Invoke
  the local binary rather than `npx`, which under a shell wrapper can stay alive
  while logging nothing.

Both write screenshots to `test/screenshots/` (gitignored) and share
`test/verify-harness.mjs`. `e2e.mjs` deliberately does not use that harness — it is
the only regression net here and stays self-contained.

### Releasing

CI runs on every push to `main` — typecheck, build, pack — and attaches the packed zip to
the run as a 14-day artifact, so any commit can be loaded into Chrome without cutting a
release. It does **not** run `npm test`; see [`docs/ci-cd/context.md`](./docs/ci-cd/context.md)
for why, and treat the suite as a manual gate before releasing.

To publish a release:

```bash
# 1. Run the full suite yourself — CI cannot.
npm test

# 2. Bump the version. package.json is the only place that matters: the build
#    stamps dist/manifest.json from it.
#    …edit "version" in package.json…

# 3. Regenerate the changelog for the version you just bumped to. The release
#    refuses to publish without a section for its tag.
npm run changelog

git commit -am "chore: release 0.3.0"

# 4. Push the commit first, then the tag. The tag must match package.json
#    exactly or the workflow refuses to release.
git tag v0.3.0
git push && git push --tags
```

`.github/workflows/release.yml` then builds, packs, and creates a GitHub Release with
`senannotate-<version>.zip` attached and the release notes taken from
[`CHANGELOG.md`](./CHANGELOG.md) — and, once the Chrome Web Store credentials are
configured, uploads that same zip to the Store and submits it for review. Until they are,
that step skips itself rather than failing the release. Setup and the two traps worth
knowing are in [`docs/chrome-store-publish/context.md`](./docs/chrome-store-publish/context.md).

### The changelog

[`CHANGELOG.md`](./CHANGELOG.md) is **generated, not written**. `npm run changelog` rebuilds
it from the `v*.*.*` tags and the [Conventional Commit](https://www.conventionalcommits.org/)
subjects between them, grouped into Added / Fixed / Changed / Documentation / Internal, with
breaking changes first. Editing the file by hand is pointless — the next run overwrites it.
The way to fix a bad release note is to write a better commit subject.

The release workflow calls `node scripts/changelog.mjs --extract <version>` and pipes the
result to `gh release create --notes-file`. That step runs *before* `npm ci`, so a tag whose
version has no section fails in seconds and publishes nothing. The reasoning, including why
`--generate-notes` was dropped, is in
[`docs/release-changelog/context.md`](./docs/release-changelog/context.md).

Publishing through the API still means *submitted for review*, and the host permission makes
that review a manual one — days, not minutes.

If the tag and `package.json` disagree, the workflow fails before installing anything and
creates nothing. Fix `package.json`, then delete and re-push the tag:

```bash
git tag -d v0.3.0 && git push origin :refs/tags/v0.3.0
```

## Layout

```
src/
├── shared/       types, wire protocol, Markdown generation, export/import, accent
├── inspector/    MAIN world — freeze, diagnostics
│   └── detectors/  one file per framework + a dispatcher
├── content/      ISOLATED world — capture, storage, UI, frame bridge
├── background/   service worker
└── popup/        status, session report, export/import
```

Zero runtime dependencies. Build-time: `esbuild` and `typescript`.

## Docs

The [**wiki**](https://github.com/thangnm93/SenAnnotate/wiki) is the manual: install,
every gesture and setting, the report format, the framework matrix, the architecture, and
troubleshooting — twenty pages, illustrated with screenshots of the built extension.

Its source is [`wiki/`](./wiki) in this repository rather than the wiki repo, so a change
goes through a pull request like any other:

```bash
SENANNOTATE_PLAYWRIGHT_DIR=… npm run wiki:assets   # re-shoot wiki/images/
npm run wiki:sync                                  # dry run
npm run wiki:sync -- --push                        # publish
```

Design notes, the reasoning behind the three-world split, the licensing history, and the
full record of each release live in [`docs/`](./docs) — start with
[`docs/README.md`](./docs/README.md).
