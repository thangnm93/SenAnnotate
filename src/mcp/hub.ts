// =============================================================================
// Hub — the one process on the port
// =============================================================================
//
// Whichever `senannotate-mcp` binds the port first is the hub: the extension connects to
// it, it holds the snapshots, and it runs every tool call — its own agent's, and those
// relayed by the servers other agents started (`node.ts`).
//
// Everything that reaches it comes over loopback, which keeps the internet out and lets
// every web page in the reviewer's browser in. A page can open a WebSocket to 127.0.0.1
// (WebSockets are not subject to CORS) and can fire a POST at it, so a server that
// trusted loopback would hand any site the notes — or let it mark them done. The rules,
// each enforced on every request:
//
//   Host     must be 127.0.0.1:<port> or localhost:<port>. A DNS-rebinding page reaches
//            this socket under its own hostname, and that is where it is turned away.
//   /extension (WebSocket)
//            needs an `Origin` of `chrome-extension://<id>`. Browsers set `Origin` on a
//            WebSocket handshake and pages cannot forge it, so no page passes. And the id
//            must be trusted: the Web Store build's, or one named in
//            SENANNOTATE_EXTENSION_ID. Fails closed — any *other* installed extension can
//            dial loopback too, and one the hub believed could feed the agent invented
//            notes. An untrusted id is told so (`refused`) and disconnected; nothing it
//            sends is read.
//   /health, /call (the relay endpoints)
//            refuse any request that carries `Origin` or `Sec-Fetch-Site`. A browser sends
//            one or both on every request a page makes; Node's `fetch` sends neither.
//            `/call` also insists on `Content-Type: application/json`, which no page can
//            send cross-origin without a preflight this server never answers.
//
// A local process can still pass all three. It is already running as the reviewer, and
// nothing on loopback can be defended against that.
// =============================================================================

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  EXTENSION_ID_PATTERN,
  MCP_EXTENSION_PATH,
  MCP_HOST,
  OFFICIAL_EXTENSION_IDS,
  MCP_WIRE_VERSION,
  type BridgeCommand,
  type BridgePage,
  type CommandResult,
  type ExtensionMessage,
  type ServerMessage,
} from "../shared/mcp";
import type { OutputDetailLevel } from "../shared/types";
import { callTool, type BrowserView, type ToolHost, type ToolResult } from "./tools";
import { acceptUpgrade, refuseUpgrade, type WebSocketConnection } from "./websocket";

export const SERVER_NAME = "senannotate-mcp";

/**
 * The largest snapshot accepted. Storage caps one page at 4 MB (`content/storage.ts`) and
 * `chrome.storage.local` at 10 MB in all, so this is generous by design — a refused
 * snapshot means every tool answers from a stale one, which is worse than a large one.
 */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_RELAY_BODY_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 8_000;

const DETAIL_LEVELS = new Set<OutputDetailLevel>(["compact", "standard", "detailed", "forensic"]);

interface Browser {
  id: number;
  socket: WebSocketConnection;
  /** Set by `hello`. Nothing else is accepted from a browser that has not said it. */
  label: string | null;
  syncedAt: number | null;
  pages: BridgePage[];
  detailLevel: OutputDetailLevel;
}

interface Pending {
  browserId: number;
  resolve: (result: CommandResult) => void;
  timer: NodeJS.Timeout;
}

export interface HubOptions {
  port: number;
  version: string;
  log: (message: string) => void;
  /** Extension ids trusted on top of `OFFICIAL_EXTENSION_IDS` — unpacked and dev copies. */
  extraExtensionIds?: string[];
}

export class Hub implements ToolHost {
  readonly port: number;
  private readonly server: Server;
  private readonly connected = new Map<number, Browser>();
  private readonly pending = new Map<number, Pending>();
  private nextBrowserId = 1;
  private nextCommandId = 1;
  private readonly trusted: Set<string>;

  constructor(private readonly options: HubOptions) {
    this.port = options.port;
    this.trusted = new Set([...OFFICIAL_EXTENSION_IDS, ...(options.extraExtensionIds ?? [])]);
    this.server = createServer((request, response) => void this.onRequest(request, response));
    this.server.on("upgrade", (request, socket, head) => this.onUpgrade(request, socket, head));
  }

