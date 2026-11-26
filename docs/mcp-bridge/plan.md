# Plan — MCP bridge

The order is chosen so each step can be checked before the next one leans on it.

1. **Wire types** — `src/shared/mcp.ts`: default port, the host the extension may dial,
   the extension ↔ server messages, the bridge status the settings card shows. Shared by
   the service worker and the server, so neither can drift from the other.

2. **The server** — `src/mcp/`, bundled by `build.mjs` into `dist-mcp/senannotate-mcp.mjs`
   (`platform: node`, outside `dist/` because `dist/` is the Web Store package):
   - `websocket.ts` — the server half of RFC 6455, enough for one well-behaved client:
     masked client frames, fragmentation, ping/pong, close, a size cap.
   - `hub.ts` — the HTTP listener on `127.0.0.1`. `Host` checked on every request; the
     WebSocket path admits only a `chrome-extension://` `Origin`; the relay endpoints
     refuse any request that carries an `Origin` at all, which is every browser request.
   - `tools.ts` — the four tools as pure functions over the snapshots, so they can be
     tested without a browser or a socket.
   - `node.ts` — hub-or-relay: bind the port, or relay through whoever has it, and take
     over when it goes.
   - `index.ts` — MCP over stdio (JSON-RPC 2.0, newline-delimited), version negotiation,
     `tools/list`, `tools/call`; everything else on stderr.

3. **The bridge** — `src/background/mcp.ts`: read the two settings, dial
   `ws://127.0.0.1:<port>/extension`, send `hello` and a snapshot, re-send the snapshot
   (debounced) on every annotation write, ping every 20 s so Chrome 116+ keeps the worker
   alive, back off and retry on close, answer `set-status` by writing storage and telling
   the open tabs. The badge message every page load already sends is the wake-up.

4. **The page** — `content/index.ts`: apply an `annotations-updated` message to the
   in-memory list (status only), persist, re-render, toast.

5. **Settings** — `mcpBridge` and `mcpPort` in `Settings`; a group in the settings card
   with the switch, the port, and a status line polled from the worker while the card is
   open.

6. **Tests** — `test/mcp.mjs`, its own launch like `upgrade.mjs`:
   - server only: MCP handshake, `tools/list`, a refused web `Origin`, a refused `Host`,
     a refused relay call carrying an `Origin`;
   - with the extension: notes seeded into storage reach `list_annotations`; `get_report`
     matches; `get_annotation` returns the image; `set_status` flips the note in an open
     tab's panel; switch off closes the connection;
   - two servers: the second relays, and takes over when the first exits.

7. **Words** — `PRIVACY.md`, `store/listing-privacy.md`, `README.md`, the wiki, this
   folder's `context.md` and `changelog.md`, the index in `docs/README.md`, and the
   architecture table in `CLAUDE.md`.

8. **Release plumbing** — `pack.mjs` copies the server beside the zip as
   `senannotate-mcp-<version>.mjs`; `release.yml` attaches it.
