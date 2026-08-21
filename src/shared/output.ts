// =============================================================================
// The Markdown report
// =============================================================================
//
// The product's actual output. An agent reading it should never need to ask "which
// button?", so the ordering is by usefulness, not by what was easiest to collect:
// source location first, then the component chain, then a selector to grep for.
//
// Four detail levels, each a superset of the last:
//
//   compact   one line per note — for a quick "these three things"
//   standard  + source, component chain, location            (the default)
//   detailed  + selector, props, classes, box, context
//   forensic  + environment, full DOM path, computed styles, a11y, neighbours
//
// Diagnostics (console errors, failed requests, repro steps) are appended after the
// annotations, so the thing the person actually pointed at stays the headline.
// =============================================================================

import {
  isDone,
  kindOf,
  type ActionEntry,
  type Annotation,
  type BoxModel,
  type ContrastReport,
  type ElementOverrides,
  type Diagnostics,
  type Measurements,
  type OutputDetailLevel,
  type PageFrameworkInfo,
  type Sides,
  type SourceRef,
} from "./types";

export interface OutputContext {
  pathname: string;
  href: string;
  page: PageFrameworkInfo | null;
  diagnostics?: Diagnostics | null;
  actions?: ActionEntry[];
  /** Live CSS overrides made on this page, if any. */
  cssChanges?: ElementOverrides[];
}

// -----------------------------------------------------------------------------
// Small formatters
// -----------------------------------------------------------------------------

/** `src/components/Foo.vue:12:5`, or a grep hint when there is no path at all. */
export function formatSource(source: SourceRef | undefined | null): string | null {
  if (!source) return null;
  if (source.origin === "grep-handle") return `(no path — grep for \`[${source.file}]\`)`;

  const line = source.line ? `:${source.line}` : "";
  const column = source.line && source.column ? `:${source.column}` : "";
  return `${source.file}${line}${column}`;
}

