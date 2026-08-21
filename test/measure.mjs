// =============================================================================
// Unit checks for the pure modules
// =============================================================================
//
// `measure.ts` and the formatters in `output.ts` are arithmetic and string building:
// the e2e suite can reach them only through a browser, a click and a clipboard read,
// which is a terrible feedback loop for a sign error. They are bundled here with the
// esbuild that already builds the extension — no test framework, no new dependency,
// the same `check()` shape `e2e.mjs` uses.
//
//   node test/measure.mjs
// =============================================================================

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Bundle a TS module to ESM in a temp dir and import it. */
async function load(entry, outName) {
  const dir = mkdtempSync(join(tmpdir(), "senannotate-unit-"));
  const outfile = join(dir, outName);
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
  });
  const module = await import(pathToFileURL(outfile).href);
  rmSync(dir, { recursive: true, force: true });
  return module;
}

/** DOMRect is not in Node; the engine only needs these six fields. */
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const { roundPx, measureGap, toHex, parseRgb, contrastRatio, contrastReport } = await load("src/content/measure.ts", "measure.mjs");

// --- roundPx -----------------------------------------------------------------
check("roundPx trims trailing zeros", roundPx(24.0) === 24, String(roundPx(24.0)));
check("roundPx keeps a sub-pixel gap", roundPx(0.5) === 0.5, String(roundPx(0.5)));
check("roundPx goes to two places", roundPx(12.3456) === 12.35, String(roundPx(12.3456)));
check("roundPx normalises negative zero", Object.is(roundPx(-0.001), 0), String(roundPx(-0.001)));

// --- measureGap: apart --------------------------------------------------------
// A at x 0..100, B at x 124..224 — 24px of clear space, same row.
const apart = measureGap(rect(0, 0, 100, 40), rect(124, 0, 100, 40));
check("a clear horizontal gap is positive", apart.gap.x === 24, JSON.stringify(apart.gap));
check("rows on the same line have no vertical gap", apart.gap.y === -40, JSON.stringify(apart.gap));
check("aligned top edges read 0", apart.edges.top === 0, String(apart.edges.top));
check("nothing is contained", apart.containment === "none", apart.containment);

// --- measureGap: touching -----------------------------------------------------
const touching = measureGap(rect(0, 0, 100, 40), rect(100, 0, 50, 40));
check("touching edges read 0", touching.gap.x === 0, String(touching.gap.x));

// --- measureGap: overlapping --------------------------------------------------
const overlap = measureGap(rect(0, 0, 100, 40), rect(88, 0, 100, 40));
check("an overlap is negative", overlap.gap.x === -12, String(overlap.gap.x));

// --- measureGap: containment --------------------------------------------------
const inside = measureGap(rect(0, 0, 200, 100), rect(20, 10, 100, 40));
check("b inside a is detected", inside.containment === "b-inside-a", inside.containment);
check("b inside a keeps usable edges", inside.edges.left === 20, String(inside.edges.left));

const outside = measureGap(rect(20, 10, 100, 40), rect(0, 0, 200, 100));
check("a inside b is detected", outside.containment === "a-inside-b", outside.containment);

// --- measureGap: edges and centre ---------------------------------------------
const shifted = measureGap(rect(0, 0, 100, 40), rect(8, 0, 80, 40));
check("left edge delta is signed", shifted.edges.left === 8, String(shifted.edges.left));
check("right edge delta is signed", shifted.edges.right === -12, String(shifted.edges.right));
check("centre delta is computed", shifted.center.x === -2, String(shifted.center.x));

// --- sub-pixel survives end to end --------------------------------------------
const hairline = measureGap(rect(0, 0, 100, 40), rect(100.5, 0, 100, 40));
check("a 0.5px gap is not rounded away", hairline.gap.x === 0.5, String(hairline.gap.x));

// -----------------------------------------------------------------------------
// Report formatting
// -----------------------------------------------------------------------------

// `output.ts` is browser code: its forensic header reports the viewport and the user
// agent. Nothing under test here reads them, but the module would throw on the way past,
// so `window` is stubbed rather than the header being made to care where it runs.
// `navigator` is left alone — Node has had one since 21, and it is read-only.
globalThis.window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2 };

const { formatSides, formatBoxModel, generateOutput } = await load(
  "src/shared/output.ts",
  "output.mjs",
);

const equal = { top: 1, right: 1, bottom: 1, left: 1 };
const pair = { top: 8, right: 12, bottom: 8, left: 12 };
const odd = { top: 0, right: 0, bottom: 16, left: 0 };
check("four equal sides collapse to one", formatSides(equal) === "1px", formatSides(equal));
check("a vertical/horizontal pair collapses to two", formatSides(pair) === "8px 12px", formatSides(pair));
check("an odd side keeps all four", formatSides(odd) === "0 0 16px 0", formatSides(odd));

