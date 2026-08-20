# Chrome Web Store — Privacy form answers

Paste-ready text for the **Privacy** tab. Every claim here was checked against the code, not
inferred; the checks are noted where they matter. Char counts are within the form's 1,000
limit per field.

> **Each box below takes its own paragraph.** The five justification fields are five
> different questions — pasting the same text into all of them, or pasting the manifest's
> `permissions` array, is not a justification and gets the version rejected. Copy one block
> per field.
>
> `downloads` was **removed** in 0.5.2 and there is no field for it any more — upload
> `senannotate-0.5.2.zip` and the form drops it. See [the note below](#removed-permission-downloads).

---

## Single purpose description

Three short paragraphs rather than one long sentence: Google asks for "narrow and
easy-to-understand", so the first line is the single purpose, the second is how it is
achieved, and the third answers the two questions a reviewer asks on seeing `<all_urls>` —
does it alter the page, and where does the data go.

```
SenAnnotate has one purpose: to describe a web page element precisely enough that someone
else can act on a note about it.

The user turns on inspect mode, clicks an element, and types a note. The extension then
produces a Markdown report that names that element — its DOM path, a re-resolvable CSS
selector, and, on pages built with Vue, React, Svelte or Angular, the component and the
source file the framework itself reports — so the note can be handed to an AI coding
assistant or a colleague without anyone guessing which element was meant.

That is its only function. It does not modify, block or inject anything into the pages it
inspects beyond its own floating toolbar, and it has no server: everything it produces stays
on the user's device until the user copies the report or saves a screenshot.
```

---

## Permission justifications

### storage

```
Two local stores, both via chrome.storage. (1) chrome.storage.local holds the user's
annotations — the note text plus a description of the annotated element, its DOM ancestry and
a re-resolvable CSS selector — keyed by the page's origin and path, so that reloading the page
under review brings the notes back instead of silently losing the user's work. A note may also
carry images: the optional screenshot of the annotated element, and up to three reference
images the user pastes or attaches to show what the element should look like instead. Both are
downscaled and stored as data URIs beside the note, and a size ceiling sheds them rather than
let a write fail and lose the notes themselves. (2)
chrome.storage.sync holds preferences only: report detail level, theme, whether diagnostics
capture is enabled, and whether the toolbar is collapsed, so they follow the user's Chrome
profile between machines. Annotation content is never written to sync storage. Nothing in
either store is transmitted anywhere — the extension makes no network requests of its own.
```

### activeTab

```
Used only for the optional per-annotation screenshot. When the user clicks the camera button
in the annotation composer, the service worker calls chrome.tabs.captureVisibleTab, which
requires activeTab, to photograph the visible area of the tab the user is annotating. The
content script then crops that image to the annotated element and hands it to Chrome's normal
download flow. No capture happens without that explicit click, none happens on a tab the user
is not looking at, and the image is never uploaded — the extension has no server to upload it
to.
```

### clipboardWrite

```
The extension's entire output is a Markdown report the user copies with the "Copy report"
button. The primary path is navigator.clipboard.writeText, but a page can disable that with
Permissions-Policy: clipboard-write=(), and it also rejects when the document is not focused.
In those cases the extension falls back to document.execCommand("copy") on a textarea inside
its own shadow root, which is what requires clipboardWrite. It is used only in response to the
user pressing Copy, and only to write.

The extension never reads the clipboard programmatically: it does not call
navigator.clipboard.readText or read(), and it declares no clipboardRead permission. The one
place clipboard content reaches it is a paste the user performs into an open annotation, where
the paste event's own image data becomes a reference image attached to that note. The
accompanying text, if any, is left to the browser to insert into the note's textarea and is
never inspected.
```

### Host permission (`<all_urls>`)

```
The extension annotates whichever page the user is already reviewing, and that can be any URL
— a localhost dev server, a staging host, or production — so it cannot know the hosts in
advance and declares its two content scripts for <all_urls>. What runs on every page is small
and local: a floating toolbar inside a shadow root, and a capped in-memory record of console
errors, failed requests and coarse interaction steps, which exists so a bug report can say
what led to the problem. That record holds at most 60 entries of each kind, is never written
to disk, and is discarded when the page reloads. Values typed into fields are never recorded
and credential-like query parameters are redacted. The page's DOM is read in detail only when
the user turns inspect mode on and clicks an element. The extension makes no network request
of its own, so nothing from any page ever leaves the browser.
```

---

## Are you using remote code?

**Select "No, I am not using remote code."**

The screenshot shows "Yes" selected — that is wrong, and answering Yes invites the deeper
review the banner warns about. Verified: all four bundles (`content.js`, `inspector.js`,
`background.js`, `popup.js`) are built by esbuild with everything inlined, and contain **zero**
occurrences of `eval(` or `new Function`. There are no `<script>` tags injected, no dynamic
`import()`, no remote stylesheet or module URLs, and no `chrome.scripting` calls. The
extension has no runtime dependencies at all.

---

## Data usage — what to check

| Category | Check? | Why |
|---|---|---|
| Personally identifiable information | ☐ no | Never sought. Any personal text that appears does so as the content of an element the user chose, which is disclosed under Website content. A pasted reference image is user-authored input like the note text — supplied deliberately, stored locally, never transmitted — and is not collection. |
| Health information | ☐ no | Not touched. |
| Financial and payment information | ☐ no | Not touched. |
| Authentication information | ☐ no | Actively avoided: field values are never recorded and credential-like query params are replaced with `[redacted]`. |
| Personal communications | ☐ no | Not touched. |
| Location | ☐ no | Not touched. |
| **Web history** | ☑ **yes** | Annotations are stored keyed by the page's origin and path, and the in-memory step trail records navigations as paths. Narrow and local, but a reviewer reading the code will see it — disclose it. |
| **User activity** | ☑ **yes** | The step trail records that a button was clicked, a field edited, a form submitted, a page navigated. Never what was typed. |
| **Website content** | ☑ **yes** | The core function: element text, accessible name, classes, computed styles, nearby text and DOM path of the element the user annotates. |

### The three certifications — all true, tick all three

- **Do not sell or transfer user data to third parties** — true. The extension makes no
  network requests of its own; there is no endpoint for data to go to.
- **Do not use user data for purposes unrelated to the single purpose** — true. Everything
  captured exists to build the report the user asked for.
- **Do not use user data to determine creditworthiness or for lending** — true.

---

## Privacy policy URL

```
https://github.com/thangnm93/SenAnnotate/blob/main/PRIVACY.md
```

`PRIVACY.md` is in the repo root. The repository is public, so the URL is publicly reachable
as Google requires — but **the file has to be pushed before you paste the URL**, or the
reviewer gets a 404.

---

## Removed permission: `downloads`

Removed in 0.5.2. `chrome.downloads` was never called: screenshots are saved the plain DOM
way — `URL.createObjectURL` on the cropped canvas, then a hidden `<a download>` that is
clicked (`src/content/screenshot.ts:44-51`), which needs no permission at all. The form is
explicit that an unnecessary permission is grounds for rejection, so it went.

Removing a permission risks breaking the feature that looked like it needed one, so the save
path is now pinned by an e2e check — *"the screenshot downloads without a downloads
permission"* — which clicks the real camera button and waits for Chrome to offer the file.
It passes with the permission gone, which is the evidence that the removal was safe rather
than merely plausible.

Upload `senannotate-0.5.2.zip`. The `downloads justification` field disappears once the
uploaded package no longer declares it.

`activeTab` is worth a thought too: `captureVisibleTab` is satisfied by the `<all_urls>` host
permission on its own, so `activeTab` is technically redundant. It is kept because it is the
narrower, more legible declaration of intent and reviewers expect to see it for
`captureVisibleTab` — unlike `downloads`, it is backed by a real call.
