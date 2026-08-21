# Keyboard Reference

Everything, in one table. The line above the toolbar always names the current mode's keys,
so none of this needs memorising — but it is here when you want it.

---

## Global

| Key | Does | Works when |
|---|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Toggle inspect mode | Always |
| <kbd>H</kbd> | Collapse / expand the toolbar | Always, inspect mode or not |
| <kbd>A</kbd> | Open / close the annotations panel | Inspect mode on |
| <kbd>F</kbd> | Freeze / unfreeze page animations | Inspect mode on |
| <kbd>Esc</kbd> | Close the innermost open thing | Always |

<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> is a Chrome *command*, so it works even when
the page has not been clicked yet. It is rebindable at `chrome://extensions/shortcuts`.

The rest are ordinary key handlers, so the **page** needs the keyboard for them to fire.
If you have just clicked something inside the extension's own UI — the composer, a
settings row — click the page once and they come back. See [[Troubleshooting]].

---

## Modes

| Key | Mode |
|---|---|
| <kbd>1</kbd> | Click an element *(default)* |
| <kbd>2</kbd> | Select text |
| <kbd>3</kbd> | Drag across elements |
| <kbd>4</kbd> | Measure distances — only when *Measuring tools* is on in Settings |

Mode keys need inspect mode on. <kbd>H</kbd> does not, which is the one asymmetry.

---

## Selecting

| Gesture | Does |
|---|---|
| **Click** | Annotate the element |
| <kbd>C</kbd> | Annotate what the pointer is hovering, **without clicking** — in mode 4, the measured pair |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+**click** | Add to a pick set — click again to remove |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+**drag** | Marquee, without leaving mode 1 |
| <kbd>Enter</kbd> | Annotate the pick set as it stands |
| <kbd>Esc</kbd> | Drop the pick set, or the measuring anchor, staying in inspect mode |
| **Drag the pill** | Move the toolbar — remembered per page |
| **Drag from a ruler** | Place a guide — drag it back onto the ruler to remove it. Needs *Screen rulers and guides* on |

**On macOS use <kbd>⌘</kbd>.** <kbd>Ctrl</kbd>+click there is a right-click.

---

## In the composer

| Key | Does |
|---|---|
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Save the note |
| <kbd>Esc</kbd> | Cancel |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>V</kbd> | Paste a reference image |

<kbd>Esc</kbd> pressed while a native `<select>` or a colour picker is open dismisses
*that*, not the composer — the control that owns the key keeps it.

---

## What Escape closes, in order

<kbd>Esc</kbd> always takes the innermost thing first, so it is safe to press repeatedly:

1. a tooltip
2. the open card — composer, settings, or the markup editor
3. a half-built pick set
4. the panel
5. inspect mode

---

## Keys the extension deliberately does not take

Everything not listed above reaches the page unchanged. The extension does not intercept
<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd>, <kbd>Tab</kbd>, the arrow keys, or anything
the page has bound — annotating a keyboard-driven app must not require turning the
extension off.