const box = {
  width: 320,
  height: 48,
  content: { width: 296, height: 32 },
  padding: { top: 8, right: 12, bottom: 8, left: 12 },
  border: { top: 0, right: 0, bottom: 0, left: 0 },
  margin: { top: 0, right: 0, bottom: 16, left: 0 },
  scaled: false,
};
check(
  "the box line reads as one sentence of CSS",
  formatBoxModel(box) === "320\u00d748px \u00b7 content 296\u00d732 \u00b7 padding 8px 12px \u00b7 margin 0 0 16px 0",
  formatBoxModel(box),
);
check("a zero band is left out entirely", !formatBoxModel(box).includes("border"), formatBoxModel(box));
check(
  "a scaled element says so rather than lying",
  formatBoxModel({ ...box, scaled: true }).endsWith(" \u00b7 scaled"),
  formatBoxModel({ ...box, scaled: true }),
);

/** One annotation carrying a measured gap, at whichever detail level. */
function reportWith(detail) {
  return generateOutput(
    [
      {
        id: "1",
        comment: "these two are not aligned",
        timestamp: 0,
        element: 'button "Save"',
        elementPath: ".actions > button",
        selector: ".actions > button.primary",
        x: 50,
        y: 100,
        isFixed: false,
        measurements: {
          box,
          gap: {
            gap: { x: 24, y: 0 },
            edges: { top: 0, right: -12, bottom: 0, left: 8 },
            center: { x: -2, y: 0 },
            containment: "none",
            toElement: 'button "Cancel"',
            toSelector: ".actions > button.secondary",
          },
        },
      },
    ],
    { pathname: "/checkout", href: "https://example.test/checkout", page: null },
    detail,
  );
}

const standard = reportWith("standard");
check("standard names the second element", standard.includes('**Measured to:** button "Cancel"'), standard.slice(0, 300));
check("standard prints the gap", standard.includes("**Gap:** 24px horizontal, 0px vertical"), standard.slice(0, 300));
check("standard withholds the edges", !standard.includes("**Edges:**"), "");
check("standard withholds the box", !standard.includes("**Box:**"), "");

const detailed = reportWith("detailed");
check(
  "detailed prints the edges",
  detailed.includes("**Edges:** top aligned, right -12px, bottom aligned, left +8px"),
  detailed.slice(0, 400),
);
check("detailed prints the box", detailed.includes("**Box:** 320\u00d748px"), detailed.slice(0, 400));
check("detailed still withholds the centres", !detailed.includes("**Centres:**"), "");

const forensic = reportWith("forensic");
check(
  "forensic prints the centres",
  forensic.includes("**Centres:** 2px left, aligned vertically"),
  forensic.slice(0, 400),
);

const compact = reportWith("compact");
check("compact appends the gap to the bullet", compact.includes("\u00b7 gap 24\u00d70px"), compact.slice(0, 300));
check("compact prints no measurement block", !compact.includes("**Gap:**"), "");

// --- toHex ---------------------------------------------------------------------
check("opaque rgb becomes six-digit hex", toHex("rgb(37, 99, 235)") === "#2563eb", toHex("rgb(37, 99, 235)"));
check("white round-trips", toHex("rgb(255, 255, 255)") === "#ffffff", toHex("rgb(255, 255, 255)"));
check("alpha 1 is not spelled out", toHex("rgba(0, 0, 0, 1)") === "#000000", toHex("rgba(0, 0, 0, 1)"));
check("partial alpha becomes eight digits", toHex("rgba(0, 0, 0, 0.5)") === "#00000080", toHex("rgba(0, 0, 0, 0.5)"));
check("fully transparent is named, not hexed", toHex("rgba(0, 0, 0, 0)") === "transparent", toHex("rgba(0, 0, 0, 0)"));
check("an unparseable colour is passed through", toHex("color(srgb 1 0 0)") === "color(srgb 1 0 0)", toHex("color(srgb 1 0 0)"));

// --- contrast ------------------------------------------------------------------
const near = (a, b) => Math.abs(a - b) < 0.02;
const rgb = (r, g, b, a = 1) => ({ r, g, b, a });

check("parseRgb reads a computed colour", JSON.stringify(parseRgb("rgb(37, 99, 235)")) === JSON.stringify(rgb(37, 99, 235)), JSON.stringify(parseRgb("rgb(37, 99, 235)")));
check("parseRgb returns null for what it cannot read", parseRgb("color(srgb 1 0 0)") === null);

