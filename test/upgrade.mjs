// =============================================================================
// Upgrade test — notes and settings must outlive a new version
// =============================================================================
//
// Runs after `e2e.mjs` and needs the same two things from the environment (see that
// file's header for why nothing is defaulted):
//
//   SENANNOTATE_PLAYWRIGHT_DIR   a directory whose node_modules contains playwright
//
// Why this is a separate file rather than another block in the suite: the upgrade has
// to be *real*, and a real one needs two browser launches over one profile —
//
//   launch 1   annotate a page, change two settings, quit
//   bump       rewrite the version in the loaded dist/manifest.json
//   launch 2   same profile, same extension directory → a new version of the same
//              extension, reading the storage the old one wrote
//
// An unpacked extension's id is derived from its path, so keeping the path keeps the id,
// and with it the storage. `e2e.mjs` uses one throwaway profile for one context and
// cannot do this. `chrome.runtime.reload()` looked like the shortcut and is not one:
// measured, Chrome *drops* an extension that was loaded with `--load-extension` when it
// calls that, and every navigation to it afterwards fails ERR_BLOCKED_BY_CLIENT.
//
//   node test/upgrade.mjs
// =============================================================================

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const FIXTURES = join(HERE, "fixtures");
const MANIFEST = join(DIST, "manifest.json");

