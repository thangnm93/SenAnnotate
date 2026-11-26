# Changelog — MCP bridge

## Built

- `src/shared/mcp.ts` — the wire both ends import: default port, the fixed host, message
  shapes, the status the settings card shows.
- `src/mcp/` — `senannotate-mcp`, bundled to `dist-mcp/senannotate-mcp.mjs` (49 KB,
  unminified, no dependencies): `websocket.ts` (server half of RFC 6455), `hub.ts` (the
  listener and its guard rails), `tools.ts` (four tools as pure functions), `node.ts`
  (hub-or-relay and takeover), `index.ts` (JSON-RPC over stdio).
- `src/background/mcp.ts` — the bridge in the worker; wired into the badge message as its
  wake-up and into a new `mcp-status` message.
- `content/index.ts` — `annotations-updated` handler and the settings card's status poll.
- `content/ui/settings.ts` — an *AI agent* group: the switch, *Port*, *Status*.
- `Settings.mcpBridge` (default `false`) and `Settings.mcpPort` (default 7362).
- `tsconfig.mcp.json`; `npm run typecheck` now runs both configs. `@types/node@22` added as
  a dev dependency — type definitions only, nothing bundled.
- `test/mcp.mjs` (59 checks) and `test/fixtures/mcp.html`; added to `npm test`, and as
  `npm run test:mcp`.
- `scripts/pack.mjs` writes `senannotate-mcp-<version>.mjs` beside the zip;
  `release.yml` attaches it. `.gitignore` covers both.
- Words: `PRIVACY.md`, `store/listing-privacy.md`, `README.md`, `wiki/` (a new *Agent
  Connection MCP* page, a section in *Settings*, sidebar and home links), `CLAUDE.md`.
- `wiki/images/agent-connection.png` — shot once, by hand, against a running server. Not
  produced by `npm run wiki:assets`, which would have to start `senannotate-mcp` with the
  unpacked build's id to show the *Connected* state; worth adding when that script is next
  touched.

No new manifest permission: a WebSocket to `127.0.0.1` needs none. So the Store publish
step will not fail with `INVALID_ITEM_METADATA` the way 0.8.7's did — but the justification
texts pasted into the dashboard's Privacy tab now say less than the extension does, and
should be re-pasted from `store/listing-privacy.md` with the release.

## What went wrong on the way

**The second type-check found the DOM in `shared/output.ts`.** `tsconfig.mcp.json` started
without the DOM lib, on the theory that it would catch shared code the server cannot run.
It flagged `renderHeader`'s `window.innerWidth` at once — real, but on a path the server
never takes (`generateOutput`, the live report; the server only calls
`generateSessionOutput`), and absent from the bundle (`grep -c 'window\.'` on it: 0). DOM
went back into that config with the reason written beside it; the runtime guard is the
test running the real bundle.

**Closing stdin lost the answer in flight.** The first smoke test piped four requests and
an EOF into the server; the tool call never came back. `close` on the line reader exited the
process while `tools/call` was still in its 3-second "a hub that just started may not have
a browser yet" wait. The server now waits for in-flight requests before stopping. An agent
would rarely close stdin mid-call, but a test harness does it on every run.

**The first "off by default" check passed for free.** It asserted that, with the switch at
its default, the agent on a random test port saw no browser. A bridge that was *on* by
default would have dialled 7362 — not the test port — and produced the same silence.
Confirmed by flipping the default to `true`: the check still passed. Fixed by pointing
`mcpPort` at the test port in sync storage *before* the page loads, leaving `mcpBridge`
unset; against the same broken build it now fails ("2 open notes — Chrome 148").

**A shutdown fix that measured as unnecessary, kept for a narrower reason.** Review of
`hub.ts` suggested a hub would outlive its agent while a relay's pooled keep-alive
connection stayed open, holding the port. Measured: it exits in under 10 ms either way —
Node 19+ `server.close()` drops idle connections itself. `closeAllConnections()` stayed,
with a comment saying what it is actually for: a relayed request still *in flight* (a
`set_status` can wait 8 s on the browser). The same review wrapped the relay endpoint's
tool call in a `try`, since an unhandled rejection there ends the hub every relay uses.

**The hub first trusted any extension.** As built, `/extension` accepted every well-formed
`chrome-extension://` origin unless `SENANNOTATE_EXTENSION_ID` pinned one — fail-open, as
an automated security review pointed out: any other installed extension could connect and
feed the agent invented notes. Now it trusts the Web Store id plus the ids that variable
names, and tells everything else `refused` (new wire message, new `refused` bridge state,
the card printing the id to add). `test/mcp.mjs` gained seven checks; against a build with
the trust test disabled, four of them fail — including the real unpacked extension being
told it is refused.

**The Store texts went over the form's 1,000-character limit.** The first draft of
`store/listing-privacy.md` appended the agent connection to three fields: *Single purpose*
reached 1,177 characters, *storage* 1,283 and the host permission 1,063. The form rejects a
field over the limit — the repo has two earlier `fix:` commits for exactly this. Rewritten to
965, 988 and 999 (counted with newlines, as the file's other counts are).

**Valid JSON that is not an object stopped the server.** An automated review of the pushed
commit found that `null` as a relay `/call` body reached `call.name` and threw inside an
async handler nobody caught — an unhandled rejection, which ends a Node process, and with
it the hub every relay uses. The extension socket (`null` as a message) and stdio (`null`
as a line) had the same shape. Checked before fixing: against the committed server, a
`POST /call` with body `null` reset the connection (status 0) and every later request
failed. All three channels now require an object, and the HTTP handler has a `.catch` of
its own; `test/mcp.mjs` sends `null`, `[1]` and `7` down each and asserts the server still
answers. The same review raised port squatting — `context.md`, *What it does not defend
against*.

**Two more builds were broken on purpose** to make sure the end-to-end checks can fail:

| Broken build | Checks that failed |
|---|---|
| `mcpBridge: true` by default | *with the switch at its default, the extension makes no connection*, then the run stops at the port row (the click turned the switch *off*) |
| content ignores `annotations-updated` | *the open tab's panel shows the note done without a reload*, *the reviewer's next edit keeps the agent's change* (`[["m1","done"],["m2","open"]]`) |

The second row is the one that justified the tab message at all: without it, the
reviewer's next click wrote the tab's stale copy over the agent's change.

## Verified

Run headless (`SENANNOTATE_HEADLESS=1`), Chromium 148 via Playwright 1.60:

- `npm run typecheck` — clean, both configs.
- `npm test` — measure: all checks passed; e2e: 410/410; upgrade: 9/9; MCP: 52/52.
- After the fail-closed change, the whole suite again: measure all passed; e2e 410/410;
  upgrade 9/9; MCP 59/59.
- After the malformed-JSON fix: `test/mcp.mjs` 63/63 (`src/content/` untouched since the
  full run).

Not verified here: the worker staying alive on an idle Chrome 116+ with no debugger
attached (see `context.md` — Playwright's CDP attachment keeps every worker alive), and
real agents (Claude Code, Cursor) against the built server beyond the protocol checks.
