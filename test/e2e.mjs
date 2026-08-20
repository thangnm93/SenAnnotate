// =============================================================================
// End-to-end test
// =============================================================================
//
// Loads the built extension into a real Chromium, drives the toolbar against a
// Vue 3 fixture, and asserts the report actually names the right .vue file.
//
// Playwright is not a dependency of this package — it is resolved from the
// monorepo, where it is already installed with its browsers.
//
//   node test/e2e.mjs
// =============================================================================

import { createServer } from "node:http";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const FIXTURES = join(HERE, "fixtures");

// Playwright (with its browsers) and a Vue 3 global build are not dependencies of this
// package — the extension itself ships none, and the suite is not worth adding three
// runtimes for. Both are supplied by the person running the suite:
//
//   SENANNOTATE_PLAYWRIGHT_DIR  a directory whose node_modules contains playwright
//   SENANNOTATE_VUE_GLOBAL      path to a vue.global.js dev build (copied in once)
//
// There is deliberately no default. A hardcoded guess only works on the machine it was
// written on, and a wrong guess fails later and more confusingly than an unset variable.
const PLAYWRIGHT_HOST = process.env.SENANNOTATE_PLAYWRIGHT_DIR || null;
const VUE_SOURCE = process.env.SENANNOTATE_VUE_GLOBAL || null;
const VUE_VENDORED = join(FIXTURES, "vendor/vue.global.js");

// `SENANNOTATE_HEADLESS=1` runs the suite without a window on screen. `channel: "chromium"`
// is required with it: Playwright's bundled build only reaches Chrome's new headless — the
// one that supports extensions — through that channel. Default stays headed, because that is
// the configuration the extension actually ships into.
// Deliberately duplicated in `upgrade.mjs` and `verify-harness.mjs` rather than shared:
// importing this file runs the whole suite, and the verify scripts are kept unentangled
// from it on purpose (see that file's header).
const HEADLESS_LAUNCH = process.env.SENANNOTATE_HEADLESS
  ? { headless: true, channel: "chromium" }
  : { headless: false };

async function ensureVueFixture() {
  // Copied in on first run and kept (gitignored), so the variable is only needed once.
  if (existsSync(VUE_VENDORED)) return;

  if (!VUE_SOURCE) {
    throw new Error(
      `No Vue 3 dev build available.\n` +
        `  Set SENANNOTATE_VUE_GLOBAL to a vue.global.js, or drop one at:\n` +
        `    ${VUE_VENDORED}\n` +
        `  It ships in the vue package as vue/dist/vue.global.js.`,
    );
  }
  if (!existsSync(VUE_SOURCE)) {
    throw new Error(`SENANNOTATE_VUE_GLOBAL points at a file that does not exist:\n  ${VUE_SOURCE}`);
  }

  mkdirSync(dirname(VUE_VENDORED), { recursive: true });
  await copyFile(VUE_SOURCE, VUE_VENDORED);
}

// -----------------------------------------------------------------------------
// Harness
// -----------------------------------------------------------------------------

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
      const file = join(FIXTURES, path === "/" ? "vue3-app.html" : path);
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

// -----------------------------------------------------------------------------

