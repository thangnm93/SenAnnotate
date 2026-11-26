# Context — MCP bridge

## The shape is forced by two facts

1. **An extension cannot listen.** MV3 has no server socket API, and an MCP client only
   talks to a process it started (stdio) or to a URL. So the server has to be a separate
   program the agent starts, and the extension has to dial *it*.
2. **Only the service worker can hold the connection.** A content script dies with its
   tab, while the agent asks about every annotated page, open or not. And a content
   script's WebSocket goes out under the *page's* origin — the very thing the server must
   refuse (below). The worker is the one context that outlives tabs and dials as the
   extension.

## Alternatives that were rejected

| | Why not |
|---|---|
| **Native messaging** | Adds the `nativeMessaging` permission — a Store release that fails at publish until someone fills the Privacy tab by hand — and an OS-specific host manifest the user must install. Worse, Chrome launches the native host itself, so it is a *different* process from the one the agent starts over stdio: the two would still need their own IPC. |
| **Extension serves, agent polls** | Impossible; see fact 1. |
| **A file in `~/Downloads` the server watches** | One-way, leaves a copy of every note on disk, and gives nothing back to mark done. |
| **One port per agent, extension dials a range** | A failed connection per empty port on every worker wake-up, and the extension would have to know how many agents run. Hub/relay keeps that knowledge on the Node side. |
| **The MCP SDK and `ws`** | Bundled, they would cost the user nothing at install time — but this process holds the reviewer's notes, screenshots included, and every package in it is code to trust. The protocol surface a tools-only stdio server needs is four methods, and the WebSocket surface needed against one known client is a few frame types. |

## The security model

Loopback keeps the internet out and lets every page in the reviewer's browser in: a page
can open a WebSocket to `127.0.0.1` (not subject to CORS) and can fire requests at it.
A server that trusted loopback would let any site read the notes, inject fake ones into
the agent's context (a prompt-injection route), or mark them done. So, on every request:

- **`Host`** must be `127.0.0.1:<port>` or `localhost:<port>`. A DNS-rebinding page
  arrives under its own hostname.
- **`/extension`** (the WebSocket) requires `Origin: chrome-extension://<32 a–p>`. Browsers
  always send `Origin` on a WebSocket handshake and pages cannot set it.
- **…and a trusted id. Fails closed.** Every *other* installed extension can dial loopback
  with its own extension origin, and one the hub believed could put invented notes in front
  of an agent that edits code and runs commands. So the hub trusts the Web Store build's id
  (`OFFICIAL_EXTENSION_IDS` in `shared/mcp.ts`) and the ids named in
  `SENANNOTATE_EXTENSION_ID` (comma-separated), and nothing else. An unknown id gets past
  the handshake only to be told `refused` and closed with 4003; nothing it sends is read.
  The handshake is completed rather than refused because a refused handshake looks, from
  inside the worker, exactly like no server — and "start your agent" is the wrong advice
  for a server that is running and saying no. The settings card shows the id to name.

  The first version accepted any extension id unless pinned. An automated security review
  flagged that as fail-open; unpacked ids differing per folder had been the argument for
  it, and the settings card naming the id answers that argument at the cost of one line of
  agent config for people running from source.
- **`/health` and `/call`** (relay endpoints, for other `senannotate-mcp` processes) refuse
  any request with `Origin` or `Sec-Fetch-Site` — every page request carries one, Node's
  `fetch` neither — and `/call` requires `Content-Type: application/json`, which a page
  cannot send cross-origin without a preflight this server never answers.
- **The extension dials `127.0.0.1` only.** The host is a constant in `shared/mcp.ts`, not a
  setting. A setting can be changed by an import, a sync from another machine or a
  confused user; a constant cannot point the notes at the internet.

### What it does not defend against: whoever owns the port

The extension authenticates nothing about the server. Whatever is listening on
`127.0.0.1:<port>` when the switch is on gets the snapshot, and can send `set-status`.

- **A process running as the reviewer** gains nothing by squatting: it can already read
  `chrome.storage.local` straight out of the Chrome profile on disk.
- **A process running as another OS user** is the real residual. Loopback is shared across
  accounts, so on a machine several people log into, another account could bind the port
  first and receive the notes — which it could not read from this user's profile.

