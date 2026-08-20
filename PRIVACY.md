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
- The filename of any screenshot you chose to save, and a downscaled copy of the
  screenshot itself, so the note still carries its picture after a reload.
- **Reference images you paste or attach**, up to three per note, downscaled and stored
  the same way. These are files *you* supply — a design frame, a screenshot from another
  window, anything you choose — so unlike everything else on this list they may hold
  content that has nothing to do with the page you are on. They are stored exactly like
  your note text: on your device, never uploaded, and deleted with the annotation.

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

### Screenshots

If you click the camera button on an annotation, the extension photographs the visible area
of the current tab, crops it to the annotated element in the page, and hands the result to
Chrome's normal download flow. The image is not uploaded anywhere. No capture ever happens
without that click.

### Reference images, and what "paste" means here

You can attach a picture of what an element *should* look like: paste one into the note, or
pick one from disk with the button beside the camera.

The paste is yours — nothing happens until you press ⌘/Ctrl+V with a note open. The
extension does not poll, watch or read the clipboard at any other time, and there is no
clipboard-read permission in its manifest that would let it. When you do paste, it takes
the image off that one event and nothing else: if your clipboard also carries text, that
text goes into the note's text box exactly as it would have, and the extension never looks
at what it says.

The image is then downscaled, re-encoded and stored beside the note on your device. It is
not uploaded, not sent anywhere, and removing the thumbnail or deleting the note removes
it.

One limitation worth stating plainly: the extension's own interface lives in an *open*
shadow root on the page you are reviewing, which means a script on that page can read what
is displayed in it — including a reference image you have pasted but not yet saved. If the
picture is confidential and the page you are annotating is not one you trust, that is worth
knowing before you paste.

## What the extension does not do

- It does not sell or transfer your data to anyone — there is nowhere for it to go.
- It does not use your data for anything unrelated to producing the report you asked for.
- It does not use your data to assess creditworthiness or for lending purposes.
- It does not read your clipboard on its own, and holds no permission that would let it.
  It writes to the clipboard when you press Copy, and it sees clipboard content in exactly
  one other place: the paste you perform yourself into an open note, where it takes the
  image and leaves the text to the text box (see *Reference images* below).
- It does not modify, block or inject anything into the pages you visit beyond its own
  floating toolbar, which lives in a shadow root and is removed when you disable it.
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
