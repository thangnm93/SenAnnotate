# Brief — the picture of what it should look like instead

## The problem

Every image the extension holds today is a photograph of the **current** state: the
composer's camera crops the element as it is. There is no way to attach the thing the
element should look like — an approved Figma frame, a competitor's page, a screenshot
from the design review.

That is the case words are worst at. "Tighten the spacing and make it feel less heavy"
costs a paragraph, survives being misread, and still leaves an agent guessing. One
picture ends it.

## What ships

- **Paste an image into the composer.** The primary route — from Figma, from a
  screenshot tool, from anywhere. Text paste is untouched.
- **An attach button** beside the camera, for an image already on disk.
- **Up to three per note**, shown as thumbnails with a remove button, and kept when the
  note is reopened for editing.
- **A report heading that says what they are**: *Reference — how it should look, not how
  it looks now*, followed by a line telling the agent to reach for the project's tokens
  rather than the literal values it can read off the picture.

## Not in scope

- Annotating the reference. The markup editor belongs to the screenshot, which is of
  *our* page; a pasted image is somebody else's artefact.
- Drag and drop onto the composer. Paste covers the clipboard and the picker covers the
  disk; a third route earns nothing.
- Any upload. The image is a `data:` URI in `chrome.storage.local` like everything else.
