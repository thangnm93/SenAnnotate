# Toolbar and Modes

The toolbar is the whole interface. There is no options page you have to find and no
DevTools panel to dock — settings, the annotation list and the modes all live on the pill
in the corner, next to the page they describe.

![The toolbar, with the hint line above it](images/toolbar.png)

---

## Anatomy, left to right

| | Button | Does | Key |
|---|---|---|---|
| `Vue 3 3.5.35` | **Stack badge** | Names the framework found on this page. Absent when none was found; **amber** on a production build. Not a button. | — |
| `S Inspect` | **Inspect** | Turns inspect mode on and off. Reads **Inspecting** while on. | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> |
| ⌖ | **Click an element** | Mode 1 — the default. | <kbd>1</kbd> |
| T | **Select text** | Mode 2. | <kbd>2</kbd> |
| ⛶ | **Drag across elements** | Mode 3 — the marquee. | <kbd>3</kbd> |
| ⇔ | **Measure distances** | Mode 4 — the gap between two elements. **Only present when *Measuring tools* and *Measure distances* are both on in Settings; the master is off by default.** | <kbd>4</kbd> |
| ✎ | **Edit CSS** | Mode 5 — change an element's CSS on the page. **Only present when *Live CSS editor* is on in Settings; off by default.** | <kbd>5</kbd> |
| ❄ | **Freeze animations** | Parks `requestAnimationFrame` and `setTimeout` in the page. | <kbd>F</kbd> |
| ⬥ | **Pick a colour** | Samples any pixel on screen and copies the hex. Only present when *Measuring tools* is on. | — |
| ☰ ③ | **Annotations** | Opens the panel. The badge is the count on this page. | <kbd>A</kbd> |
| ⚙ | **Settings** | Opens the settings card. | — |
| » | **Collapse toolbar** | Collapses to a dot. | <kbd>H</kbd> |

**The mode buttons only appear once inspect mode is on**, and the fourth only if you have switched measuring on. They are icon-only, which
is exactly why the hint line exists.

---

## The hint line

The line above the pill always names what the current mode does and which keys reach the
others:

| Mode | Line |
|---|---|
| Click an element | `Click an element · ⌘/Ctrl+drag across several · C captures hover · 2 text · 3 area` |
| Select text | `Select text · 1 point · 3 area` |
| Drag across elements | *(names the drag, and the keys back)* |

It also becomes a live counter while you are assembling a selection —
`3 elements picked · ⌘/Ctrl+click to add · Enter to annotate` — so you can see what you
have before committing to it.

This line exists because of a real failure: the marquee mode shipped and went **unused
for three releases**, because nothing on screen said it existed. Every button also names
itself on hover *and* on keyboard focus, for the same reason.

---

## Modes

### 1 · Click an element

The default. Hover outlines an element and labels it; click annotates it. Most work
happens here, and the two other selection gestures — <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+click
and <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+drag — work from inside this mode without switching.

### 2 · Select text

Select a text range and the composer opens with a **Text** row carrying what you
selected. Use it when the complaint is about wording rather than about a box.

![Text mode: a selected range, with the composer showing the Text row](images/text-mode.png)

### 3 · Drag across elements

Draw a box; everything it **fully contains** is taken. See [[Selecting Elements]].

---

## Freeze

<kbd>F</kbd> parks the page's animations: `requestAnimationFrame` and `setTimeout` are
held, so a carousel, a toast on a timer, or a CSS transition mid-flight all stop where
they are and can be annotated.

Two things worth knowing:

- **It has to run in the page's own world to work.** Patching `setTimeout` from an
  isolated content script patches only that script's timers; the page's animation loops
  live in a different heap. See [[Architecture]].
- **It does not help with hover-driven surfaces.** A dropdown that closes on mouse-out is
  driven by pointer events, not by time, so freeze has no effect on it. <kbd>C</kbd> is
  the answer there — see [[Selecting Elements]].

*Freeze animations on inspect* in [[Settings]] makes it automatic whenever inspect mode
goes on.

---

## Moving the toolbar

