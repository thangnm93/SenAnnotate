// =============================================================================
// MCP bridge — the worker's end
// =============================================================================
//
// Keeps `senannotate-mcp` (the server an agent starts) supplied with what storage holds,
// and applies the one change an agent may make: a note's status.
//
// Why the service worker and not a content script, which holds the notes already:
//
//   - A content script lives and dies with its tab. The agent asks about every page the
//     reviewer annotated, including the ones no longer open.
//   - A content script's WebSocket goes out with the *page's* origin, and the server
//     refuses every origin that is not an extension (`mcp/hub.ts`) — which is the rule
//     that stops any web page from reading the notes.
//
// The worker can be torn down between any two events, so nothing here is state that has
// to survive: storage is the truth, the snapshot is re-sent whole on every connect, and
// a lost connection is simply dialled again. From Chrome 116 a WebSocket that carries a
// message every 30 s keeps the worker alive, hence the 20 s ping; before 116 the worker
// sleeps anyway and the next page load — whose badge message wakes it — reconnects.
//
// Nothing here runs while the switch is off. Not a probe, not a lookup: `PRIVACY.md`
// says the extension makes no network request of its own, and with the bridge off that
// has to stay literally true.
// =============================================================================

import { exportAll } from "../shared/archive";
import {
  MCP_DEFAULT_PORT,
  MCP_EXTENSION_PATH,
  MCP_HOST,
  MCP_WIRE_VERSION,
  isValidPort,
  type BridgeCommand,
  type CommandResult,
  type ExtensionMessage,
  type McpBridgeState,
  type McpBridgeStatus,
  type ServerMessage,
} from "../shared/mcp";
import { ANNOTATION_PREFIX, SETTINGS_KEY, type RuntimeMessage } from "../shared/protocol";
import { DEFAULT_SETTINGS, type Annotation, type AnnotationStatus, type Settings } from "../shared/types";

/** Under the 30 s idle window Chrome 116+ measures a WebSocket's activity against. */
const KEEPALIVE_MS = 20_000;
/** Storage writes come in bursts (a note, then its screenshot); one snapshot per burst. */
const SNAPSHOT_DEBOUNCE_MS = 250;
/** Back-off while the worker is alive. Each page load starts over from the first. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/**
 * A page load's badge message wakes the bridge. A page re-renders far more often than it
 * loads, so wake-ups closer together than this are ignored — otherwise a reviewer
 * clicking around with no server running would fire a failed connection per click.
 */
const WAKE_MIN_INTERVAL_MS = 3_000;

let enabled = false;
let port = MCP_DEFAULT_PORT;
let socket: WebSocket | null = null;
let state: McpBridgeState = "off";
let serverVersion: string | undefined;
/** Set when the server said `refused`; the close that follows reports that, not "unreachable". */
let refused = false;
let attempt = 0;
let lastAttemptAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

export function installMcpBridge(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[SETTINGS_KEY]) {
      apply(withDefaults(changes[SETTINGS_KEY].newValue));
    }
    if (area === "local" && Object.keys(changes).some((key) => key.startsWith(ANNOTATION_PREFIX))) {
      scheduleSnapshot();
    }
  });

  void readSettings().then(apply);
}

/** A page just rendered. If the bridge is on and down, try now rather than at the next back-off. */
export function wakeMcpBridge(): void {
  if (!enabled || socket || Date.now() - lastAttemptAt < WAKE_MIN_INTERVAL_MS) return;
  attempt = 0;
  connect();
}

