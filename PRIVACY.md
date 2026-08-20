# Privacy policy — SenAnnotate

Last updated: 18 August 2026. Applies to the SenAnnotate Chrome extension.

## The short version

**SenAnnotate has no server and makes no network requests of its own.** Nothing it reads,
records or produces is transmitted anywhere. Everything stays in your browser, on your
machine, until you copy a report or save a screenshot yourself.

There is no account, no analytics, no telemetry, no crash reporting, and no advertising or
tracking code of any kind. The extension bundles all of its code; it loads nothing from a
remote host and evaluates no remote script.

## What the extension handles

To do its job — describing the element you point at well enough that someone else can find
it — the extension reads and, where noted, stores the following **locally**.

### Saved on your device until you delete it

Stored with `chrome.storage.local`, keyed by the page's origin and path, so that reloading
the page you are reviewing brings your notes back:

- The note text you type.
- A description of the element you annotated: its tag and accessible name, a short DOM
  ancestry, and a re-resolvable CSS selector.
- The marker's position, and the element's bounding box.
- Depending on the report detail level you choose: text selected inside the element, nearby
  text, CSS class names, computed styles, accessibility attributes, the full DOM path, and —
  on pages built with Vue, React, Svelte or Angular — the component names and source file
  the framework itself reports.
- If you used the Design section to try a change on the element: the CSS properties you
  adjusted, with the value the element already had and the value you chose — `font-size:
  16px → 22px` — and, if you rewrote the element's text, that text and what it replaced.
- The filename of any screenshot you chose to save.

Because this describes real page content, it can incidentally include text that is personal
— a customer name in a table row you annotated, for example. That text is only ever the
content of the element you chose, it stays on your device, and deleting the annotation
deletes it.

Settings — report detail level, theme, whether diagnostics capture is on, toolbar state —
are stored with `chrome.storage.sync`, so they follow your Chrome profile between machines.
**Annotations are never written to sync storage.**

### Held in memory only, and discarded

When diagnostics capture is on (the default, and switchable off in the extension's popup),
the extension keeps a small rolling record of what happened on the page so a bug report can
say what led to the problem:

- Console errors, unhandled promise rejections, `console.error` calls and failed resource
  loads.
- Requests that failed or returned 4xx/5xx — method, path, status and duration.
- Coarse interaction steps: that a button was clicked, that a field was edited, that a form
  was submitted, that the page navigated.

This lives in a capped in-memory buffer — at most 60 log entries and 60 request entries —
inside the page. **It is never written to disk**, it is discarded when the page reloads or
you navigate away, and it leaves the extension only if you press "Copy report", which puts
it on your clipboard.

Two guarantees here are deliberate, and both have automated tests:

1. **Values typed into fields are never recorded.** The trail records *that* a field was
   edited and which field it was — "Edited Password", never the password.
2. **Request and response bodies are never recorded.** Query parameters that look like
   credentials (`token`, `secret`, `password`, `signature`, `api_key`, `auth`, `session`,
   `jwt`, and similar) are replaced with `[redacted]` before storage.

### Design previews are temporary, and never saved to the page

The Design section inside the annotation card lets you try a change — a colour, a size, some
padding, or a rewritten label — on the real element while you decide what to ask for. While
that card is open, the change is applied to the element as an inline style (or, for text, to
the text itself) so that you can see it.

**It is always undone when the card closes** — when you save, cancel, press Escape, or open a
different note. The `style` attribute is put back exactly as the page had it, and removed
entirely when the page had none. Nothing is written to the page, no stylesheet or script is
injected, and reloading is not needed to get the page back: the extension has already handed
it back. What is kept is the *description* of the change, in the annotation, as listed above —
so that whoever reads the note knows what you tried.

### Screenshots

If you click the camera button on an annotation, the extension photographs the visible area
of the current tab, crops it to the annotated element in the page, and hands the result to
Chrome's normal download flow. The image is not uploaded anywhere. No capture ever happens
without that click.

## What the extension does not do

- It does not sell or transfer your data to anyone — there is nowhere for it to go.
- It does not use your data for anything unrelated to producing the report you asked for.
- It does not use your data to assess creditworthiness or for lending purposes.
- It does not read your clipboard. It only writes to it, when you press Copy.
- It does not inject scripts or stylesheets into the pages you visit, block anything on
  them, or leave any change behind. Its own interface lives in a shadow root and is removed
  when you disable it. The one thing it does put on a page — the temporary design preview
  described above — is applied only while you have that annotation card open and is undone
  when it closes.
- It does not collect health, financial, payment, authentication or location data, and it
  does not read your personal communications.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `storage` | Keep your annotations across a page reload, and your settings across machines. |
| `activeTab` | Photograph the visible tab, only when you click the camera button. |
| `clipboardWrite` | Write the report to your clipboard when you press Copy, including on pages that block the modern clipboard API. |
| Host access (`<all_urls>`) | The page you want to annotate can be any URL — localhost, staging or production — so the extension cannot know the hosts in advance. |

## Removing your data

Uninstalling the extension removes everything it stored. You can also clear notes for a
single page with the trash button in the extension's panel, or delete individual notes one
at a time.

## Changes

Material changes to this policy will be published in this file, whose history is public at
<https://github.com/thangnm93/SenAnnotate/commits/main/PRIVACY.md>.

## Contact

Open an issue at <https://github.com/thangnm93/SenAnnotate/issues>.
