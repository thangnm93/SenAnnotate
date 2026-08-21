# The Report

The artefact. Everything else in this extension exists to produce this text.

![The generated Markdown report](images/report.jpg)

It is Markdown, so it pastes intact into Claude Code, Cursor, a Jira ticket, a GitHub
issue or a Slack message — and it is written to be read by a machine that has never seen
your codebase.

---

## Anatomy

```markdown
## Page feedback: /orders
**Stack:** Vue 3 3.5.35 · pinia  ·  **Viewport:** 1280×800

### 1. [ui] button "New order"
**Source:** app/components/PrimaryButton.vue:12:5
**Components:** <App> <PrimaryButton>
**Location:** .actions > .primary-button
**Screenshot:** ~/Downloads/senannotate-1763029180000.png
**Feedback:** Make this the primary action and move it above the divider.

### 2. [bug] span.filter-chip
**Source:** app/components/OrderTable.vue:24:3
**Components:** <App> <OrderTable>
**Location:** .table-card-head > .filter-chip
**Feedback:** This filter resets itself when the table reloads.

## Already fixed

- [copy] td "Priya Raman" — Customer names should link through to the customer record.

## Console errors (1)
…

## Failed requests (1)
…

## Steps to reproduce
…
```

| Line | Is |
|---|---|
| `## Page feedback: /orders` | The page's **pathname**. Not the full URL — the query string is deliberately excluded. |
| `**Stack:**` | The framework found, and libraries beside it. Absent when none was found. |
| `**Viewport:**` | The window size when the notes were taken. A layout bug is a bug *at a width*. |
| `### 1. [ui] element` | One heading per note: number, type, element name. The number matches the pin on the page. |
| `**Source:**` | The file that rendered it — see [[Framework Support]]. |
| `**Components:**` | The component ancestry, outermost first. |
| `**Location:**` | A short, readable DOM path. |
| `**Feedback:**` | Your sentence. Always last, so it is what the eye lands on. |

Rows appear only when there is something to put in them. A page with no framework emits
no `Stack:`, no `Source:` and no `Components:` — and the report is still complete.

---

## The four detail levels

Set in the panel footer or in [[Settings]]. The same notes, four widths.

### Compact — one line each

```markdown
### 1. [ui] button "New order"
**Location:** .actions > .primary-button
**Feedback:** Make this the primary action and move it above the divider.
```

For a quick "these four things". Also what you want when pasting into a chat message.

### Standard — component + source *(default)*

Adds `**Source:**` and `**Components:**`. This is the level that makes the report worth
more than a screenshot, and it is the right default.

### Detailed — + classes, box, props

Adds, on top of Standard:

| | |
|---|---|
| `**Props:**` | The owning component's props |
| `**Selector:**` | A re-resolvable CSS selector |
| `**Classes:**` | The element's classes |
| `**Position:**` | The bounding box |
| `**Context:**` | Nearby text, when there is no selected text |
| `**Computed styles:**` | The styles that actually applied |

For a bug where *what it looks like now* is half the question.

### Forensic — everything

Replaces `**Location:**` with `**Selector:**` and `**Full DOM path:**`, and adds:

| | |
|---|---|
| `**Owner:**` | The owning component, named on its own |
| `**Grep handles:**` | Strings unique enough to `grep -r`, including the scoped-style hash |
| `**Marker at:**` | Where the pin sits, as a percentage and a pixel offset |
| `**Accessibility:**` | Role, accessible name, ARIA state |
| `**Nearby elements:**` | What surrounds it |
| `**Environment:**` | URL, user agent, viewport, as a list |

**Grep handles are the level's best idea.** On a production build there is no source path
— but a scoped-style hash like `data-v-7ba5bd90` survives minification and is a unique
handle a coding agent can search the repo for. That is a real answer to "which file is
this?" when the framework will not give one.

A multi-element note says so, and the forensic block covers the first element:

```markdown
### 1. [ui] button "New order"
*Multi-element selection — forensic detail is for the first element.*
```

---

## Measurements

Only present on annotations taken in **mode 4**. The figures are deliberately not gated
the same way:

| Line | Compact | Standard | Detailed | Forensic |
|---|:-:|:-:|:-:|:-:|
| ` · gap 24×0px` on the one-line bullet | ✓ | | | |
| `**Measured to:**` and `**Gap:**` | | ✓ | ✓ | ✓ |
| `**Edges:**` | | | ✓ | ✓ |
| `**Box:**` | | | ✓ | ✓ |
| `**Centres:**` | | | | ✓ |
| `**Contrast:**` | | | ✓ | ✓ |