Closing it needs a secret the extension and the server share: the server prints a pairing
key once, the reviewer pastes it into the settings card, and the server proves it holds it
(an HMAC over a nonce in `welcome`) before the worker sends a byte of notes or obeys a
command. Raised by an automated review of the first commit.

**Decided against, 26 November 2026, by the project owner:** it puts a copy-and-paste step
in front of every user to defend a shared-machine case, and development machines are
overwhelmingly single-user. `PRIVACY.md` discloses the residual and says to leave the switch
off on a shared computer. Revisit only if the bridge is offered somewhere shared machines
are the norm.

## Lifetime of the worker

From Chrome 116, a WebSocket that carries a message inside each 30-second idle window
keeps the service worker alive ([Chrome docs: WebSockets in service
workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)),
hence the 20 s ping. On 111–115 the worker sleeps and the socket with it; the badge message
every page sends on render wakes the worker, and its startup dials again.

**This cannot be observed under Playwright.** Playwright attaches to the extension's
service worker over CDP, and an attached debugger keeps a worker alive regardless. The
suite checks what it can — reconnection after a hub exits, which needs the retry path —
and the lifetime rule rests on the documentation above.

## Why a snapshot, not deltas

Storage is the truth and the worker can be killed between any two events. A delta stream
would have to survive a restart on both ends; a snapshot only has to be sent again. It is
re-sent whole, debounced 250 ms, on every `chrome.storage.local` change to an annotation
key — which also means notes added after the agent connected reach it with no extra code.
Size is bounded by storage itself (4 MB per page, 10 MB in all), and it travels over
loopback.

## Why `set_status` writes storage *and* messages the tab

The worker writes `chrome.storage.local` first: it is the truth, and it covers pages no
tab is showing. Then it messages every tab on that *site* — not only the one showing that
page — because since `docs/multi-page-list/` an open tab holds its origin's whole list in
memory and writes that copy back, every page of it, on the reviewer's next edit. Without the
message, the reviewer's next click silently undid the agent — `test/mcp.mjs` has the check,
and it fails against a build without the handler.

The tab does **not** `persist()` on that message: storage is already right, and persisting
would re-run the quota trim and repeat its "stored without N images" toast.

## The report over MCP

`get_report` is `generateSessionOutput` — the *Copy session* document, unchanged, so an
agent and a person read the same thing. Two differences, both in `mcp/tools.ts` rather than
`output.ts`:

- **Images are pointers.** A `data:` URI is unreadable to an agent as text and costs it
  hundreds of kilobytes of context. The field's value becomes `get_annotation:<id>`, so
  `output.ts` still prints its *Screenshot* / *Reference* headings — the part that says what
  a picture is *for* — and `get_annotation` returns the pixels as MCP image content.
- **An id map is appended.** The report numbers notes for a person; `set_status` needs ids.

No diagnostics: console errors, failed requests and the action trail live in the page's
memory and are never stored (`PRIVACY.md`), so they cannot be in a snapshot.

## Small decisions

- **Port 7362** spells SENA on a phone keypad, is unassigned, and sits outside the ranges
  dev servers default to — the collision that matters, since the page under review runs on
  the same machine.
- **`wakeMcpBridge` is rate-limited to once per 3 s.** The badge message fires on every
  render, not only on load; without the limit a reviewer clicking around with no server
  running fires a failed connection per click.
- **The server is not minified** in a release build. People read it to decide whether to
  trust it, and its stack traces land in bug reports.
- **`tsconfig.mcp.json` keeps the DOM lib.** `shared/output.ts`'s *live* report header
  reads `window` and `navigator`. The server only reaches the session report, which reads
  neither, and esbuild drops the rest — but `tsc` checks the module whole. The guard for
  the runtime is `test/mcp.mjs` running the real bundle.

## Not done, and where it would attach

- **npm.** `npx senannotate-mcp` needs a published package; the repo is `private`. The
  bundle is already a single file with a shebang.
- **A `wait_for_annotations` tool** that blocks until the reviewer adds a note — the hub
  already sees every snapshot arrive.
- **Live diagnostics.** Would need the worker to ask the top frame of an open tab for its
  mirror — a new content message, and a privacy statement to match.
- **Re-shooting `wiki/images/settings-card.png`** (`npm run wiki:assets`), which predates
  the new *AI agent* group.
