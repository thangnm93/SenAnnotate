# Context — the project's only HTML sink, and why the remap is one line

## The escaping rule, stated once

`shared/share.ts` is the **only** module in the project that builds HTML from strings taken
off someone else's page. `ui/dom.ts` offers `text` and deliberately no `html` so the overlay
can never grow an injection sink; that argument does not extend to a file written to disk,
which has to be HTML to be openable.

So the rule is local and absolute: **no HTML is built by concatenation**. Everything goes
through the `html` tagged template, which escapes each substitution as it interpolates, so a
`${}` added in a hurry is safe by default and the only way to insert markup is to say
`raw(...)`. The first version escaped per interpolation with a bare `esc()` call and three
layers of documentation asking people to remember it; the construct does that job instead,
and the e2e check (`an element name cannot close a tag in the shared file`) now guards a
property rather than a habit. An element name is `button "Save"` today and whatever a page
author wrote tomorrow.

One field reaches an *active URL sink* rather than text: `screenshotData`, which after an
import is whatever the file said — `looksLikeAnnotation` never inspects it. `isEmbeddable`
therefore matches the exact shape the extension itself produces,
`data:image/(png|jpeg|webp);base64,…`, and refuses everything else. A bare
`startsWith("data:image/")` admits `data:image/svg+xml,<svg …>`, which the parser hands the
browser as a document to render; scripts inside an `<img>`-loaded SVG are blocked in current
browsers, and the gate deliberately does not depend on that staying true. Matching the shape
also proves the value cannot contain any of the five escaped characters, so it is inserted
with `raw` — escaping a 60–120 KB base64 payload is five full scans and five copies per
screenshot, in a popup Chrome tears down on blur.

The document also carries **no `<script>` at all**, and an e2e check asserts that too. Not
because a script would be dangerous to us — it would be running on the recipient's machine,
from a file they were emailed. A review that does nothing when opened is one nobody has to
decide whether to trust. That claim is now made by the document itself: a CSP `<meta>` with
`default-src 'none'; img-src data:; style-src 'unsafe-inline'` means a script or a remote
reference that ever slips through is inert in the reader's browser instead of live.

## Why the remap needs a scheme check, not just a parse

`activeTabOrigin` returns an origin the notes will be *findable* at, which is a stricter
question than whether the URL parses. `chrome://settings`, `chrome-extension://…`,
`devtools://` and `view-source:` all parse and all have an origin; `file:` parses and has
the origin `"null"`. No content script runs on any of them, and `storage.ts` keys pages as
`location.origin + location.pathname` — so a remap onto one of those writes the review to a
key nothing will ever read, while the hint reports success. `http:`/`https:` only.

And when the box is ticked and no origin resolves, the popup says so. Collapsing "could not
work out an origin" into "the user did not ask" produces an ordinary success message for
exactly the failure this feature exists to prevent.

## Why `buildShareHtml` takes an `ExportFile`

It could read `chrome.storage.local` itself. It takes the same structure `exportAll()`
returns instead, so that "everything" means the same thing in both formats — the day a
filter is added to the JSON export, the HTML gets it for free rather than silently
disagreeing about the contents of a review.

That also makes it a pure function of its argument, which is why it needs no test harness
of its own: the e2e suite exercises it through the button.

## Why the remap replaces only the origin

`https://staging.example.com/checkout` → `http://localhost:3000/checkout`. The path is what
identifies the screen and is the same on every deployment of the same app; the origin is the
only part that moves. Replacing more would require knowing about base paths and route
prefixes, which is a mapping problem with no correct default.

A key that will not parse as a URL is passed through untouched. It came from a scheme this
build does not understand, and guessing where its path begins would put the notes somewhere
worse than where they were.

## Why the checkbox, and not a prompt

The obvious design is to notice that the file's origins differ from the current tab's and
offer to remap. It was rejected: the popup closes the instant focus leaves it, so anything
modal is a dialog that cannot be answered, and the same "no alerts in the popup" constraint
that shaped `reportArchive` applies. A checkbox is read at import time and costs nothing
when it is off.

Reading the *active tab's* origin — not the popup's own URL — is the subtle part. In the
real popup those are different documents and it is unambiguous. In the e2e suite the popup
is an ordinary tab, so clicking anything in it makes it the active tab; the test therefore
sets the checkbox through `evaluate` and calls `bringToFront()` on the page under review.
Any future test that clicks its way through the popup will read `chrome-extension://…` as
the origin and quietly assert nothing.

## Where this leaves the three formats

| Format | For | Server needed |
|---|---|---|
| `.md` (clipboard / file) | your coding agent | no |
| `.html` | a person without the extension | no |
| `.json` | another copy of this extension | no |

Worth recording because the tool this was modelled on needs a local server for its HTML
export — its screenshots live on disk. Ours are already `data:` URIs when the delivery
setting is `embed`, so the whole document is built from what storage holds.