```markdown
**Measured to:** button "Cancel" (`.actions > button.secondary`)
**Gap:** 24px horizontal, 0px vertical
**Edges:** top aligned, right -12px, bottom aligned, left +8px
**Box:** 320×48px · content 296×32 · padding 8px 12px · margin 0 0 16px 0
```

**Why `**Gap:**` appears a level earlier than `**Box:**`.** A gap costs two deliberate
clicks in a mode you chose — it is the thing you meant to say, so lowering the detail
level does not throw it away. The box model is collected alongside without being asked
for, which puts it at the same level as `**Position:**` and `**Classes:**`.

**Contrast.** Present whenever the element paints text of its own on a background that
can be resolved:

```markdown
**Contrast:** 4.49:1 · fails AA (needs 4.5:1)
```

The threshold it missed is named, because a bare verdict leaves the reader to look up
which of four numbers applied. A colour that *would* pass is deliberately not suggested —
that is a design decision, and the reader is better placed to make it.

It is absent, rather than guessed at, when there is no honest figure: an element whose
text lives in a child paints none of its own, nothing is painted behind it, or what is
painted is a gradient or an image. A ratio against a guess is worse than no ratio.

**Reading the numbers.**

- `**Gap:**` is the clear space on each axis. `12px overlap` means they overlap by that
  much; `0px` means the edges touch. When one element is wholly inside the other the
  line reads `none` and `**Edges:**` is the real answer.
- `**Edges:**` is the second element's edge minus the first's, so `aligned` means 0 and
  the sign tells you which way to move.
- Figures keep two decimal places. A `0.5px` gap prints as `0.5px` rather than being
  rounded to nothing — a half-pixel seam is a real defect and the usual integer
  rounding is what hides it.
- `**Box:**` describes the **anchor** — the first element you clicked — because every
  other line in the annotation does. `320×48px` is the border box as painted.

---

## CSS changes

Present whenever anything was overridden in mode 5, as a section of its own rather than
attached to a note — an override is not a comment about an element, it is an instruction
about one, and it exists whether or not anybody wrote a sentence beside it.

```markdown
## CSS changes

### `.actions > button.primary`

- `padding`: `8px 12px` → `12px 20px`
```

The heading is the **selector**, not the friendly label: this is the one part of the
report meant to be acted on mechanically, and `button.primary` is not something you can
paste into a stylesheet. `from` is the value the page computed before you touched it, not
the previous edit — someone following the report needs the stylesheet's value, not your
intermediate step.

---

## Frames

An element inside an iframe carries a `**Frame:**` line above `**Location:**`, because
which document the element is in changes what the location is even about:

```markdown
**Frame:** Storybook preview — `https://storybook.example.com/iframe.html`
```

Forensic adds `**Frame element:**` with the selector of the `<iframe>` itself. See
[[Iframes Modals and Edge Cases]].

---

## The automatic sections

Below your notes, when there is anything to report and *Capture errors & steps* is on:

| Section | Contains |
|---|---|
| `## Console errors (n)` | Uncaught throws, unhandled rejections, `console.error`, failed resource loads. Stack traces at Detailed and Forensic. |
| `## Failed requests (n)` | Every `fetch` and XHR that returned 4xx/5xx or failed outright — method, path, status, duration. |
| `## Steps to reproduce` | Clicks, field edits, submits and navigations, timestamped from page load. |

These are the sections nobody would have written by hand, and they are frequently the
part that solves the bug. See [[Diagnostics and Privacy]].

---

## Already fixed

Notes ticked done move out of the numbered list into their own section rather than
disappearing:

```markdown
## Already fixed

- [copy] td "Priya Raman" — Customer names should link through to the customer record.
```

Because "this was already handled" is context worth having. See [[Triage]].

---

## Getting it out

| | |
|---|---|
| **Copy report** | The clipboard. |
| **.md** ⤓ | A file, when the clipboard is blocked or you want to attach it. |
| **Copy session report** | Every page you annotated, in one document — from the popup. |

The session report separates pages with `---` and a `## <page>` heading. It carries the
notes but **not** the console errors or reproduction steps: those belong to a page load
and are not stored. See [[Sessions Export and Import]].

---

## Writing a report an agent can act on

The extension supplies the *where*. You supply the *what*, and that is the half that
decides whether the report works.

| Weak | Strong |
|---|---|
| "broken" | "Submitting with an empty email shows no error and the form resets." |
| "wrong colour" | "Should use the danger token — it is a destructive action." |
| "fix the spacing" | "Gap should be 8px to match the cards above." |

Two habits that pay off:

- **Say what it should be, not only that it is wrong.** An agent that has to guess the
  intended behaviour guesses wrong roughly as often as you would expect.
- **Use Forensic for the hard one.** When a bug has resisted one round of fixing, the
  computed styles and grep handles are usually what unblocks it.
