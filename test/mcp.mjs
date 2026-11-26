// =============================================================================
// MCP bridge test — the server, its guard rails, and the extension end to end
// =============================================================================
//
// Three parts, cheapest first, so a broken server fails in seconds rather than after a
// browser launch:
//
//   1. the server alone     MCP handshake, tool list, and every request the hub must
//                           refuse — a web page's Origin, a rebinding Host, a relay
//                           call from a browser
//   2. a scripted browser   a Node WebSocket speaking the extension's side of the wire,
//                           so the four tools and the hub/relay takeover can be checked
//                           without Chrome
//   3. the real extension   a persistent Chromium with dist/ loaded: off by default
//                           means no connection; switched on, the notes reach the agent,
//                           set_status reaches an open tab's panel, and a second agent
//                           takes over when the first exits
//
// Part 3 needs SENANNOTATE_PLAYWRIGHT_DIR, as `e2e.mjs` does (see its header). Its own
// launch and profile, like `upgrade.mjs`: it flips a stored setting, and a suite block
// that flips settings is a hazard to every block after it.
//
//   node test/mcp.mjs
// =============================================================================

import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const SERVER = join(ROOT, "dist-mcp/senannotate-mcp.mjs");
const FIXTURES = join(HERE, "fixtures");

const PLAYWRIGHT_HOST = process.env.SENANNOTATE_PLAYWRIGHT_DIR || null;
const HEADLESS_LAUNCH = process.env.SENANNOTATE_HEADLESS
  ? { headless: true, channel: "chromium" }
  : { headless: false };