The pill docks bottom-right, which is exactly where a page tends to put its chat widget,
cookie bar or footer actions. So: **drag it anywhere.** Grab any part of the pill,
buttons included — a press that travels more than a few pixels moves it instead of
clicking it.

The position is remembered **per page**, the same way annotations are. Move it clear of
the checkout page's order summary and it stays there on that page, while every other page
keeps the default corner. Open the same page in a narrower window later and it is clamped
back into view rather than stranded off-screen.

The settings card follows the pill wherever it is dragged, so it never opens off the edge
of the screen.

---

## Collapsing

<kbd>H</kbd> — or the `»` button — collapses the toolbar to a single dot that still
carries the annotation count.

![The collapsed toolbar: a dot carrying the count](images/toolbar-collapsed.png)

**Collapsing means *get out of the way*, not merely *get smaller*.** It also:

- leaves inspect mode, and
- closes whichever card is open.

That is deliberate. A toolbar you have just dismissed which is still swallowing every
click — so the next one opens a composer for no reason the screen can explain — is the
exact failure this behaviour prevents.

Expanding gives none of it back. <kbd>H</kbd> asked for the toolbar, so <kbd>H</kbd>
returns the toolbar, and nothing else. Freeze is untouched either way, because freeze is
a property of the page rather than of the toolbar.

The collapsed state is a **setting**, not a session flag, so a reload does not put the
pill back over the corner you were looking at. <kbd>H</kbd> works whether or not inspect
mode is on, unlike the mode keys.

---

## Escape

<kbd>Esc</kbd> closes the innermost thing first, in this order:

1. a tooltip
2. the open card — composer, settings, or the markup editor
3. a half-built pick set
4. the panel
5. inspect mode

So <kbd>Esc</kbd> is always safe to press: it never skips a level, and it never throws
away more than the one thing you were most recently in.

---

## Where the toolbar is not

On `chrome://` pages, the Chrome Web Store and the PDF viewer, Chrome does not run
extension content scripts at all. There is no toolbar there and nothing can put one
there — including for theme and accent, which are otherwise global settings. Open an
ordinary page instead.

**Hide until restart** in [[Settings]] removes the overlay from one tab deliberately.
If the toolbar is missing where you expect it, that is the first thing to check —
see [[Troubleshooting]].

---

## Mode 4 — measuring

**Off by default.** Turn on *Measuring tools* in Settings first; *Measure distances*
underneath it is already on, so that is the only click needed. Until you do, there is
no fourth button, <kbd>4</kbd> does nothing, and the hint line does not mention it —
three modes is already the most a row of icon-only buttons can explain, and most reviews
never measure anything.


Mode 4 answers the question most UI notes are really about: *how far apart are these two
things?* Hover reads, click writes — the same contract as mode 1.

1. **Hover** anything. The highlight gains a `320×48` badge, and padding and margin are
   shaded on it.
2. **Click** an element. It stays outlined as the **anchor**, and the hint changes to ask
   for the second one.
3. **Hover** a second element. A dimension line is drawn across the space between them,
   with the figure on it. Nothing has been recorded yet — reading a number costs nothing.
4. **Click** it, or press <kbd>C</kbd>, and the composer opens with both elements captured
   and the figures attached.

<kbd>Esc</kbd> drops the anchor without leaving the mode.

### What the overlay tells you

| On screen | Says |
|---|---|
| The badge, e.g. `320×48` | Border box as painted |
| A figure on a shaded band | That band's thickness — only where the band is at least 14px, or the number would not be legible |
| A dashed green line | Where the padding ends and the content begins |
| A dashed orange line | The outer edge of the margin |
| A contrast verdict, green or red | The WCAG ratio for this element's own text, and whether it clears AA and AAA |
| The panel under the badge | A grouped inspector: the element in CSS terms, then **Box Model**, **Appearance** and **Text** |

The panel reads as CSS because that is what you are about to go and write — a panel that
renames things makes you translate twice. Rows appear only when the property is in force:
no `gap` row on something that is not a flex or grid container, no `border` row at zero.

