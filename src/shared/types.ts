// =============================================================================
// Shared types — the vocabulary all three worlds agree on
// =============================================================================

import { DEFAULT_ACCENT } from "./accent";

export type OutputDetailLevel = "compact" | "standard" | "detailed" | "forensic";

/**
 * How aggressively to filter the component ancestry.
 * - `off`      no component detection at all
 * - `filtered` drop known framework plumbing (Transition, RouterView, …) — default
 * - `smart`    `filtered`, and additionally require the component name to correlate
 *              with a CSS class on the element or one of its ancestors
 * - `all`      no filtering
 */
export type ComponentDetectionMode = "off" | "filtered" | "smart" | "all";

export type ThemePreference = "auto" | "light" | "dark";

/**
 * How a screenshot reaches the reader of the report.
 *
 * - `path`   the PNG is saved and the report names where it landed. An agent with a
 *            file-reading tool opens it; the report stays a few hundred bytes.
 * - `embed`  a downscaled JPEG copy goes into the Markdown as a `data:` URI, so the
 *            report is self-contained for Slack, Jira or an email — at 60-120 KB a
 *            shot. The file is still saved either way.
 */
export type ScreenshotDelivery = "path" | "embed";

/** What a click means while inspect mode is on. */
export type InspectMode = "point" | "text" | "area" | "measure";

// -----------------------------------------------------------------------------
// Triage
// -----------------------------------------------------------------------------
//
// Nine notes in a report read as nine equal demands. In practice two block a
// release, five are polish and one is a question that has to be answered before
// anything is written — and both readers, the developer triaging and the agent
// planning an edit order, currently have to infer that from prose.

export type AnnotationKind = "bug" | "ui" | "copy" | "question";
export type AnnotationStatus = "open" | "done";

/**
 * `ui` is first because it is the default, and the default is what an unlabelled
 * note means: "this looks wrong". `bug` is the one that changes a reader's priority,
 * so it is the one worth a click.
 */
export const ANNOTATION_KINDS: { value: AnnotationKind; label: string; hint: string }[] = [
  { value: "ui", label: "UI", hint: "Layout, spacing, styling" },
  { value: "bug", label: "Bug", hint: "It does the wrong thing" },
  { value: "copy", label: "Copy", hint: "Wording, tone, translation" },
  { value: "question", label: "Question", hint: "Needs an answer before it can be changed" },
];

/**
 * Both fields are optional on the stored shape, so notes written by an older build
 * stay readable — the same call `framework` got when it was renamed from `vue` in
 * 0.3.0. These two helpers are the only place the defaulting happens.
 */
export function kindOf(annotation: Pick<Annotation, "kind">): AnnotationKind {
  return annotation.kind ?? "ui";
}

