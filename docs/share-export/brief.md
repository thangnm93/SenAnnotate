# Brief — a review anyone can open, and one that lands on the right site

## The problem

Two people cannot currently receive a review.

**Someone without the extension.** The Markdown report is written for an agent and the
JSON export is written for another copy of this extension. A designer signing off, a PM,
a client — none of them have either. Screenshots are the part of a review that carries,
and both existing formats reference them rather than containing them: the `.md` report
embeds them only when the delivery setting is `embed`, and even then it is Markdown, which
most recipients cannot render.

**Someone on a different machine.** Annotations are keyed on `origin + pathname`. A review
captured on `https://staging.example.com` imports into a key nobody's `localhost:3000` will
ever open. The notes are in storage, correctly merged, and invisible. The import reports
success, which makes it worse.

## What ships

- **Save `.html`** in the popup: one self-contained document, every screenshot embedded,
  no script and no network reference. Opens in any browser.
- **Import onto this site**: a checkbox next to Import. When ticked, every page in the file
  is rewritten onto the active tab's origin, path kept. The hint line names the origin the
  notes landed on.

## Not in scope

- Sending anywhere. The file downloads; who it reaches is the user's business.
- A per-page origin picker. One origin for the whole file covers the case that exists
  (one deployment → one dev server) and a mapping table would need a UI of its own.
- Screenshots that are paths rather than `data:` URIs. They name a file on the reporter's
  machine; the document says so instead of showing a broken image.
