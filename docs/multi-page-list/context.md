# Context — one list per origin

## The storage layout did not change

Notes were already stored one key per page: `senannotate:page:<origin><pathname>`. The
popup's export, import, session copy, share and "clear all pages" all read that layout,
and every release before this one wrote it. The cheapest correct design leaves it alone:

- **Load** reads every key beginning `senannotate:page:<origin>/` and merges them into one
  list, stamping each note with the path from its key (`Annotation.pathname`).
- **Save** splits the list back by `pathname` and writes one key per page, removing the
  keys this tab loaded or wrote that are now empty.

That is the whole migration: there is none. A key written by 0.8.x is a key this build
reads. The trailing `/` in the prefix is what stops `https://a.com` from matching
`https://a.com.evil/x`.

The stamped field is also written back, harmlessly. On load the key wins over the field,
so an imported file whose `pathname` disagrees with its page key cannot put a note in the
wrong place.

## Where the list is, and is not, page-aware

The list is origin-wide: the toolbar count, the badge, the panel, the report, Clear all.
Anything that needs an element is page-bound, and goes through one predicate,
`onThisPage()` in `content/index.ts`:

- pins (`markers.render` is handed only this page's notes);
- the panel's hover highlight;
- opening the editor from a panel row — for another page's note it toasts the path
  instead of opening a composer anchored to nothing.

Numbering is **per page** everywhere: pins, panel groups and the report each number a
page's notes from 1. A single global number would not match the pins (a page holding
notes 4 and 5 would draw pins "1" and "2"), and the report restarts numbering under each
`## /path` heading anyway.

## SPA navigation

`onUrlChange` used to save page A's list and load page B's, because the list was page-sized.
Now there is nothing to swap: the list is in memory for the origin, `persist()` writes it on
every change, and a navigation only needs to re-render (which re-derives which notes are on
the page now), clear the action trail and close a composer started on the old page.
`saveAnnotationsForUrl` existed only for that swap and is gone.

## The report

`generateOutput` groups by page. One group gives the old shape, headed by that page's path.
Several give a site header (`## Page feedback: <origin> — N pages`), then a `## /path`
section per page, current page first, each with its own numbered open notes and its own
"Already fixed" list. Diagnostics, the action trail and CSS overrides describe the live page
load, so they stay one block after all the page sections, as before.

`output.ts` is one of the three licence-constrained modules; this change was written from
this repo's own code only.

## Copy and clearing

`copyReport` already snapshots the list and clears only what it sent, and only after a
confirmed clipboard write, when `clearOnCopy` is on. It now sends the origin's whole list,
so it clears the whole origin's list — the intended behaviour, not a side effect.

`clearOnCopy` defaults to **off** and still does. That default was a deliberate decision
(`docs/clear-on-copy/`), and "only an explicit clear empties the list" is true either way:
navigation, closing the overlay and reloading never clear. Whether Copy should clear by
default is a product call this change does not make.

## Reading the whole store on load

Finding a page's neighbours needs the keys of the origin, and `chrome.storage.local` has no
prefix query; Chrome 111 (our floor) has no `getKeys()` either. Load therefore does
`get(null)` and filters. It runs once per page load at `document_idle`, off the critical
path, over at most 10 MB. If that ever shows up in a profile, the fix is an index key per
origin — which the popup's import would have to maintain too, so it was left out.

## Test isolation

Every fixture used to sit on one origin and be isolated by its pathname. A per-origin list
removes that, so `e2e.mjs` gives each fixture file an origin of its own
(`http://<file>.localhost:<port>`, which Chrome resolves to loopback). Blocks that load the
same fixture twice share its notes exactly as before. The new multi-page block puts two
paths on one origin on purpose.