export function isDone(annotation: Pick<Annotation, "status">): boolean {
  return annotation.status === "done";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// -----------------------------------------------------------------------------
// Measurements
// -----------------------------------------------------------------------------
//
// All figures are **layout pixels**, not on-screen pixels. `getComputedStyle` reports
// the pre-transform box while `getBoundingClientRect` reports the post-transform one,
// and mixing the two gives a badge whose width and padding describe different
// coordinate spaces. Everything here is the former, and `BoxModel.scaled` is set when
// the two disagree so a reader knows the element is not drawn at these numbers.

export interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxModel {
  /** Border box: content + padding + border. */
  width: number;
  height: number;
  content: { width: number; height: number };
  padding: Sides;
  border: Sides;
  margin: Sides;
  /** The rendered rect differs from the layout box — a transform or a zoom is in play. */
  scaled: boolean;
}

export type Containment = "none" | "b-inside-a" | "a-inside-b";

/** Pure geometry between two rects, with no idea what either element is. */
export interface GapGeometry {
  /** Empty space on each axis. Positive apart, negative overlapping, 0 touching. */
  gap: { x: number; y: number };
  /** B's edge minus A's edge. 0 means aligned. */
  edges: Sides;
  /** B's centre minus A's centre. */
  center: { x: number; y: number };
  containment: Containment;
}

export interface GapMeasurement extends GapGeometry {
  /** Human-readable name of the second element, e.g. `button "Cancel"`. */
  toElement: string;
  toSelector: string;
}

export interface Measurements {
  box?: BoxModel;
  gap?: GapMeasurement;
  contrast?: ContrastReport;
}

/**
 * The handful of computed properties worth reading *on the page*, as opposed to in the
 * report. Overlay-only by design: `Annotation.computedStyles` already carries this
 * ground for the report, and printing both would say everything twice.
 */
/** Colour channels, 0-255, with straight alpha 0-1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A WCAG contrast verdict. Absent whenever it cannot be taken honestly — an element with
 * no text of its own, a background nothing paints, or one painted with an image.
 */
export interface ContrastReport {
  /** 1 to 21, two decimal places. */
  ratio: number;
  /** WCAG large text: >= 24px, or >= 18.66px at weight >= 700. Moves the pass mark. */
  large: boolean;
  aa: boolean;
  aaa: boolean;
}

export interface StyleSummary {
  fontSize: string;
  /** Computed, so `normal` or a px value — never the ratio the stylesheet wrote. */
  lineHeight: string;
  /** First family only; a whole stack is unreadable at this size. */
  fontFamily: string;
  fontWeight: string;
  /** `#rrggbb`, or `#rrggbbaa` when it is not opaque. */
  color: string;
  /** The first non-transparent background found walking up from the element. */
  background: string;
  /** The background came from an ancestor, not from the element itself. */
  backgroundInherited: boolean;
  /** Set when a gradient or image is painted, which no single swatch can honestly show. */
  backgroundIsImage: boolean;
  /** Absent when no honest ratio exists — see `ContrastReport`. */
  contrast?: ContrastReport;
  display: string;
  /** Empty when the corners are square. */
  radius: string;
  /** Empty unless the element lays out with a gap that is actually in effect. */
  gap: string;
  boxSizing: string;
  textAlign: string;
}

// -----------------------------------------------------------------------------
// Framework detection results
// -----------------------------------------------------------------------------
//
// Framework-neutral by design: one detector per framework implements
// `FrameworkDetector` (src/inspector/detectors/types.ts) and fills these in. Nothing
// outside `src/inspector/detectors/` should know which frameworks exist — display
// labels come from the detector, not from a switch elsewhere.

export type FrameworkId = "vue" | "react" | "svelte" | "angular";

/** Whole-page detection, answered once per page (and re-answered on demand). */
export interface PageFrameworkInfo {
  detected: boolean;
  framework: FrameworkId | null;
  /**
   * Display label chosen by the detector — "Vue 3", "Nuxt 3/4", "SvelteKit", "Next.js".
   * Kept as free text so adding a framework never means editing a label mapping
   * somewhere else.
   */
  flavour: string | null;
  /** Reported by the runtime when available, e.g. "3.5.13". */
  version: string | null;
  /**
   * True when the runtime exposes per-element component metadata. False for a
   * production build, where the report degrades to selectors + DOM path.
   */
  devMetadata: boolean;
  /**
   * Exact `file:line:column` is obtainable, not just a filename. True for Vue's
   * tracer or `data-v-inspector`, Svelte's `__svelte_meta`, React's pre-19
   * `_debugSource`.
   */
  hasSourcePositions: boolean;
  /** e.g. "pinia", "vuex", "redux", "ngrx". Free text for the same reason as `flavour`. */
  stateManager: string | null;
  routePath: string | null;
}

/** Where in the repo the annotated element comes from. */
export interface SourceRef {
  /** Repo-relative when we can work it out, absolute otherwise. */
  file: string;
  line?: number;
  column?: number;
  /**
   * - `exact`        line and column, straight from the framework's own records
   * - `dom-attr`     line and column, read off a build-plugin DOM attribute
   * - `file`         file-level only, from component metadata the compiler injected
   * - `grep-handle`  no path at all; an opaque but unique string to grep for
   */
  origin: "exact" | "dom-attr" | "file" | "grep-handle";
}

/** Per-element detection result. */
export interface ElementFrameworkInfo {
  /** Ancestry rendered outermost → innermost, e.g. `<App> <TheSidebar> <BaseButton>`. */
  path: string | null;
  /** Component names, innermost → outermost. */
  components: string[];
  /** The component that owns this element (innermost, unfiltered). */
  ownerComponent: string | null;
  /**
   * Best location the framework itself knows about.
   *
   * `precision` matters to `resolveSource()`: `exact` wins outright, while `file`
   * has to compete with a DOM attribute that may carry line and column but may have
   * been inherited from a wrapper in a different file.
   */
  source: {
    file: string;
    line?: number;
    column?: number;
    precision: "exact" | "file";
  } | null;
  /** Shallow, truncated snapshot of the owner component's resolved props. */
  props: Record<string, string>;
  /**
   * Opaque strings that survive minification and are unique enough to `grep -r`.
   * Vue fills this with scoped-style hashes (`data-v-7ba5bd90`); most frameworks
   * have no equivalent and leave it empty.
   */
  grepHandles: string[];
}

// -----------------------------------------------------------------------------
// Diagnostics — what turns "the button is broken" into a usable bug report
// -----------------------------------------------------------------------------

export type LogKind = "error" | "rejection" | "console" | "resource";

export interface LogEntry {
  kind: LogKind;
  message: string;
  stack?: string;
  /** Script URL / line / column, when the browser gave us one. */
  source?: string;
  line?: number;
  column?: number;
  /** Milliseconds since the page started loading. */
  at: number;
}

export interface NetworkEntry {
  method: string;
  /** Query values for sensitive-looking params are redacted before storage. */
  url: string;
  /** 0 means the request never completed (network error, CORS, abort). */
  status: number;
  statusText?: string;
  durationMs: number;
  transport: "fetch" | "xhr";
  at: number;
}

export type ActionKind = "click" | "input" | "submit" | "key" | "navigate";

export interface ActionEntry {
  kind: ActionKind;
  /** Human-readable target, e.g. `button "Save changes"`. */
  target: string;
  /**
   * Extra context — a field's label, or the URL for a navigation. Never the text
   * a user typed: an action trail must not become a keystroke log.
   */
  detail?: string;
  at: number;
}

export interface Diagnostics {
  logs: LogEntry[];
  network: NetworkEntry[];
  /** Set when capture was never installed (extension loaded after the page). */
  unavailable?: boolean;
}

// -----------------------------------------------------------------------------
// Frames
// -----------------------------------------------------------------------------

/** Which iframe an annotated element came from, as seen from the top document. */
export interface FrameRef {
  /** Short, human-readable: the frame's `name`, `title`, or its path. */
  label: string;
  /** The frame's own URL — the document the selector actually resolves against. */
  url: string;
  /** A selector for the `<iframe>` element in the *top* document. */
  selector: string;
}

// -----------------------------------------------------------------------------
// Annotation
// -----------------------------------------------------------------------------

export interface Annotation {
  id: string;
  comment: string;
  timestamp: number;

  /** Absent means `ui` — see `kindOf`. */
  kind?: AnnotationKind;
  /** Absent means `open` — see `isDone`. */
  status?: AnnotationStatus;

  /** Human-readable element name, e.g. `button "Save changes"`. */
  element: string;
  /** Short ancestry, e.g. `.sidebar > nav > button`. */
  elementPath: string;
  /** Best-effort unique CSS selector, re-resolvable across reloads. */
  selector: string;

  /** Marker position: % of viewport width. */
  x: number;
  /** Marker position: px from the top of the document, or of the viewport if `isFixed`. */
  y: number;
  /** The element is `position: fixed|sticky`, so the marker must not scroll away. */
  isFixed: boolean;

  boundingBox?: Rect;
  /** One box per element when the annotation came from a marquee selection. */
  elementBoundingBoxes?: Rect[];
  isMultiSelect?: boolean;

  /**
   * Figures the reviewer deliberately took. Absent on every annotation made outside
   * `measure` mode and on every one written before this feature — the same optional-field
   * treatment `framework` and `frame` get, for the same reason: these are per-review
   * scratch data and no migration is worth carrying.
   */
  measurements?: Measurements;

  selectedText?: string;
  nearbyText?: string;
  nearbyElements?: string;
  cssClasses?: string;
  computedStyles?: string;
  accessibility?: string;
  fullPath?: string;

  /**
   * Renamed from `vue` in 0.3.0. Annotations persisted by an older build keep the old
   * key and simply lose their component line when reloaded — they are per-review
   * scratch data, so no migration is worth carrying.
   */
  framework?: ElementFrameworkInfo;
  source?: SourceRef;
  /**
   * Set when the element lives inside an iframe. Without it a report says
   * `button "Pay"` on a page whose own DOM contains no such button — the reader has
   * no way to know which document to look in.
   */
  frame?: FrameRef;
  /** Filename of the PNG the user downloaded for this annotation, if any. */
  screenshot?: string;
  /**
   * Where that PNG most likely landed — `~/Downloads/<file>`. Constructed rather than
   * observed: no API tells a content script Chrome's download directory, and the one
   * that would costs a permission this extension does without.
   */
  screenshotPath?: string;
  /**
   * A downscaled JPEG copy as a `data:` URI, only when the delivery setting is
   * `embed`. Stripped from the *persisted* copy if the page's annotations would
   * otherwise exceed what `chrome.storage.local` will hold — see `saveAnnotations`.
   */
  screenshotData?: string;
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export interface Settings {
  detailLevel: OutputDetailLevel;
  componentMode: ComponentDetectionMode;
  theme: ThemePreference;
  /** Show the numbered pins on the page. */
  showMarkers: boolean;
  /**
   * Show the measuring tools at all: mode 4, the `4` key, and the box-model overlay.
   *
   * Off by default, and the default is the argument. Three modes is already the most a
   * toolbar of icon-only buttons can explain, and most reviews never measure anything —
   * so the people who do not want it should not have to see it, and the hint line should
   * not spend a clause advertising it to them.
   */
  measureTools: boolean;
  /**
   * Mode 4 itself. Only reachable when `measureTools`, and switched **on** whenever the
   * master is — a master switch you turn on that changes nothing on screen is a broken
   * switch, and the gap measurement is the headline the master is named after. The
   * default here only covers a profile that has never touched either.
   */
  measureDistances: boolean;
  /** Draw the box model on the hover highlight. Only reachable when `measureTools`. */
  showBoxModel: boolean;
  /** Freeze animations automatically whenever inspect mode turns on. */
  freezeOnInspect: boolean;
  /** Include the owner component's props in the report. */
  includeProps: boolean;
  /** Ceiling on how many ancestors to name. */
  maxComponents: number;
  /**
   * Record console errors, failed requests and an action trail, and attach them
   * to the report. This is the setting that makes the extension useful to a
   * tester on a built site, where component and source data are unavailable.
   */
  captureDiagnostics: boolean;
  /**
   * Wipe the annotations once a copy has actually reached the clipboard.
   *
   * Off by default, and deliberately the *only* automatic way annotations are
   * destroyed: a report you have handed to your agent is finished, but a report
   * you have not is the whole session's work. Nothing else — closing the overlay,
   * leaving inspect mode — may clear it.
   */
  clearOnCopy: boolean;
  /**
   * Shrink the toolbar to a single handle. Persisted rather than session-only so
   * that reviewing a page whose bottom-right corner matters — a chat widget, a
   * cookie bar — does not mean re-collapsing after every reload.
   */
  toolbarCollapsed: boolean;
  /** Whether a screenshot travels as a file path or inside the Markdown. */
  screenshotDelivery: ScreenshotDelivery;
  /**
   * The extension's colour, `#rrggbb`. Reaches the overlay, the popup, the toolbar
   * badge and the markup editor's strokes — see `shared/accent.ts`, which derives the
   * hover and text-on-accent shades from it.
   */
  accentColor: string;
}

export const DEFAULT_SETTINGS: Settings = {
  detailLevel: "standard",
  componentMode: "filtered",
  theme: "auto",
  showMarkers: true,
  measureTools: false,
  measureDistances: true,
  showBoxModel: false,
  freezeOnInspect: false,
  includeProps: true,
  maxComponents: 6,
  captureDiagnostics: true,
  clearOnCopy: false,
  toolbarCollapsed: false,
  screenshotDelivery: "path",
  accentColor: DEFAULT_ACCENT,
};

export const OUTPUT_DETAIL_OPTIONS: { value: OutputDetailLevel; label: string; hint: string }[] = [
  { value: "compact", label: "Compact", hint: "One line each" },
  { value: "standard", label: "Standard", hint: "Component + source" },
  { value: "detailed", label: "Detailed", hint: "+ classes, box, props" },
  { value: "forensic", label: "Forensic", hint: "Everything" },
];

// The three below moved here from `popup/index.ts` when the settings card took the
// controls over. They sit beside `OUTPUT_DETAIL_OPTIONS` because that one was already
// shared, and a list of a setting's legal values belongs with the setting's type.

export const COMPONENT_OPTIONS: { value: ComponentDetectionMode; label: string }[] = [
  { value: "filtered", label: "Skip framework plumbing" },
  { value: "smart", label: "Only names matching the DOM" },
  { value: "all", label: "Every component" },
  { value: "off", label: "Off (fastest)" },
];

export const SCREENSHOT_OPTIONS: { value: ScreenshotDelivery; label: string }[] = [
  { value: "path", label: "Link to the saved file" },
  { value: "embed", label: "Embed in the report" },
];

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Detail level implies how hard to work at naming components. */
export const DETAIL_TO_COMPONENT_MODE: Record<OutputDetailLevel, ComponentDetectionMode> = {
  compact: "off",
  standard: "filtered",
  detailed: "smart",
  forensic: "all",
};
