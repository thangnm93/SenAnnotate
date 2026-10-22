# SenAnnotate

**The visual feedback tool for agents.** Click any element on any website, type a note,
and copy a Markdown report your AI coding agent can act on without guessing.

![Inspect mode: the hovered element labelled with its component and the file that rendered it](images/inspect.jpg)

No `npm install`, no code in your bundle, no dev server. It works against localhost,
staging and production alike, on any stack — and when the page is built with Vue, React,
Svelte or Angular, the report gains the component ancestry and the source file that
rendered the element, as precisely as `src/components/BaseButton.vue:12:5`.

**[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/senannotate-%E2%80%94-visual-anno/nfplcbaoccfdgfpbkjiigfdpmjphbjla)**

---

## Start here

Three readers use this wiki, and they want different things.

| You are… | Read |
|---|---|
| **Testing a site** and need to report what is wrong | [[Quick Start]] → [[Selecting Elements]] → [[Triage]] |
| **Using it daily** and want the whole surface | [[Toolbar and Modes]] → [[Settings]] → [[Keyboard Reference]] |
| **Changing the code** | [[Architecture]] → [[Development]] → [[Releasing]] |

Not sure it will work on your app? [[Framework Support]] is the honest answer, including
what you lose on a production build.

---

## What the loop looks like

**1. Point at the thing.** Hovering names the component and the source line before you
commit to anything.

**2. Say what is wrong.** The composer already carries the element, its source, the
component chain and the owner's props — you supply the sentence and the type.

![The composer, showing element, source, component chain, props and the type chips](images/composer.jpg)

**3. Collect as many as you need.** They persist per site, survive a reload, and
follow you from page to page.

![The annotations panel with the All/Open/Done filter and captured diagnostics](images/panel-triage.png)

**4. Copy the report.** This is the artefact — the thing you paste into Claude Code,
Cursor, or a Jira ticket.

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

[[The Report]] takes that apart line by line and shows all four detail levels.

---

## What makes it different

**It runs on any page, including ones you did not build.** There is no component to
import and nothing to add to your bundle, so a hosted checkout, a staging environment
behind SSO, or a competitor's site are all annotatable.

**It reads framework internals properly.** Frameworks write their metadata as JS
properties on DOM nodes, and Chrome hides those from ordinary content scripts. The
extension runs a script in the page's own world to read them — which is why it can name
`<App> <TheSidebar> <BaseButton>` where a bookmarklet cannot. See [[Architecture]].

**It captures the context you would forget.** Console errors, failed requests and the
steps that led to the bug are recorded from `document_start`, before the app's first
line runs. See [[Diagnostics and Privacy]] — including the two things that are *never*
recorded.

**Nothing leaves your machine.** No account, no server, no telemetry. Notes live in
`chrome.storage.local`, settings in `chrome.storage.sync`, and the only network traffic
is the page's own.

---

## Every page

**Getting started** — [[Installation]] · [[Quick Start]]

**Using it** — [[Toolbar and Modes]] · [[Selecting Elements]] · [[The Composer]] ·
[[Screenshots and Markup]] · [[The Annotations Panel]] · [[Triage]] · [[Settings]] ·
[[Sessions Export and Import]] · [[Keyboard Reference]]

**What comes out** — [[The Report]] · [[Diagnostics and Privacy]]

**Environments** — [[Framework Support]] · [[Iframes Modals and Edge Cases]]

**Contributing** — [[Architecture]] · [[Development]] · [[Releasing]]

**Stuck?** — [[Troubleshooting]]

---

MIT licensed. The project began as a port of
[`agentation`](https://github.com/benjitaylor/agentation) by Benji Taylor and was
reimplemented in 0.3.1 so this repository could be MIT — see
[`NOTICE.md`](https://github.com/thangnm93/SenAnnotate/blob/main/NOTICE.md), which is
worth reading before vendoring any of this.