/** The Web Store build's id — trusted by the server with no configuration. */
const STORE_ID = "nfplcbaoccfdgfpbkjiigfdpmjphbjla";
/** A well-formed id the server has not been told about: any other installed extension. */
const STRANGER_ID = "a".repeat(32);
const originOf = (id) => `chrome-extension://${id}`;
/** 1×1 PNG. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? "  ok  " : " FAIL "} ${name}${detail && !condition ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(probe, timeout = 10_000, interval = 200) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  return last;
}

function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

// -----------------------------------------------------------------------------
// An MCP client over the server's stdio — what an agent is
// -----------------------------------------------------------------------------

class Agent {
  constructor(port, env = {}) {
    this.port = port;
    this.child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, SENANNOTATE_MCP_PORT: String(port), ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stdout = "";
    this.stderr = "";
    this.garbage = [];
    this.exited = new Promise((done) => this.child.on("exit", done));

    this.child.stderr.on("data", (chunk) => (this.stderr += chunk));
    this.child.stdout.on("data", (chunk) => {
      this.stdout += chunk;
      let newline;
      while ((newline = this.stdout.indexOf("\n")) >= 0) {
        const line = this.stdout.slice(0, newline);
        this.stdout = this.stdout.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          // Anything on stdout that is not a JSON-RPC message breaks a real client.
          this.garbage.push(line);
          continue;
        }
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    });
  }

  request(method, params, timeout = 20_000) {
    const id = this.nextId++;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`${method} timed out`)), timeout);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(protocolVersion = "2025-06-18") {
    const response = await this.request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "senannotate-test", version: "0" },
    });
    this.notify("notifications/initialized");
    return response;
  }

  async call(name, args = {}) {
    const response = await this.request("tools/call", { name, arguments: args });
    return response.result;
  }

  async listening() {
    return waitFor(() => /listening|relaying/.test(this.stderr), 5_000);
  }

  async close() {
    this.child.stdin.end();
    await Promise.race([this.exited, sleep(5_000)]);
    this.child.kill();
  }
}

const textOf = (result) =>
  (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

// -----------------------------------------------------------------------------
// Raw HTTP, for the requests no well-behaved client would send
// -----------------------------------------------------------------------------

function http(port, { method = "GET", path = "/health", headers = {}, body } = {}) {
  return new Promise((done) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => done({ status: res.statusCode, body: text }));
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      done({ status: res.statusCode, body: "" });
    });
    req.on("error", (error) => done({ status: 0, body: String(error) }));
    if (body) req.write(body);
    req.end();
  });
}

function upgrade(port, headers, path = "/extension") {
  return http(port, {
    path,
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": Buffer.from("0123456789abcdef").toString("base64"),
      ...headers,
    },
  });
}

// -----------------------------------------------------------------------------
// A scripted browser — the extension's side of the wire, without Chrome
// -----------------------------------------------------------------------------

function scriptedBrowser(port, pages, id = STORE_ID) {
  const commands = [];
  const received = [];
  // undici's WebSocket takes a `headers` option a browser's does not; it is how this
  // stands in for the Origin Chrome sends.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, {
    headers: { origin: originOf(id) },
  });
  const closed = new Promise((done) => ws.addEventListener("close", (event) => done(event.code)));
  const welcomed = new Promise((done, fail) => {
    ws.onerror = () => fail(new Error("scripted browser could not connect"));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      received.push(message.type);
      if (message.type === "refused") fail(new Error("refused"));
      if (message.type === "welcome") {
        ws.send(JSON.stringify({ type: "snapshot", pages, detailLevel: "standard", at: Date.now() }));
        done();
      }
      if (message.type === "command") {
        commands.push(message.command);
        const updated = [];
        for (const target of message.command.targets) {
          const entry = pages.find((candidate) => candidate.page === target.page);
          for (const note of entry?.annotations ?? []) {
            if (target.ids.includes(note.id)) {
              note.status = message.command.status;
              updated.push(note.id);
            }
          }
        }
        ws.send(JSON.stringify({ type: "result", id: message.id, result: { ok: true, updated, missing: [] } }));
        ws.send(JSON.stringify({ type: "snapshot", pages, detailLevel: "standard", at: Date.now() }));
      }
    };
  });
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", wire: 1, version: "test", browser: "Scripted 1" }));
  return { ws, commands, received, welcomed, closed, close: () => ws.close() };
}

function note(id, comment, extra = {}) {
  return {
    id,
    comment,
    timestamp: 1_700_000_000_000,
    element: 'button "Pay now"',
    elementPath: "main > button",
    selector: "main > button.pay",
    x: 10,
    y: 80,
    isFixed: false,
    ...extra,
  };
}

// -----------------------------------------------------------------------------
// Part 1 — the server alone
// -----------------------------------------------------------------------------

async function partServer() {
  console.log("\n— the server alone");
  const port = await freePort();
  const agent = new Agent(port);
  try {
    await agent.listening();

    const init = await agent.initialize("2025-06-18");
    check("initialize echoes a protocol version it speaks", init.result?.protocolVersion === "2025-06-18");
    check(
      "initialize names the server and offers tools",
      init.result?.serverInfo?.name === "senannotate" && init.result?.capabilities?.tools,
      JSON.stringify(init.result).slice(0, 200),
    );

    const newer = await agent.request("initialize", { protocolVersion: "2099-01-01", capabilities: {} });
    check(
      "an unknown protocol version gets the newest one offered back",
      newer.result?.protocolVersion === "2025-11-25",
      newer.result?.protocolVersion,
    );

    const list = await agent.request("tools/list", {});
    const names = (list.result?.tools ?? []).map((tool) => tool.name).sort();
    check(
      "tools/list offers exactly the four tools",
      JSON.stringify(names) === JSON.stringify(["get_annotation", "get_report", "list_annotations", "set_status"]),
      names.join(", "),
    );
    check(
      "only set_status is marked as writing",
      (list.result?.tools ?? []).every((tool) => tool.annotations.readOnlyHint === (tool.name !== "set_status")),
    );

    const unknown = await agent.request("resources/list", {});
    check("an unknown method is a JSON-RPC error, not silence", unknown.error?.code === -32601);

    const lonely = await agent.call("list_annotations");
    check(
      "with no browser connected, a tool says how to connect one",
      lonely.isError && /No browser is connected/.test(textOf(lonely)) && textOf(lonely).includes(String(port)),
      textOf(lonely),
    );

    // The guard rails. Each of these is a request a web page in the reviewer's browser
    // could make against 127.0.0.1.
    const health = await http(port);
    check("health answers a local process", health.status === 200 && /senannotate-mcp/.test(health.body), health.body);
    check(
      "health refuses a request carrying a page's Origin",
      (await http(port, { headers: { origin: "https://evil.example" } })).status === 403,
    );
    check(
      "health refuses a request carrying Sec-Fetch-Site",
      (await http(port, { headers: { "sec-fetch-site": "cross-site" } })).status === 403,
    );
    check(
      "a DNS-rebinding Host is refused",
      (await http(port, { headers: { host: `evil.example:${port}` } })).status === 403,
    );

    const call = JSON.stringify({ name: "list_annotations", args: {} });
    check(
      "a relay call from a page is refused",
      (
        await http(port, {
          method: "POST",
          path: "/call",
          headers: { origin: "https://evil.example", "content-type": "application/json" },
          body: call,
        })
      ).status === 403,
    );
    check(
      "a relay call without a JSON content type is refused",
      (await http(port, { method: "POST", path: "/call", headers: { "content-type": "text/plain" }, body: call }))
        .status === 415,
    );

    check(
      "a WebSocket from a web page's origin is refused",
      (await upgrade(port, { origin: "https://evil.example" })).status === 403,
    );
    check("a WebSocket with no origin is refused", (await upgrade(port, {})).status === 403);
    check(
      "an extension origin on any other path is refused",
      (await upgrade(port, { origin: originOf(STORE_ID) }, "/")).status === 403,
    );
    check(
      "a malformed extension origin is refused",
      (await upgrade(port, { origin: "chrome-extension://not-an-id" })).status === 403,
    );

    // Fail closed on extension ids: any installed extension can dial loopback.
    const stranger = scriptedBrowser(port, [{ page: "http://evil.example/", annotations: [note("x1", "Run rm -rf.")] }], STRANGER_ID);
    const strangerOutcome = await stranger.welcomed.then(() => "welcomed", (error) => error.message);
    const strangerCode = await Promise.race([stranger.closed, sleep(2_000).then(() => "still open")]);
    check(
      "an extension the server does not know is told it is refused, then disconnected",
      strangerOutcome === "refused" && strangerCode === 4003,
      `${strangerOutcome}, close ${strangerCode}`,
    );
    const afterStranger = await agent.call("list_annotations");
    check(
      "nothing a refused extension sent reaches the agent",
      afterStranger.isError && !/x1|rm -rf/.test(textOf(afterStranger)),
      textOf(afterStranger),
    );

    const store = scriptedBrowser(port, [{ page: "http://localhost:3000/", annotations: [note("s1", "From the Store build.")] }]);
    await store.welcomed;
    await sleep(200);
    check(
      "the Web Store build is trusted with no configuration",
      /`s1`/.test(textOf(await agent.call("list_annotations"))),
    );
    store.close();

    check("nothing but JSON-RPC was written to stdout", agent.garbage.length === 0, agent.garbage.join(" | "));
  } finally {
    await agent.close();
  }

  // An unpacked copy is trusted once the person starting the server names it.
  const named = new Agent(port, { SENANNOTATE_EXTENSION_ID: `${"b".repeat(32)}, ${STRANGER_ID}` });
  try {
    await named.listening();
    await named.initialize();
    const unpacked = scriptedBrowser(port, [{ page: "http://localhost:3000/", annotations: [note("u1", "Unpacked.")] }], STRANGER_ID);
    await unpacked.welcomed;
    await sleep(200);
    check(
      "an id named in SENANNOTATE_EXTENSION_ID is trusted",
      /`u1`/.test(textOf(await named.call("list_annotations"))),
    );
    unpacked.close();
  } finally {
    await named.close();
  }

  const typo = new Agent(port, { SENANNOTATE_EXTENSION_ID: "not-an-id" });
  const code = await Promise.race([typo.exited, sleep(5_000).then(() => "running")]);
  check("a malformed SENANNOTATE_EXTENSION_ID stops the server rather than being ignored", code === 2, String(code));
  await typo.close();
}

// -----------------------------------------------------------------------------
// Part 2 — the tools and the relay, against a scripted browser
// -----------------------------------------------------------------------------

async function partScripted() {
  console.log("\n— the tools, against a scripted browser");
  const port = await freePort();
  const pages = [
    {
      page: "http://localhost:3000/checkout",
      annotations: [
        note("n1", "Show a spinner while paying.", { kind: "bug", screenshotData: PIXEL, referenceImages: [PIXEL] }),
        note("n2", "Fix the typo in the heading.", { kind: "copy", element: 'h1 "Chekout"' }),
        note("n3", "Already handled.", { status: "done" }),
      ],
    },
    { page: "http://localhost:3000/cart", annotations: [note("n4", "Cart total is misaligned.")] },
  ];

  const first = new Agent(port);
  let second = null;
  let browser = null;
  try {
    await first.listening();
    await first.initialize();
    browser = scriptedBrowser(port, pages);
    await browser.welcomed;
    await sleep(200);

    const list = textOf(await first.call("list_annotations"));
    check(
      "list_annotations shows the open notes with their ids",
      /`n1`/.test(list) && /`n2`/.test(list) && /`n4`/.test(list) && !/`n3`/.test(list),
      list,
    );
    check("list_annotations says how many done notes it left out", /1 done not shown/.test(list), list);
    check("list_annotations names the attachments", /screenshot, 1 reference image/.test(list), list);

    const cart = textOf(await first.call("list_annotations", { url: "http://localhost:3000/cart?step=2#top" }));
    check("a full URL with query and hash finds its page", /`n4`/.test(cart) && !/`n1`/.test(cart), cart);

    const done = textOf(await first.call("list_annotations", { status: "done" }));
    check("status: done lists only the done notes", /`n3`/.test(done) && !/`n1`/.test(done), done);

    const report = textOf(await first.call("get_report", { url: "/checkout" }));
    check("get_report is the session report", /# Review session/.test(report) && /Show a spinner/.test(report), report.slice(0, 300));
    check("get_report inlines no image data", !/data:image/.test(report));
    check("get_report points at get_annotation for images", /get_annotation:n1/.test(report));
    check("get_report maps report numbers to ids", /1\. `n1`/.test(report) && /2\. `n2`/.test(report), report.slice(-300));

    const compact = textOf(await first.call("get_report", { detail: "compact" }));
    check("get_report honours an explicit detail level", !/\*\*Feedback:\*\*/.test(compact), compact.slice(0, 300));

    const one = await first.call("get_annotation", { id: "n1" });
    const images = one.content.filter((item) => item.type === "image");
    check(
      "get_annotation returns the screenshot and the reference as images",
      images.length === 2 && images.every((image) => image.mimeType === "image/png" && image.data.length > 20),
      JSON.stringify(one.content.map((item) => item.type)),
    );
    check("get_annotation labels which image is the target", /how it should look instead/.test(textOf(one)));

    const missing = await first.call("get_annotation", { id: "nope" });
    check("get_annotation on an unknown id is an error", missing.isError === true);

    const marked = await first.call("set_status", { ids: ["n1", "n4", "ghost"], status: "done" });
    check(
      "set_status sends one command per browser, grouped by page",
      browser.commands.length === 1 && browser.commands[0].targets.length === 2,
      JSON.stringify(browser.commands),
    );
    check(
      "set_status reports what changed and what was not found",
      /Marked done: `n1`, `n4`/.test(textOf(marked)) && /ghost/.test(textOf(marked)),
      textOf(marked),
    );
    await sleep(200);
    const after = textOf(await first.call("list_annotations"));
    check("a marked note leaves the open list", !/`n1`/.test(after) && /`n2`/.test(after), after);

    // Hub and relay.
    console.log("\n— two agents on one port");
    second = new Agent(port);
    await second.listening();
    await second.initialize();
    check("a second server on the same port relays instead of failing", /relaying/.test(second.stderr), second.stderr);

    const relayed = textOf(await second.call("list_annotations"));
    check("a relayed call sees the hub's browser", /`n2`/.test(relayed), relayed);

    await first.close();
    browser.close();
    const tookOver = await waitFor(() => /listening/.test(second.stderr), 8_000);
    check("the relay takes the port when the hub exits", tookOver, second.stderr);

    browser = scriptedBrowser(port, pages);
    await browser.welcomed;
    await sleep(200);
    const afterTakeover = textOf(await second.call("list_annotations"));
    check("the new hub serves the browser that reconnects to it", /`n2`/.test(afterTakeover), afterTakeover);
  } finally {
    browser?.close();
    await first.close();
    await second?.close();
  }
}