`padding` and `margin` keep their per-side `T R B L` form rather than the shorthand the
other rows use. A side whose figure is already drawn on its band is **dimmed**. What stays
at full weight is exactly what the page could not tell you — the bands too thin to hold a
number. That is why the sides are spelled out rather than written as a shorthand: being
told `8px 12px` and left to work out which of two unlabelled bands is which is not being
shown the value.

Three regions meet at two dashed lines; the border box itself is the solid accent
outline of the hover highlight. On a page with a strong background of its own the
translucent bands alone read as a vague tint, so the lines are what make them regions.

The colour line resolves what is **actually** behind the element. Most elements declare no
background of their own, so it walks up until it finds one and marks the result
`(inherited)`. Where a gradient or an image is painted it says `image` rather than
inventing a swatch — one colour cannot honestly stand for one.

None of this goes into the report; the report already carries the same ground in
`**Box:**` and `**Computed styles:**`. See [[The Report]].

The report gets `**Measured to:**`, `**Gap:**` and — from *Detailed* — `**Edges:**` and
`**Box:**`. See [[The Report]] for the exact lines.

Two things worth knowing:

- **The box model describes the anchor**, not the second element, because every other
  line of the annotation does too. The second element is named on the `**Measured to:**`
  line.
- **A `(scaled)` badge** means the element is drawn at a different size than it is laid
  out at — a CSS `transform`, or page zoom. The size shown is what is on screen; the
  padding and margin figures are the layout ones, and the two genuinely differ.

---

## Picking a colour

The ⬥ button samples any pixel on the screen, copies the hex to the clipboard and says so
in a toast. Dismissing the picker says nothing — pressing Escape out of it is a decision,
not a failure.

Hovering already reports an element's text colour and the real background behind it, so
this is not the usual way to get a colour out of a page. It is for the case the other one
cannot answer: where the background is a **gradient, an image or a canvas**, the hover
panel reports `image` and refuses to guess, because one swatch cannot honestly stand for
one. This is how you get a number there.

The hex is copied rather than left on screen because a six-character string in a toast
that vanishes is a string you have to go and pick again.

---

## Mode 5 — editing CSS

**Off by default**, and the switch that matters: it is the one that lets this extension
*write* to a page rather than only read one. Turn on *Live CSS editor* in Settings, press
<kbd>5</kbd>, and click an element.

The card has two tabs.

**Styles** lists the properties people actually change, each with its current computed
value, each editable. Type a value and it applies immediately. An overridden property is
marked, with a ↺ to put it back. The last row takes any property name you type, for
everything not on the list.

**Changes** lists every override on the page, grouped by element, as `was → is`. **Copy
CSS** puts the whole thing on the clipboard in the same shape the report uses; **Revert
all** undoes everything.

The overrides also reach the report, as a `## CSS changes` section of its own — an
override list is the most directly actionable thing this tool can hand an agent, because
it is the instruction with the guessing already removed.

**Arrow keys step numbers.** With the caret in a value, <kbd>↑</kbd> and <kbd>↓</kbd>
move the number it is sitting in by 1, <kbd>Shift</kbd> by 10, <kbd>Alt</kbd> by 0.1. The
caret is what decides *which* number: in `8px 12px` it is the one you are next to, and in
`rgb(37, 99, 235)` it is that channel alone. Each press applies straight to the page, so
holding <kbd>↑</kbd> is a way to find a value by eye.

Three things worth knowing:

- **Reverting restores, it does not clear.** An element that already carried an inline
  style gets that value back, not a missing property.
- **A framework re-render wipes an override.** The change is an inline style and the
  re-render replaces the node. The Changes tab keeps the record so you can re-apply;
  nothing re-applies it for you. DevTools has the same hole.
- **Switching the editor off does not undo your edits.** They are your work, not the
  mode's. Use *Revert all* for that.

`@media` editing and pseudo-state forcing are **not** here. Forcing `:hover` needs the
Chrome DevTools Protocol behind the `debugger` permission, and the CSSOM workaround
cannot read stylesheets served from another origin at all — which is most sites.