async function main() {
  await ensureVueFixture();

  if (!existsSync(join(FIXTURES, "prod", "tracer", "app.js"))) {
    console.log("building production fixtures (first run only)…");
    const { buildProdFixtures } = await import("./build-prod-fixtures.mjs");
    await buildProdFixtures();
  }

  if (!PLAYWRIGHT_HOST) {
    throw new Error(
      `SENANNOTATE_PLAYWRIGHT_DIR is not set.\n` +
        `  Point it at a directory whose node_modules contains playwright and its\n` +
        `  browsers, e.g. any project where you have run:\n` +
        `    npm i -D playwright && npx playwright install chromium`,
    );
  }
  const require = createRequire(join(PLAYWRIGHT_HOST, "package.json"));
  const { chromium } = require("playwright");

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const profile = mkdtempSync(join(tmpdir(), "senannotate-e2e-"));

  // Extensions require a persistent context. Headed is the default because it is the
  // configuration users run in; `SENANNOTATE_HEADLESS=1` swaps in Chrome's *new* headless,
  // which — unlike the old headless shell this comment used to rule out — does load
  // extensions, run the service worker and answer `captureVisibleTab`. Worth having: the
  // headed window steals the screen and the keyboard focus of whoever started the suite.
  const context = await chromium.launchPersistentContext(profile, {
    ...HEADLESS_LAUNCH,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });

  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });

    // The MAIN-world inspector is registered by the service worker, not declared in the
    // manifest, so the extension has a readiness point that a declarative one does not:
    // `registerContentScripts` only affects navigations that *begin* after it resolves.
    // Navigate inside that window and the page loads with no MAIN world at all — measured,
    // and it is not subtle: the first navigation reports no framework while every later one
    // reports Vue correctly. Seven checks in the Vue block failed exactly this way.
    //
    // Waiting here rather than reloading in the Vue block, because the condition is not
    // Vue's: every framework block, the freeze and the diagnostics all need that world. The
    // product-level cost of the same window — a page loaded in the moment after install has
    // no inspector until it is reloaded — is recorded in `docs/domain-rules/changelog.md`.
    {
      let [ready] = context.serviceWorkers();
      if (!ready) ready = await context.waitForEvent("serviceworker", { timeout: 10_000 });
      const deadline = Date.now() + 10_000;
      for (;;) {
        const registered = await ready
          .evaluate(() => chrome.scripting.getRegisteredContentScripts())
          .catch(() => []);
        if (registered.length || Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // -------------------------------------------------------------------------
    // Vue 3
    // -------------------------------------------------------------------------
    const page = await context.newPage();
    await page.goto(`${base}/vue3-app.html`);
    await page.waitForSelector(".base-button");

    const toolbar = page.locator(".toolbar");
    await toolbar.waitFor({ state: "visible", timeout: 10_000 });
    check("toolbar is injected", await toolbar.isVisible());

    const stackBadge = page.locator(".stack-badge");
    const stackText = (await stackBadge.textContent())?.trim() ?? "";
    check("Vue 3 is detected and versioned", /^Vue 3 \d+\./.test(stackText), `badge read "${stackText}"`);

    // Regression: a dev build must not be reported as production. The old check
    // looked at the mount container, which never carries `__vueParentComponent`,
    // so every real app looked like a production build.
    check(
      "a dev build is not mislabelled as production",
      (await stackBadge.getAttribute("data-warn")) === null,
      `title read "${await stackBadge.getAttribute("title")}"`,
    );

    // Turn on inspect mode and hover the button.
    await page.locator(".tool--brand").click();
    await page.locator(".base-button").first().hover();

    const hoverLabel = page.locator(".highlight__label");
    await hoverLabel.waitFor({ state: "visible", timeout: 5_000 });
    const hoverText = (await hoverLabel.textContent())?.trim() ?? "";
    check(
      "hover names the owning component",
      hoverText.includes("<BaseButton>"),
      `label read "${hoverText}"`,
    );
    check(
      "hover shows the exact source line",
      hoverText.includes("src/components/BaseButton.vue:12:5"),
      `label read "${hoverText}"`,
    );

    // Click to annotate.
    await page.locator(".base-button").first().click();
    const composer = page.locator(".composer");
    await composer.waitFor({ state: "visible", timeout: 5_000 });

    const composerText = (await composer.textContent()) ?? "";
    check(
      "composer reports the source file",
      composerText.includes("src/components/BaseButton.vue:12:5"),
      composerText.slice(0, 200),
    );
    check(
      "composer reports the component ancestry",
      composerText.includes("<App> <TheSidebar> <BaseButton>"),
      composerText.slice(0, 200),
    );
    check(
      "composer reports the component props",
      composerText.includes('label="Save changes"'),
      composerText.slice(0, 200),
    );

    await page.locator(".composer__input").fill("This button should be the primary action.");
    await page.locator(".composer .button--primary").click();
    await composer.waitFor({ state: "detached", timeout: 5_000 });

    check("a marker appears", (await page.locator(".marker").count()) === 1);
    check("the toolbar count updates", (await page.locator(".count").textContent()) === "1");

    // Copy the report.
    await page.locator('.tool[aria-label^="Annotations"]').click();
    await page.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".panel .button--primary").click();

    const report = await page.evaluate(() => navigator.clipboard.readText());
    check(
      "report includes the source line",
      report.includes("**Source:** src/components/BaseButton.vue:12:5"),
      report.slice(0, 300),
    );
    check(
      "report includes the component ancestry",
      report.includes("**Components:** <App> <TheSidebar> <BaseButton>"),
      report.slice(0, 300),
    );
    check(
      "report includes the typed feedback",
      report.includes("This button should be the primary action."),
      report.slice(0, 300),
    );
    check("report names the stack", report.includes("Vue 3"), report.slice(0, 300));

    // Persistence across a reload.
    await page.reload();
    await page.waitForSelector(".base-button");
    await page.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(600);
    check("annotations survive a reload", (await page.locator(".marker").count()) === 1);

    // -------------------------------------------------------------------------
    // Freeze: cancellation must stick
    // -------------------------------------------------------------------------
    //
    // Regression tests for a decoy-id design this file once shipped: timers scheduled
    // during a freeze got fake ids, so clearTimeout/clearInterval silently did nothing
    // and the "cancelled" work replayed on unfreeze — a cleared interval came back
    // permanently and could never be cleared again. page.evaluate runs in the MAIN
    // world, which is exactly where the wrappers live.

    await page.locator('.tool[aria-label^="Freeze"]').click();
    await page.evaluate(() => {
      const state = { kept: 0, cancelledTimeout: 0, cancelledInterval: 0 };
      window.__freezeTest = state;

      window.setTimeout(() => state.kept++, 50);

      const doomed = window.setTimeout(() => state.cancelledTimeout++, 50);
      window.clearTimeout(doomed);

      const interval = window.setInterval(() => state.cancelledInterval++, 50);
      window.clearInterval(interval);
    });
    await page.waitForTimeout(400); // both timers come due while still frozen
    await page.locator('.tool[aria-label^="Freeze"]').click(); // unfreeze → replay
    await page.waitForTimeout(400);

    const freezeState = await page.evaluate(() => window.__freezeTest);
    check(
      "a timeout kept through a freeze replays exactly once",
      freezeState.kept === 1,
      JSON.stringify(freezeState),
    );
    check(
      "a timeout cancelled during a freeze never fires",
      freezeState.cancelledTimeout === 0,
      JSON.stringify(freezeState),
    );
    check(
      "an interval cancelled during a freeze does not resurrect",
      freezeState.cancelledInterval === 0,
      JSON.stringify(freezeState),
    );

    // -------------------------------------------------------------------------
    // Forensic element identification
    // -------------------------------------------------------------------------
    //
    // Everything below comes out of `src/content/identify.ts`, which had no coverage
    // at all: the pre-existing checks only ever asserted the element *name*. These
    // pin the rest of its observable output.
    //
    // Note the ordering: the detail level has to be Forensic *before* annotating.
    // `capture.ts` gates the forensic fields on the setting at capture time, so
    // switching the dropdown afterwards adds nothing to an existing annotation.

    const forensic = await context.newPage();
    await forensic.goto(`${base}/vue3-app.html`);
    await forensic.waitForSelector(".base-button");
    await forensic.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await forensic.waitForTimeout(800);

    await forensic.locator('.tool[aria-label^="Annotations"]').click();
    await forensic.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });
    await forensic.locator(".panel select").selectOption("forensic");
    await forensic.waitForTimeout(400);
    await forensic.locator('.tool[aria-label^="Annotations"]').click();
    await forensic.waitForTimeout(300);

    await forensic.locator(".tool--brand").click();
    await forensic.locator(".base-button").first().click({ force: true });
    await forensic.locator(".composer").waitFor({ state: "visible", timeout: 10_000 });
    await forensic.locator(".composer__input").fill("Forensic coverage.");
    await forensic.locator(".composer .button--primary").click();
    await forensic.locator(".composer").waitFor({ state: "detached", timeout: 10_000 });

    await forensic.locator('.tool[aria-label^="Annotations"]').click();
    await forensic.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });
    await forensic.locator(".panel .button--primary").click();
    const forensicReport = await forensic.evaluate(() => navigator.clipboard.readText());

    // Put the detail level back. It lives in chrome.storage.sync, so leaving it on
    // Forensic silently changes every later check in this file — which is exactly what
    // happened the first time this test was written.
    await forensic.locator(".panel select").selectOption("standard");
    await forensic.waitForTimeout(400);
    await forensic.close();

    /** One assertion per identify.ts export, so a regression names the function. */
    const forensicLine = (label) =>
      forensicReport.split("\n").find((l) => l.startsWith(`**${label}:**`)) ?? "";

    check(
      "identifyElement names an element by tag and text",
      forensicReport.includes('### 1. button "Save changes"'),
      forensicReport.slice(0, 200),
    );
    check(
      "buildSelector produces a rooted, nth-of-type qualified selector",
      /^\*\*Selector:\*\* `.*button:nth-of-type\(\d+\)`$/.test(forensicLine("Selector")),
      forensicLine("Selector"),
    );
    check(
      "getFullElementPath walks from body with tag#id.class segments",
      /^\*\*Full DOM path:\*\* body > div#app > .*button\.base-button$/.test(
        forensicLine("Full DOM path"),
      ),
      forensicLine("Full DOM path"),
    );
    // Author-written class names are kept whole. The previous implementation dropped the
    // last hyphenated segment as if it were a build hash, turning `base-button` into
    // `base` and `sidebar__title` into `sidebar_` — a worse grep target and a less
    // specific selector. Only segments that actually look like hashes are stripped now.
    check(
      "getElementClasses keeps author-written class names whole",
      forensicLine("Classes") === "**Classes:** base-button",
      forensicLine("Classes"),
    );
    check(
      "getNearbyText brackets the surrounding text",
      /^\*\*Context:\*\* \[before: ".*"\] Save changes \[after: ".*"\]$/.test(forensicLine("Context")),
      forensicLine("Context"),
    );
    check(
      "getForensicComputedStyles emits semicolon-separated declarations",
      /^\*\*Computed styles:\*\* color: .*; background-color: .*; font-size: .*$/.test(
        forensicLine("Computed styles"),
      ),
      forensicLine("Computed styles").slice(0, 160),
    );
    check(
      "getAccessibilityInfo reports focusability",
      forensicLine("Accessibility").includes("focusable"),
      forensicLine("Accessibility"),
    );
    check(
      "getNearbyElements names siblings with their classes and text",
      /^\*\*Nearby elements:\*\* h2\.sidebar__title "Navigation", button\.base-button "Discard"/.test(
        forensicLine("Nearby elements"),
      ),
      forensicLine("Nearby elements"),
    );

    // -------------------------------------------------------------------------
    // vite-plugin-vue-tracer (current Nuxt DevTools)
    // -------------------------------------------------------------------------
    const tracer = await context.newPage();
    await tracer.goto(`${base}/vue3-tracer.html`);
    await tracer.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    check(
      "tracer pages write no data-v-inspector attributes",
      (await tracer.locator("[data-v-inspector]").count()) === 0,
    );

    await tracer.locator(".tool--brand").click();
    await tracer.locator(".base-button").click();
    await tracer.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });

    const tracerText = (await tracer.locator(".composer").textContent()) ?? "";
    check(
      "tracer gives an exact line and column",
      tracerText.includes("app/components/BaseButton.vue:42:7"),
      tracerText.slice(0, 200),
    );
    // Scoped to the header: the retarget controls are `.icon-button`s too, and an
    // unqualified `.composer .icon-button` matches five of them.
    await tracer.locator(".composer .card__header .icon-button").click();

    // An uninstrumented child must inherit its nearest recorded ancestor.
    await tracer.locator(".badge").click();
    await tracer.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    const badgeText = (await tracer.locator(".composer").textContent()) ?? "";
    check(
      "an uninstrumented child walks up to its recorded ancestor",
      badgeText.includes("app/components/BaseButton.vue:42:7"),
      badgeText.slice(0, 200),
    );

    // -------------------------------------------------------------------------
    // Vue 2 shape
    // -------------------------------------------------------------------------
    const legacy = await context.newPage();
    await legacy.goto(`${base}/vue2-app.html`);
    await legacy.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const legacyBadge = (await legacy.locator(".stack-badge").textContent())?.trim() ?? "";
    check("Vue 2 is detected", legacyBadge.startsWith("Vue 2"), `badge read "${legacyBadge}"`);

    await legacy.locator(".tool--brand").click();
    await legacy.locator(".add-to-cart").click();
    const legacyComposer = legacy.locator(".composer");
    await legacyComposer.waitFor({ state: "visible", timeout: 5_000 });

    const legacyText = (await legacyComposer.textContent()) ?? "";
    check(
      "Vue 2 ancestry is walked via $parent",
      legacyText.includes("<App> <ProductCard> <AddToCartButton>"),
      legacyText.slice(0, 200),
    );
    check(
      "Vue 2 source comes from $options.__file",
      legacyText.includes("src/components/AddToCartButton.vue"),
      legacyText.slice(0, 200),
    );

    // -------------------------------------------------------------------------
    // Marquee — contained + outermost
    // -------------------------------------------------------------------------
    const marquee = await context.newPage();
    await marquee.goto(`${base}/marquee.html`);
    await marquee.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await marquee.locator(".tool--brand").click();

    const hint = marquee.locator(".toolbar-hint");
    await hint.waitFor({ state: "visible", timeout: 5_000 });
    check(
      "the hint names the default mode and the keys for the others",
      ((await hint.textContent())?.trim() ?? "") ===
        "Click an element · ⌘/Ctrl+drag across several · C captures hover · 2 text · 3 area",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    await marquee.locator('.tool[aria-label^="Select text"]').click();
    check(
      "the hint follows the mode",
      ((await hint.textContent())?.trim() ?? "") === "Select text · 1 point · 3 area",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    await marquee.locator('.tool[aria-label^="Drag"]').click();
    check(
      "the hint says the drag mode is a drag",
      ((await hint.textContent())?.trim() ?? "") === "Drag across elements · 1 point · 2 text",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    // The drag repaints on requestAnimationFrame, so a read taken straight after
    // a mouse move can land on the frame before the one that reflects it. Every
    // mid-drag assertion waits this out first.
    const nextFrame = () =>
      marquee.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );

    const cardA = await marquee.locator("#card-a").boundingBox();
    const cardC = await marquee.locator("#card-c").boundingBox();

    // Fully around A and B; the right edge lands 20px inside C.
    const dragFrom = { x: cardA.x - 10, y: cardA.y - 10 };
    const dragTo = { x: cardC.x + 20, y: cardA.y + cardA.height + 10 };

    await marquee.mouse.move(dragFrom.x, dragFrom.y);
    await marquee.mouse.down();
    await marquee.mouse.move(dragTo.x, dragTo.y, { steps: 8 });
    await marquee.mouse.up();

    const composerMeta = marquee.locator(".composer__meta");
    await composerMeta.waitFor({ state: "visible", timeout: 5_000 });
    const metaText = (await composerMeta.textContent())?.trim() ?? "";

    check(
      "a marquee selects the elements it fully contains",
      metaText.includes("2 elements"),
      `meta read "${metaText}"`,
    );
    check(
      "a marquee keeps the outermost element, not the leaves",
      !metaText.includes("card-title") && !metaText.includes("card-body"),
      `meta read "${metaText}"`,
    );

    await marquee.keyboard.press("Escape");

    // A stray click in area mode must not open the composer.
    await marquee.mouse.move(cardA.x + 40, cardA.y + 40);
    await marquee.mouse.down();
    await marquee.mouse.move(cardA.x + 42, cardA.y + 42);
    await marquee.mouse.up();
    check(
      "a drag under the minimum size selects nothing",
      (await marquee.locator(".composer__meta").count()) === 0,
    );

    // The preview must show exactly what releasing would annotate.
    await marquee.mouse.move(dragFrom.x, dragFrom.y);
    await marquee.mouse.down();
    await marquee.mouse.move(dragTo.x, dragTo.y, { steps: 8 });

    await nextFrame();

    const previewCount = await marquee.locator(".highlight--preview").count();
    check(
      "the drag previews the elements it would take",
      previewCount === 2,
      `previewed ${previewCount}`,
    );
    check(
      "the hint counts the selection while dragging",
      ((await hint.textContent())?.trim() ?? "") === "2 elements selected · release to annotate",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    await marquee.mouse.up();
    const previewMeta = (await marquee.locator(".composer__meta").textContent())?.trim() ?? "";
    check(
      "the previewed set is the annotated set",
      previewMeta.includes("2 elements"),
      `meta read "${previewMeta}"`,
    );
    await marquee.keyboard.press("Escape");

    // Scrolling mid-drag: the box is anchored to the page, not the viewport.
    const scrollBy = 200;
    await marquee.mouse.move(dragFrom.x, dragFrom.y);
    await marquee.mouse.down();
    await marquee.mouse.wheel(0, scrollBy);
    await marquee.waitForFunction((y) => window.scrollY >= y, scrollBy);
    await marquee.mouse.move(dragTo.x, dragTo.y - scrollBy, { steps: 8 });
    await marquee.mouse.up();

    const scrolledMeta = marquee.locator(".composer__meta");
    await scrolledMeta.waitFor({ state: "visible", timeout: 5_000 });
    const scrolledText = (await scrolledMeta.textContent())?.trim() ?? "";
    check(
      "scrolling mid-drag keeps the box on the page, not the viewport",
      scrolledText.includes("2 elements"),
      `meta read "${scrolledText}"`,
    );
    await marquee.keyboard.press("Escape");
    await marquee.evaluate(() => window.scrollTo(0, 0));

    // A box over empty page area: the hint says so rather than going blank.
    const emptyY = cardA.y + cardA.height + 60;
    await marquee.mouse.move(cardA.x, emptyY);
    await marquee.mouse.down();
    await marquee.mouse.move(cardA.x + 120, emptyY + 60, { steps: 4 });
    await nextFrame();
    check(
      "an empty box says nothing is inside it",
      ((await hint.textContent())?.trim() ?? "") === "Nothing inside the box yet",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );
    await marquee.mouse.up();

    check(
      "the hint returns to the mode line after a drag",
      ((await hint.textContent())?.trim() ?? "") === "Drag across elements · 1 point · 2 text",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    // -------------------------------------------------------------------------
    // ⌘/Ctrl+drag — the same box without leaving point mode
    // -------------------------------------------------------------------------
    //
    // The modifier already means "collect" for a single element, so click and drag
    // have to be told apart by movement. The threshold is MIN_MARQUEE_SIZE, reused
    // rather than reinvented: it is already the size below which a box selects
    // nothing, so one number cannot disagree with the other.
    await marquee.locator('.tool[aria-label^="Click an element"]').click();
    check(
      "the point hint advertises the modifier drag",
      ((await hint.textContent())?.trim() ?? "") ===
        "Click an element · ⌘/Ctrl+drag across several · C captures hover · 2 text · 3 area",
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );

    const modifierDrag = async (from, to) => {
      await marquee.keyboard.down("ControlOrMeta");
      await marquee.mouse.move(from.x, from.y);
      await marquee.mouse.down();
      await marquee.mouse.move(to.x, to.y, { steps: 8 });
      await marquee.mouse.up();
      await marquee.keyboard.up("ControlOrMeta");
    };

    await modifierDrag(dragFrom, dragTo);
    const modMeta = marquee.locator(".composer__meta");
    await modMeta.waitFor({ state: "visible", timeout: 5_000 });
    const modText = (await modMeta.textContent())?.trim() ?? "";
    check(
      "⌘/Ctrl+drag boxes elements without switching to area mode",
      modText.includes("2 elements"),
      `meta read "${modText}"`,
    );
    check(
      "the modifier drag leaves the mode alone",
      (await marquee.locator('.tool[aria-label^="Click an element"]').getAttribute("aria-pressed")) ===
        "true",
    );
    await marquee.keyboard.press("Escape");

    // Anything already collected joins the box rather than being dropped — the same
    // rule a plain click follows, so the modifier keeps one meaning throughout.
    await marquee
      .locator("#card-c .card-body")
      .click({ modifiers: ["ControlOrMeta"], timeout: 5_000 });
    await marquee.waitForTimeout(200);
    await modifierDrag(dragFrom, dragTo);
    await modMeta.waitFor({ state: "visible", timeout: 5_000 });
    const mergedText = (await modMeta.textContent())?.trim() ?? "";
    check(
      "a modifier drag commits what was already picked along with the box",
      mergedText.includes("3 elements"),
      `meta read "${mergedText}"`,
    );
    await marquee.keyboard.press("Escape");

    // Below the threshold the gesture is still a pick. Without this the modifier
    // would stop collecting single elements the moment the hand shook.
    await marquee.mouse.move(cardA.x + 40, cardA.y + 40);
    await marquee.keyboard.down("ControlOrMeta");
    await marquee.mouse.down();
    await marquee.mouse.move(cardA.x + 42, cardA.y + 42);
    await marquee.mouse.up();
    await marquee.keyboard.up("ControlOrMeta");
    await marquee.waitForTimeout(200);
    check(
      "a modifier drag under the threshold still picks rather than boxing",
      ((await hint.textContent())?.trim() ?? "").startsWith("1 element picked") &&
        (await marquee.locator(".composer").count()) === 0,
      `hint read "${(await hint.textContent())?.trim() ?? ""}"`,
    );
    await marquee.keyboard.press("Escape");

    // -------------------------------------------------------------------------
    // Picking elements one at a time — ⌘/Ctrl+click
    // -------------------------------------------------------------------------
    //
    // The marquee above takes what one rectangle fully contains. The set a review
    // actually wants is often three things far apart, so this accumulates them: a
    // modifier-click adds (or removes) one, a plain click adds the element it landed on
    // and commits, `Enter` commits the set as it stands, `Escape` drops it.
    //
    // `ControlOrMeta` rather than `Meta`: the extension accepts either modifier, and
    // Playwright resolves this one per platform — on macOS a real Ctrl+click is a
    // right-click and never delivers the `click` this depends on.
    const pick = await context.newPage();
    await pick.goto(`${base}/pick.html`);
    await pick.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await pick.locator(".tool--brand").click();

    const pickHint = async () =>
      ((await pick.locator(".toolbar-hint").textContent()) ?? "").trim();
    const addPick = (selector) =>
      pick.locator(selector).click({ modifiers: ["ControlOrMeta"], timeout: 5_000 });

    await addPick(".badge");
    await addPick(".label");
    await pick.waitForTimeout(200);

    check(
      "two modifier-clicks pick two elements",
      (await pickHint()).startsWith("2 elements picked"),
      `hint read "${await pickHint()}"`,
    );
    check(
      "picking does not open the composer",
      (await pick.locator(".composer").count()) === 0,
      "a composer opened while the set was still being built",
    );
    // The pointer is over `.label`, which is picked, so it must not be drawn twice —
    // two boxes, not three.
    check(
      "every picked element is drawn, once each",
      (await pick.locator(".highlight--preview").count()) === 2,
      `${await pick.locator(".highlight--preview").count()} preview boxes`,
    );

    // Same element again removes it — and the hint has to say "1 element", singular.
    await addPick(".label");
    await pick.waitForTimeout(200);
    check(
      "picking the same element again takes it back out",
      (await pickHint()).startsWith("1 element picked"),
      `hint read "${await pickHint()}"`,
    );

    // A plain click is both "add this one" and "done".
    await addPick(".label");
    await pick.locator(".submit").click({ timeout: 5_000 });
    await pick.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    const pickMeta = ((await pick.locator(".composer__meta").textContent()) ?? "").trim();
    check(
      "a plain click commits the set together with the element it landed on",
      pickMeta.includes("3 elements"),
      `meta read "${pickMeta}"`,
    );

    await pick.keyboard.type("These three all use the wrong grey.");
    await pick.locator(".composer .button--primary").click();
    await pick.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await pick.locator('.tool[aria-label^="Annotations"]').click();
    await pick.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    check(
      "three picked elements make one note, not three",
      (await pick.locator(".entry").count()) === 1,
      `${await pick.locator(".entry").count()} entries`,
    );

    await pick.locator(".panel .button--primary").click();
    const pickReport = await pick.evaluate(() => navigator.clipboard.readText());
    check(
      "the report says the note covers more than the element it names",
      /\+2 more/.test(pickReport) && /These three all use the wrong grey/.test(pickReport),
      pickReport.slice(0, 240),
    );
    await pick.locator('.tool[aria-label^="Annotations"]').click();

    // Escape drops the set without leaving inspect mode — the hint going back to the
    // mode line is how you can tell the difference.
    await addPick(".badge");
    await addPick(".label");
    await pick.keyboard.press("Escape");
    await pick.waitForTimeout(200);
    check(
      "Escape drops the set and stays in inspect mode",
      (await pickHint()) ===
        "Click an element · ⌘/Ctrl+drag across several · C captures hover · 2 text · 3 area" &&
        (await pick.locator(".highlight--preview").count()) === 0 &&
        (await pick.locator(".tool--brand").getAttribute("aria-pressed")) === "true",
      `hint read "${await pickHint()}", ${await pick.locator(".highlight--preview").count()} boxes`,
    );

    // And Enter commits the set as it stands, with no plain click at all.
    await addPick(".badge");
    await addPick(".label");
    await pick.keyboard.press("Enter");
    await pick.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    check(
      "Enter commits the picked set on its own",
      (((await pick.locator(".composer__meta").textContent()) ?? "").includes("2 elements")),
      `meta read "${((await pick.locator(".composer__meta").textContent()) ?? "").trim()}"`,
    );
    await pick.keyboard.press("Escape");

    // -------------------------------------------------------------------------
    // Modals — our own UI must not read as a click outside the page's dialog
    // -------------------------------------------------------------------------
    //
    // Mouse events are `composed: true`, so a click on our toolbar leaves the shadow
    // root and reaches `document` retargeted to our host — which sits on
    // `documentElement`, outside every dialog on the page. A site that dismisses on
    // "a pointer event outside the dialog" then closes the modal the moment the
    // toolbar is touched, and the modal becomes impossible to annotate.
    //
    // The modal is opened with inspect mode OFF, because inspect mode correctly
    // swallows page-directed clicks.
    const modal = await context.newPage();
    await modal.goto(`${base}/modal.html`);
    await modal.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const modalOpen = () =>
      modal.locator("#backdrop").evaluate((el) => el.classList.contains("open"));
    // Names what dismissed it, so a failure says why rather than just "it closed".
    const closeLog = () => modal.evaluate(() => window.__closeLog.join(", "));

    await modal.locator("#open").click();
    check("the fixture's modal opens", await modalOpen());

    // Let the dialog's 0.25s entrance animation finish before anything freezes, or the
    // freeze correctly pauses it mid-fade and the visibility check below would be
    // asserting on a half-faded dialog rather than on what freeze does to a settled one.
    await modal.waitForFunction(
      () => getComputedStyle(document.getElementById("dialog")).opacity === "1",
      null,
      { timeout: 5_000 },
    );

    await modal.locator(".tool--brand").click();
    check(
      "toggling inspect does not dismiss the page's modal",
      await modalOpen(),
      `closed by: ${await closeLog()}`,
    );

    await modal.keyboard.press("f");
    // Freezing crosses the bridge, so it lands a round-trip after the keypress — but this
    // deliberately does NOT use `waitForFunction`, which polls on requestAnimationFrame:
    // freeze parks rAF *and* setTimeout callbacks, so any in-page polling loop is held by
    // the very state it is waiting to observe, and every such wait times out. A Node-side
    // sleep plus one `evaluate` — neither of which depends on a page timer — is the only
    // way to observe a frozen page.
    await modal.waitForTimeout(600);
    check(
      "the page really is frozen",
      await modal.evaluate(() => !!document.getElementById("senannotate-freeze-styles")),
    );
    check(
      "freezing does not dismiss the page's modal",
      await modalOpen(),
      `closed by: ${await closeLog()}`,
    );
    // The dialog's opacity comes from a forwards-filling animation, so this also
    // pins that `animation-play-state: paused` does not blank animated content.
    check(
      "a frozen modal is still visible",
      (await modal.locator("#dialog").evaluate((el) => getComputedStyle(el).opacity)) === "1",
    );
    await modal.keyboard.press("f");

    await modal.locator('.tool[aria-label^="Annotations"]').click();
    check(
      "opening the panel does not dismiss the page's modal",
      await modalOpen(),
      `closed by: ${await closeLog()}`,
    );
    await modal.locator('.tool[aria-label^="Annotations"]').click();

    await modal.keyboard.press("h");
    check(
      "collapsing the toolbar does not dismiss the page's modal",
      await modalOpen(),
      `closed by: ${await closeLog()}`,
    );
    await modal.keyboard.press("h");

    // Collapsing took inspect mode with it and expanding does not hand it back, so it
    // has to be asked for again before the modal can be annotated.
    await modal.locator(".tool--brand").click();

    // The point of all of the above: the modal can actually be annotated.
    await modal.locator(".dialog-body").click();
    await modal.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    check("an element inside the modal opens the composer", await modalOpen());

    await modal.locator(".composer__input").fill("This copy should name the item.");
    await modal.locator(".composer .button--primary").click();
    await modal.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await modal.locator('.tool[aria-label^="Annotations"]').click();
    await modal.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await modal.locator(".panel .button--primary").click();
    const modalReport = await modal.evaluate(() => navigator.clipboard.readText());
    check(
      "the report locates the annotated element inside the dialog",
      /dialog/.test(modalReport),
      modalReport.slice(0, 200),
    );

    // -------------------------------------------------------------------------
    // The top layer — a `showModal()` dialog outranks any z-index we can set
    // -------------------------------------------------------------------------
    //
    // Everything above uses a `div` modal, which our maximum z-index wins. `showModal()`
    // does not compete on z-index at all: it moves the dialog into the browser's top
    // layer, painted above the whole stacking order, and makes every element outside it
    // inert — unhittable, unfocusable, deaf to keystrokes. Reported as exactly that: with
    // a modal open, no note could be added. The fix places our host inside the topmost
    // `:modal` element; these checks are what it has to buy.
    //
    // No `Escape` anywhere in this block — a native dialog closes on it.
    const native = await context.newPage();
    await native.goto(`${base}/modal-native.html`);
    await native.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const nativeCloseLog = () => native.evaluate(() => window.__closeLog.join(", "));
    const dialogIsModal = (id) => native.locator(`#${id}`).evaluate((el) => el.matches(":modal"));

    await native.locator("#open-plain").click();
    check("the native dialog opens modally", await dialogIsModal("native"));

    // The first thing the report said was impossible: reaching our own toolbar. Before the
    // fix the dialog intercepted the click and Playwright timed out on it.
    const brandPressed = () =>
      native.locator(".tool--brand").getAttribute("aria-pressed");
    await native.locator(".tool--brand").click({ timeout: 5_000 });
    check(
      "the toolbar is clickable with a top-layer modal open",
      (await brandPressed()) === "true",
      `aria-pressed read "${await brandPressed()}"`,
    );

    // The highlight has to land *on* the element, not offset by the dialog's box: inside a
    // dialog our host can be sized to the dialog rather than the viewport, which moves
    // every coordinate we draw. Asserted on both dialogs, because only the transformed one
    // is a containing block for fixed positioning.
    const highlightLinesUp = async (selector) => {
      const target = await native.locator(selector).boundingBox();
      await native.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 4,
      });
      const highlight = native.locator(".highlight").first();
      await highlight.waitFor({ state: "visible", timeout: 5_000 });
      await native.waitForTimeout(200);
      const drawn = await highlight.boundingBox();
      return {
        ok: Math.abs(drawn.x - target.x) < 2 && Math.abs(drawn.y - target.y) < 2,
        detail: `target ${Math.round(target.x)},${Math.round(target.y)} vs highlight ${Math.round(drawn.x)},${Math.round(drawn.y)}`,
      };
    };

    const plainAligned = await highlightLinesUp(".plain-body");
    check("the highlight lines up inside a top-layer dialog", plainAligned.ok, plainAligned.detail);

    await native.locator(".plain-body").click({ timeout: 5_000 });
    await native.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    check("an element inside a top-layer dialog opens the composer", await dialogIsModal("native"));

    // Real keystrokes, never `fill()`. `fill()` writes the value straight into the element
    // and would pass even with the composer inert behind the dialog — which is the whole
    // bug. `modal-focus-leak/changelog.md` records that measurement nearly hiding the
    // sibling bug in 0.5.1.
    await native.keyboard.type("The dialog's copy should name the item.");
    check(
      "the composer takes real keystrokes with a modal open",
      (await native.locator(".composer__input").inputValue()) ===
        "The dialog's copy should name the item.",
      `textarea read "${await native.locator(".composer__input").inputValue()}"`,
    );

    await native.locator(".composer .button--primary").click();
    await native.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    check(
      "the dialog survives being annotated",
      await dialogIsModal("native"),
      `closed by: ${await nativeCloseLog()}`,
    );

    // The second dialog is transformed, so `inset: 0` on our host resolves against the
    // dialog instead of the viewport unless the fit compensates for it.
    // Opened through the DOM, not the page's button: inspect mode is on by now and
    // correctly swallows page-directed clicks, and `showModal()` needs no activation.
    await native.locator("#native").evaluate((el) => el.close());
    await native.locator("#animated").evaluate((el) => el.showModal());
    check("the transformed dialog opens modally", await dialogIsModal("animated"));

    const animatedAligned = await highlightLinesUp(".animated-body");
    check(
      "the highlight lines up inside a transformed top-layer dialog",
      animatedAligned.ok,
      animatedAligned.detail,
    );

    await native.locator(".animated-body").click({ timeout: 5_000 });
    await native.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await native.keyboard.type("Noted through a containing block.");
    await native.locator(".composer .button--primary").click();
    await native.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    check(
      "both notes were saved from inside the top layer",
      (await native.locator(".count").textContent()) === "2",
      `count badge read "${await native.locator(".count").textContent()}"`,
    );

    await native.locator('.tool[aria-label^="Annotations"]').click();
    await native.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await native.locator(".panel .button--primary").click();
    const nativeReport = await native.evaluate(() => navigator.clipboard.readText());
    check(
      "the report names the elements annotated inside the top layer",
      /plain-body/.test(nativeReport) && /animated-body/.test(nativeReport),
      nativeReport.slice(0, 300),
    );

    // -------------------------------------------------------------------------
    // Focus traps — our UI must not take focus off the page's dialog
    // -------------------------------------------------------------------------
    //
    // Focus is the default action of `mousedown`, so a toolbar click used to move
    // `document.activeElement` into our shadow root. Two things then went wrong, both
    // measured: a modal that closes when focus leaves it was dismissed, and a modal with
    // a focus trap fought the composer for focus and won — every keystroke of the note
    // landed in the dialog and the textarea stayed empty.
    //
    // Each variant gets its own page: the fixture's two document-level listeners would
    // otherwise observe each other's dialogs.

    // Variant A — closes when focus leaves the dialog.
    const focusClose = await context.newPage();
    await focusClose.goto(`${base}/modal-focus.html`);
    await focusClose.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const closeOpen = () =>
      focusClose.locator("#backdrop-close").evaluate((el) => el.classList.contains("open"));
    const focusLog = (page) => page.evaluate(() => window.__focusLog.join(", "));

    await focusClose.locator("#open-close").click();
    check("the close-on-focus-loss modal opens", await closeOpen());

    await focusClose.locator(".tool--brand").click();
    check(
      "toggling inspect takes no focus off the page's dialog",
      await closeOpen(),
      `focus log: ${await focusLog(focusClose)}`,
    );

    await focusClose.keyboard.press("f");
    await focusClose.waitForTimeout(600);
    check(
      "freezing takes no focus off the page's dialog",
      await closeOpen(),
      `focus log: ${await focusLog(focusClose)}`,
    );
    await focusClose.keyboard.press("f");

    await focusClose.locator('.tool[aria-label^="Annotations"]').click();
    check(
      "opening the panel takes no focus off the page's dialog",
      await closeOpen(),
      `focus log: ${await focusLog(focusClose)}`,
    );
    await focusClose.locator('.tool[aria-label^="Annotations"]').click();

    // The composer autofocuses its textarea, and the dialog's own `focusout` fires on the
    // dialog rather than through our host — so this variant does close here, and cannot be
    // made not to while typing requires focus. What must survive is the annotation: the
    // element is captured before the composer opens, so the report is unaffected.
    await focusClose.locator(".close-body").click();
    await focusClose.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await focusClose.locator(".composer__input").fill("Noted while the dialog gave up.");
    await focusClose.locator(".composer .button--primary").click();
    await focusClose.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await focusClose.locator('.tool[aria-label^="Annotations"]').click();
    await focusClose.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await focusClose.locator(".panel .button--primary").click();
    const closeReport = await focusClose.evaluate(() => navigator.clipboard.readText());
    check(
      "a dialog that closes on focus loss still yields a report naming its element",
      /close-body|dialog-close/.test(closeReport),
      closeReport.slice(0, 200),
    );

    // Variant B — a real focus trap, which restores focus rather than closing.
    const focusTrap = await context.newPage();
    await focusTrap.goto(`${base}/modal-focus.html`);
    await focusTrap.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const trapOpen = () =>
      focusTrap.locator("#backdrop-restore").evaluate((el) => el.classList.contains("open"));

    await focusTrap.locator("#open-restore").click();
    check("the focus-trap modal opens", await trapOpen());

    await focusTrap.locator(".tool--brand").click();
    check(
      "a toolbar click does not trip the page's focus trap",
      (await focusLog(focusTrap)) === "",
      `focus log: ${await focusLog(focusTrap)}`,
    );

    await focusTrap.locator(".restore-body").click();
    await focusTrap.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    check("the focus-trap modal survives being annotated", await trapOpen());

    // Real keystrokes, not `fill()`: `fill()` sets the value over CDP and would pass even
    // with the page stealing focus back between characters, which is the actual bug.
    await focusTrap.locator(".composer__input").click();
    await focusTrap.keyboard.type("Typed inside a focus trap.", { delay: 20 });
    const typed = await focusTrap.locator(".composer__input").inputValue();
    check(
      "a note typed inside a focus trap reaches the composer",
      typed === "Typed inside a focus trap.",
      `textarea holds "${typed}" · focus log: ${await focusLog(focusTrap)}`,
    );
    await focusTrap.keyboard.press("Escape");

    // Variant C — the same trap keyed on `focusout` instead, which is what Reka UI, Radix
    // and Headless UI actually ship. That event fires on the *page's* focused element, so
    // it never travels through our host and the propagation guard cannot reach it: measured,
    // the trap pulled focus back to the dialog before the first keystroke and the note went
    // nowhere, while everything on screen looked correct. `takeFocus` blurs first so the
    // trap sees the `relatedTarget === null` it is required to ignore.
    // `docs/modal-trap-refocus/`.
    const focusOutTrap = await context.newPage();
    await focusOutTrap.goto(`${base}/modal-focus.html`);
    await focusOutTrap.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const outTrapOpen = () =>
      focusOutTrap.locator("#backdrop-trap").evaluate((el) => el.classList.contains("open"));

    await focusOutTrap.locator("#open-trap").click();
    check("the focusout-trap modal opens", await outTrapOpen());

    await focusOutTrap.locator(".tool--brand").click();
    check(
      "a toolbar click does not trip a focusout-keyed trap",
      (await focusLog(focusOutTrap)) === "",
      `focus log: ${await focusLog(focusOutTrap)}`,
    );

    await focusOutTrap.locator(".trap-body").click();
    await focusOutTrap.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    check("the focusout-trap modal survives being annotated", await outTrapOpen());

    // No `.click()` on the textarea first, and no `fill()`: the composer autofocuses, and
    // the bug is entirely in what happens between that autofocus and the first keystroke.
    await focusOutTrap.keyboard.type("Typed inside a focusout trap.", { delay: 20 });
    const outTyped = await focusOutTrap.locator(".composer__input").inputValue();
    check(
      "a note typed inside a focusout-keyed trap reaches the composer",
      outTyped === "Typed inside a focusout trap.",
      `textarea holds "${outTyped}" · focus log: ${await focusLog(focusOutTrap)}`,
    );

    await focusOutTrap.locator(".composer .button--primary").click();
    await focusOutTrap.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    check("the focusout-trap modal is still open after the note is saved", await outTrapOpen());

    // -------------------------------------------------------------------------
    // The hover label stays inside the viewport
    // -------------------------------------------------------------------------
    //
    // The label is anchored to the highlighted box's left edge and grows rightward, so
    // hovering anything near the right edge — a header action, a table's last column — used
    // to run it off screen and cut off the source path, the half worth reading. Found while
    // shooting the Web Store screenshots, where it sat clipped over the page.
    //
    // A negative `style.left` is the clamp having engaged, which is also the proof the
    // overflow was real: without the shift the label would have been exactly that far out.
    const edge = await context.newPage();
    await edge.goto(`${base}/label-edge.html`);
    await edge.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await edge.locator(".tool--brand").click();
    const viewportWidth = await edge.evaluate(() => window.innerWidth);

    const labelAt = async (selector) => {
      const box = await edge.locator(selector).boundingBox();
      await edge.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
      const label = edge.locator(".highlight__label").first();
      await label.waitFor({ state: "visible", timeout: 5_000 });
      await edge.waitForTimeout(200);
      return {
        rect: await label.boundingBox(),
        shift: await label.evaluate((el) => parseFloat(el.style.left) || 0),
      };
    };

    const atRight = await labelAt(".edge-button");
    check(
      "a label on a right-edge element stays inside the viewport",
      atRight.rect.x + atRight.rect.width <= viewportWidth,
      `label spans ${Math.round(atRight.rect.x)}–${Math.round(atRight.rect.x + atRight.rect.width)} of ${viewportWidth}`,
    );
    check(
      "the label was actually shifted to achieve that",
      atRight.shift < 0,
      `style.left was ${atRight.shift}px`,
    );

    const atLeft = await labelAt(".left-button");
    check(
      "a label on a left-edge element is not shifted off the other side",
      atLeft.shift === 0 && atLeft.rect.x >= 0,
      `style.left was ${atLeft.shift}px, x was ${Math.round(atLeft.rect.x)}`,
    );

    // -------------------------------------------------------------------------
    // Hover capture — annotating what a click would destroy
    // -------------------------------------------------------------------------
    //
    // The fixture's menu is open only while the pointer is on it. Clicking an item
    // to annotate it is impossible to do *and* observe: the click is what closes the
    // thing. `C` is the whole feature — capture without moving or pressing.
    const hover = await context.newPage();
    await hover.goto(`${base}/hover-menu.html`);
    await hover.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await hover.locator(".tool--brand").click();

    await hover.locator(".menu__trigger").hover();
    const menuItem = hover.locator("#menu-billing");
    await menuItem.waitFor({ state: "visible", timeout: 5_000 });

    // Move onto the item itself and leave the pointer there for the keypress.
    await menuItem.hover();
    check("the hover-only menu is open with the pointer on it", await menuItem.isVisible());

    await hover.keyboard.press("c");
    const hoverComposer = hover.locator(".composer");
    await hoverComposer.waitFor({ state: "visible", timeout: 5_000 });

    const hoverMeta = (await hover.locator(".composer__meta").textContent())?.trim() ?? "";
    check(
      "C annotates the hovered menu item with no click",
      /Billing settings/.test(hoverMeta),
      `composer described "${hoverMeta}"`,
    );

    await hover.locator(".composer__input").fill("This item belongs above Sign out.");
    await hover.locator(".composer .button--primary").click();
    await hoverComposer.waitFor({ state: "detached", timeout: 5_000 });

    await hover.locator('.tool[aria-label^="Annotations"]').click();
    await hover.locator(".panel .button--primary").click();
    const hoverReport = await hover.evaluate(() => navigator.clipboard.readText());
    check(
      "the hover-captured note reaches the report intact",
      hoverReport.includes("Billing settings") && hoverReport.includes("belongs above Sign out"),
      hoverReport.split("\n").slice(0, 8).join(" / "),
    );

    // Pressing it over nothing must say so rather than looking broken.
    const empty = await context.newPage();
    await empty.goto(`${base}/plain.html`);
    await empty.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await empty.locator(".tool--brand").click();
    await empty.keyboard.press("c");
    const emptyToast = empty.locator(".toast");
    await emptyToast.waitFor({ state: "visible", timeout: 5_000 });
    check(
      "C with nothing hovered explains itself",
      /Hover an element first/.test((await emptyToast.textContent()) ?? ""),
      `toast read "${(await emptyToast.textContent())?.trim() ?? ""}"`,
    );
    await empty.close();

    // -------------------------------------------------------------------------
    // Screenshots — saved with no `downloads` permission
    // -------------------------------------------------------------------------
    //
    // The manifest deliberately does not request `downloads`: the cropped PNG is handed to
    // the browser the plain DOM way, via a blob URL on a hidden `<a download>`, which needs
    // no permission at all. That is easy to "fix" by adding the permission back, and the
    // Web Store rejects unnecessary permissions — so the path is pinned here.
    const shooter = await context.newPage();
    await shooter.goto(`${base}/vue3-app.html`);
    await shooter.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await shooter.locator(".tool--brand").click();
    await shooter.locator(".base-button").first().click();
    await shooter.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });

    // The camera no longer downloads directly — it opens the markup editor, and
    // nothing reaches the disk until that editor is saved. A cancelled markup must
    // leave no file behind, which is the second half of this block.
    await shooter.locator('.composer .button[title^="Capture"]').click();
    const editor = shooter.locator(".shot-editor");
    await editor.waitFor({ state: "visible", timeout: 10_000 });

    check("the camera button opens the markup editor", await editor.isVisible());

    // Draw a box, so the saved PNG is a marked-up one rather than the bare crop.
    const canvasBox = await shooter.locator(".shot-editor__canvas").boundingBox();
    check("the editor exposes a drawable canvas", canvasBox !== null && canvasBox.width > 0);

    if (canvasBox) {
      await shooter.mouse.move(canvasBox.x + 12, canvasBox.y + 12);
      await shooter.mouse.down();
      await shooter.mouse.move(canvasBox.x + canvasBox.width - 12, canvasBox.y + canvasBox.height - 12, {
        steps: 8,
      });
      await shooter.mouse.up();
    }

    const undoEnabled = await shooter
      .locator(".shot-tool", { hasText: "Undo" })
      .isEnabled()
      .catch(() => false);
    check("drawing a shape enables undo", undoEnabled);

    const download = shooter
      .waitForEvent("download", { timeout: 15_000 })
      .then((d) => d.suggestedFilename())
      .catch(() => null);
    await shooter.locator(".shot-editor .button--primary").click();
    const savedAs = await download;

    check(
      "the screenshot downloads without a downloads permission",
      typeof savedAs === "string" && savedAs.endsWith(".png"),
      `download was ${savedAs === null ? "never offered" : `"${savedAs}"`}`,
    );

    // The report has to name a path the reader can open. A bare filename — what
    // 0.5.x emitted — is unresolvable to both a person and an agent.
    await shooter.locator(".composer__input").fill("The corner radius is wrong here.");
    await shooter.locator(".composer .button--primary").click();
    await shooter.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    await shooter.locator('.tool[aria-label^="Annotations"]').click();
    await shooter.locator(".panel .button--primary").click();
    const shotReport = await shooter.evaluate(() => navigator.clipboard.readText());

    check(
      "the report names where the screenshot was saved",
      /\*\*Screenshot:\*\* ~\/Downloads\/senannotate-\d+\.png/.test(shotReport),
      `report said: ${shotReport.split("\n").find((line) => line.includes("Screenshot")) ?? "(no screenshot line)"}`,
    );
    check(
      "the default delivery does not embed the image in the report",
      !shotReport.includes("data:image/"),
      "a data: URI appeared with screenshotDelivery still on its 'path' default",
    );

    await shooter.keyboard.press("Escape");

    // -------------------------------------------------------------------------
    // Diagnostics — the tester workflow on a page that misbehaves
    // -------------------------------------------------------------------------
    const buggy = await context.newPage();
    await buggy.goto(`${base}/buggy.html`);
    await buggy.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    // Use the app first, the way a tester would, before reaching for the toolbar.
    const SECRET_INPUT = "SHOULD-NOT-APPEAR@example.com";
    await buggy.locator("#email").fill(SECRET_INPUT);
    await buggy.locator(".save").click();
    await buggy.waitForTimeout(600);

    // Then annotate the thing that looked wrong.
    await buggy.locator(".tool--brand").click();
    await buggy.locator("#headline").click();
    await buggy.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await buggy.locator(".composer__input").fill("Saving does nothing and the page errors.");
    await buggy.locator(".composer .button--primary").click();
    await buggy.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await buggy.locator('.tool[aria-label^="Annotations"]').click();
    await buggy.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });

    const summary = buggy.locator(".capture-summary");
    await summary.waitFor({ state: "visible", timeout: 5_000 });
    const summaryText = (await summary.textContent())?.trim() ?? "";
    check(
      "the panel shows what was captured",
      /console error/.test(summaryText) && /failed request/.test(summaryText),
      `summary read "${summaryText}"`,
    );

    await buggy.locator(".panel .button--primary").click();
    const bugReport = await buggy.evaluate(() => navigator.clipboard.readText());

    check("report has steps to reproduce", bugReport.includes("## Steps to reproduce"));
    check(
      "steps name the field without its value",
      bugReport.includes("Edited Email address"),
      bugReport.slice(0, 400),
    );
    check("steps record the click", /Clicked button "Save changes"/.test(bugReport));
    // The headline was only ever clicked to annotate it, never as part of using
    // the app — so it must not show up as a step towards reproducing anything.
    check(
      "annotating is not recorded as a repro step",
      !/Clicked h1 "Account settings"/.test(bugReport),
      bugReport.slice(0, 500),
    );

    check("report has a console errors section", bugReport.includes("## Console errors"));
    check(
      "console.error calls are captured",
      bugReport.includes("Settings form failed validation"),
      bugReport.slice(0, 600),
    );
    check(
      "unhandled rejections are captured",
      bugReport.includes("saveProfile() timed out"),
      bugReport.slice(0, 600),
    );
    check(
      "uncaught throws are captured",
      bugReport.includes("Cannot read properties of undefined"),
      bugReport.slice(0, 600),
    );

    check("report has a failed requests section", bugReport.includes("## Failed requests"));
    check(
      "failing fetch is captured with its status",
      /404.*GET \/api\/seller\/profile/.test(bugReport),
      bugReport.slice(0, 800),
    );
    check(
      "failing XHR is captured",
      /POST \/api\/seller\/settings/.test(bugReport),
      bugReport.slice(0, 800),
    );

    // The two privacy guarantees, asserted rather than assumed.
    check(
      "credentials in URLs are redacted",
      bugReport.includes("access_token=%5Bredacted%5D") || bugReport.includes("access_token=[redacted]"),
      bugReport.slice(0, 800),
    );
    check("the raw token never appears", !bugReport.includes("SUPERSECRET123"));
    check("typed input values never appear", !bugReport.includes(SECRET_INPUT));

    // The same guarantee down the *props* path, which is a separate way in: a controlled
    // React input carries its typed value as a `value` prop, and `includeProps` (default
    // on) records the owner's props. Forensic detail renders them, so this is where a
    // password would surface if the redaction in the detector dispatcher failed.
    const privacy = await context.newPage();
    await privacy.goto(`${base}/react-input.html`);
    await privacy.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await privacy.waitForTimeout(800);

    await privacy.locator(".tool--settings").click();
    await privacy.locator(".settings").waitFor({ state: "visible", timeout: 5_000 });
    await privacy.selectOption('.settings [data-setting="detailLevel"]', "forensic");
    await privacy.locator(".tool--settings").click();
    await privacy.waitForTimeout(200);

    await privacy.locator(".tool--brand").click();
    await privacy.locator(".field").click({ force: true });
    await privacy.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await privacy.locator(".composer__input").fill("Props privacy check.");
    await privacy.locator(".composer .button--primary").click();
    await privacy.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await privacy.locator('.tool[aria-label^="Annotations"]').click();
    await privacy.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await privacy.locator(".panel .button--primary").click();
    const propsReport = await privacy.evaluate(() => navigator.clipboard.readText());
    check(
      "a controlled input's typed value never reaches the report via props",
      !propsReport.includes("hunter2-should-never-ship"),
      propsReport.slice(0, 500),
    );
    check(
      "the redacted prop key is kept, so the signal survives without the secret",
      propsReport.includes("value=[redacted]"),
      propsReport.slice(0, 500),
    );
    await privacy.close();

    // -------------------------------------------------------------------------
    // Production builds — what a QA tester actually gets
    // -------------------------------------------------------------------------
    // Three minified production builds of the same app. This is the measurement
    // behind the "what works on production?" answer in the README.
    const prodResults = {};

    for (const variant of ["stock", "devtools", "tracer"]) {
      const prod = await context.newPage();
      await prod.goto(`${base}/prod/${variant}/index.html`);
      await prod.waitForSelector(".base-button");
      await prod.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
      await prod.waitForTimeout(1_200);

      await prod.locator(".tool--brand").click();
      await prod.locator(".base-button").first().click();
      await prod.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });

      prodResults[variant] = {
        badge: (await prod.locator(".stack-badge").textContent())?.trim() ?? "",
        composer: (await prod.locator(".composer").textContent()) ?? "",
      };
      await prod.close();
    }

    // Stock: the metadata genuinely is not in the page. Annotating must still work.
    check(
      "stock production build reports no component data",
      !prodResults.stock.composer.includes("<BaseButton>"),
      prodResults.stock.composer.slice(0, 200),
    );
    check(
      "stock production build still identifies the element",
      prodResults.stock.composer.includes('button "Save changes"'),
      prodResults.stock.composer.slice(0, 200),
    );
    check(
      "stock production build is flagged as production",
      prodResults.stock.badge.length > 0,
      `badge read "${prodResults.stock.badge}"`,
    );

    // __VUE_PROD_DEVTOOLS__ alone: real component names survive minification,
    // because the SFC compiler emits `__name` in production too.
    check(
      "__VUE_PROD_DEVTOOLS__ restores the component tree on production",
      prodResults.devtools.composer.includes("<App> <TheSidebar> <BaseButton>"),
      prodResults.devtools.composer.slice(0, 200),
    );
    // @vitejs/plugin-vue re-attaches `__file` once devtools are enabled, but in a
    // production build it deliberately stores only the basename
    // (`isProduction ? path.basename(filename) : filename`). So you get a filename
    // to grep for, not a path, and never a line number.
    check(
      "__VUE_PROD_DEVTOOLS__ gives a bare filename, not a path",
      prodResults.devtools.composer.includes("BaseButton.vue") &&
        !prodResults.devtools.composer.includes("src/components/BaseButton.vue"),
      prodResults.devtools.composer.slice(0, 250),
    );
    check(
      "__VUE_PROD_DEVTOOLS__ alone gives no line number",
      !/\.vue:\d+/.test(prodResults.devtools.composer),
      prodResults.devtools.composer.slice(0, 250),
    );

    // Plus the tracer (which needs sourcemaps at build time): exact positions.
    check(
      "the tracer restores exact source positions on production",
      /src\/components\/BaseButton\.vue:\d+:\d+/.test(prodResults.tracer.composer),
      prodResults.tracer.composer.slice(0, 250),
    );

    // -------------------------------------------------------------------------
    // Non-Vue page — must degrade, not break
    // -------------------------------------------------------------------------
    // Served over http rather than `setContent`, which would leave the page on
    // about:blank where content scripts do not run.
    const plain = await context.newPage();
    await plain.goto(`${base}/plain.html`);
    await plain.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    // The retry in boot() waits 1.5s before giving up on a late-hydrating app.
    await plain.waitForTimeout(2_000);
    const plainBadgeVisible = await plain.locator(".stack-badge").isVisible();
    check(
      "non-framework pages show no stack badge",
      !plainBadgeVisible,
      `badge visible: ${plainBadgeVisible}`,
    );

    await plain.locator(".tool--brand").click();
    await plain.locator(".cta").click();
    await plain.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    const plainComposer = (await plain.locator(".composer").textContent()) ?? "";
    check(
      "non-Vue pages still annotate",
      plainComposer.includes('button "Click me"'),
      plainComposer.slice(0, 200),
    );

    await plain.locator(".composer__input").fill("Make this button wider.");
    await plain.locator(".composer .button--primary").click();
    await plain.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await plain.locator('.tool[aria-label^="Annotations"]').click();
    await plain.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await plain.locator(".panel .button--primary").click();
    const plainReport = await plain.evaluate(() => navigator.clipboard.readText());

    // Checks that the *tool* claims no framework. Deliberately not `!/Vue/` over the
    // whole report: plain.html's own copy says "No Vue here", and forensic detail
    // surfaces page text, so that assertion failed for the page being right.
    check(
      "non-framework reports claim no framework",
      !plainReport.includes("Stack:") &&
        !plainReport.includes("**Components:**") &&
        !plainReport.includes("**Owner:**"),
      plainReport.slice(0, 300),
    );

    // -------------------------------------------------------------------------
    // React, Svelte, Angular
    // -------------------------------------------------------------------------
    //
    // Each fixture reproduces the framework's DOM shapes rather than loading the
    // real runtime — the same approach vue2-app.html already takes. It keeps the
    // suite hermetic and lets shapes be tested that a real build could not show
    // us on demand, such as a React 19 node with no `_debugSource`.

    /**
     * Annotate `selector` on `path` and return { badge, hover, report }.
     *
     * Clears any stored annotations first. Annotations persist per origin+pathname, and
     * these fixtures are visited more than once in the same browser profile — without
     * this, the second visit's report still contains the first visit's annotation and
     * every assertion reads the wrong section.
     */
    async function driveFramework(path, selector) {
      const page = await context.newPage();
      await page.goto(`${base}/${path}`);
      await page.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(2_000); // outwait boot()'s late-hydration retry

      if ((await page.locator(".marker").count()) > 0) {
        await page.locator('.tool[aria-label^="Annotations"]').click();
        await page.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });
        await page.locator('.panel .icon-button[title^="Clear all"]').click();
        await page.waitForTimeout(300);
        await page.locator('.tool[aria-label^="Annotations"]').click();
        await page.waitForTimeout(300);
      }

      const badge = (await page.locator(".stack-badge").textContent())?.trim() ?? "";

      await page.locator(".tool--brand").click();
      await page.locator(selector).first().hover();
      await page.waitForTimeout(700);
      const hover = (await page.locator(".highlight__label").textContent())?.trim() ?? "";

      await page.locator(selector).first().click({ force: true });
      await page.locator(".composer").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(".composer__input").fill("Framework detector check.");
      await page.locator(".composer .button--primary").click();
      await page.locator(".composer").waitFor({ state: "detached", timeout: 10_000 });

      await page.locator('.tool[aria-label^="Annotations"]').click();
      await page.locator(".panel").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(".panel .button--primary").click();
      const report = await page.evaluate(() => navigator.clipboard.readText());

      await page.close();
      return { badge, hover, report };
    }

    // React ---------------------------------------------------------------------
    const react = await driveFramework("react-app.html", ".save");
    check("React is detected and versioned", /^React 18 18\./.test(react.badge), `badge "${react.badge}"`);
    check(
      "React ancestry is walked via fiber.return",
      react.report.includes("**Components:** <App> <Toolbar> <SaveButton>"),
      react.report.slice(0, 400),
    );
    check(
      "React internals and HOC wrappers are filtered out",
      !react.report.includes("StrictMode") && !react.report.includes("Memo"),
      react.report.slice(0, 400),
    );
    check(
      "React source comes from _debugSource with line and column",
      react.report.includes("**Source:** src/components/SaveButton.jsx:12:5"),
      react.report.slice(0, 400),
    );

    // No _debugSource of its own, but an ancestor has one — walks up, exactly as the
    // Vue tracer and Svelte's __svelte_meta do.
    const reactInherited = await driveFramework("react-app.html", ".intro");
    check(
      "a node without its own _debugSource walks up to an ancestor that has one",
      reactInherited.report.includes("<Intro>") &&
        reactInherited.report.includes("**Source:** src/App.jsx:4:3"),
      reactInherited.report.slice(0, 400),
    );

    // React 19 shape: names survive, `_debugSource` is gone from the whole chain. Must
    // report components and omit Source rather than inventing a path.
    const react19 = await driveFramework("react-app.html", ".orphan");
    check(
      "React 19 (no _debugSource anywhere) still reports its components",
      react19.report.includes("<Shell> <OrphanButton>"),
      react19.report.slice(0, 400),
    );
    check(
      "React 19 reports no Source line rather than inventing one",
      !react19.report.includes("**Source:**"),
      react19.report.slice(0, 400),
    );

    // Svelte --------------------------------------------------------------------
    const svelte = await driveFramework("svelte-app.html", ".save");
    check("SvelteKit is detected and versioned", /^SvelteKit 5\./.test(svelte.badge), `badge "${svelte.badge}"`);
    check(
      "Svelte source comes from __svelte_meta with line and column",
      svelte.report.includes("**Source:** src/lib/SaveButton.svelte:12:5"),
      svelte.report.slice(0, 400),
    );
    check(
      "Svelte ancestry is recovered from distinct loc.file values",
      svelte.report.includes("**Components:** <+page> <Toolbar> <SaveButton>"),
      svelte.report.slice(0, 400),
    );

    // An element with no __svelte_meta of its own must inherit from its ancestors.
    const svelteBare = await driveFramework("svelte-app.html", ".bare");
    check(
      "an element without its own __svelte_meta walks up to an ancestor",
      svelteBare.report.includes("**Source:** src/routes/+page.svelte"),
      svelteBare.report.slice(0, 400),
    );

    // Angular -------------------------------------------------------------------
    const angular = await driveFramework("angular-app.html", ".save");
    check("Angular is detected and versioned", /^Angular 18 18\./.test(angular.badge), `badge "${angular.badge}"`);
    check(
      "Angular ancestry is walked via ng.getComponent",
      angular.report.includes("**Components:** <AppComponent> <ToolbarComponent> <SaveButtonComponent>"),
      angular.report.slice(0, 400),
    );
    check(
      "Angular reports no Source line, having no authoring positions",
      !angular.report.includes("**Source:**"),
      angular.report.slice(0, 400),
    );

    // -------------------------------------------------------------------------
    // The settings card
    // -------------------------------------------------------------------------
    //
    // Its own fixture: the block annotates and then counts pins, and annotations are
    // keyed on origin + pathname in storage shared across the whole run.
    //
    // It also flips settings that live in chrome.storage.sync, which every other page in
    // this context reads. Everything touched here is put back before the block ends —
    // leaving `showMarkers` off would silently break every later `.marker` assertion,
    // the same way a stray `toolbarCollapsed` would break every `.tool--brand` click.
    const settingsPageUnderTest = await context.newPage();
    await settingsPageUnderTest.goto(`${base}/settings.html`);
    await settingsPageUnderTest.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const card = settingsPageUnderTest.locator(".settings");
    const gear = settingsPageUnderTest.locator(".tool--settings");
    const annotationsButton = settingsPageUnderTest.locator('.tool[aria-label^="Annotations"]');

    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    check("the gear opens the settings card", await card.isVisible());

    // The version is handed to the card rather than read inside it, so an empty or stale
    // string is a real possibility and nothing else on screen would show it.
    //
    // Read from `dist/manifest.json` here, not from the page: `chrome.runtime` does not
    // exist in the page's main world, which is where `page.evaluate` runs. The built
    // manifest is what Chrome actually loaded, and `build.mjs` stamps it from
    // package.json — so this also catches a build that shipped a stale version.
    const shownVersion = (
      await settingsPageUnderTest.locator(".settings__version").textContent()
    )?.trim();
    const manifestVersion = JSON.parse(
      await readFile(join(DIST, "manifest.json"), "utf8"),
    ).version;
    check(
      "the card names the version that is actually running",
      shownVersion === `SenAnnotate ${manifestVersion}`,
      `card says "${shownVersion}", manifest says "${manifestVersion}"`,
    );

    // Neither card may cover the toolbar's hint line. Inspect mode adds that line above
    // the pill, so a card whose bottom stops at the pill's clearance overlaps it — both
    // cards did, by 22px, and both are now lifted by the same sibling rule.
    const clearsTheHint = async (selector) => {
      await settingsPageUnderTest.waitForTimeout(250);
      return settingsPageUnderTest.evaluate((sel) => {
        const root = document.querySelector("[data-senannotate-ui]").shadowRoot;
        const card = root.querySelector(sel);
        const hint = root.querySelector(".toolbar-hint");
        if (!card || !hint) return null;
        return card.getBoundingClientRect().bottom <= hint.getBoundingClientRect().top;
      }, selector);
    };

    await settingsPageUnderTest.locator(".tool--brand").click(); // inspect on → hint shows
    check("the settings card clears the hint line", (await clearsTheHint(".settings")) === true);

    // One slot, one card. Opening the panel has to take the settings card with it.
    await annotationsButton.click();
    await settingsPageUnderTest.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    check("the panel clears the hint line too", (await clearsTheHint(".panel")) === true);
    await settingsPageUnderTest.locator(".tool--brand").click(); // inspect back off
    await settingsPageUnderTest.waitForTimeout(300);
    check(
      "opening the panel closes the settings card",
      (await card.count()) === 0,
      `${await card.count()} cards`,
    );

    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.waitForTimeout(300);
    check(
      "opening settings closes the panel",
      (await settingsPageUnderTest.locator(".panel").count()) === 0,
      `${await settingsPageUnderTest.locator(".panel").count()} panels`,
    );

    // Escape closes the card, the same key that closes the composer. It must not fall
    // through to the rest of the Escape chain either — inspect mode is off here, and
    // turning it *on* or dropping a pick set would both be surprising.
    await settingsPageUnderTest.keyboard.press("Escape");
    await settingsPageUnderTest.waitForTimeout(250);
    check("Escape closes the settings card", (await card.count()) === 0, `${await card.count()} cards`);

    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });

    // The help is the only explanation a setting gets, so it has to be reachable by
    // keyboard as well as by pointer — hence a button rather than a span.
    const tooltip = settingsPageUnderTest.locator(".tooltip");
    await settingsPageUnderTest.locator('.settings .hint-dot').first().hover();
    await settingsPageUnderTest.waitForTimeout(250);
    check("hovering the help dot shows a tooltip", await tooltip.isVisible());

    await settingsPageUnderTest.locator('.settings .hint-dot').first().evaluate((el) => el.blur());
    await settingsPageUnderTest.mouse.move(10, 400);
    await settingsPageUnderTest.waitForTimeout(250);
    check("leaving the help dot hides it again", !(await tooltip.isVisible()));

    await settingsPageUnderTest.locator('.settings .hint-dot').first().focus();
    await settingsPageUnderTest.waitForTimeout(250);
    check("focusing the help dot shows the tooltip too", await tooltip.isVisible());
    await settingsPageUnderTest.keyboard.press("Escape");
    await settingsPageUnderTest.waitForTimeout(250);
    check("Escape dismisses the tooltip", !(await tooltip.isVisible()));
    // …and only the tooltip. Escape now closes the cards too, so the innermost-first order
    // is what keeps one press from taking the settings card with the tooltip on top of it.
    check("dismissing a tooltip does not close the card under it", await card.isVisible());

    // The toolbar's buttons are icon-only, so the name is the affordance. It used to be a
    // `title=`, which arrives a second late and in the page's own styling.
    await settingsPageUnderTest.locator(".tool--settings").hover();
    await settingsPageUnderTest.waitForTimeout(250);
    check(
      "hovering a toolbar button names it",
      (await tooltip.isVisible()) && (await tooltip.textContent()) === "Settings",
      `tooltip reads "${await tooltip.textContent()}"`,
    );

    // Anchored to the dock rather than to the button, or inspect mode's hint line — which
    // sits directly above the pill — would be underneath it.
    await settingsPageUnderTest.locator(".tool--brand").click(); // inspect on → hint shows
    await settingsPageUnderTest.locator('.tool[aria-label^="Freeze"]').hover();
    check("a toolbar tooltip clears the hint line", (await clearsTheHint(".tooltip")) === true);
    await settingsPageUnderTest.locator(".tool--brand").click(); // inspect back off
    await settingsPageUnderTest.mouse.move(10, 400);
    await settingsPageUnderTest.waitForTimeout(250);

    // Escape closes the annotations panel too, the same way it closes the settings card.
    await annotationsButton.click();
    await settingsPageUnderTest.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.keyboard.press("Escape");
    await settingsPageUnderTest.waitForTimeout(300);
    check(
      "Escape closes the annotations panel",
      (await settingsPageUnderTest.locator(".panel").count()) === 0,
      `${await settingsPageUnderTest.locator(".panel").count()} panels`,
    );

    // Leave the card open: the block below expects the gear's next click to close it.
    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });

    // A toggle has to change the page, not just the checkbox.
    await gear.click();
    await settingsPageUnderTest.waitForTimeout(300);
    await settingsPageUnderTest.locator(".tool--brand").click();
    await settingsPageUnderTest.locator("#target").click();
    await settingsPageUnderTest.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.keyboard.type("A pin to switch off.");
    await settingsPageUnderTest.locator(".composer .button--primary").click();
    await settingsPageUnderTest.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    // `:visible`, not a bare count: `markers.ts` sets `display: none` on the pins rather
    // than removing them, and Playwright's `count()` counts hidden nodes perfectly well.
    check(
      "the note is pinned while showMarkers is on",
      (await settingsPageUnderTest.locator(".marker:visible").count()) === 1,
      `${await settingsPageUnderTest.locator(".marker:visible").count()} markers`,
    );

    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.locator('.settings [data-setting="showMarkers"]').click();
    await settingsPageUnderTest.waitForTimeout(300);
    check(
      "turning off numbered pins removes them from the page",
      (await settingsPageUnderTest.locator(".marker:visible").count()) === 0,
      `${await settingsPageUnderTest.locator(".marker:visible").count()} markers`,
    );

    await settingsPageUnderTest.reload();
    await settingsPageUnderTest.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await settingsPageUnderTest.waitForTimeout(600); // settings load is async
    check(
      "the setting survives a reload",
      (await settingsPageUnderTest.locator(".marker:visible").count()) === 0,
      `${await settingsPageUnderTest.locator(".marker:visible").count()} markers`,
    );

    // Hide until restart: per-tab, not a stored setting. It lives in sessionStorage so
    // it survives a reload of this tab, never follows the user to another page, and
    // clears itself when the tab closes — which is what "restart" means here.
    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.locator('.settings [data-action="hide-until-restart"]').click();
    await settingsPageUnderTest.waitForTimeout(300);
    // The host is hidden, so nothing in the overlay is visible — the card node lingers
    // in the DOM inside the hidden host, so this asserts on visibility, not on count.
    check(
      "hide-until-restart hides the whole overlay in this tab",
      !(await settingsPageUnderTest.locator(".toolbar").isVisible()) &&
        !(await settingsPageUnderTest.locator(".settings").isVisible()),
    );

    await settingsPageUnderTest.reload();
    await settingsPageUnderTest.waitForTimeout(800);
    check(
      "the hide survives a reload of the same tab",
      !(await settingsPageUnderTest.locator(".toolbar").isVisible()),
    );

    // A different page is a different tab as far as the user is concerned — the
    // toolbar must be there.
    const otherTab = await context.newPage();
    await otherTab.goto(`${base}/plain.html`);
    await otherTab.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    check("another tab still shows the toolbar", await otherTab.locator(".toolbar").isVisible());
    await otherTab.close();

    // Put the tab back: clear the flag the way closing the tab would.
    await settingsPageUnderTest.evaluate(() =>
      window.sessionStorage.removeItem("senannotate:hide-until-restart"),
    );
    await settingsPageUnderTest.reload();
    await settingsPageUnderTest.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await settingsPageUnderTest.waitForTimeout(600);

    // Collapsing takes the card with it, exactly as it takes the panel.
    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.locator(".tool--collapse").click();
    await settingsPageUnderTest.waitForTimeout(400);
    check(
      "collapsing closes the settings card",
      (await card.count()) === 0,
      `${await card.count()} cards`,
    );
    await settingsPageUnderTest.locator(".tool--collapse").click();
    await settingsPageUnderTest.waitForTimeout(300);

    // Put it back. Everything after this point assumes the shipped defaults.
    await gear.click();
    await card.waitFor({ state: "visible", timeout: 5_000 });
    await settingsPageUnderTest.locator('.settings [data-setting="showMarkers"]').click();
    await settingsPageUnderTest.waitForTimeout(300);
    check(
      "the block restored showMarkers before leaving",
      (await settingsPageUnderTest.locator(".marker:visible").count()) === 1,
      `${await settingsPageUnderTest.locator(".marker:visible").count()} markers`,
    );
    await gear.click();
    await settingsPageUnderTest.close();

    // -------------------------------------------------------------------------
    // Collapse — the toolbar must get out of the way
    // -------------------------------------------------------------------------
    //
    // Last in the run, and expanded again at the end: `toolbarCollapsed` lives in
    // chrome.storage.sync, so a collapsed state left behind would follow every
    // other page in this profile and break their `.tool--brand` clicks.
    //
    // marquee.html is used because it has no stored annotations — its own scenario
    // escapes every composer it opens.
    const collapsed = await context.newPage();
    await collapsed.goto(`${base}/marquee.html`);
    await collapsed.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const dock = collapsed.locator(".toolbar-dock");
    const pill = collapsed.locator(".toolbar");
    const handle = collapsed.locator(".tool--collapse");
    const collapseBrand = collapsed.locator(".tool--brand");
    const collapseHint = collapsed.locator(".toolbar-hint");

    await collapseBrand.click(); // inspect on, so the hint line is showing too
    await collapseHint.waitFor({ state: "visible", timeout: 5_000 });

    // Open too, so the collapse has something to close.
    await collapsed.locator('.tool[aria-label^="Annotations"]').click();
    await collapsed.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });

    // The panel fades out before it is removed, so for a moment after a close there is
    // a node on screen that nothing holds a reference to. Reopening inside that window
    // must not leave two — one fading, one live.
    await collapsed.locator('.tool[aria-label^="Annotations"]').click();
    await collapsed.locator('.tool[aria-label^="Annotations"]').click();
    check(
      "closing and reopening inside the exit animation leaves one panel",
      (await collapsed.locator(".panel").count()) === 1,
      `${await collapsed.locator(".panel").count()} panels`,
    );

    await handle.click();
    await collapsed.waitForTimeout(200);

    check("collapsing hides the toolbar controls", !(await collapseBrand.isVisible()));
    check("collapsing hides the hint line", !(await collapseHint.isVisible()));
    check(
      "the collapsed toolbar stays on screen as a handle",
      (await pill.isVisible()) && (await handle.isVisible()),
    );

    // Collapsing is "get out of the way", not merely "get smaller". Inspect mode armed
    // behind a logo is what made the next page click open a composer out of nowhere,
    // and an open panel is the other thing a collapse would leave floating.
    check(
      "collapsing turns inspect mode off",
      (await dock.getAttribute("data-inspecting")) === "false",
      `data-inspecting read "${await dock.getAttribute("data-inspecting")}"`,
    );
    check(
      "collapsing closes an open panel",
      (await collapsed.locator(".panel").count()) === 0,
      `${await collapsed.locator(".panel").count()} panels`,
    );

    await collapsed.locator("#card-a").click();
    await collapsed.waitForTimeout(200);
    check(
      "a page click after collapsing belongs to the page again",
      (await collapsed.locator(".composer").count()) === 0,
    );

    const handleBox = await handle.boundingBox();
    check(
      "the collapsed toolbar is about one button wide",
      handleBox.width <= 44,
      `handle measured ${Math.round(handleBox.width)}px`,
    );

    const handleCount = collapsed.locator(".handle-count");
    check(
      "the collapsed handle shows no count with nothing noted yet",
      !(await handleCount.isVisible()),
    );

    // Expanding restores nothing on its own — inspect mode has to be asked for again,
    // which is the half of the asymmetry worth pinning.
    await collapsed.keyboard.press("h");
    await collapsed.waitForTimeout(200);
    check(
      "expanding does not turn inspect mode back on",
      (await dock.getAttribute("data-inspecting")) === "false",
      `data-inspecting read "${await dock.getAttribute("data-inspecting")}"`,
    );

    await collapseBrand.click();
    await collapsed.locator("#card-a").click();
    await collapsed.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await collapsed.locator(".composer__input").fill("Noted before the toolbar collapsed.");
    await collapsed.locator(".composer .button--primary").click();
    await collapsed.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await handle.click();
    await collapsed.waitForTimeout(200);
    check(
      "the collapsed handle carries the annotation count",
      ((await handleCount.textContent())?.trim() ?? "") === "1",
      `handle count read "${(await handleCount.textContent())?.trim() ?? ""}"`,
    );

    await collapsed.reload();
    await collapsed.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await collapsed.waitForTimeout(600); // settings load is async
    check("the collapsed state survives a reload", !(await collapseBrand.isVisible()));
    check(
      "the count is back on the handle after a reload",
      ((await handleCount.textContent())?.trim() ?? "") === "1",
      `handle count read "${(await handleCount.textContent())?.trim() ?? ""}"`,
    );

    // Inspect mode is off after a reload, so this also proves `h` is handled above
    // the guard that gates 1/2/3/f/a on inspect mode being on.
    check(
      "a reload leaves inspect mode off",
      (await dock.getAttribute("data-inspecting")) === "false",
      `data-inspecting read "${await dock.getAttribute("data-inspecting")}"`,
    );
    await collapsed.keyboard.press("h");
    await collapsed.waitForTimeout(200);
    check("h expands the toolbar with inspect mode off", await collapseBrand.isVisible());
    check(
      "the expanded toolbar shows the count once, on the panel button",
      !(await handleCount.isVisible()) && (await collapsed.locator(".count").isVisible()),
    );

    await collapsed.keyboard.press("h");
    await collapsed.waitForTimeout(200);
    check("h collapses it again", !(await collapseBrand.isVisible()));

    await handle.click(); // and the handle is the way back for the mouse
    check("clicking the handle expands the toolbar", await collapseBrand.isVisible());

    // -------------------------------------------------------------------------
    // Retarget — the composer walks the DOM, and stores what it shows
    // -------------------------------------------------------------------------
    //
    // Its own fixture, for the reason `retarget.html` states. The two assertions that
    // matter most are the two the feature's own changelog singled out and shipped without:
    // **submitting after a retarget stores the new element**, and a retarget cannot land in
    // a composer it was not started from. Both are invisible until the report is read.
    const retarget = await context.newPage();
    await retarget.goto(`${base}/retarget.html`);
    await retarget.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await retarget.locator(".tool--brand").click();

    const retargetMeta = retarget.locator(".composer__meta");
    const retargetInput = retarget.locator(".composer__input");

    // The mis-click the feature exists to fix: the <span> inside the button.
    await retarget.locator("#label").click();
    await retargetMeta.waitFor({ state: "visible", timeout: 5_000 });
    check(
      "clicking the inner span selects the span, not the button",
      ((await retargetMeta.textContent()) ?? "").includes("Elementspan"),
      `meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );
    check(
      "a fresh single-element pick offers the retarget controls",
      (await retarget.locator(".retarget__button").count()) === 4,
      `${await retarget.locator(".retarget__button").count()} buttons`,
    );

    // ↑ with the note still empty walks to the parent.
    await retarget.keyboard.press("ArrowUp");
    await retarget.waitForTimeout(400);
    check(
      "ArrowUp on an empty note retargets to the parent",
      ((await retargetMeta.textContent()) ?? "").includes('button "Place order"'),
      `meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );

    // The note survives the move — the whole point of not rebuilding the composer.
    await retargetInput.fill("This button is the wrong size.");
    await retarget.keyboard.press("ArrowUp");
    await retarget.waitForTimeout(400);
    check(
      "the arrows stop working once the note has text",
      ((await retargetMeta.textContent()) ?? "").includes('button "Place order"'),
      `meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );

    // …but the buttons still do, which is why they exist.
    await retarget.locator('.retarget__button[aria-label^="Select the parent"]').click();
    await retarget.waitForTimeout(400);
    check(
      "the ↑ button retargets even with text in the note",
      ((await retargetMeta.textContent()) ?? "").includes("div.ordercard"),
      `meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );
    check(
      "retargeting does not disturb what has been typed",
      (await retargetInput.inputValue()) === "This button is the wrong size.",
      `note read "${await retargetInput.inputValue()}"`,
    );

    // The blocking one: what gets *stored* has to be the element on screen, not the one
    // that was clicked. Invisible anywhere but the report.
    await retarget.locator(".composer .button--primary").click();
    await retarget.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    await retarget.locator('.tool[aria-label^="Annotations"]').click();
    await retarget.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await retarget.locator(".panel .button--primary").click();
    const retargetReport = await retarget.evaluate(() => navigator.clipboard.readText());
    check(
      "submitting after a retarget stores the element the composer ended on",
      retargetReport.includes("div.ordercard") && !retargetReport.includes("`span`"),
      retargetReport.slice(0, 400),
    );
    await retarget.locator('.tool[aria-label^="Annotations"]').click();

    // A retarget started in one composer must not resolve into another. Escape closes the
    // first mid-flight; the click opens a second on an unrelated element.
    await retarget.locator("#label").click();
    await retargetMeta.waitFor({ state: "visible", timeout: 5_000 });
    await retarget.keyboard.press("ArrowUp");
    await retarget.keyboard.press("Escape");
    await retarget.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    await retarget.locator("#card-two").click();
    await retargetMeta.waitFor({ state: "visible", timeout: 5_000 });
    await retarget.waitForTimeout(700); // longer than the bridge's 500ms timeout
    check(
      "a retarget from a closed composer cannot land in the next one",
      ((await retargetMeta.textContent()) ?? "").includes("div.secondcard"),
      `meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );
    await retarget.keyboard.press("Escape");
    await retarget.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    // A retarget that adds meta rows grows the card downward from a `top` clamped when it
    // was shorter, so the footer — Save, camera, delete — ends up below the viewport.
    //
    // It has to be the plain-host → Vue-component step for that to be reachable at all:
    // every element on a page with no framework renders exactly one row, the card never
    // changes height, and the check below would pass with `setData`'s `position()` call
    // deleted. `#fold-host` is the plain wrapper (one row) and the component inside it
    // carries Source, Component and Props (four) — hence the row count assertion first,
    // which is what proves the height actually moved.
    await retarget.locator("#fold-host").click({ position: { x: 4, y: 4 } });
    await retargetMeta.waitFor({ state: "visible", timeout: 5_000 });
    const foldRows = retarget.locator(".composer__meta .meta-row");
    const foldRowsBefore = await foldRows.count();
    await retarget.keyboard.press("ArrowDown");
    await retarget.waitForTimeout(400);
    const foldRowsAfter = await foldRows.count();
    check(
      "stepping into a component adds the rows a plain element has none of",
      foldRowsBefore === 1 && foldRowsAfter > foldRowsBefore,
      `${foldRowsBefore} row(s) before, ${foldRowsAfter} after — meta read "${((await retargetMeta.textContent()) ?? "").trim()}"`,
    );

    const retargetBox = await retarget.locator(".composer").boundingBox();
    const retargetViewport = retarget.viewportSize();
    check(
      "a retarget near the fold keeps the composer's footer on screen",
      !!retargetBox &&
        !!retargetViewport &&
        retargetBox.y + retargetBox.height <= retargetViewport.height,
      retargetBox && retargetViewport
        ? `composer bottom at ${Math.round(retargetBox.y + retargetBox.height)} of ${retargetViewport.height}`
        : "composer or viewport could not be measured",
    );
    await retarget.keyboard.press("Escape");
    await retarget.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    // A multi-element draft has no single thing to walk from, so the controls must be
    // absent — and `retargetable` reads that off the draft rather than off the module
    // global, which is what makes the same guarantee hold for an iframe draft.
    await retarget.locator("#card-one").click({ modifiers: ["ControlOrMeta"] });
    await retarget.locator("#card-two").click();
    await retargetMeta.waitFor({ state: "visible", timeout: 5_000 });
    const multiMeta = ((await retargetMeta.textContent()) ?? "").trim();
    check(
      "a multi-element draft offers no retarget controls",
      multiMeta.includes("2 elements") &&
        (await retarget.locator(".retarget__button").count()) === 0,
      `meta read "${multiMeta}", ${await retarget.locator(".retarget__button").count()} buttons`,
    );
    await retarget.keyboard.press("Escape");
    await retarget.close();

    // -------------------------------------------------------------------------
    // Drag — the toolbar moves, and every button still clicks
    // -------------------------------------------------------------------------
    //
    // Its own fixture, for the reason `drag.html` states: dock positions are keyed on
    // origin + pathname in shared storage, so a dragged toolbar would move for every
    // later block on the same page and every boundingBox after it would measure the
    // wrong thing.
    //
    // This block collapses the toolbar, which is `toolbarCollapsed` in
    // chrome.storage.sync — the same profile-wide state the Collapse block above is
    // careful to restore. It ends expanded, with inspect mode off, for that reason.
    const drag = await context.newPage();
    await drag.setViewportSize({ width: 1280, height: 900 });
    await drag.goto(`${base}/drag.html`);
    await drag.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await drag.waitForTimeout(600); // settings and the stored position load async

    const dragDock = drag.locator(".toolbar-dock");
    const dragPill = drag.locator(".toolbar");
    const dragBrand = drag.locator(".tool--brand");

    check(
      "a page with no stored position keeps the CSS corner",
      (await dragDock.getAttribute("data-floating")) === null,
      `data-floating read "${await dragDock.getAttribute("data-floating")}"`,
    );

    // The whole risk of making the pill its own drag handle: a threshold that fires too
    // eagerly breaks every toolbar button at once. Asserted before anything is dragged.
    await dragBrand.click();
    check(
      "a plain click on the toolbar still toggles inspect mode",
      (await dragDock.getAttribute("data-inspecting")) === "true",
      `data-inspecting read "${await dragDock.getAttribute("data-inspecting")}"`,
    );
    await dragBrand.click();
    check(
      "and clicking it again turns inspect mode back off",
      (await dragDock.getAttribute("data-inspecting")) === "false",
      `data-inspecting read "${await dragDock.getAttribute("data-inspecting")}"`,
    );

    // A drag started *on a button* has to move the dock and leave the button alone —
    // the two meanings every pixel of the pill now carries.
    const dockBefore = await dragDock.boundingBox();
    const brandBox = await dragBrand.boundingBox();
    const grabAt = { x: brandBox.x + brandBox.width / 2, y: brandBox.y + brandBox.height / 2 };
    await drag.mouse.move(grabAt.x, grabAt.y);
    await drag.mouse.down();
    await drag.mouse.move(grabAt.x - 320, grabAt.y - 260, { steps: 12 });
    await drag.mouse.up();
    await drag.waitForTimeout(250);

    const dockDragged = await dragDock.boundingBox();
    check(
      "a drag from a button moves the dock",
      Math.abs(dockDragged.x - dockBefore.x) > 200 && Math.abs(dockDragged.y - dockBefore.y) > 150,
      `dock moved from ${Math.round(dockBefore.x)},${Math.round(dockBefore.y)} to ${Math.round(dockDragged.x)},${Math.round(dockDragged.y)}`,
    );
    check(
      "the drag did not press the button it started on",
      (await dragDock.getAttribute("data-inspecting")) === "false",
      `data-inspecting read "${await dragDock.getAttribute("data-inspecting")}"`,
    );
    check("a dragged dock is marked floating", (await dragDock.getAttribute("data-floating")) === "true");

    // Capture is only taken once the threshold is crossed, so a press released just off
    // the pill's edge never reaches `end()`. What must not happen next is the pill
    // following a cursor with no button held.
    const edgeBox = await dragPill.boundingBox();
    await drag.mouse.move(edgeBox.x + 1, edgeBox.y + 1);
    await drag.mouse.down();
    // One hop, straight off the pill: `.toolbar` never sees a move past the threshold,
    // and never sees the release either.
    await drag.mouse.move(edgeBox.x - 9, edgeBox.y - 9);
    await drag.mouse.up();
    const beforeHover = await dragDock.boundingBox();
    await drag.mouse.move(edgeBox.x + 40, edgeBox.y + 12);
    await drag.mouse.move(edgeBox.x + 120, edgeBox.y + 22);
    await drag.waitForTimeout(200);
    const afterHover = await dragDock.boundingBox();
    check(
      "hovering after a press that ended off the pill does not drag it",
      Math.abs(afterHover.x - beforeHover.x) < 2 && Math.abs(afterHover.y - beforeHover.y) < 2,
      `dock drifted to ${Math.round(afterHover.x)},${Math.round(afterHover.y)} from ${Math.round(beforeHover.x)},${Math.round(beforeHover.y)}`,
    );

    // Persisted on drop, and re-clamped rather than trusted on load.
    await drag.reload();
    await drag.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await drag.waitForTimeout(700);
    const dockRestored = await dragDock.boundingBox();
    check(
      "the dragged position survives a reload",
      Math.abs(dockRestored.x - dockDragged.x) < 4 && Math.abs(dockRestored.y - dockDragged.y) < 4,
      `restored at ${Math.round(dockRestored.x)},${Math.round(dockRestored.y)}, dropped at ${Math.round(dockDragged.x)},${Math.round(dockDragged.y)}`,
    );

    // The settings card belongs to the pill, so it has to travel with it. Geometry read
    // from the shadow root rather than Playwright's boundingBox: what matters is the
    // relationship between two rects in the same document, plus whether the card is
    // placed by inline styles at all.
    const dockAndCard = () =>
      drag.evaluate(() => {
        const root = document.querySelector("[data-senannotate-ui]").shadowRoot;
        const dock = root.querySelector(".toolbar-dock");
        const card = root.querySelector(".settings");
        if (!dock || !card) return null;
        const d = dock.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return {
          dock: { left: d.left, top: d.top, right: d.right, bottom: d.bottom },
          card: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
          inlineLeft: card.style.left,
          inlineTop: card.style.top,
        };
      });

    await drag.locator(".tool--settings").click();
    await drag.locator(".settings").waitFor({ state: "visible", timeout: 5_000 });
    await drag.waitForTimeout(300);
    const anchored = await dockAndCard();
    check(
      "the settings card opens against the dragged pill, right edges aligned",
      anchored !== null &&
        Math.abs(anchored.card.right - anchored.dock.right) <= 1 &&
        Math.abs(anchored.dock.top - anchored.card.bottom - 8) <= 1,
      anchored === null
        ? "no card or no dock"
        : `card right ${Math.round(anchored.card.right)} vs dock right ${Math.round(anchored.dock.right)}, gap ${Math.round(anchored.dock.top - anchored.card.bottom)}`,
    );

    // Mid-drag, before the release: `onMove` fires on drop, so a card wired to that would
    // sit still while the pill slid out from under it and then teleport.
    const pillNow = await dragPill.boundingBox();
    await drag.mouse.move(pillNow.x + pillNow.width / 2, pillNow.y + pillNow.height / 2);
    await drag.mouse.down();
    await drag.mouse.move(pillNow.x + pillNow.width / 2 + 180, pillNow.y + pillNow.height / 2 + 90, {
      steps: 10,
    });
    await drag.waitForTimeout(150);
    const midDrag = await dockAndCard();
    await drag.mouse.up();
    await drag.waitForTimeout(250);
    check(
      "and follows it during the drag, not only on the drop",
      midDrag !== null &&
        Math.abs(midDrag.card.right - midDrag.dock.right) <= 1 &&
        Math.abs(midDrag.dock.top - midDrag.card.bottom - 8) <= 1,
      midDrag === null
        ? "no card or no dock"
        : `card right ${Math.round(midDrag.card.right)} vs dock right ${Math.round(midDrag.dock.right)}, gap ${Math.round(midDrag.dock.top - midDrag.card.bottom)}`,
    );

    // No room above: the card has to go under the pill rather than off the top of the
    // screen. This is the case CSS cannot decide, because it turns on the card's height.
    const pillHigh = await dragPill.boundingBox();
    await drag.mouse.move(pillHigh.x + pillHigh.width / 2, pillHigh.y + pillHigh.height / 2);
    await drag.mouse.down();
    // A nudge along the pill before the long move. Pointer capture is only taken once the
    // threshold is crossed, so a gesture whose first interpolated step is already off the
    // pill — 52px up, from a pill 44px tall — delivers no `pointermove` to it at all and
    // never starts a drag. Measured: this is why the same code dragged fine sideways.
    await drag.mouse.move(pillHigh.x + pillHigh.width / 2 - 16, pillHigh.y + pillHigh.height / 2);
    await drag.mouse.move(600, 40, { steps: 12 });
    await drag.mouse.up();
    await drag.waitForTimeout(300);
    const flipped = await dockAndCard();
    check(
      "a pill near the top of the viewport gets its card underneath",
      flipped !== null && flipped.card.top >= flipped.dock.bottom + 7 && flipped.card.bottom <= 900,
      flipped === null
        ? "no card or no dock"
        : `card top ${Math.round(flipped.card.top)}, dock bottom ${Math.round(flipped.dock.bottom)}, card bottom ${Math.round(flipped.card.bottom)}`,
    );

    // The panel is the other half of the request: it is a page-level list, pinned top and
    // bottom, and it stays where it is however far the pill has been dragged.
    await drag.locator(".tool--settings").click(); // close the card first
    await drag.locator(".settings").waitFor({ state: "detached", timeout: 5_000 });
    await drag.locator('.tool[aria-label^="Annotations"]').click();
    await drag.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await drag.waitForTimeout(300);
    const panelGeometry = await drag.evaluate(() => {
      const root = document.querySelector("[data-senannotate-ui]").shadowRoot;
      const panelBox = root.querySelector(".panel").getBoundingClientRect();
      return { right: panelBox.right, top: panelBox.top, width: window.innerWidth };
    });
    check(
      "the annotations panel does not follow the pill",
      Math.abs(panelGeometry.width - panelGeometry.right - 20) <= 1 &&
        Math.abs(panelGeometry.top - 20) <= 1,
      `panel right edge ${Math.round(panelGeometry.width - panelGeometry.right)}px from the viewport edge, top ${Math.round(panelGeometry.top)}`,
    );
    await drag.locator('.tool[aria-label^="Annotations"]').click();
    await drag.waitForTimeout(250);

    // Per page, not per user — the whole argument for `local` over `sync`. Read-only on
    // a fixture another block owns, so nothing is left behind on it.
    const untouched = await context.newPage();
    await untouched.goto(`${base}/pick.html`);
    await untouched.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await untouched.waitForTimeout(600);
    check(
      "another page opens at the default corner",
      (await untouched.locator(".toolbar-dock").getAttribute("data-floating")) === null,
      `data-floating read "${await untouched.locator(".toolbar-dock").getAttribute("data-floating")}"`,
    );

    // And with no drag anywhere in the picture the card is placed by the stylesheet, not
    // by us: the default corner is the configuration the extension ships in, and the one
    // the settings block measures the hint-line clearance against.
    await untouched.locator(".tool--settings").click();
    await untouched.locator(".settings").waitFor({ state: "visible", timeout: 5_000 });
    await untouched.waitForTimeout(250);
    const cornerCard = await untouched.evaluate(() => {
      const root = document.querySelector("[data-senannotate-ui]").shadowRoot;
      const card = root.querySelector(".settings");
      const box = card.getBoundingClientRect();
      return {
        inlineLeft: card.style.left,
        inlineTop: card.style.top,
        anchored: card.dataset.anchored ?? "",
        fromRight: window.innerWidth - box.right,
      };
    });
    check(
      "a card on a never-dragged page is left to CSS",
      cornerCard.inlineLeft === "" &&
        cornerCard.inlineTop === "" &&
        cornerCard.anchored === "" &&
        Math.abs(cornerCard.fromRight - 20) <= 1,
      `inline left "${cornerCard.inlineLeft}", top "${cornerCard.inlineTop}", anchored "${cornerCard.anchored}", ${Math.round(cornerCard.fromRight)}px from the right edge`,
    );
    await untouched.close();

    // A window narrower than the pill makes the clamp's upper bound negative. Applied in
    // the wrong order it wins, and the pill is pushed off the left edge — out of reach,
    // in the one path that exists to bring it back.
    await drag.setViewportSize({ width: 320, height: 700 });
    await drag.waitForTimeout(400);
    const dockNarrow = await dragDock.boundingBox();
    check(
      "a window narrower than the pill still leaves it against the left edge",
      dockNarrow.x >= 0,
      `dock at x=${Math.round(dockNarrow.x)} in a 320px window`,
    );
    await drag.setViewportSize({ width: 1280, height: 900 });
    await drag.waitForTimeout(400);

    // The dock changes size for reasons `resize` cannot see. Collapse, drop the handle at
    // the right edge, expand: the dock is left-anchored, so without a re-clamp the full
    // pill grows out of the viewport and every button but collapse is off-screen.
    await drag.keyboard.press("h");
    await drag.waitForTimeout(400);
    const handleAtEdge = await drag.locator(".tool--collapse").boundingBox();
    await drag.mouse.move(
      handleAtEdge.x + handleAtEdge.width / 2,
      handleAtEdge.y + handleAtEdge.height / 2,
    );
    await drag.mouse.down();
    await drag.mouse.move(1250, 420, { steps: 10 });
    await drag.mouse.up();
    await drag.waitForTimeout(300);
    await drag.keyboard.press("h"); // expand again
    await drag.waitForTimeout(600); // the pill animates its width over 160ms
    const dockExpanded = await dragDock.boundingBox();
    check(
      "expanding a handle dropped at the right edge brings the whole pill back on screen",
      dockExpanded.x + dockExpanded.width <= 1280,
      `right edge at ${Math.round(dockExpanded.x + dockExpanded.width)} of 1280`,
    );

    // Dragging the pill in `area` mode must not also draw a selection: the marquee's
    // document handler returns early on `isOurUi`, and a shadow event retargets to the
    // host, which carries that attribute. True today, and easy to break.
    await dragBrand.click();
    await drag.keyboard.press("3");
    await drag.waitForTimeout(200);
    const pillInArea = await dragPill.boundingBox();
    await drag.mouse.move(
      pillInArea.x + pillInArea.width / 2,
      pillInArea.y + pillInArea.height / 2,
    );
    await drag.mouse.down();
    await drag.mouse.move(
      pillInArea.x + pillInArea.width / 2 - 220,
      pillInArea.y + pillInArea.height / 2 + 160,
      { steps: 10 },
    );
    check(
      "dragging the toolbar in area mode draws no marquee",
      !(await drag.locator(".marquee").isVisible()),
    );
    await drag.mouse.up();
    await drag.waitForTimeout(200);

    // Left expanded with inspect mode off: `toolbarCollapsed` is profile-wide.
    await drag.keyboard.press("1");
    await dragBrand.click();
    await drag.waitForTimeout(200);
    check(
      "the drag block leaves the toolbar expanded and inspect mode off",
      (await dragBrand.isVisible()) &&
        (await dragDock.getAttribute("data-inspecting")) === "false",
      `brand visible ${await dragBrand.isVisible()}, data-inspecting "${await dragDock.getAttribute("data-inspecting")}"`,
    );
    await drag.close();

    // -------------------------------------------------------------------------
    // Triage — type, status, and what each does to the report
    // -------------------------------------------------------------------------
    // Its own fixture: annotations are keyed on origin + pathname and storage is
    // shared across the whole context, so a page an earlier block annotated starts
    // this one with notes already on it.
    const triage = await context.newPage();
    await triage.goto(`${base}/triage.html`);
    await triage.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await triage.locator(".tool--brand").click();

    // One note typed as a bug…
    await triage.locator(".cta").click();
    await triage.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await triage.locator('.kind-chip[data-kind="bug"]').click();
    await triage.locator(".composer__input").fill("Clicking this does nothing at all.");
    await triage.locator(".composer .button--primary").click();
    await triage.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    // …and one left on the default type.
    await triage.locator("#headline").click();
    await triage.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await triage.locator(".composer__input").fill("Heading is too tight against the intro.");
    await triage.locator(".composer .button--primary").click();
    await triage.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

    await triage.locator('.tool[aria-label^="Annotations"]').click();
    await triage.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    await triage.locator(".panel .button--primary").click();
    const triageReport = await triage.evaluate(() => navigator.clipboard.readText());

    check(
      "a typed note carries its type into the report heading",
      /### 1\. \[bug\] /.test(triageReport),
      triageReport.split("\n").find((line) => line.startsWith("### 1.")) ?? "(no first heading)",
    );
    check(
      "the default type is not printed, so it decorates nothing",
      !triageReport.includes("[ui]"),
      "an explicit [ui] tag appeared where the default should stay silent",
    );

    // Marking one done moves it out of the numbered work list without losing it.
    await triage.locator(".entry").first().locator(".entry__status").click();
    await triage.locator(".panel .button--primary").click();
    const doneReport = await triage.evaluate(() => navigator.clipboard.readText());

    check("a done note gets its own section", doneReport.includes("## Already fixed"));
    check(
      "a done note is out of the numbered list",
      !/### 1\. \[bug\] /.test(doneReport) && /Clicking this does nothing/.test(doneReport),
      "the done note either stayed numbered or vanished entirely",
    );
    check(
      "the one note still open is renumbered to 1",
      doneReport.includes("### 1.") && !doneReport.includes("### 2."),
      "numbering did not close up after a note was marked done",
    );

    const entriesBefore = await triage.locator(".entry").count();
    await triage.locator(".panel__filter-button", { hasText: "Open" }).click();
    const entriesOpen = await triage.locator(".entry").count();
    check(
      "the Open filter hides what is done",
      entriesBefore === 2 && entriesOpen === 1,
      `${entriesBefore} entries unfiltered, ${entriesOpen} with Open`,
    );

    await triage.locator(".panel__filter-button", { hasText: "Done" }).click();
    check("the Done filter shows only what is done", (await triage.locator(".entry").count()) === 1);

    // -------------------------------------------------------------------------
    // Iframes — the document the top frame cannot reach into
    // -------------------------------------------------------------------------
    const framed = await context.newPage();
    await framed.goto(`${base}/frames.html`);
    await framed.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    check(
      "exactly one toolbar exists, however many frames the page has",
      (await framed.locator(".toolbar").count()) === 1,
      `${await framed.locator(".toolbar").count()} toolbars`,
    );

    // The 1×1 frame must not have been instrumented at all.
    const pixelHosts = await framed
      .frameLocator("#pixel")
      .locator("[data-senannotate-ui]")
      .count()
      .catch(() => 0);
    check("a tracking-pixel-sized frame is left alone", pixelHosts === 0, `${pixelHosts} hosts`);

    // Diagnostics capture replaces `fetch`, `XMLHttpRequest.prototype.open/send` and
    // `console.error` in the page's own heap. A browser-integrity check — Cloudflare's
    // Turnstile is the one that bit us — reads a non-native `fetch` as tampering and
    // refuses to verify, and the widget renders in an iframe we were instrumenting.
    //
    // The capture is only ever *read* in the top frame: `onDiagnostics` and
    // `fetchDiagnostics` are both called inside `installTopFrame()`, and the child
    // branch's own comment says "no annotations, no diagnostics, no badge". So a child
    // frame must be left with its natives intact — we were paying for data nobody read.
    const topPatched = await framed.evaluate(
      () => !window.fetch.toString().includes("[native code]"),
    );
    check("the top frame is still instrumented", topPatched, `topPatched=${topPatched}`);

    const innerFrame = framed.frames().find((frame) => frame.url().includes("frame-inner.html"));
    const innerNative = await innerFrame?.evaluate(() =>
      [
        window.fetch.toString(),
        XMLHttpRequest.prototype.open.toString(),
        XMLHttpRequest.prototype.send.toString(),
        console.error.toString(),
      ].every((source) => source.includes("[native code]")),
    );
    check(
      "a child frame's natives are left unpatched, so a captcha can still verify",
      innerNative === true,
      `innerNative=${innerNative}`,
    );

    await framed.locator(".tool--brand").click();
    // The state broadcast is a postMessage; give it a turn to land.
    await framed.waitForTimeout(300);

    const inner = framed.frameLocator("#embedded");
    await inner.locator(".framed-button").click();

    const framedComposer = framed.locator(".composer");
    await framedComposer.waitFor({ state: "visible", timeout: 5_000 });

    const framedMeta = (await framed.locator(".composer__meta").textContent())?.trim() ?? "";
    check(
      "clicking inside a frame annotates the inner element, not the <iframe>",
      /Pay now/.test(framedMeta) && !/iframe/i.test(framedMeta),
      `composer described "${framedMeta}"`,
    );

    // The composer is anchored off the translated box; if the frame's own offset were
    // dropped, it would sit at the top-left of the page instead of near the button.
    const composerBox = await framedComposer.boundingBox();
    const iframeBox = await framed.locator("#embedded").boundingBox();
    check(
      "the capture is translated into the top document's coordinates",
      composerBox !== null && iframeBox !== null && composerBox.x > iframeBox.x - 200,
      `composer at x=${Math.round(composerBox?.x ?? -1)}, iframe at x=${Math.round(iframeBox?.x ?? -1)}`,
    );

    await framed.locator(".composer__input").fill("This button should say Place order.");
    await framed.locator(".composer .button--primary").click();
    await framedComposer.waitFor({ state: "detached", timeout: 5_000 });

    await framed.locator('.tool[aria-label^="Annotations"]').click();
    await framed.locator(".panel .button--primary").click();
    const frameReport = await framed.evaluate(() => navigator.clipboard.readText());

    check(
      "the report names the frame the element came from",
      /\*\*Frame:\*\*/.test(frameReport) && /preview|frame-inner/.test(frameReport),
      frameReport.split("\n").find((line) => line.startsWith("**Frame:**")) ?? "(no frame line)",
    );
    check(
      "the framed element is still fully identified",
      /Pay now/.test(frameReport),
      "the inner button did not reach the report",
    );

    // -------------------------------------------------------------------------
    // The accent colour setting
    // -------------------------------------------------------------------------
    //
    // One colour has to reach four places that cannot see each other's styles: the
    // overlay's shadow stylesheet, the popup's own document, the badge painted by the
    // service worker, and a canvas `strokeStyle` in the markup editor. Each is checked
    // where it lands, because a substitution in one of them proves nothing about the rest.
    //
    // The block ends by resetting to the default, so everything after it runs in the
    // shipped colour.
    const [accentWorker] = context.serviceWorkers();
    const accentExtensionId = accentWorker ? new URL(accentWorker.url()).host : null;

    if (accentExtensionId) {
      const accented = await context.newPage();
      await accented.goto(`${base}/accent.html`);
      await accented.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
      await accented.locator(".tool--brand").click();

      // A note first: the badge only carries a colour once it carries a count.
      await accented.locator(".card-copy").click();
      await accented.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
      await accented.keyboard.type("Checking the accent reaches everything.");
      await accented.locator(".composer .button--primary").click();
      await accented.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });

      /** Resolve a custom property to a real colour: they read back as their own token. */
      const resolved = (property) =>
        accented.evaluate((name) => {
          const host = document.querySelector("[data-senannotate-ui]");
          const probe = document.createElement("span");
          probe.style.color = `var(${name})`;
          host.shadowRoot.append(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        }, property);

      const hoverHighlight = async () => {
        const box = await accented.locator(".card-copy").boundingBox();
        await accented.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
        await accented.locator(".highlight").first().waitFor({ state: "visible", timeout: 5_000 });
        await accented.waitForTimeout(200);
        return accented.locator(".highlight").first().evaluate((el) => getComputedStyle(el).borderColor);
      };

      // The accent is picked in the toolbar's settings card now, not in the popup.
      // The popup is still opened below, to prove it wears a colour it no longer chooses.
      const openSettings = async () => {
        await accented.locator(".tool--settings").click();
        await accented.locator(".settings").waitFor({ state: "visible", timeout: 5_000 });
      };
      const closeSettings = async () => {
        await accented.locator(".tool--settings").click();
        await accented.locator(".settings").waitFor({ state: "detached", timeout: 5_000 });
      };

      await openSettings();
      check(
        "the settings card offers the presets and a free picker",
        (await accented.locator(".settings .swatch").count()) === 6 &&
          (await accented.locator(".settings .accent-custom").count()) === 1,
        `${await accented.locator(".settings .swatch").count()} swatches`,
      );

      // A preset, by its title rather than its position, so reordering the list does not
      // silently change what this asserts.
      await accented.locator('.settings .swatch[title="Blue"]').click();
      await accented.waitForTimeout(400);
      check(
        "a preset recolours the overlay",
        (await resolved("--sa-accent")) === "rgb(59, 130, 246)",
        `--sa-accent resolved to ${await resolved("--sa-accent")}`,
      );

      // The card sits over the right of the page; the hover check needs it gone.
      await closeSettings();
      check(
        "the highlight is drawn in the chosen colour",
        (await hoverHighlight()) === "rgb(59, 130, 246)",
        `border read ${await hoverHighlight()}`,
      );

      // Opened after the change, because the popup reads settings once at load. It no
      // longer writes any — this is the read half, and it still has to hold.
      const settingsPage = await context.newPage();
      await settingsPage.goto(`chrome-extension://${accentExtensionId}/popup.html`);
      await settingsPage.locator("#pages").waitFor({ state: "attached", timeout: 10_000 });
      check(
        "the popup wears the accent it no longer picks",
        (await settingsPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())) ===
          "#3b82f6",
        await settingsPage.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
        ),
      );
      check(
        "the popup no longer carries settings controls of its own",
        (await settingsPage.locator("#detail, #props, #accent-presets").count()) === 0,
        `${await settingsPage.locator("#detail, #props, #accent-presets").count()} stale controls`,
      );

      // A dark colour is the case a "darken it" derivation gets wrong: the ink is text
      // drawn *on* the accent, so on navy it has to come out light, not black-on-black.
      await openSettings();
      await accented.locator(".settings .accent-custom").fill("#0b3d91");
      await accented.waitForTimeout(400);
      await closeSettings();
      const ink = await resolved("--sa-accent-ink");
      // A `color-mix()` result comes back as `color(srgb 0.82 0.86 0.92)`, not as
      // `rgb(…)` — the channels are already 0-1 there, and only the plain form needs
      // dividing. Getting this wrong reads as the feature failing rather than the parse.
      const inkLuminance = (() => {
        const channels = [...ink.matchAll(/[\d.]+/g)].map(Number).slice(0, 3);
        if (channels.length < 3) return -1;
        const scale = ink.startsWith("rgb") ? 255 : 1;
        const [red, green, blue] = channels.map((channel) => channel / scale);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      })();
      check(
        "a dark accent gets light ink rather than black on black",
        (await resolved("--sa-accent")) === "rgb(11, 61, 145)" && inkLuminance > 0.5,
        `accent ${await resolved("--sa-accent")}, ink ${ink} (luminance ${inkLuminance.toFixed(2)})`,
      );

      // The markup editor strokes a canvas, which cannot read a CSS variable — the colour
      // has to have been handed to it. Draw a box over the white target and look for it.
      await accented.locator(".shot-target").click();
      await accented.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
      await accented.locator('.composer .button[title^="Capture"]').click();
      await accented.locator(".shot-editor").waitFor({ state: "visible", timeout: 10_000 });
      const shotCanvas = await accented.locator(".shot-editor__canvas").boundingBox();
      if (shotCanvas) {
        await accented.mouse.move(shotCanvas.x + 14, shotCanvas.y + 14);
        await accented.mouse.down();
        await accented.mouse.move(
          shotCanvas.x + shotCanvas.width - 14,
          shotCanvas.y + shotCanvas.height - 14,
          { steps: 8 },
        );
        await accented.mouse.up();
      }
      const strokeFound = await accented.evaluate(() => {
        const host = document.querySelector("[data-senannotate-ui]");
        const canvas = host.shadowRoot.querySelector(".shot-editor__canvas");
        const context = canvas.getContext("2d");
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < data.length; index += 4) {
          // The exact colour, not a range: the stroke is drawn flat over a white halo.
          if (data[index] === 11 && data[index + 1] === 61 && data[index + 2] === 145) return true;
        }
        return false;
      });
      check("the markup editor strokes in the chosen colour", strokeFound);
      await accented.locator(".shot-editor .button--ghost").first().click();
      await accented.keyboard.press("Escape");

      // The badge is the service worker's to paint, and only it can read the colour back.
      const badge = await accentWorker
        .evaluate(async (origin) => {
          const [tab] = await chrome.tabs.query({ url: `${origin}/accent.html` });
          if (!tab?.id) return null;
          return chrome.action.getBadgeBackgroundColor({ tabId: tab.id });
        }, base)
        .catch(() => null);
      check(
        "the toolbar badge is painted in the chosen colour",
        Array.isArray(badge) && badge[0] === 11 && badge[1] === 61 && badge[2] === 145,
        `getBadgeBackgroundColor returned ${JSON.stringify(badge)}`,
      );

      await openSettings();
      await accented.locator(".settings .link-button").click();
      await accented.waitForTimeout(400);
      await closeSettings();
      check(
        "Reset puts the shipped colour back, with no inline override left behind",
        (await resolved("--sa-accent")) === "rgb(249, 115, 22)" &&
          !(await accented.evaluate(() =>
            document
              .querySelector("[data-senannotate-ui]")
              .style.getPropertyValue("--sa-accent"),
          )),
        `--sa-accent resolved to ${await resolved("--sa-accent")}`,
      );

      await settingsPage.close();
      await accented.close();
    }

    // -------------------------------------------------------------------------
    // Clear after copying — the one automatic way annotations are destroyed
    // -------------------------------------------------------------------------
    // Its own fixture, for the usual reason: this block counts markers and reads the
    // toolbar count, and storage is shared by every page in this context.
    //
    // The block ends with the setting back off. It lives in `storage.sync`, so leaving
    // it on would make every copy in the blocks below wipe the page it just copied.
    //
    // One criterion cannot be reached from here, and it is the one that matters most:
    // a *failed* copy must never clear. Both clipboard routes have to refuse inside the
    // ISOLATED world, and neither `navigator.clipboard` nor `document.execCommand` can be
    // patched from the page — each world gets its own. Reaching it needs a sabotaged
    // second bundle, the same kind of reason `upgrade.mjs` is not in this file. The gate
    // is `copyReport`'s `if (!copied) { toast("Copy failed"); return; }`, and it was
    // verified by hand against a bundle with both routes stubbed out.
    const clearPage = await context.newPage();
    await clearPage.goto(`${base}/clear-copy.html`);
    await clearPage.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });

    const clearMarkers = () => clearPage.locator(".marker").count();
    const clearToast = async () => ((await clearPage.locator(".toast").last().textContent()) ?? "").trim();
    const clearBadge = async () => ((await clearPage.locator(".count").textContent()) ?? "").trim();

    const annotateClearPage = async (selector, comment) => {
      await clearPage.locator(".tool--brand").click(); // inspect on
      await clearPage.locator(selector).click();
      await clearPage.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
      await clearPage.locator(".composer__input").fill(comment);
      await clearPage.locator(".composer .button--primary").click();
      await clearPage.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
      await clearPage.locator(".tool--brand").click(); // inspect off
    };

    /** Copy from the panel, and hand back whatever landed on the clipboard. */
    const copyFromPanel = async () => {
      if (!(await clearPage.locator(".panel").count())) {
        await clearPage.locator('.tool[aria-label^="Annotations"]').click();
        await clearPage.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
      }
      // The panel is rebuilt on every render and a settings change queues one, so a click
      // that lands inside that window hits a button already detached from the DOM.
      await clearPage.waitForTimeout(600);
      await clearPage.locator(".panel .button--primary").click();
      await clearPage.waitForTimeout(400);
      return clearPage.evaluate(() => navigator.clipboard.readText());
    };

    const setClearOnCopy = async (on) => {
      await clearPage.locator(".tool--settings").click();
      await clearPage.locator(".settings").waitFor({ state: "visible", timeout: 5_000 });
      const box = clearPage.locator('.settings [data-setting="clearOnCopy"]');
      const before = await box.isChecked();
      if (before !== on) await box.click();
      await clearPage.locator(".tool--settings").click(); // the gear closes its own card
      await clearPage.locator(".settings").waitFor({ state: "detached", timeout: 5_000 });
      await clearPage.waitForTimeout(300);
      return before;
    };

    // The default path first. It is what everyone who never opens the settings card
    // gets, and the feature's first requirement is that it does not change.
    await annotateClearPage(".cta", "Kept by the default path.");
    const keptReport = await copyFromPanel();
    check(
      "the report reaches the clipboard with the setting off",
      keptReport.includes("Kept by the default path."),
      keptReport.slice(0, 200),
    );
    check(
      "a copy with the setting off leaves the annotations alone",
      (await clearMarkers()) === 1 && (await clearBadge()) === "1",
      `${await clearMarkers()} markers, badge read "${await clearBadge()}"`,
    );
    check(
      "and its toast claims no clear",
      /^Copied 1 annotation$/.test(await clearToast()),
      `toast read "${await clearToast()}"`,
    );

    const wasOff = await setClearOnCopy(true);
    check("Clear after copying is off until it is asked for", wasOff === false);

    // A click for the action trail, which is supposed to be cleared alongside the
    // annotations: steps from a bug already filed must not attach to the next report.
    await clearPage.locator("#stale").click();
    await clearPage.waitForTimeout(200);

    const clearedReport = await copyFromPanel();
    check(
      "a copy that clears still reaches the clipboard",
      clearedReport.includes("Kept by the default path."),
      clearedReport.slice(0, 200),
    );
    check(
      "the toast names what was copied, then the clear",
      /^Copied 1 annotation · cleared$/.test(await clearToast()),
      `toast read "${await clearToast()}"`,
    );
    check(
      "clearing empties the page",
      (await clearMarkers()) === 0 && (await clearBadge()) === "0",
      `${await clearMarkers()} markers, badge read "${await clearBadge()}"`,
    );
    check(
      "the panel falls back to its empty state",
      (await clearPage.locator(".panel .empty").count()) === 1,
      `${await clearPage.locator(".panel .entry").count()} entries left`,
    );

    // In storage, not just in the overlay: an in-memory-only clear would come back on
    // the next reload, which is the one thing worse than not clearing at all.
    await clearPage.reload();
    await clearPage.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
    await clearPage.waitForTimeout(400);
    check(
      "the clear reaches storage, not just the overlay",
      (await clearMarkers()) === 0 && (await clearBadge()) === "0",
      `${await clearMarkers()} markers after reload`,
    );

    /**
     * Just the trail, not the whole report. At forensic detail an entry carries its
     * neighbours, so the *page's* buttons are quoted in it — a regex over the whole
     * document finds "Stale click" whether or not the trail was cleared.
     */
    const trailSection = (report) => {
      const [, rest = ""] = report.split("## Steps to reproduce");
      return rest.split(/^## /m)[0];
    };

    await clearPage.locator("#fresh").click();
    await clearPage.waitForTimeout(200);
    await annotateClearPage("#headline", "Second round, nothing before it.");
    const secondRound = await copyFromPanel();
    check(
      "the action trail goes with the annotations",
      /Clicked button "Stale click"/.test(trailSection(clearedReport)) &&
        !/Stale click/.test(trailSection(secondRound)) &&
        /Clicked button "Fresh click"/.test(trailSection(secondRound)),
      `trail after the clear read "${trailSection(secondRound).trim().replace(/\s+/g, " ").slice(0, 160)}"`,
    );
    check(
      "the next report carries only the new note",
      secondRound.includes("Second round, nothing before it.") &&
        !secondRound.includes("Kept by the default path."),
      secondRound.slice(0, 200),
    );

    // A draft in the composer is work the copy never took, so the clear must leave it
    // alone. An *editor* is the opposite case: the annotation it was editing has just
    // gone, so it has nothing to save back to and goes with it.
    await annotateClearPage(".cta", "Cleared while a draft was open.");
    await clearPage.locator(".tool--brand").click(); // inspect on, to open a draft
    await clearPage.locator("#stale").click();
    await clearPage.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await clearPage.locator(".composer__input").fill("A draft nobody has saved yet.");
    await clearPage.locator(".tool--brand").click(); // inspect off — the draft stays up
    await copyFromPanel();
    check(
      "an unsaved draft survives the clear",
      (await clearPage.locator(".composer").count()) === 1 &&
        (await clearPage.locator(".composer__input").inputValue()) === "A draft nobody has saved yet." &&
        (await clearMarkers()) === 0,
      `${await clearPage.locator(".composer").count()} composers, ${await clearMarkers()} markers`,
    );

    await clearPage.locator(".composer .button--primary").click();
    await clearPage.locator(".composer").waitFor({ state: "detached", timeout: 5_000 });
    check(
      "and it still files, onto the page the copy emptied",
      (await clearMarkers()) === 1 && (await clearBadge()) === "1",
      `${await clearMarkers()} markers, badge read "${await clearBadge()}"`,
    );

    await clearPage.locator(".panel .entry__comment").click();
    await clearPage.locator(".composer").waitFor({ state: "visible", timeout: 5_000 });
    await copyFromPanel();
    check(
      "an editor whose annotation the clear removed closes with it",
      (await clearPage.locator(".composer").count()) === 0 && (await clearMarkers()) === 0,
      `${await clearPage.locator(".composer").count()} composers, ${await clearMarkers()} markers`,
    );

    // Download is deliberately not covered by the setting: the checkbox says *copying*,
    // and a setting that also fires on a button it does not name destroys work by
    // surprise. See `docs/clear-on-copy/context.md`.
    await annotateClearPage(".cta", "Kept for the download path.");
    if (!(await clearPage.locator(".panel").count())) {
      await clearPage.locator('.tool[aria-label^="Annotations"]').click();
      await clearPage.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
    }
    const reportFile = clearPage
      .waitForEvent("download", { timeout: 15_000 })
      .then((d) => d.suggestedFilename())
      .catch(() => null);
    await clearPage.locator('.panel .icon-button[title^="Download"]').click();
    const savedReport = await reportFile;
    check(
      "downloading the report does not clear it",
      typeof savedReport === "string" && savedReport.endsWith(".md") && (await clearMarkers()) === 1,
      `download was ${savedReport === null ? "never offered" : `"${savedReport}"`}, ${await clearMarkers()} markers left`,
    );

    // Nor does the popup's session copy, whatever the setting says. It spans every page
    // in the session, and clearing across pages is not what a per-page checkbox bought.
    const [clearWorker] = context.serviceWorkers();
    const clearExtensionId = clearWorker ? new URL(clearWorker.url()).host : null;
    if (clearExtensionId) {
      const sessionPopup = await context.newPage();
      await sessionPopup.goto(`chrome-extension://${clearExtensionId}/popup.html`);
      await sessionPopup.locator("#copy-session").waitFor({ state: "visible", timeout: 5_000 });
      await sessionPopup.locator("#copy-session").click();
      await sessionPopup.waitForTimeout(400);
      await sessionPopup.close();
      await clearPage.waitForTimeout(300);
      check(
        "the popup's session copy never clears, setting or not",
        (await clearMarkers()) === 1,
        `${await clearMarkers()} markers left`,
      );
    }

    // Back off, for every block below this one as much as for the assertion.
    const wasOn = await setClearOnCopy(false);
    const restoredReport = await copyFromPanel();
    check(
      "turning the setting back off restores the default path",
      wasOn === true &&
        restoredReport.includes("Kept for the download path.") &&
        (await clearMarkers()) === 1 &&
        !/cleared/.test(await clearToast()),
      `${await clearMarkers()} markers, toast read "${await clearToast()}"`,
    );

    await clearPage.close();

    // -------------------------------------------------------------------------
    // Export / import — driven through the real popup
    // -------------------------------------------------------------------------
    const [worker] = context.serviceWorkers();
    const extensionId = worker ? new URL(worker.url()).host : null;
    check("the extension id is discoverable from its service worker", extensionId !== null);

    if (extensionId) {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator("#export").waitFor({ state: "visible", timeout: 5_000 });

      // The session report: every annotated page in one document, which is what
      // walking a multi-screen flow produces and what four separate copies is not.
      const pageRows = await popup.locator(".page-row").count();
      check(
        "the popup lists every page holding notes",
        pageRows >= 3,
        `${pageRows} page rows listed`,
      );

      await popup.locator("#copy-session").click();
      await popup.waitForTimeout(300);

      // Read it back from a fixture page, not from the popup. `clipboard-read` was
      // granted for the fixture origin only; asking for it on `chrome-extension://`
      // raises a permission prompt that nothing in a headed run ever answers, and the
      // suite hangs rather than failing.
      const session = await triage.evaluate(() => navigator.clipboard.readText());

      check(
        "the session report covers more than one page",
        /^# Review session — \d+ pages/m.test(session) &&
          (session.match(/^## http/gm) ?? []).length >= 3,
        `${(session.match(/^## http/gm) ?? []).length} page sections`,
      );
      check(
        "the session report carries notes from separate pages",
        /Clicking this does nothing/.test(session) && /Place order/.test(session),
        "notes from two different pages did not both appear",
      );
      check(
        "the session report says why diagnostics are absent rather than omitting them silently",
        /not kept/.test(session),
        "no explanation of the missing diagnostics",
      );

      const exported = popup
        .waitForEvent("download", { timeout: 15_000 })
        .then((download) => download.path())
        .catch(() => null);
      await popup.locator("#export").click();
      const exportPath = await exported;

      check("the popup exports a file", typeof exportPath === "string");

      let parsed = null;
      if (exportPath) {
        try {
          parsed = JSON.parse(await readFile(exportPath, "utf8"));
        } catch {
          parsed = null;
        }
      }

      check(
        "the export is tagged so import can refuse anything else",
        parsed?.format === "senannotate/annotations" && parsed?.version === 1,
        `format was ${JSON.stringify(parsed?.format)}`,
      );
      check(
        "the export carries the notes taken during this run",
        Array.isArray(parsed?.pages) &&
          parsed.pages.some((entry) =>
            entry.annotations?.some((note) => /Clicking this does nothing/.test(note.comment ?? "")),
          ),
        `${parsed?.pages?.length ?? 0} pages exported`,
      );

      // A file that is not ours must be refused rather than written into storage.
      const junk = join(profile, "not-an-export.json");
      await writeFile(junk, JSON.stringify({ hello: "world" }), "utf8");
      await popup.locator("#import-file").setInputFiles(junk);
      await popup.waitForTimeout(400);
      check(
        "a foreign JSON file is refused",
        /not a SenAnnotate export/i.test((await popup.locator("#archive-hint").textContent()) ?? ""),
        `hint read "${(await popup.locator("#archive-hint").textContent())?.trim() ?? ""}"`,
      );

      // And a real one merges back in after the page has been cleared.
      if (exportPath) {
        await triage.locator('.card__header .icon-button[title^="Clear"]').click();
        await triage.waitForTimeout(300);
        check(
          "clearing empties the page first",
          (await triage.locator(".entry").count()) === 0,
          "entries survived Clear all",
        );

        await popup.locator("#import-file").setInputFiles(exportPath);
        await popup.waitForTimeout(600);
        check(
          "importing reports what it merged",
          /Imported \d+ note/.test((await popup.locator("#archive-hint").textContent()) ?? ""),
          `hint read "${(await popup.locator("#archive-hint").textContent())?.trim() ?? ""}"`,
        );

        await triage.reload();
        await triage.locator(".toolbar").waitFor({ state: "visible", timeout: 10_000 });
        await triage.locator('.tool[aria-label^="Annotations"]').click();
        await triage.locator(".panel").waitFor({ state: "visible", timeout: 5_000 });
        check(
          "the imported notes are back on the page they came from",
          (await triage.locator(".entry").count()) === 2,
          `${await triage.locator(".entry").count()} entries after import`,
        );
      }

      await popup.close();
    }

    // -------------------------------------------------------------------------
    // Domain rules — where the extension is allowed to run
    // -------------------------------------------------------------------------
    //
    // **Last in the run, and it restores `off` + an empty list before it ends.** The rules
    // live in chrome.storage.sync, shared by every page in this profile, so a rule left
    // behind switches the extension off for everything after it — and the symptom is a
    // `.toolbar` locator timing out, which looks nothing like the cause.
    //
    // The fixture origin is `127.0.0.1`, which is what the patterns below have to match.
    if (extensionId) {
      const rulesPopup = await context.newPage();
      await rulesPopup.goto(`chrome-extension://${extensionId}/popup.html`);
      await rulesPopup.locator("#rule-mode").waitFor({ state: "visible", timeout: 10_000 });

      /** Set the mode and the list, the way a user would, and wait for the write. */
      const setRules = async (mode, list) => {
        await rulesPopup.locator("#rule-mode").selectOption(mode);
        await rulesPopup.waitForTimeout(200);
        if (mode !== "off") {
          await rulesPopup.locator("#rules").fill(list);
          // `fill` does not always end with a `change` for a textarea, and `change` is what
          // the popup listens on — saving per keystroke would hammer sync's per-minute quota.
          await rulesPopup.locator("#rules").dispatchEvent("change");
        }
        await rulesPopup.waitForTimeout(400);
      };

      /** Does the toolbar turn up on a *fresh* load? The rules apply per page load. */
      const toolbarAppears = async () => {
        const probe = await context.newPage();
        await probe.goto(`${base}/rules.html`);
        // No `waitFor` — the assertion is about absence, and a wait would be the timeout.
        await probe.waitForTimeout(2_500);
        const count = await probe.locator(".toolbar").count();
        await probe.close();
        return count > 0;
      };

      await setRules("blocklist", "127.0.0.1");
      check(
        "a blocklisted host gets no toolbar at all",
        (await toolbarAppears()) === false,
        "the toolbar was injected on a blocklisted host",
      );

      // Not merely hidden: nothing was built, so the popup cannot reach a content script —
      // and it has to say *why*, or this is indistinguishable from a chrome:// page.
      const blocked = await context.newPage();
      await blocked.goto(`${base}/rules.html`);
      await blocked.waitForTimeout(1_500);
      await rulesPopup.reload();
      await rulesPopup.locator("#rule-mode").waitFor({ state: "visible", timeout: 10_000 });
      await rulesPopup.waitForTimeout(900);
      check(
        "the popup says the site is off by the user's own rules",
        /off on this site by your rules/i.test(
          (await rulesPopup.locator("#status-text").textContent()) ?? "",
        ),
        `status read "${((await rulesPopup.locator("#status-text").textContent()) ?? "").trim()}"`,
      );
      check(
        "the popup names the pattern that decided it",
        ((await rulesPopup.locator("#verdict-text").textContent()) ?? "").includes("127.0.0.1"),
        `verdict read "${((await rulesPopup.locator("#verdict-text").textContent()) ?? "").trim()}"`,
      );
      await blocked.close();

      // An allowlist that does not name this host excludes it — the other reading of the
      // same list, and the direction that fails closed.
      await setRules("allowlist", "example.com");
      check(
        "an allowlist that does not cover the host keeps the toolbar away",
        (await toolbarAppears()) === false,
        "the toolbar was injected on a host missing from the allowlist",
      );

      // A wildcard label, which is the part of the syntax a plain string compare would miss.
      await setRules("allowlist", "127.0.0.*");
      check(
        "a wildcard label matches, so the allowlist admits the host",
        (await toolbarAppears()) === true,
        "the toolbar stayed away despite a matching wildcard",
      );

      // A bare domain is meant to cover its subdomains. `127.0.0.1` has no subdomains to
      // test with, so this checks the other half of that rule: a *longer* pattern must not
      // match a shorter host, or `example.com` in a blocklist would take unrelated sites
      // with it.
      await setRules("allowlist", "sub.127.0.0.1");
      check(
        "a pattern longer than the host does not match it",
        (await toolbarAppears()) === false,
        "a longer pattern matched a shorter host",
      );

      // Restore, and prove the restore worked rather than assuming it.
      await setRules("off", "");
      check(
        "turning the rules off brings the toolbar back everywhere",
        (await toolbarAppears()) === true,
        "the toolbar did not come back after the rules were turned off",
      );

      await rulesPopup.close();
    }

    // Surviving an actual version upgrade is asserted by `test/upgrade.mjs`, which runs
    // straight after this file. It needs two browser launches sharing one profile, which
    // this suite's single throwaway context cannot provide — and `chrome.runtime.reload()`
    // is not a substitute: measured, Chrome drops an extension loaded with
    // `--load-extension` instead of reloading it, and every following navigation to it
    // fails with ERR_BLOCKED_BY_CLIENT.
  } finally {
    await context.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((error) => {
    console.error("\nharness error:", error);
    process.exit(1);
  });