  /** Bind, or report that something already has the port. Any other error is thrown. */
  listen(): Promise<"listening" | "in-use"> {
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        this.server.off("listening", onListening);
        if (error.code === "EADDRINUSE") resolve("in-use");
        else reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve("listening");
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.port, MCP_HOST);
    });
  }

  close(): Promise<void> {
    for (const browser of this.connected.values()) browser.socket.close();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      // `close` already drops *idle* keep-alive connections (Node 19+; measured: a hub with
      // a relay's pooled connection open exits in under 10 ms without this). What it still
      // waits for is a request in flight — a relayed `set_status` can sit 8 s on the
      // browser's answer — and the port the relays want stays held until it ends.
      this.server.closeAllConnections();
    });
  }

  // ---------------------------------------------------------------------------
  // ToolHost
  // ---------------------------------------------------------------------------

  browsers(): BrowserView[] {
    return [...this.connected.values()]
      .filter((browser) => browser.label !== null)
      .map((browser) => ({
        id: browser.id,
        label: browser.label as string,
        syncedAt: browser.syncedAt,
        pages: browser.pages,
        detailLevel: browser.detailLevel,
      }));
  }

  command(browserId: number, command: BridgeCommand): Promise<CommandResult> {
    const browser = this.connected.get(browserId);
    if (!browser) return Promise.resolve({ ok: false, error: "the browser disconnected" });

    const id = this.nextCommandId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: `the browser did not answer within ${COMMAND_TIMEOUT_MS / 1000} s` });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { browserId, resolve, timer });
      this.send(browser, { type: "command", id, command });
    });
  }

  call(name: string, args: unknown): Promise<ToolResult> {
    return callTool(this, name, args);
  }

  // ---------------------------------------------------------------------------
  // HTTP — the relay endpoints
  // ---------------------------------------------------------------------------

  private async onRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.hostAllowed(request) || fromABrowser(request)) {
      return respond(response, 403, { error: "forbidden" });
    }

    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method === "GET" && path === "/health") {
      return respond(response, 200, {
        name: SERVER_NAME,
        version: this.options.version,
        wire: MCP_WIRE_VERSION,
        browsers: this.browsers().length,
      });
    }

    if (request.method === "POST" && path === "/call") {
      if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
        return respond(response, 415, { error: "application/json only" });
      }
      const body = await readBody(request, MAX_RELAY_BODY_BYTES);
      if (body === null) return respond(response, 413, { error: "too large" });

      let call: { name?: unknown; args?: unknown };
      try {
        call = JSON.parse(body) as { name?: unknown; args?: unknown };
      } catch {
        return respond(response, 400, { error: "not JSON" });
      }
      if (typeof call.name !== "string") return respond(response, 400, { error: "name required" });

      // A throw here would be an unhandled rejection — which ends the process, and with it
      // the hub every other agent relays through. A tool that fails answers as a tool.
      let result: ToolResult;
      try {
        result = await this.call(call.name, call.args);
      } catch (error) {
        result = { content: [{ type: "text", text: `Internal error: ${String(error)}` }], isError: true };
      }
      return respond(response, 200, { result });
    }

    respond(response, 404, { error: "not found" });
  }

  // ---------------------------------------------------------------------------
  // WebSocket — the extension
  // ---------------------------------------------------------------------------

  private onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const extensionId = extensionIdOf(request.headers.origin);
    if (path !== MCP_EXTENSION_PATH || !this.hostAllowed(request) || extensionId === null) {
      this.options.log(`refused a connection from ${String(request.headers.origin ?? "no origin")} to ${path}`);
      return refuseUpgrade(socket, 403, "Forbidden");
    }

    const connection = acceptUpgrade(request, socket, head, MAX_MESSAGE_BYTES);
    if (!connection) return;

    if (!this.trusted.has(extensionId)) {
      this.options.log(
        `refused extension ${extensionId}: not the Web Store build. If it is your own unpacked copy, start the server with SENANNOTATE_EXTENSION_ID=${extensionId}`,
      );
      connection.send(
        JSON.stringify({
          type: "refused",
          reason: `this server does not trust extension ${extensionId}`,
        } satisfies ServerMessage),
      );
      connection.close(4003);
      return;
    }

    const browser: Browser = {
      id: this.nextBrowserId++,
      socket: connection,
      label: null,
      syncedAt: null,
      pages: [],
      detailLevel: "standard",
    };
    this.connected.set(browser.id, browser);

    connection.onMessage = (text) => this.onBrowserMessage(browser, text);
    connection.onClose = () => {
      this.connected.delete(browser.id);
      for (const [id, pending] of this.pending) {
        if (pending.browserId !== browser.id) continue;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve({ ok: false, error: "the browser disconnected" });
      }
      if (browser.label) this.options.log(`browser disconnected: ${browser.label}`);
    };
  }

  private onBrowserMessage(browser: Browser, text: string): void {
    let message: ExtensionMessage;
    try {
      message = JSON.parse(text) as ExtensionMessage;
    } catch {
      return;
    }

    if (message.type === "hello") {
      if (message.wire !== MCP_WIRE_VERSION) {
        this.options.log(
          `refused a browser speaking wire ${String(message.wire)} (this server speaks ${MCP_WIRE_VERSION}) — update whichever is older`,
        );
        browser.socket.close(1002);
        return;
      }
      browser.label = `${oneLine(message.browser)} · SenAnnotate ${oneLine(message.version)}`;
      this.send(browser, { type: "welcome", wire: MCP_WIRE_VERSION, version: this.options.version });
      this.options.log(`browser connected: ${browser.label}`);
      return;
    }

    if (browser.label === null) return;

    switch (message.type) {
      case "snapshot":
        browser.pages = validPages(message.pages);
        browser.detailLevel = DETAIL_LEVELS.has(message.detailLevel) ? message.detailLevel : "standard";
        browser.syncedAt = Date.now();
        return;
      case "result": {
        const pending = this.pending.get(message.id);
        if (!pending || pending.browserId !== browser.id) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        pending.resolve(validResult(message.result));
        return;
      }
      case "ping":
        this.send(browser, { type: "pong" });
        return;
      default:
        return;
    }
  }

  private send(browser: Browser, message: ServerMessage): void {
    browser.socket.send(JSON.stringify(message));
  }

  // ---------------------------------------------------------------------------
  // Who may talk to this
  // ---------------------------------------------------------------------------

  private hostAllowed(request: IncomingMessage): boolean {
    const host = request.headers.host;
    return host === `${MCP_HOST}:${this.port}` || host === `localhost:${this.port}`;
  }

}