function formatProps(props: Record<string, string> | undefined): string | null {
  const entries = Object.entries(props ?? {});
  if (!entries.length) return null;
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

/** `1240` → `+1.2s`. Relative time is what correlates a click with an error. */
function stamp(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatBox(annotation: Annotation): string {
  const box = annotation.boundingBox;
  if (!box) return "";
  const round = Math.round;
  return `x:${round(box.x)}, y:${round(box.y)} (${round(box.width)}×${round(box.height)}px)`;
}

// -----------------------------------------------------------------------------
// Measurements
// -----------------------------------------------------------------------------

/**
 * CSS shorthand order, collapsed the way a stylesheet would write it.
 *
 * Collapsing matters more than it looks: `8px 12px` is a value a reader can paste
 * straight into a rule, while `8px 12px 8px 12px` reads as four separate numbers
 * they have to compare before they trust it.
 */
export function formatSides(sides: Sides): string {
  const unit = (value: number) => (value === 0 ? "0" : `${value}px`);
  const { top, right, bottom, left } = sides;

  if (top === right && right === bottom && bottom === left) return unit(top);
  if (top === bottom && left === right) return `${unit(top)} ${unit(right)}`;
  return `${unit(top)} ${unit(right)} ${unit(bottom)} ${unit(left)}`;
}

/** `320×48px · content 296×32 · padding 8px 12px · margin 0 0 16px 0`. */
export function formatBoxModel(box: BoxModel): string {
  const parts = [
    `${box.width}×${box.height}px`,
    `content ${box.content.width}×${box.content.height}`,
  ];

  // A band of nothing is noise. Only the ones that exist earn a place on the line.
  const nonZero = (sides: Sides) => sides.top || sides.right || sides.bottom || sides.left;
  if (nonZero(box.padding)) parts.push(`padding ${formatSides(box.padding)}`);
  if (nonZero(box.margin)) parts.push(`margin ${formatSides(box.margin)}`);
  if (nonZero(box.border)) parts.push(`border ${formatSides(box.border)}`);

  // Last, because it qualifies everything before it.
  if (box.scaled) parts.push("scaled");

  return parts.join(" · ");
}

/** `24px` apart, `12px overlap`, or a plain `0px` when the edges touch. */
function formatAxis(value: number): string {
  if (value < 0) return `${-value}px overlap`;
  return `${value}px`;
}

/** `+8px`, `-12px`, or `aligned`. ASCII minus: this line gets grepped. */
function formatDelta(value: number): string {
  if (value === 0) return "aligned";
  return value > 0 ? `+${value}px` : `${value}px`;
}

/**
 * The lines a deliberately-taken measurement earns.
 *
 * `**Gap:**` appears from `standard` while `**Box:**` waits for `detailed`, and the
 * asymmetry is the point: a gap cost the reviewer two clicks in a mode they chose,
 * so suppressing it would discard an expressed intention. The box model is passive
 * data collected alongside, which is the same standing `**Position:**` has.
 */
function measurementLines(measurements: Measurements, detail: OutputDetailLevel): string[] {
  const lines: string[] = [];
  const wantsDetail = detail === "detailed" || detail === "forensic";
  const wantsForensic = detail === "forensic";
  const { gap, box } = measurements;

  if (gap) {
    lines.push(`**Measured to:** ${gap.toElement} (\`${gap.toSelector}\`)`);

    if (gap.containment === "none") {
      lines.push(`**Gap:** ${formatAxis(gap.gap.x)} horizontal, ${formatAxis(gap.gap.y)} vertical`);
    } else {
      // One rect is wholly inside the other, so "the space between them" describes
      // nothing. The edge deltas are the whole answer, and they are printed below.
      const which =
        gap.containment === "b-inside-a"
          ? "the second element is inside the first"
          : "the first element is inside the second";
      lines.push(`**Gap:** none — ${which}`);
    }

    if (wantsDetail) {
      const { top, right, bottom, left } = gap.edges;
      lines.push(
        `**Edges:** top ${formatDelta(top)}, right ${formatDelta(right)}, ` +
          `bottom ${formatDelta(bottom)}, left ${formatDelta(left)}`,
      );
    }

    if (wantsForensic) {
      const horizontal =
        gap.center.x === 0
          ? "aligned horizontally"
          : `${Math.abs(gap.center.x)}px ${gap.center.x > 0 ? "right" : "left"}`;
      const vertical =
        gap.center.y === 0
          ? "aligned vertically"
          : `${Math.abs(gap.center.y)}px ${gap.center.y > 0 ? "down" : "up"}`;
      lines.push(`**Centres:** ${horizontal}, ${vertical}`);
    }
  }

  if (wantsDetail && box) lines.push(`**Box:** ${formatBoxModel(box)}`);
  // Same level as `**Box:**`: passive data collected alongside, not something the
  // reviewer spent a gesture asking for.
  if (wantsDetail && measurements.contrast) {
    lines.push(`**Contrast:** ${formatContrast(measurements.contrast)}`);
  }

  return lines;
}

/**
 * `3.45:1 · fails AA (needs 4.5:1)`.
 *
 * The threshold it missed is named, because a bare verdict leaves the reader — often an
 * agent about to change a colour — to look up which of four numbers applied. What is
 * deliberately *not* here is a suggested replacement colour: that is a design decision,
 * and the person reading is better placed to make it than this line is.
 */
function formatContrast(contrast: ContrastReport): string {
  const size = contrast.large ? " on large text" : "";
  const ratio = `${contrast.ratio}:1`;

  if (contrast.aaa) return `${ratio} · passes AA and AAA${size}`;
  if (contrast.aa) {
    return `${ratio} · passes AA, fails AAA (needs ${contrast.large ? "4.5" : "7"}:1)${size}`;
  }
  return `${ratio} · fails AA (needs ${contrast.large ? "3" : "4.5"}:1)${size}`;
}

/**
 * The CSS the reviewer actually changed, as a section of its own.
 *
 * Top-level rather than attached to an annotation, because an override is not a note
 * about an element — it is an instruction about one, and it exists whether or not
 * anybody wrote a sentence next to it.
 *
 * The heading is the **selector**, not the friendly label: this section is the one part
 * of the report meant to be acted on mechanically, and `button.primary` is not something
 * you can paste into a stylesheet.
 *
 * Elements whose overrides were all reverted are dropped rather than printed empty — a
 * heading with nothing under it reads as a change that failed to record.
 */
export function formatCssChanges(elements: ElementOverrides[]): string[] {
  const populated = elements.filter((element) => element.overrides.length > 0);
  if (!populated.length) return [];

  const lines = ["## CSS changes", ""];
  for (const element of populated) {
    lines.push(`### \`${element.selector}\``, "");
    for (const { property, from, to } of element.overrides) {
      lines.push(`- \`${property}\`: \`${from}\` \u2192 \`${to}\``);
    }
    lines.push("");
  }
  return lines;
}

/** `gap 24×0px`, for the one-line bullet in a compact report. */
function compactGap(measurements: Measurements | undefined): string {
  const gap = measurements?.gap;
  if (!gap) return "";
  return ` · gap ${gap.gap.x}×${gap.gap.y}px`;
}

/**
 * One line describing the framework, or null when none was detected.
 *
 * The label comes from the detector, never from a mapping here — that is what keeps
 * adding a framework to one file.
 */
function describeStack(page: PageFrameworkInfo | null): string | null {
  if (!page?.detected) return null;

  const label = page.flavour ?? page.framework ?? "detected";
  const parts = [page.version ? `${label} ${page.version}` : label];
  if (page.stateManager) parts.push(page.stateManager);
  if (!page.devMetadata) parts.push("production build — component metadata unavailable");
  return parts.join(" · ");
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

function renderHeader(context: OutputContext, detail: OutputDetailLevel): string[] {
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const stack = describeStack(context.page);
  const lines = [`## Page feedback: ${context.pathname}`];

  if (detail === "forensic") {
    lines.push("", "**Environment:**", `- URL: ${context.href}`);
    if (stack) lines.push(`- Stack: ${stack}`);
    if (context.page?.routePath) lines.push(`- Route: ${context.page.routePath}`);
    lines.push(
      `- Viewport: ${viewport}`,
      `- Device pixel ratio: ${window.devicePixelRatio}`,
      `- User agent: ${navigator.userAgent}`,
      `- Captured: ${new Date().toISOString()}`,
      "",
      "---",
    );
  } else if (detail !== "compact") {
    // Omitted entirely rather than saying "not detected": on a page with no framework
    // that line is noise in every single report.
    lines.push(stack ? `**Stack:** ${stack}  ·  **Viewport:** ${viewport}` : `**Viewport:** ${viewport}`);
  }

  lines.push("");
  return lines;
}

// -----------------------------------------------------------------------------
// Annotations
// -----------------------------------------------------------------------------

/**
 * `[bug] ` — and nothing at all for `ui`.
 *
 * `ui` is the default every unlabelled note lands on, so printing it would decorate
 * every line of every report with a word that carries no information. A tag appears
 * only where someone chose one.
 */
function tag(annotation: Annotation): string {
  const kind = kindOf(annotation);
  return kind === "ui" ? "" : `[${kind}] `;
}

function renderCompact(annotation: Annotation, number: number): string {
  const source = formatSource(annotation.source);
  const where = source ? ` (${source})` : "";
  const quoted = annotation.selectedText ? ` — re: "${truncate(annotation.selectedText, 30)}"` : "";
  const gap = compactGap(annotation.measurements);
  return `${number}. ${tag(annotation)}**${annotation.element}**${where}${gap}: ${annotation.comment}${quoted}`;
}

/**
 * Notes already marked done, kept rather than filtered out.
 *
 * The instinct is to drop them. That is wrong for the primary reader: an agent told
 * "change these five things" works better knowing a sixth thing in the same area was
 * already dealt with — it is the difference between an edit and a re-edit. They just
 * do not belong in the numbered list of work to do.
 */
function renderDone(annotations: Annotation[]): string[] {
  if (!annotations.length) return [];

  const lines = ["## Already fixed", ""];
  for (const annotation of annotations) {
    const source = formatSource(annotation.source);
    const where = source ? ` (${source})` : "";
    lines.push(`- ${tag(annotation)}**${annotation.element}**${where} — ${annotation.comment}`);
  }
  lines.push("");
  return lines;
}

function renderAnnotation(
  annotation: Annotation,
  number: number,
  detail: OutputDetailLevel,
): string[] {
  const lines = [`### ${number}. ${tag(annotation)}${annotation.element}`];
  const source = formatSource(annotation.source);
  const wantsDetail = detail === "detailed" || detail === "forensic";
  const wantsForensic = detail === "forensic";

  if (wantsForensic && annotation.isMultiSelect) {
    lines.push("*Multi-element selection — forensic detail is for the first element.*");
  }

  // Most useful first.
  if (source) lines.push(`**Source:** ${source}`);
  if (annotation.framework?.path) lines.push(`**Components:** ${annotation.framework.path}`);
  if (wantsForensic && annotation.framework?.ownerComponent) {
    lines.push(`**Owner:** <${annotation.framework.ownerComponent}>`);
  }

  const props = formatProps(annotation.framework?.props);
  if (wantsDetail && props) lines.push(`**Props:** ${props}`);
  if (wantsForensic && annotation.framework?.grepHandles.length) {
    lines.push(`**Grep handles:** ${annotation.framework.grepHandles.join(", ")}`);
  }

  // Above Location, because it changes which document Location is even about.
  if (annotation.frame) {
    const where = annotation.frame.url ? ` — \`${annotation.frame.url}\`` : "";
    lines.push(`**Frame:** ${annotation.frame.label}${where}`);
    if (wantsForensic) lines.push(`**Frame element:** \`${annotation.frame.selector}\``);
  }

  // Forensic replaces the short Location line with a selector and the full path.
  if (wantsForensic) {
    lines.push(`**Selector:** \`${annotation.selector}\``);
    if (annotation.fullPath) lines.push(`**Full DOM path:** ${annotation.fullPath}`);
  } else {
    lines.push(`**Location:** ${annotation.elementPath}`);
    if (detail === "detailed") lines.push(`**Selector:** \`${annotation.selector}\``);
  }

  if (wantsDetail && annotation.cssClasses) lines.push(`**Classes:** ${annotation.cssClasses}`);
  if (wantsDetail && annotation.boundingBox) lines.push(`**Position:** ${formatBox(annotation)}`);
  if (annotation.measurements) {
    lines.push(...measurementLines(annotation.measurements, detail));
  }
  if (wantsForensic) {
    lines.push(
      `**Marker at:** ${annotation.x.toFixed(1)}% from left, ${Math.round(annotation.y)}px from top`,
    );
  }

  if (annotation.selectedText) lines.push(`**Selected text:** "${annotation.selectedText}"`);
  // Context duplicates the quoted selection, so it is skipped when there is one.
  if (wantsDetail && annotation.nearbyText && !annotation.selectedText) {
    lines.push(`**Context:** ${truncate(annotation.nearbyText, 100)}`);
  }

  if (wantsForensic) {
    if (annotation.computedStyles) lines.push(`**Computed styles:** ${annotation.computedStyles}`);
    if (annotation.accessibility) lines.push(`**Accessibility:** ${annotation.accessibility}`);
    if (annotation.nearbyElements) lines.push(`**Nearby elements:** ${annotation.nearbyElements}`);
  } else if (detail === "detailed" && annotation.computedStyles) {
    lines.push(`**Computed styles:** ${annotation.computedStyles}`);
  }

  lines.push(...renderScreenshot(annotation));
  lines.push(`**Feedback:** ${annotation.comment}`, "");
  return lines;
}

/**
 * A screenshot is only worth a line if the reader can actually open it.
 *
 * `screenshotData` (embed mode) wins when present: it needs nothing outside the
 * document. Otherwise the path is what an agent's file-reading tool takes — and the
 * older `screenshot` field, a bare filename, is still honoured for annotations stored
 * before 0.6.0 so they degrade to what they always were rather than vanishing.
 */
function renderScreenshot(annotation: Annotation): string[] {
  if (annotation.screenshotData) {
    // Square brackets in the alt text would close it early; the element name is
    // scraped off the page and can contain anything.
    const alt = annotation.element.replace(/[[\]]/g, "");
    return ["**Screenshot:**", "", `![${alt}](${annotation.screenshotData})`, ""];
  }

  const path = annotation.screenshotPath ?? annotation.screenshot;
  return path ? [`**Screenshot:** ${path}`] : [];
}

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

const ACTION_VERB: Record<ActionEntry["kind"], string> = {
  click: "Clicked",
  input: "Edited",
  submit: "Submitted",
  key: "Pressed",
  navigate: "Navigated to",
};

function renderActions(actions: ActionEntry[]): string[] {
  if (!actions.length) return [];

  const lines = ["## Steps to reproduce", ""];
  actions.forEach((action, index) => {
    const detail = action.detail ? ` (${action.detail})` : "";
    lines.push(
      `${index + 1}. ${ACTION_VERB[action.kind]} ${action.target}${detail}  \`${stamp(action.at)}\``,
    );
  });
  lines.push("");
  return lines;
}

const LOG_LABEL: Record<string, string> = {
  error: "Uncaught",
  rejection: "Unhandled rejection",
  console: "console.error",
  resource: "Resource",
};

function renderLogs(logs: Diagnostics["logs"], withStacks: boolean): string[] {
  if (!logs.length) return [];

  const lines = [`## Console errors (${logs.length})`, ""];
  for (const log of logs) {
    const where = log.source ? ` — ${log.source}${log.line ? `:${log.line}` : ""}` : "";
    lines.push(`- \`${stamp(log.at)}\` **${LOG_LABEL[log.kind] ?? log.kind}:** ${log.message}${where}`);

    if (withStacks && log.stack) {
      // Eight frames is enough to place the throw without burying the report.
      const frames = log.stack.split("\n").slice(0, 8).map((frame) => `  ${frame.trim()}`);
      lines.push("", "  ```", ...frames, "  ```");
    }
  }
  lines.push("");
  return lines;
}

function renderNetwork(network: Diagnostics["network"]): string[] {
  if (!network.length) return [];

  const lines = [`## Failed requests (${network.length})`, ""];
  for (const request of network) {
    const status = request.status === 0 ? "failed" : String(request.status);
    const reason = request.statusText ? ` ${request.statusText}` : "";
    lines.push(
      `- \`${stamp(request.at)}\` **${status}**${reason} — ${request.method} ${request.url} (${request.durationMs}ms)`,
    );
  }
  lines.push("");
  return lines;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * One document covering every page that was annotated.
 *
 * Built from storage rather than from a live page, which is what shapes it: there is
 * no `PageFrameworkInfo` and no diagnostics for a page nobody is standing on, and
 * those were never persisted — they are per-load state. Rather than quietly render a
 * report that looks like the single-page one minus a few lines, the header says what
 * is missing and why, so nobody reads the absence of a "Steps to reproduce" section
 * as "there were no steps".
 *
 * The detail level is *not* clamped. Every annotation carries exactly the fields that
 * were captured when it was written, so asking for forensic here shows what is there
 * and nothing more — the same as it would on the page itself.
 */
export function generateSessionOutput(
  pages: { page: string; annotations: Annotation[] }[],
  detailLevel: OutputDetailLevel = "standard",
): string {
  const populated = pages.filter((entry) => entry.annotations.length > 0);
  if (!populated.length) return "";

  const total = populated.reduce((sum, entry) => sum + entry.annotations.length, 0);

  const lines = [
    `# Review session — ${populated.length} page${populated.length === 1 ? "" : "s"}, ${total} note${total === 1 ? "" : "s"}`,
    "",
    "_Collected from stored annotations. Console errors, failed requests and steps to_",
    "_reproduce belong to a page load and are not kept, so they are absent here — copy_",
    "_a single page's report from its own toolbar to get them._",
    "",
  ];

  for (const entry of populated) {
    const open = entry.annotations.filter((annotation) => !isDone(annotation));
    const done = entry.annotations.filter((annotation) => isDone(annotation));

    lines.push("---", "", `## ${entry.page}`, "");

    if (detailLevel === "compact") {
      open.forEach((annotation, index) => lines.push(renderCompact(annotation, index + 1)));
      if (done.length) lines.push("", `_${done.length} already fixed._`);
      lines.push("");
      continue;
    }

    open.forEach((annotation, index) => {
      lines.push(...renderAnnotation(annotation, index + 1, detailLevel));
    });
    lines.push(...renderDone(done));
  }

  return lines.join("\n").trim();
}

export function generateOutput(
  annotations: Annotation[],
  context: OutputContext,
  detailLevel: OutputDetailLevel = "standard",
): string {
  if (!annotations.length) return "";

  const lines = renderHeader(context, detailLevel);

  // Numbers follow the open notes, so "note 3" means the third thing still to do.
  const open = annotations.filter((annotation) => !isDone(annotation));
  const done = annotations.filter((annotation) => isDone(annotation));

  open.forEach((annotation, index) => {
    if (detailLevel === "compact") lines.push(renderCompact(annotation, index + 1));
    else lines.push(...renderAnnotation(annotation, index + 1, detailLevel));
  });

  const actions = context.actions ?? [];
  const diagnostics = context.diagnostics;
  const logCount = diagnostics?.logs.length ?? 0;
  const requestCount = diagnostics?.network.length ?? 0;

  if (detailLevel === "compact") {
    // Compact stays one line per thing, but silently dropping captured errors would be
    // the worst possible failure for a bug report — so it says what it is withholding.
    const withheld: string[] = [];
    if (logCount) withheld.push(`${logCount} console error${logCount === 1 ? "" : "s"}`);
    if (requestCount) withheld.push(`${requestCount} failed request${requestCount === 1 ? "" : "s"}`);
    if (done.length) withheld.unshift(`${done.length} already fixed`);
    if (withheld.length) {
      lines.push("", `_Also captured: ${withheld.join(", ")} — switch off Compact to include them._`);
    }
    return lines.join("\n").trim();
  }

  // Above the diagnostics and below the notes: an override is an instruction, and it
  // outranks a console error the reader may not have to do anything about.
  lines.push(...formatCssChanges(context.cssChanges ?? []));

  lines.push(...renderDone(done));

  if (actions.length || logCount || requestCount) {
    lines.push("---", "", ...renderActions(actions));
    if (diagnostics) {
      const withStacks = detailLevel === "detailed" || detailLevel === "forensic";
      lines.push(...renderLogs(diagnostics.logs, withStacks), ...renderNetwork(diagnostics.network));
    }
  }

  if (diagnostics?.unavailable) {
    lines.push(
      "_Console and network capture was not active on this page — reload with the extension enabled to collect them._",
    );
  }

  return lines.join("\n").trim();
}