const PLAYWRIGHT_HOST = process.env.SENANNOTATE_PLAYWRIGHT_DIR || null;

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? "  ok  " : " FAIL "} ${name}${detail && !condition ? ` — ${detail}` : ""}`);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startServer() {
  const server = createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    try {
      const file = join(FIXTURES, path === "/" ? "upgrade.html" : path);
      if (!file.startsWith(FIXTURES)) throw new Error("outside fixtures");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port }));
  });
}

/**
 * A note an older build stored under a *different* path of the same origin. Notes used to
 * live in one slot per page and never travel; the list is per origin now, so this one has
 * to surface on `/upgrade.html` without anything having migrated it.
 */
const LEGACY_OTHER_PAGE_NOTE = {
  id: "legacy-other-page",
  comment: "Stored on another page by an older version.",
  timestamp: 1_700_000_100_000,
  element: 'link "Pricing"',
  elementPath: "body > a",
  selector: "body > a.pricing",
  x: 20,
  y: 60,
  isFixed: false,
};

/**
 * The stored note from before the fields 0.3.0 and later added — no `kind`, no `status`,
 * no screenshot, no frame. Written straight into storage from an extension page, which is
 * the only context that can, and the reason the upgrade check is worth having at all: the
 * storage keys and the optional-ness of everything added since are a contract with every
 * copy already installed. If a release makes one of those fields required, or renames a
 * key, this is what fails.
 */
const LEGACY_NOTE = {
  id: "legacy-0-2-0",
  comment: "Written by an older version.",
  timestamp: 1_700_000_000_000,
  element: 'button "Complete checkout"',
  elementPath: "body > button",
  selector: "body > button.checkout",
  x: 50,
  y: 120,
  isFixed: false,
};

// `SENANNOTATE_HEADLESS=1`, as in `e2e.mjs`: Chrome's new headless does load extensions, and
// `channel: "chromium"` is what reaches it. Default headed — see that file.
const HEADLESS_LAUNCH = process.env.SENANNOTATE_HEADLESS
  ? { headless: true, channel: "chromium" }
  : { headless: false };

async function launch(chromium, profile) {
  const context = await chromium.launchPersistentContext(profile, {
    ...HEADLESS_LAUNCH,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1280, height: 800 },
  });
  // The service worker is how the extension id is discoverable; it may not have started
  // by the time the context is up.
  for (let attempt = 0; attempt < 40 && !context.serviceWorkers().length; attempt += 1) {
    await context.waitForEvent("serviceworker", { timeout: 500 }).catch(() => {});
  }
  const [worker] = context.serviceWorkers();
  return { context, extensionId: worker ? new URL(worker.url()).host : null };
}

async function main() {
  if (!existsSync(DIST)) throw new Error(`No build at ${DIST}. Run \`npm run build\` first.`);
  if (!PLAYWRIGHT_HOST) {
    throw new Error(
      `SENANNOTATE_PLAYWRIGHT_DIR is not set.\n` +
        `  Point it at a directory whose node_modules contains playwright and its\n` +
        `  browsers. See the header of test/e2e.mjs.`,
    );
  }

  const require = createRequire(join(PLAYWRIGHT_HOST, "package.json"));
  const { chromium } = require("playwright");

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "senannotate-upgrade-"));
  const before = JSON.parse(await readFile(MANIFEST, "utf8"));
  const bumped = `${before.version}.1`;
  let firstId = null;

  try {
    // -------------------------------------------------------------------------
    // Launch 1 — the version the user already has
    // -------------------------------------------------------------------------
    {
      const { context, extensionId } = await launch(chromium, profile);
      firstId = extensionId;
      check("the extension id is discoverable before the upgrade", extensionId !== null);
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });

      const page = await context.newPage();
      await page.goto(`${base}/upgrade.html`);
      await page.locator(".toolbar").waitFor({ state: "visible", timeout: 15_000 });
      await page.locator(".tool--brand").click();
      await page.locator(".checkout").click();
      await page.locator(".composer").waitFor({ state: "visible", timeout: 10_000 });
      await page.keyboard.type("This button needs a loading state.");
      await page.locator(".composer .button--primary").click();
      await page.locator(".composer").waitFor({ state: "detached", timeout: 10_000 });
      check("a note was taken on the old version", true);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator("#pages").waitFor({ state: "attached", timeout: 10_000 });

      await popup.evaluate(
        async ([pageUrl, note]) => {
          const url = new URL(pageUrl);
          const key = `senannotate:page:${url.origin}${url.pathname}`;
          const stored = await chrome.storage.local.get(key);
          const existing = Array.isArray(stored[key]) ? stored[key] : [];
          await chrome.storage.local.set({ [key]: [...existing, note] });
        },
        [`${base}/upgrade.html`, LEGACY_NOTE],
      );
      await popup.evaluate(
        async ([key, note]) => chrome.storage.local.set({ [key]: [note] }),
        [`senannotate:page:${base}/pricing`, LEGACY_OTHER_PAGE_NOTE],
      );

      // Through the real controls, so what is asserted after the upgrade is what a user
      // set rather than a value written past the UI. Those controls are in the toolbar's
      // settings card now, not the popup, so this drives the page rather than the popup.
      await page.locator(".tool--settings").click();
      await page.locator(".settings").waitFor({ state: "visible", timeout: 10_000 });
      await page.selectOption('.settings [data-setting="theme"]', "dark");
      await page.selectOption('.settings [data-setting="detailLevel"]', "compact");
      await page.waitForTimeout(400);

      await context.close();
    }

    // -------------------------------------------------------------------------
    // The upgrade itself
    // -------------------------------------------------------------------------
    await writeFile(MANIFEST, `${JSON.stringify({ ...before, version: bumped }, null, 2)}\n`);

    // -------------------------------------------------------------------------
    // Launch 2 — same profile, same path, new version
    // -------------------------------------------------------------------------
    {
      const { context, extensionId } = await launch(chromium, profile);
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });

      check(
        "the extension keeps its id across the upgrade",
        extensionId !== null && extensionId === firstId,
        `${firstId} → ${extensionId}`,
      );

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator("#pages").waitFor({ state: "attached", timeout: 10_000 });

      const running = await popup.evaluate(() => chrome.runtime.getManifest().version);
      check(
        "the new version is the one running",
        running === bumped,
        `manifest reports ${running}, expected ${bumped}`,
      );

      const page = await context.newPage();
      await page.goto(`${base}/upgrade.html`);
      await page.locator(".toolbar").waitFor({ state: "visible", timeout: 15_000 });

      await page.locator(".tool--settings").click();
      await page.locator(".settings").waitFor({ state: "visible", timeout: 10_000 });
      const theme = await page.locator('.settings [data-setting="theme"]').inputValue();
      const detail = await page.locator('.settings [data-setting="detailLevel"]').inputValue();
      check(
        "settings set on the old version survive the upgrade",
        theme === "dark" && detail === "compact",
        `theme=${theme} detail=${detail}`,
      );
      await page.locator(".tool--settings").click();

      await page.locator('.tool[aria-label^="Annotations"]').click();
      await page.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });

      // Two notes belong to this page and one to /pricing; the list now holds all three,
      // and only this page's two are pinned.
      const entries = await page.locator(".entry").count();
      check(
        "notes taken on the old version are still on the page",
        entries === 3,
        `${entries} entries after the upgrade, expected 3`,
      );
      const pins = await page.locator(".marker").count();
      check("only this page's old notes are pinned", pins === 2, `${pins} pins, expected 2`);
      check(
        "a note an older build stored for another page joins the list under its path",
        (await page.locator('.panel__page[data-here="false"]').textContent())?.trim() === "/pricing",
      );

      await page.locator(".panel .button--primary").click();
      const report = await page.evaluate(() => navigator.clipboard.readText());
      check(
        "the note taken on the old version is in the report",
        /This button needs a loading state/.test(report),
        report.slice(0, 300),
      );
      check(
        "a note stored in the 0.2.0 shape still renders",
        /Written by an older version/.test(report),
        report.slice(0, 300),
      );

      // The count badge is fed from the same storage the panel reads, so a mismatch here
      // would mean the notes came back but the toolbar disagrees about them.
      const badge = await page.locator(".count").textContent();
      check(
        "the other page's old note is in the report, under its page",
        /## \/pricing/.test(report) && /Stored on another page by an older version/.test(report),
        report.slice(0, 400),
      );
      check("the toolbar count agrees after the upgrade", badge === "3", `badge read "${badge}"`);

      await context.close();
    }
  } finally {
    await writeFile(MANIFEST, `${JSON.stringify(before, null, 2)}\n`);
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} upgrade checks passed`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error("\nharness error:", error);
    process.exit(1);
  });