/** The id in a `chrome-extension://<id>` origin, or null for any other origin. */
function extensionIdOf(origin: string | undefined): string | null {
  const prefix = "chrome-extension://";
  if (typeof origin !== "string" || !origin.startsWith(prefix)) return null;
  const id = origin.slice(prefix.length);
  return EXTENSION_ID_PATTERN.test(id) ? id : null;
}

/** Every request a web page makes carries at least one of these; Node's `fetch` neither. */
function fromABrowser(request: IncomingMessage): boolean {
  return request.headers.origin !== undefined || request.headers["sec-fetch-site"] !== undefined;
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function readBody(request: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    request.on("end", () => resolve(over ? null : Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(null));
  });
}

/**
 * Keep the pages that have the shape the tools read, drop the rest.
 *
 * The sender is the extension, but the check is cheap and the tools index into these
 * without guarding — a malformed entry would otherwise surface as a crash in the middle
 * of an agent's tool call.
 */
function validPages(value: unknown): BridgePage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is BridgePage =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as BridgePage).page === "string" &&
        Array.isArray((entry as BridgePage).annotations),
    )
    .map((entry) => ({
      page: entry.page,
      annotations: entry.annotations.filter(
        (annotation) =>
          typeof annotation === "object" &&
          annotation !== null &&
          typeof annotation.id === "string" &&
          typeof annotation.comment === "string" &&
          typeof annotation.element === "string",
      ),
    }));
}

function validResult(value: unknown): CommandResult {
  const result = value as CommandResult | undefined;
  if (result?.ok === true && Array.isArray(result.updated) && Array.isArray(result.missing)) {
    return { ok: true, updated: result.updated.map(String), missing: result.missing.map(String) };
  }
  if (result?.ok === false) return { ok: false, error: String(result.error) };
  return { ok: false, error: "the browser sent an unreadable answer" };
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").slice(0, 80);
}
