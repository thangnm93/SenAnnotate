# Brief — an agent that reads the notes itself

## The problem

Every route out of the extension ends in a person pressing a button: *Copy report* puts
Markdown on the clipboard, the popup exports a JSON file or a self-contained `.html`. The
agent the report is written for sees only what was pasted into it, and three things fall
out of that:

- **The loop stops at the paste.** The reviewer annotates, copies, switches window,
  pastes, and the agent works from a frozen copy. A note added a minute later is not in it.
- **Screenshots do not travel.** `path` delivery names a file in `~/Downloads` that an
  agent on another machine — or in a sandbox — cannot open; `embed` delivery puts a few
  hundred kilobytes of base64 into a chat box.
- **Nothing comes back.** The agent fixes note 3 and the page still shows note 3 as open.
  Triage (`open`/`done`) exists, and only a human can drive it.

## What ships

- **A local MCP server**, `senannotate-mcp`, one self-contained Node file the agent starts
  over stdio (`claude mcp add senannotate -- node …/senannotate-mcp.mjs`). Zero runtime
  dependencies, like the extension.
- **A bridge in the extension's service worker** that connects to that server on
  `127.0.0.1` and keeps it supplied with the stored annotations. **Off by default**, behind
  a switch in the settings card, with the port beside it and a live status line.
- **Four tools:** `list_annotations` (ids, kind, status, note, element, source),
  `get_report` (the same Markdown *Copy session* produces, at any detail level),
  `get_annotation` (one note in full, with its screenshot and reference images as real
  image content), and `set_status` (mark notes done or open again — the page updates).
- **Several agents at once.** The first server to start owns the port; every later one
  relays through it, and takes over when it exits.

## Not in scope

- **Deleting annotations from the agent.** Only two things ever remove annotations —
  *Clear all* and *Clear after copying* (`docs/clear-on-copy/context.md`). An agent is not
  a third.
- **Creating annotations, or driving the page** (highlight, scroll, click). Read and
  triage first; the page belongs to the reviewer.
- **Diagnostics.** Console errors, failed requests and the action trail live in the page's
  memory and are never stored, so the session report has never carried them. The bridge
  does not change that — it carries what storage carries.
- **Publishing the server to npm.** It is built into `dist-mcp/` and attached to the
  GitHub Release. A registry package is a separate decision.
- **Any remote host.** The extension only ever dials `127.0.0.1`; the port is the only
  thing a user can change.

## Success looks like

- With the switch on and the server running, an agent lists the open notes on a page
  without anyone pressing *Copy*.
- `get_annotation` hands the agent the screenshot as an image it can look at.
- `set_status done` from the agent flips the note in an open tab, the panel and the badge
  included, without a reload.
- With the switch off — the default — the extension opens no connection of any kind, and
  `PRIVACY.md`'s "no network requests of its own" stays literally true.
- A web page cannot read the notes or mark them done by talking to the local server.
