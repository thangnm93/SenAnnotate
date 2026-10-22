# Troubleshooting

---

## "This extension is not trusted by Enhanced Safe Browsing"

**Nothing is wrong with the extension.** Chrome trusts an extension only when **both**
hold:

1. it was installed from the Chrome Web Store, **and**
2. the developer has a track record of following the Developer Program Policies — in
   practice, the extension has been published for **roughly three months** and the
   account has no violations.

A new extension, or one from a new developer, is "not trusted" until that clock runs out.
There is no button, no form and no appeal.

**A locally loaded unpacked copy always shows it**, whatever the Store says — and that is
the more common reason to see it. Check which copy you are running:

`chrome://extensions` → Developer mode → compare the **ID** with
`nfplcbaoccfdgfpbkjiigfdpmjphbjla`.

| ID | Meaning |
|---|---|
| `nfplcbaoccfdgfpbkjiigfdpmjphbjla` | The Store build. Just not old enough yet — wait. |
| Anything else | You are running an unpacked copy. Remove it and use the Store install. |

Running both side by side is easy to do by accident, and the unpacked one is the one
showing the warning.

To dismiss the warning while developing: `chrome://settings/security` → **Standard
protection**.

---

## No toolbar on the page

Work down this list.

1. **Is it a page extensions can run on?** Not `chrome://` pages, not the Chrome Web
   Store, not the PDF viewer, not another extension's pages. Nothing can put a toolbar
   there.
2. **Is Hide until restart on for this tab?** It is per-tab and survives reloads. Close
   the tab and reopen the page.
3. **Is the toolbar just collapsed?** Look for a small dot in the corner — or somewhere
   else, since the position is remembered per page. Press <kbd>H</kbd>.
4. **Did you just update an unpacked install?** Reload the tab. The old content script
   runs until you do, which looks exactly like the update not working.
5. **Is the extension enabled?** `chrome://extensions`.

---

## Keyboard shortcuts do nothing

<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> is a Chrome *command* and works even when
the page has not been clicked. **Everything else — <kbd>A</kbd>, <kbd>F</kbd>,
<kbd>C</kbd>, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>, <kbd>H</kbd> — needs the page to
have the keyboard.**

If you have just clicked inside the extension's own UI, click the page once and they come
back.

Two more causes:

- **The mode keys need inspect mode on.** <kbd>H</kbd> does not, which is the one
  asymmetry.
- **Another extension has taken the command.** Check
  `chrome://extensions/shortcuts` — you can rebind it there.

---

## No component or source line in the report

**Expected on:** a page with no framework, a **production build**, React 19 (which
removed `_debugSource` upstream), and Angular (which records no authoring positions at
all, even in dev).

Otherwise:

| Symptom | Cause |
|---|---|
| Amber stack badge | Production build. See [[Framework Support]] for what `__VUE_PROD_DEVTOOLS__` buys you for 1.7 KB. |
| No badge at all | No framework detected. |
| Filename but no `:line:col` (Vue) | The tracer is not running. `devtools: { enabled: true }` in `nuxt.config.ts`. |
| Was working, now stops at the filename | Sourcemaps turned off. The tracer needs them and **fails completely silently** without them. |
| Components missing at every level | *Components* is set to **Off (fastest)**, or the detail level is **Compact**, which implies it. |

---

## Copy report does nothing

The clipboard write needs the click's user activation, so an extension or policy that
interposes on the click can break it.

**Use the ⤓ button instead** — it saves the same text as a `.md` file with no clipboard
involved.

---

## The composer will not take my typing

A dialog with a **focus trap** — Reka UI, Radix, Headless UI — pulling focus back. Fixed
in **0.8.1**; check the version in the settings card footer and update if you are older.

If it is a dialog that *closes* when focus leaves it, that is the one unavoidable case:
typing requires focus. The annotation was captured before the composer opened, so the
note is complete. See [[Iframes Modals and Edge Cases]].

---

## Clicking the toolbar closes the page's modal

Fixed in **0.5.1**. Update.

---

## My notes disappeared

| Cause | Recoverable? |
|---|---|
| Different page of the same site | Not lost — the list is per origin, so the note is in the panel on every page, and pinned on the page it was made on. |
| `http://` vs `https://`, or `localhost` vs `127.0.0.1` | Yes — different origins. Go back to the one you annotated. |
| **Clear all** / **Clear after copying** | Only from an export. |
| Uninstalled the extension | Only from an export. |
| Chrome profile cleared | Only from an export. |

**Export from the popup is the only backup**, and it takes one click. See
[[Sessions Export and Import]].

---

## Hovering is slow on a big page

The component chain costs a bridge round trip per element. In [[Settings]], set
**Components → Off (fastest)**, or drop the detail level to **Compact**.

The bridge times out at 500 ms and degrades to a note with no framework data rather than
hanging.

---

## Marquee does not work inside an iframe

Correct, and deliberate — drag-select stops at the frame boundary. Click and text
selection work inside frames. See [[Iframes Modals and Edge Cases]].

---

## A Cloudflare / captcha challenge will not pass

The extension does not instrument challenge frames precisely so this does not happen. If
you hit it anyway, turn the extension off for that load and file an issue with the site.

---

## Chrome nags "Disable developer mode extensions" every launch

Click **Cancel**, not Disable. Chrome shows this for any unpacked extension. The Web
Store install does not have it — see [[Installation]].

---

## Still stuck

Open an issue at
[github.com/thangnm93/SenAnnotate/issues](https://github.com/thangnm93/SenAnnotate/issues).

Include:

- the **version** (the settings card footer shows it),
- your Chrome version,
- the framework and whether it is a dev or production build,
- what you expected and what happened.

A SenAnnotate report of the page it happened on is, as you would hope, an excellent bug
report.
