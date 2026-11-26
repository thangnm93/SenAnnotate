# Context

## Root cause

Reproduced on `test/fixtures/inspect-freeze.html` with `freezeOnInspect` on. Turning
inspect on parks `setTimeout`, `setInterval` and `requestAnimationFrame` (the freeze
engaged by `setActive(true)`), and nothing took the freeze off again. After leaving
inspect the page's intervals stopped ticking and a `setTimeout` scheduled by a click never
ran: menus, carousels and debounced handlers go dead, which reads as a hung tab. The only
way out was to find the Freeze button.

With the setting off (the default) the page keeps running after inspect and clicks reach
it again. So the report only applies to users who turned *Freeze animations on inspect*
on, which is consistent with the reporter seeing it "after choosing inspect".

Not the cause, checked: `mousedown`/`mouseup`/`click` swallowing is gated on `active`, and
stops with inspect. Page clicks work again straight after leaving.

## Fix

`frozenByInspect` records that the freeze was inspect's own. `setActive(false)` releases
it; a freeze the user asked for (toolbar button or key) clears the flag and is left alone.

## Debug log

- Lives in the top-frame content script (`content/debug-log.ts`): a 500-entry ring buffer,
  only filled while `Settings.debugMode` is on, discarded when it is turned off.
- Recorded: state transitions (`active`, `mode`, `frozen`, composer/panel open), freeze
  on/off (and whether inspect or the user did it), every `pointerdown`/`click` seen at the
  window in capture phase with the overlay state at that moment, and the clicks the
  overlay swallowed.
- Privacy: a target is `tag#id.class.class` (three classes, each cut at 30 characters).
  No text content, attribute values or field values; the page is origin + pathname.
- The toggle is in the in-page settings card, not the popup: the popup stopped writing
  settings when they moved into the card (`popup/index.ts` header).
- The popup's *Save .json* asks the active tab's content script for the log
  (`get-debug-log`) and saves it with `shared/download.ts`.
- The inspector (MAIN world) is not involved: the content script's own `frozen` flag is
  what the freeze toggle drives, and a bridge round trip would add a 500 ms timeout path
  to a diagnostic tool.
