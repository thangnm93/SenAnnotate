// =============================================================================
// MCP bridge — the wire between the extension and the local agent server
// =============================================================================
//
// An extension cannot listen on a port, and an MCP client only talks to a process it
// started (stdio) or a URL it was given. So the agent starts `senannotate-mcp`, that
// process listens on 127.0.0.1, and the extension's service worker dials *it*. This file
// is the one both ends import: the server bundle (`src/mcp/`, Node) and the worker
// (`src/background/mcp.ts`). Two copies of a message shape are two chances to drift.
//
// Kept free of anything that needs `chrome.*` or the DOM, because the server bundles it.
// =============================================================================

import type { Annotation, AnnotationStatus, OutputDetailLevel } from "./types";

/**
 * 7362 spells SENA on a phone keypad. Unassigned by IANA, and outside the ranges dev
 * servers default to (3000, 5173, 8080…), which is the collision that matters here: the
 * port is on the same machine as whatever is being reviewed.
 */
export const MCP_DEFAULT_PORT = 7362;

/**
 * The only host the extension will ever dial. Not a setting.
 *
 * Making the host configurable would turn a switch that means "hand my notes to a process
 * on this machine" into one that can send them anywhere — and a settings value is exactly
 * what a hostile import or a confused user can change. The port is the one degree of
 * freedom, and a port on loopback cannot leave the machine.
 */
export const MCP_HOST = "127.0.0.1";

/**
 * Extension ids the server trusts without being told: the Chrome Web Store build.
 *
 * The server *fails closed* on every other id. Any installed extension can open a
 * WebSocket to 127.0.0.1 with its own `chrome-extension://` origin, and one that the hub
 * accepted could feed the agent invented notes — a prompt-injection route into a process
 * that edits code and runs commands. An unpacked copy (whose id is derived from its folder)
 * is trusted only when the person starting the server names it in
 * `SENANNOTATE_EXTENSION_ID`, and the settings card shows them the id to name.
 */
export const OFFICIAL_EXTENSION_IDS: readonly string[] = ["nfplcbaoccfdgfpbkjiigfdpmjphbjla"];

/** The shape of a Chrome extension id: 32 letters a–p. */
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** The WebSocket path the extension connects on. The server refuses it to anything else. */
export const MCP_EXTENSION_PATH = "/extension";

/**
 * Version of *this* wire, not of either program. Bumped only on a change an older peer
 * would misread; the server refuses a `hello` it does not speak rather than guessing.
 */
export const MCP_WIRE_VERSION = 1;

/** The lowest and highest port the settings card accepts. Below 1024 needs root. */
export const MCP_PORT_RANGE = { min: 1024, max: 65535 } as const;

export function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MCP_PORT_RANGE.min &&
    value <= MCP_PORT_RANGE.max
  );
}

/** One page's stored notes, keyed the way storage keys them: `origin + pathname`. */
export interface BridgePage {
  page: string;
  annotations: Annotation[];
}

// -----------------------------------------------------------------------------
// extension → server
// -----------------------------------------------------------------------------

export type ExtensionMessage =
  | {
      type: "hello";
      wire: number;
      /** The extension's version, for the agent's "which build?" question. */
      version: string;
      /** Browser and major version, e.g. `Chrome 131`. A label, never parsed. */
      browser: string;
    }
  | {
      /**
       * Everything storage holds, sent whole.
       *
       * Whole rather than as deltas because the source of truth is `chrome.storage.local`
       * and the worker can be torn down between any two events — a delta stream has to
       * survive a restart on both ends, a snapshot only has to be sent again.
       */
      type: "snapshot";
      pages: BridgePage[];
      /** The reviewer's chosen detail level, the default for `get_report`. */
      detailLevel: OutputDetailLevel;
      at: number;
    }
  | { type: "result"; id: number; result: CommandResult }
  /** Keep-alive. Chrome 116+ keeps a worker alive while messages cross its WebSocket. */
  | { type: "ping" };

// -----------------------------------------------------------------------------
// server → extension
// -----------------------------------------------------------------------------

export type ServerMessage =
  | { type: "welcome"; wire: number; version: string }
  /**
   * This extension id is not one the server trusts. Sent once, then the socket closes.
   *
   * Sent rather than refusing the handshake outright so the reviewer is told *why*: a
   * refused handshake looks, from inside the worker, exactly like no server at all, and
   * "start your agent" is the wrong advice for a server that is running and saying no.
   */
  | { type: "refused"; reason: string }
  | { type: "command"; id: number; command: BridgeCommand }
  | { type: "pong" };

/**
 * What an agent may ask the browser to change. One kind, on purpose — see
 * `docs/mcp-bridge/brief.md` for why delete and create are not here.
 */
export type BridgeCommand = {
  kind: "set-status";
  status: AnnotationStatus;
  /** Grouped by page because storage is: one read and one write per key. */
  targets: { page: string; ids: string[] }[];
};

export type CommandResult =
  | { ok: true; updated: string[]; missing: string[] }
  | { ok: false; error: string };

// -----------------------------------------------------------------------------
// worker → settings card
// -----------------------------------------------------------------------------

export type McpBridgeState =
  /** The switch is off. No socket exists. */
  | "off"
  /** A connection attempt is in flight. */
  | "connecting"
  | "connected"
  /** The switch is on and nothing answered on the port. Retrying. */
  | "unreachable"
  /** A server answered and does not trust this extension id. Retrying, slowly. */
  | "refused";

export interface McpBridgeStatus {
  state: McpBridgeState;
  port: number;
  /** The server's version once it has said `welcome`. */
  server?: string;
  /** This extension's id — what `SENANNOTATE_EXTENSION_ID` must name when `refused`. */
  extensionId?: string;
}