check("black on white is the maximum", contrastRatio(rgb(0,0,0), rgb(255,255,255)) === 21, String(contrastRatio(rgb(0,0,0), rgb(255,255,255))));
check("white on white is the minimum", contrastRatio(rgb(255,255,255), rgb(255,255,255)) === 1, String(contrastRatio(rgb(255,255,255), rgb(255,255,255))));
check("the ratio is symmetric", contrastRatio(rgb(0,0,0), rgb(255,255,255)) === contrastRatio(rgb(255,255,255), rgb(0,0,0)));

// 50% black over white composites to rgb(127.5) — luminance 0.2139, so 1.05/0.2639.
// Worked by hand rather than copied from the implementation, or the check would only be
// asserting that the code agrees with itself.
const half = contrastRatio(rgb(0, 0, 0, 0.5), rgb(255, 255, 255));
check("a translucent foreground is composited, not taken at face value", near(half, 3.98), String(half));
check("compositing lands nowhere near the opaque 21:1", half < 5, String(half));

// --- thresholds -------------------------------------------------------------------
const report = (fg, bg, size, weight) => contrastReport(fg, bg, size, weight);

const grey = report(rgb(108,117,125), rgb(255,251,224), 14, 400);
check("a failing pair fails AA", grey.aa === false && grey.aaa === false, JSON.stringify(grey));
check("and it is not called large text", grey.large === false, JSON.stringify(grey));

const strong = report(rgb(0,0,0), rgb(255,255,255), 14, 400);
check("black on white passes both", strong.aa && strong.aaa, JSON.stringify(strong));

// WCAG large text: >= 24px, or >= 18.66px when bold. 18px regular is NOT large.
check("24px regular is large text", report(rgb(0,0,0), rgb(255,255,255), 24, 400).large === true);
check("18.66px bold is large text", report(rgb(0,0,0), rgb(255,255,255), 18.66, 700).large === true);
check("18px regular is not large text", report(rgb(0,0,0), rgb(255,255,255), 18, 400).large === false);
check("18px bold is not large text either", report(rgb(0,0,0), rgb(255,255,255), 18, 700).large === false);

// #8a8a8a on white is 3.45:1 — between the large-text bar of 3 and the body bar of 4.5,
// which is the only band where `large` changes the answer, and therefore the only band
// worth testing it in. (#757575, the obvious pick, is 4.61 and passes both.)
const mid = rgb(138, 138, 138);
const white = rgb(255, 255, 255);
check("a mid grey fails AA as body text", report(mid, white, 14, 400).aa === false, JSON.stringify(report(mid, white, 14, 400)));
check("the same grey passes AA as large text", report(mid, white, 24, 400).aa === true, JSON.stringify(report(mid, white, 24, 400)));
check("the band is the one where large matters", near(report(mid, white, 14, 400).ratio, 3.45), String(report(mid, white, 14, 400).ratio));

// -----------------------------------------------------------------------------
// CSS overrides
// -----------------------------------------------------------------------------
//
// The engine writes to real elements, so it needs a DOM. These checks cover the part
// that is pure: how a list of overrides becomes the report section. The apply/revert
// round trip is covered in the browser, where an element exists to revert.

const { formatCssChanges } = await load("src/shared/output.ts", "output-css.mjs");

const empty = formatCssChanges([]);
check("no overrides means no section at all", empty.length === 0, JSON.stringify(empty));

const section = formatCssChanges([
  {
    id: "e0",
    selector: ".actions > button.primary",
    label: "button.primary",
    overrides: [
      { property: "padding", from: "8px 12px", to: "12px 20px", priorInline: "" },
      { property: "background-color", from: "rgb(37, 99, 235)", to: "rgb(29, 78, 216)", priorInline: "" },
    ],
  },
]).join("\n");

check("the section names the selector, not the friendly label", section.includes("### `.actions > button.primary`"), section);
check("each line carries both values", section.includes("- `padding`: `8px 12px` \u2192 `12px 20px`"), section);
check("and the second property too", section.includes("`rgb(37, 99, 235)` \u2192 `rgb(29, 78, 216)`"), section);
check("the section is headed once", (section.match(/## CSS changes/g) ?? []).length === 1, section);

// An element whose overrides were all reverted must not leave an empty heading behind.
const reverted = formatCssChanges([
  { id: "e1", selector: ".gone", label: "div.gone", overrides: [] },
]);
check("an element with nothing left is dropped", reverted.length === 0, JSON.stringify(reverted));

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