export function mcpStatus(): McpBridgeStatus {
  return {
    state: enabled ? state : "off",
    port,
    server: state === "connected" ? serverVersion : undefined,
    extensionId: chrome.runtime.id,
  };
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

async function readSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    return withDefaults(stored[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function withDefaults(value: unknown): Settings {
  return { ...DEFAULT_SETTINGS, ...((value as Partial<Settings> | undefined) ?? {}) };
}

function apply(settings: Settings): void {
  const nextPort = isValidPort(settings.mcpPort) ? settings.mcpPort : MCP_DEFAULT_PORT;
  const portChanged = nextPort !== port;
  enabled = settings.mcpBridge === true;
  port = nextPort;

  if (!enabled) {
    disconnect();
    state = "off";
    return;
  }
  if (portChanged) disconnect();
  if (!socket) {
    attempt = 0;
    connect();
  }
}

// -----------------------------------------------------------------------------
// Connection
// -----------------------------------------------------------------------------

function connect(): void {
  clearRetry();
  lastAttemptAt = Date.now();
  state = "connecting";

  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://${MCP_HOST}:${port}${MCP_EXTENSION_PATH}`);
  } catch {
    state = "unreachable";
    scheduleRetry();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    attempt = 0;
    send({
      type: "hello",
      wire: MCP_WIRE_VERSION,
      version: chrome.runtime.getManifest().version,
      browser: browserLabel(),
    });
    void sendSnapshot();
    stopKeepAlive();
    keepAliveTimer = setInterval(() => send({ type: "ping" }), KEEPALIVE_MS);
  };

  ws.onmessage = (event: MessageEvent) => {
    if (socket !== ws || typeof event.data !== "string") return;
    void onServerMessage(event.data);
  };

  // `error` is always followed by `close`, which does the work. Listening keeps an
  // unhandled-error report out of the worker's console for what is, here, the normal
  // case of no server running.
  ws.onerror = () => {};

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    serverVersion = undefined;
    stopKeepAlive();
    state = !enabled ? "off" : refused ? "refused" : "unreachable";
    if (enabled) scheduleRetry();
  };
}

function disconnect(): void {
  clearRetry();
  stopKeepAlive();
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  const ws = socket;
  socket = null;
  serverVersion = undefined;
  ws?.close();
}

function scheduleRetry(): void {
  clearRetry();
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (enabled && !socket) connect();
  }, delay);
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function stopKeepAlive(): void {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function send(message: ExtensionMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// -----------------------------------------------------------------------------
// What crosses it
// -----------------------------------------------------------------------------

function scheduleSnapshot(): void {
  if (!socket) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void sendSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function sendSnapshot(): Promise<void> {
  if (socket?.readyState !== WebSocket.OPEN) return;
  try {
    const [{ pages }, settings] = await Promise.all([exportAll(), readSettings()]);
    send({ type: "snapshot", pages, detailLevel: settings.detailLevel, at: Date.now() });
  } catch {
    // Storage unreadable — the extension is being reloaded. The next connect re-sends.
  }
}

async function onServerMessage(data: string): Promise<void> {
  let message: ServerMessage;
  try {
    message = JSON.parse(data) as ServerMessage;
  } catch {
    return;
  }

  switch (message.type) {
    case "welcome":
      state = "connected";
      refused = false;
      serverVersion = typeof message.version === "string" ? message.version : undefined;
      return;
    case "refused":
      // Kept until a server says `welcome`: the retries that follow are refused too until
      // the agent's server is restarted with this id, and "refused" is the true state.
      refused = true;
      return;
    case "command":
      send({ type: "result", id: message.id, result: await runCommand(message.command) });
      return;
    default:
      return;
  }
}

async function runCommand(command: BridgeCommand): Promise<CommandResult> {
  if (command?.kind !== "set-status") return { ok: false, error: "unknown command" };
  if (command.status !== "done" && command.status !== "open") return { ok: false, error: "bad status" };
  if (!Array.isArray(command.targets)) return { ok: false, error: "no targets" };

  try {
    const updated: string[] = [];
    const missing: string[] = [];

    for (const target of command.targets) {
      if (typeof target?.page !== "string" || !Array.isArray(target.ids)) continue;
      const ids = target.ids.filter((id): id is string => typeof id === "string");
      const hit = await setStatus(target.page, ids, command.status);
      updated.push(...hit);
      missing.push(...ids.filter((id) => !hit.includes(id)));
    }

    return { ok: true, updated, missing };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Write the status into storage, then tell any tab showing that page.
 *
 * Storage first, because it is the truth and covers the page that is not open. The tab
 * second, because an open tab holds the notes in memory and writes its copy back on the
 * reviewer's next edit — see `annotations-updated` in `shared/protocol.ts`.
 */
async function setStatus(page: string, ids: string[], status: AnnotationStatus): Promise<string[]> {
  const key = `${ANNOTATION_PREFIX}${page}`;
  const stored = (await chrome.storage.local.get(key))[key];
  const notes = Array.isArray(stored) ? (stored as Annotation[]) : [];

  const wanted = new Set(ids);
  const hit: string[] = [];
  for (const note of notes) {
    if (!wanted.has(note.id)) continue;
    note.status = status;
    hit.push(note.id);
  }
  if (!hit.length) return hit;

  await chrome.storage.local.set({ [key]: notes });

  const message: RuntimeMessage = { kind: "annotations-updated", page, ids: hit, status };
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || !tab.url || pageOf(tab.url) !== page) return;
      try {
        await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
      } catch {
        // No content script there (hidden for the session, or still loading). Storage
        // already has the change, and the tab reads it on its next load.
      }
    }),
  );

  return hit;
}

function pageOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/** `Chrome 131`, `Edge 131`. A label for the agent's status line, never parsed back. */
function browserLabel(): string {
  const agent = navigator.userAgent;
  for (const [token, name] of [
    ["Edg", "Edge"],
    ["OPR", "Opera"],
    ["Chrome", "Chrome"],
  ] as const) {
    const match = new RegExp(`${token}/(\\d+)`).exec(agent);
    if (match) return `${name} ${match[1]}`;
  }
  return "Chromium";
}
