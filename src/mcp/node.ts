// =============================================================================
// Hub or relay — several agents, one port
// =============================================================================
//
// Every agent session starts its own `senannotate-mcp` (stdio servers are per client),
// and a reviewer running two Claude Code terminals has two. Only one of them can own the
// port the extension dials, and the extension only dials one.
//
// So the first to bind becomes the hub and the rest relay: they answer `tools/list`
// themselves and forward `tools/call` to the hub over HTTP. When the hub's agent exits,
// its process goes with it — the relays notice on their next health check (or their next
// call) and race to bind; the winner is the new hub, the losers relay through it, and the
// extension's retry finds the new hub on the same port.
//
// The alternative — every server on its own port, the extension dialling a range — puts
// a failing connection attempt per empty port into the worker on every wake-up, and
// makes the extension the thing that has to know how many agents are running.
// =============================================================================

import { Hub, SERVER_NAME } from "./hub";
import type { ToolResult } from "./tools";

const HEALTH_INTERVAL_MS = 3_000;
const HEALTH_TIMEOUT_MS = 1_500;
/** After becoming the hub, how long a tool call waits for the extension to dial in. */
const FRESH_HUB_GRACE_MS = 15_000;
const BROWSER_WAIT_MS = 3_000;

export type Role = "starting" | "hub" | "relay" | "conflict";

export interface NodeOptions {
  port: number;
  version: string;
  log: (message: string) => void;
  extraExtensionIds?: string[];
}

export class McpNode {
  role: Role = "starting";
  private hub: Hub | null = null;
  private hubSince = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private claiming: Promise<Hub | null> | null = null;

  constructor(private readonly options: NodeOptions) {}

  async start(): Promise<void> {
    await this.claim();
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    await this.hub?.close();
    this.hub = null;
  }

  async call(name: string, args: unknown): Promise<ToolResult> {
    if (this.hub) return this.callHub(this.hub, name, args);

    if (this.role === "conflict") {
      // Something that is not us still has the port — but it may have gone since the last
      // health check, and a call is a good moment to look again.
      const hub = await this.claim();
      if (hub) return this.callHub(hub, name, args);
      if (this.role === "conflict") return conflict(this.options.port);
    }

    try {
      return await this.relay(name, args);
    } catch {
      // The hub went away between health checks. Take over and answer locally.
      const hub = await this.claim();
      if (hub) return this.callHub(hub, name, args);
      try {
        return await this.relay(name, args);
      } catch (error) {
        return {
          content: [{ type: "text", text: `Could not reach the SenAnnotate hub on port ${this.options.port}: ${String(error)}` }],
          isError: true,
        };
      }
    }
  }

  /**
   * A hub that has only just taken over has no browser yet: the extension finds it on its
   * next retry, a second or so later. Answering "nothing is connected" in that window
   * would send the agent off to tell the reviewer to fix a setting that is fine.
   */
  private async callHub(hub: Hub, name: string, args: unknown): Promise<ToolResult> {
    if (!hub.browsers().length && Date.now() - this.hubSince < FRESH_HUB_GRACE_MS) {
      const deadline = Date.now() + BROWSER_WAIT_MS;
      while (!hub.browsers().length && Date.now() < deadline) await sleep(150);
    }
    return hub.call(name, args);
  }

  private async relay(name: string, args: unknown): Promise<ToolResult> {
    const response = await fetch(`http://127.0.0.1:${this.options.port}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    if (!response.ok) throw new Error(`hub answered HTTP ${response.status}`);
    const body = (await response.json()) as { result?: ToolResult };
    if (!body.result) throw new Error("hub sent no result");
    return body.result;
  }

  // ---------------------------------------------------------------------------

  /** Try to become the hub. The hub when this process now owns the port, else null. */
  private claim(): Promise<Hub | null> {
    // Two calls arriving together must not build two servers on one port.
    this.claiming ??= this.claimOnce().finally(() => {
      this.claiming = null;
    });
    return this.claiming;
  }

  private async claimOnce(): Promise<Hub | null> {
    if (this.hub) return this.hub;

    const hub = new Hub(this.options);
    if ((await hub.listen()) === "listening") {
      this.hub = hub;
      this.hubSince = Date.now();
      this.role = "hub";
      if (this.healthTimer) clearInterval(this.healthTimer);
      this.healthTimer = null;
      this.options.log(`listening on 127.0.0.1:${this.options.port} — waiting for the browser`);
      return hub;
    }

    const owner = await this.health();
    const before = this.role;
    this.role = owner === "other" ? "conflict" : "relay";
    if (this.role !== before) {
      this.options.log(
        this.role === "relay"
          ? `another senannotate-mcp owns port ${this.options.port}; relaying through it`
          : `port ${this.options.port} is in use by another program; set SENANNOTATE_MCP_PORT (and the same port in the extension)`,
      );
    }
    this.watch();
    return null;
  }

  private watch(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      void this.health().then((owner) => {
        if (owner === "down") void this.claim();
        else if (owner === "ours" && this.role === "conflict") this.role = "relay";
      });
    }, HEALTH_INTERVAL_MS);
    // Never the reason the process stays up; stdin closing is.
    this.healthTimer.unref();
  }

  private async health(): Promise<"ours" | "other" | "down"> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.options.port}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as { name?: string } | null;
      return body?.name === SERVER_NAME ? "ours" : "other";
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      return code === "ECONNREFUSED" ? "down" : "other";
    }
  }
}

function conflict(port: number): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Port ${port} is in use by another program, so the SenAnnotate MCP server cannot listen on it. Start the server with SENANNOTATE_MCP_PORT set to a free port, and set the same port in the extension (Settings → AI agent).`,
      },
    ],
    isError: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