// -----------------------------------------------------------------------------
// Part 3 — the real extension
// -----------------------------------------------------------------------------

function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    try {
      const file = join(FIXTURES, path === "/" ? "mcp.html" : path);
      if (!file.startsWith(FIXTURES)) throw new Error("outside fixtures");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "text/plain" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port })));
}

async function partExtension() {
  console.log("\n— the real extension");
  if (!PLAYWRIGHT_HOST) {
    check("SENANNOTATE_PLAYWRIGHT_DIR is set (needed for the browser part)", false, "see the header of test/e2e.mjs");
    return;
  }
  const require = createRequire(join(PLAYWRIGHT_HOST, "package.json"));
  const { chromium } = require("playwright");

  const { server, port: fixturePort } = await startFixtureServer();
  const base = `http://127.0.0.1:${fixturePort}`;
  const pageUrl = `${base}/mcp.html`;
  const pageKey = `${base}/mcp.html`;
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "senannotate-mcp-"));

  let agent = null;
  let second = null;
  let stranger = null;
  let context = null;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...HEADLESS_LAUNCH,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
      viewport: { width: 1280, height: 800 },
    });
    for (let attempt = 0; attempt < 40 && !context.serviceWorkers().length; attempt += 1) {
      await context.waitForEvent("serviceworker", { timeout: 500 }).catch(() => {});
    }
    const extensionId = new URL(context.serviceWorkers()[0].url()).host;
    // An unpacked build's id comes from its folder, so the server has to be told it — the
    // same step a developer running from source takes. The refusal is checked at the end.
    const trust = { SENANNOTATE_EXTENSION_ID: extensionId };

    agent = new Agent(port, trust);
    await agent.listening();
    await agent.initialize();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator("#pages").waitFor({ state: "attached", timeout: 10_000 });
    await popup.evaluate(
      async ([key, notes]) => chrome.storage.local.set({ [key]: notes }),
      [
        `senannotate:page:${pageKey}`,
        [
          note("m1", "Pay button needs a loading state.", { kind: "bug", screenshotData: PIXEL }),
          note("m2", "Heading should say Checkout.", { kind: "copy", element: 'h1 "Checkout"', selector: "h1.title" }),
        ],
      ],
    );

    // The port is pointed at this agent *before* anything else, with the switch left at
    // its default. Otherwise the check below passes for free: a bridge that was on by
    // default would dial 7362, find nothing, and look exactly like one that was off.
    await popup.evaluate(
      async (mcpPort) => chrome.storage.sync.set({ "senannotate:settings": { mcpPort } }),
      port,
    );

    const page = await context.newPage();
    await page.goto(pageUrl);
    await page.locator(".toolbar").waitFor({ state: "visible", timeout: 15_000 });

    // Off by default: the page has rendered (and woken the worker), and nothing dialled.
    await sleep(1_500);
    const before = await agent.call("list_annotations");
    check(
      "with the switch at its default, the extension makes no connection",
      before.isError && /No browser is connected/.test(textOf(before)),
      textOf(before),
    );

    // Through the real control, as a reviewer would.
    await page.locator(".tool--settings").click();
    await page.locator(".settings").waitFor({ state: "visible", timeout: 10_000 });
    check(
      "the port row is hidden while the switch is off",
      !(await page.locator('.settings input[data-setting="mcpPort"]').isVisible()),
    );
    await page.locator('.settings input[data-setting="mcpBridge"]').click();
    const portInput = page.locator('.settings input[data-setting="mcpPort"]');
    await portInput.waitFor({ state: "visible", timeout: 5_000 });
    await portInput.fill(String(port));
    await portInput.press("Enter");
    await portInput.blur();

    const listed = await waitFor(async () => {
      const text = textOf(await agent.call("list_annotations"));
      return /`m1`/.test(text) && /`m2`/.test(text) ? text : null;
    }, 15_000, 500);
    check("switched on, the stored notes reach the agent", listed, listed ?? "never arrived");

    const status = await waitFor(async () => {
      const text = await page.locator(".settings .mcp-status").textContent();
      return /Connected/.test(text ?? "") ? text : null;
    }, 6_000);
    check("the settings card says it is connected", status, status ?? "");

    const image = await agent.call("get_annotation", { id: "m1" });
    check(
      "the stored screenshot reaches the agent as an image",
      image.content.some((item) => item.type === "image" && item.mimeType === "image/png"),
    );

    // Back to the panel, then let the agent mark a note done.
    await page.locator(".tool--settings").click();
    await page.locator('.tool[aria-label^="Annotations"]').click();
    await page.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });
    check("the panel starts with both notes open", (await page.locator('.entry[data-done="true"]').count()) === 0);

    const marked = await agent.call("set_status", { ids: ["m1"], status: "done" });
    check("set_status succeeds against the real extension", !marked.isError, textOf(marked));

    const flipped = await waitFor(async () => (await page.locator('.entry[data-done="true"]').count()) === 1, 5_000);
    check("the open tab's panel shows the note done without a reload", flipped);

    const readStored = () =>
      popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key], `senannotate:page:${pageKey}`);
    const statuses = (notes) => JSON.stringify(notes?.map((item) => [item.id, item.status ?? "open"]));

    const stored = await readStored();
    check(
      "storage holds the agent's change",
      stored?.find((item) => item.id === "m1")?.status === "done" && stored?.find((item) => item.id === "m2")?.status !== "done",
      statuses(stored),
    );

    // The reason the tab is told at all: it holds its own copy and writes it back on the
    // reviewer's next edit. If the copy were stale, this click would undo the agent.
    await page.locator('.entry[data-done="false"] .entry__status').first().click();
    const both = await waitFor(async () => {
      const notes = await readStored();
      return notes?.every((item) => item.status === "done") ? notes : null;
    }, 5_000);
    check(
      "the reviewer's next edit keeps the agent's change",
      both,
      statuses(await readStored()),
    );

    // A note the reviewer adds afterwards reaches the agent without anyone pressing Copy.
    await popup.evaluate(
      async ([key, extra]) => {
        const current = (await chrome.storage.local.get(key))[key] ?? [];
        await chrome.storage.local.set({ [key]: [...current, extra] });
      },
      [`senannotate:page:${pageKey}`, note("m3", "Added after the agent connected.")],
    );
    const live = await waitFor(async () => /`m3`/.test(textOf(await agent.call("list_annotations"))), 5_000, 300);
    check("a note added later reaches the agent live", live);

    // A second agent, then the first one leaving.
    second = new Agent(port, trust);
    await second.listening();
    await second.initialize();
    const relayed = textOf(await second.call("list_annotations"));
    check("a second agent sees the same notes through the hub", /`m3`/.test(relayed), relayed);

    await agent.close();
    agent = null;
    const resumed = await waitFor(async () => {
      const text = textOf(await second.call("list_annotations"));
      return /`m3`/.test(text) ? text : null;
    }, 20_000, 1_000);
    check("when the first agent exits, the extension reconnects to the second", resumed, resumed ?? "");

    // Switching off closes the connection.
    await page.locator(".tool--settings").click();
    await page.locator(".settings").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('.settings input[data-setting="mcpBridge"]').click();
    const gone = await waitFor(async () => (await second.call("list_annotations")).isError, 8_000, 500);
    check("switching off disconnects the browser", gone);

    // Fail closed: a server that was never told this unpacked id refuses it, and the card
    // says so — with the id to copy — rather than "nothing on the port".
    await page.locator('.settings input[data-setting="mcpBridge"]').click();
    await second.close();
    second = null;
    stranger = new Agent(port);
    await stranger.listening();
    await stranger.initialize();
    await page.reload();
    await page.locator(".toolbar").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator(".tool--settings").click();
    await page.locator(".settings").waitFor({ state: "visible", timeout: 10_000 });
    const refusedText = await waitFor(async () => {
      const text = await page.locator(".settings .mcp-status").textContent();
      return /Refused/.test(text ?? "") ? text : null;
    }, 10_000);
    check(
      "an unpacked copy the server was not told about is refused, and the card names its id",
      refusedText && refusedText.includes(`SENANNOTATE_EXTENSION_ID=${extensionId}`),
      refusedText ?? "",
    );
    const refusedList = await stranger.call("list_annotations");
    check(
      "a refused extension's notes never reach the agent",
      refusedList.isError && !/`m1`/.test(textOf(refusedList)),
      textOf(refusedList),
    );
  } finally {
    await context?.close();
    await agent?.close();
    await second?.close();
    await stranger?.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(SERVER)) throw new Error(`No server build at ${SERVER}. Run \`npm run build\` first.`);
  await partServer();
  await partScripted();
  await partExtension();
}

main()
  .then(() => {
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} MCP checks passed`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error("\nharness error:", error);
    process.exit(1);
  });
