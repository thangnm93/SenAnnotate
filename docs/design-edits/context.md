# Context — a preview is a loan

## The rule that shaped everything

**The page is never permanently modified.** Every override is an inline style; the
snapshot taken when the composer opens holds the `style` attribute *verbatim* — almost
always absent — and `revertDesign` puts that attribute back. When there was none it is
*removed*, not blanked, because an element that gained a bare `style=""` has still been
changed, visibly in devtools and to any page code that reads the attribute.

The attribute rather than the properties, and that is not a shortcut. A per-property
snapshot cannot describe what it found on two counts, both of which destroy styling the
page had before we arrived:

- `padding`, `margin` and `gap` are **shorthands**. `getPropertyValue("padding")` is `""`
  unless every longhand is declared inline, while `removeProperty("padding")` deletes all
  four — so an element carrying `padding-left: 10px` loses it with nothing recorded to put
  back.
- `getPropertyValue` does not carry **`!important`**. `color: red !important` would have
  come back as `color: red` and started losing to the stylesheet rule it used to beat.

The revert runs from `closeComposer` — save, cancel, Escape — and from the top of
`openComposer`, which is the path where the *panel opens a different note*. That one needs
its own call rather than falling out of the first: every path that replaces an open
composer reassigns `composerTargets` before `openComposer` runs, so the element wearing the
preview is only still reachable because `designTarget` is held next to the snapshot. Three
e2e checks exist for no other purpose than this section.

That is a deliberate divergence from the tool this was modelled on, which keeps previews
live on the page. The argument against: the reviewer would then be testing the app
against a mirage — a change that exists in their tab and in no codebase — and a reload
would take it away with no explanation. The overlay's whole contract with the page it
stands on is that it does not touch it; a preview you can see while you are choosing is
worth having, a preview that persists is a different product.

## `from` is the computed value

The inline style is empty on any element styled by a stylesheet, which is all of them.
Reporting `from: ""` would be true and useless. `getComputedStyle` gives what the element
actually rendered as — `16px`, `rgb(37, 99, 235)` — and that is the state an agent is
changing away from.

Colours are the one place the two notations meet: computed style says
`rgb(37, 99, 235)` and `<input type="color">` says `#2563eb`. `diffDesign` converts the
computed side before comparing, or every colour would read as changed the moment the
picker was opened, and each row would print two notations for one colour.

A colour `#rrggbb` cannot hold — any alpha, and the `oklch()` a Tailwind v4 page computes
to — makes `rgbToHex` return **`null`**, not a fallback colour. A fallback of `#000000` is
a value the picker can also produce, and that turns a display compromise into two wrong
answers: `background-color` computes to `rgba(0, 0, 0, 0)` on most elements, so the swatch
would open on black for an element with no background at all, and picking black would then
make `from === to` and drop from the report a change the reviewer had watched being applied.
`null` forces both callers to say what they actually know — `diffDesign` reports the raw
computed string, which can never equal a `#rrggbb`, and the panel prints it beside the
swatch so the black is labelled rather than passed off as the element's own.

## An invalid value is not a delta

`setProperty` with a value the parser rejects is a silent no-op, and the controls fire on
every keystroke — `22px`, select-all, `1` is a state anyone reaches. So `previewDesign`
clears the property before setting it, which makes the page agree with the field, and
`diffDesign` drops anything `CSS.supports` refuses. Handing an agent `font-size: 1` as the
intent is worse than saying nothing.

## One table, four consumers

`DESIGN_FIELDS` in `content/design.ts` drives the controls, the preview, the diff and the
report. Adding a property is one entry — the same rule `inspector/detectors/index.ts`
follows. `ui/design-panel.ts` contains no property names at all; if a change to the field
set forces an edit there, the abstraction has leaked.

The set is small on purpose. These are the things a reviewer re-types in devtools before
writing the note, and every addition costs vertical space in a 380px card.

## `!important` on the preview

A stylesheet rule carrying `!important` would beat a plain inline value, and the control
would appear to do nothing on exactly the elements whose styling is most worth arguing
with. `removeProperty` clears the priority along with the value, so the revert is
unaffected.

## Where the panel does not appear

`composerTargets.length === 1 && !draft.selectedText`. A multi-element note and a text
selection have no single element to preview on, and quietly editing whichever element
happened to be first would be worse than the controls being absent.

The state has a second consequence, on the *save* path: re-editing a note whose element the
page has since rebuilt gives no snapshot, so there is nothing to diff and the deltas would
come out `undefined`. Writing those onto the annotation would delete edits recorded on an
earlier visit in exchange for fixing a typo in the comment — with no signal, since the
section is not drawn in that state. `onSubmit` therefore only writes `designChanges` and
`textChange` when a snapshot exists.

## Why the layer split is worth keeping

| Module | Knows |
|---|---|
| `content/design.ts` | the field table, the DOM, what a computed value is |
| `ui/design-panel.ts` | how to draw a labelled control and what the user typed |
| `content/index.ts` | which element it is, when to preview, when to revert |

The panel could have applied the styles itself in about ten fewer lines. It would then
own an element reference, and the revert — which must happen on paths the panel never
hears about, like the annotations panel opening another note — would have had to reach
back into it.
