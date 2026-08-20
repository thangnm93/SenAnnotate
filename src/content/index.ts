// =============================================================================
// ISOLATED-world entry point — the orchestrator
// =============================================================================
//
// Owns all state, wires the UI together, and is the only place that talks to
// both the MAIN-world inspector and the service worker.
// =============================================================================

import { formatSource, generateOutput } from "../shared/output";
import { HIDDEN_KEY } from "../shared/protocol";
import type { RuntimeMessage, RuntimeResponse } from "../shared/protocol";
import {
  DEFAULT_SETTINGS,
  DETAIL_TO_COMPONENT_MODE,
  isDone,
  type Annotation,
  type AnnotationKind,
  type Diagnostics,
  type InspectMode,
  type OutputDetailLevel,
  type PageFrameworkInfo,
  type Settings,
} from "../shared/types";
import {
  clearActions,
  installActionTrail,
  readActions,
  setActionTrailPaused,
} from "./actions";
import {
  clearDiagnostics,
  detectPage,
  fetchDiagnostics,
  inspectElement,
  onDiagnostics,
  setFrozen,
} from "./bridge";
import { captureDraft, resolveElement, viewportBoxes, type Draft } from "./capture";
import {
  diffDesign,
  previewDesign,
  previewText,
  readDesign,
  revertDesign,
  type DesignSnapshot,
} from "./design";
import { copyText } from "./clipboard";
import {
  broadcastFrameState,
  installChildFrame,
  isFrameWorthInstrumenting,
  isLiveChildFrame,
  isTopFrame,
  onFrameDraft,
  requestFrameHoverCapture,
} from "./frames";
import { identifyElement, isAnnotatable, isOurUi } from "./identify";
import {
  canvasToBlob,
  cropToCanvas,
  downloadBlob,
  downloadPath,
  encodeForEmbed,
} from "./screenshot";
import { resolveSource } from "./source";
import {
  loadAnnotations,
  loadDockPosition,
  loadSettings,
  onSettingsChanged,
  saveAnnotations,
  saveDockPosition,
  saveSettings,
} from "./storage";
import {
  Composer,
  type ComposerCallbacks,
  type ComposerMeta,
  type RetargetDirection,
} from "./ui/composer";
import { listen } from "./ui/dom";
import { Markers } from "./ui/markers";
import {
  hitsInRect,
  MAX_MARQUEE_ELEMENTS,
  MIN_MARQUEE_SIZE,
  snapshotCandidates,
  toViewport,
  type Candidate,
  type MarqueeHits,
} from "./ui/marquee";
import { Overlay } from "./ui/overlay";
import { Panel } from "./ui/panel";
import { SettingsCard } from "./ui/settings";
import { createUiRoot, type UiRoot } from "./ui/root";
import { hideTooltip, installTooltips, isFocusTooltipVisible } from "./ui/tooltip";
import { ShotEditor } from "./ui/shot-editor";
import { Toolbar } from "./ui/toolbar";

// Guard against a double injection (a manual `chrome.scripting` call on top of
// the declarative content script would otherwise give you two toolbars).
declare global {
  interface Window {
    __senannotateInstalled?: boolean;
  }
}
if (window.__senannotateInstalled) throw new Error("senannotate: already installed");
window.__senannotateInstalled = true;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let settings: Settings = { ...DEFAULT_SETTINGS };
let annotations: Annotation[] = [];
let page: PageFrameworkInfo | null = null;
/** Mirror of the MAIN world's buffers, kept current by pushed events. */
let diagnosticsCache: Diagnostics | null = null;

let active = false;
let mode: InspectMode = "point";
let frozen = false;
let panelOpen = false;

let hoveredElement: Element | null = null;
let composer: Composer | null = null;
/**
 * The annotation the open composer is editing, or `null` when it holds a new draft.
 *
 * Read by `wipeAnnotations`, which is the only reason it is out here rather than in
 * `openComposer`'s closure: a clear has to tell an editor whose subject it just deleted —
 * that one has nothing to save back to — from a draft nobody has saved yet, which is work
 * the clear never copied and must not take with it.
 */
let composerEditing: Annotation | null = null;
/** Open only while a screenshot is being marked up, always on top of a composer. */
let shotEditor: ShotEditor | null = null;
/** Drag anchor, in document coordinates so a mid-drag scroll cannot move it. */
let marqueeStart: { x: number; y: number } | null = null;
/**
 * A ⌘/Ctrl press in `point` mode that has not yet moved far enough to be a drag.
 *
 * The modifier already means "collect this element", so click and drag share a
 * `pointerdown` and can only be told apart afterwards, by movement. Nothing is drawn
 * and no candidates are measured until it clears `MIN_MARQUEE_SIZE` — below that the
 * gesture stays a pick, which is what a shaky hand on a modifier-click deserves.
 */
let marqueePending: { x: number; y: number } | null = null;
/**
 * Set when a drag has just committed, cleared by the click that follows it.
 *
 * `beginAnnotation` is async, so the `composer` guard at the top of the click handler
 * cannot be relied on to have run by the time the click arrives — without this, the
 * modifier-click branch fires straight after a box and quietly picks one more element.
 */
let suppressNextClick = false;
/** Latest pointer position, document coordinates. Read by the rAF callback. */
let marqueePoint: { x: number; y: number } | null = null;
/** Measured once per drag — see `snapshotCandidates`. */
let marqueeCandidates: Candidate[] = [];
let marqueeHits: MarqueeHits = { elements: [], rects: [], capped: false };
let marqueeFrame = 0;

/**
 * Elements picked one at a time with ⌘/Ctrl+click, waiting to become one annotation.
 *
 * The marquee's set and this one both end at `beginAnnotation(Element[])`, which is why
 * neither the report, the panel, the markers nor storage know this feature exists — see
 * `docs/multi-pick/context.md`. Order is kept: the first pick is the element the report
 * names, and the rest are the `+N more`.
 */
let picked: Element[] = [];

/**
 * Where the toolbar sits on *this* page, or `null` for the default corner. Held here
 * as well as in storage because `resize` re-clamps against it on every frame of a
 * window drag, which is no place for a storage read.
 */
let dockPosition: { x: number; y: number } | null = null;

/** Elements the composer is currently about — kept live for screenshotting. */
let composerTargets: Element[] = [];
/**
 * The draft the open composer is describing, replaced wholesale by a retarget.
 *
 * Beside `composerTargets` rather than threaded through the composer's callbacks as a
 * `(next) => (live = next)` setter: the two have exactly the same lifetime, are cleared
 * by the same `closeComposer`, and `deliverScreenshot` needs to write into whichever
 * draft is current — which a closure captured at open time cannot express.
 */
let composerDraft: Draft | null = null;
/**
 * The element the *last requested* retarget was stepping from, which is not the same as
 * `composerTargets[0]` while a step is in flight.
 *
 * Every step is a bridge round trip of up to 500ms, and four arrow presses land well
 * inside one on a page whose MAIN world is slow. Stepping from the last *confirmed*
 * element would make presses 2..n all compute the same neighbour, with `retargetToken`
 * then discarding all but the last — four presses would move one level.
 */
let retargetFrom: Element | null = null;
/** Guards against a burst of arrow presses landing out of order. */
let retargetToken = 0;
/**
 * Set for as long as a screenshot flow owns the open composer's draft.
 *
 * A retarget replaces `composerDraft` wholesale, and both halves of that flow await
 * across the swap: `captureScreenshot` measures the box and asks the worker for the tab
 * before the markup editor exists, and `deliverScreenshot` runs *after* `closeShotEditor`
 * has already nulled `shotEditor` and handed focus back to the note. In either window the
 * `shotEditor` test alone reads as "no screenshot", the arrows are live, and the filename
 * is then written into an orphan draft no annotation references — the PNG reaches
 * Downloads and the report has no screenshot at all.
 */
let screenshotPending = false;

/**
 * The element's styling as the composer found it, so the preview can be undone.
 *
 * Held here rather than in the composer because it belongs to the *page*: whatever
 * closes the composer — save, cancel, Escape, the panel opening another note — has to
 * put the element back, and only this module sees all of those.
 */
let designSnapshot: DesignSnapshot | null = null;

/**
 * The element that snapshot came off, paired with it rather than read back out of
 * `composerTargets`.
 *
 * Every path that opens a composer while one is already up — a marker click, a panel row,
 * a draft arriving from a child frame — reassigns `composerTargets` before it gets there,
 * so by revert time the list no longer names the element wearing the preview. Holding it
 * here is what makes "the panel opening another note" a real revert path rather than a
 * claim, and it means the revert no longer has to re-derive whether there was one target.
 */
let designTarget: Element | null = null;

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------

let ui!: UiRoot;
let overlay!: Overlay;
let markers!: Markers;
let toolbar!: Toolbar;
let panel: Panel | null = null;
let settingsCard: SettingsCard | null = null;

/**
 * Build the chrome. Top frame only — a second toolbar inside every iframe is both
 * wrong and, unlike the rest of the child-frame path, extremely visible.
 */
function createTopUi(): void {
  ui = createUiRoot();
  installTooltips(ui.cardLayer);
  overlay = new Overlay(ui.overlayLayer);

  markers = new Markers(ui.markerLayer, {
    onClick: (annotation) => openEditor(annotation),
    onHoverChange: (annotation) => {
      if (composer) return;
      if (!annotation) {
        overlay.hideHighlights();
        return;
      }
      overlay.showHighlights(viewportBoxes(annotation), {
        primary: annotation.element,
        secondary: formatSource(annotation.source),
      });
    },
  });

  toolbar = new Toolbar(ui.cardLayer, {
    onToggleActive: () => setActive(!active),
    onModeChange: (next) => {
      mode = next;
      resetMarquee();
      clearPicked();
      overlay.hideAll();
      render();
      broadcastFrameState(active, mode);
    },
    onToggleFreeze: () => toggleFreeze(),
    onTogglePanel: () => togglePanel(),
    onToggleSettings: () => toggleSettings(),
    onToggleCollapse: () => toggleCollapsed(),
    onMove: (position) => {
      // Saved on drop rather than per frame — a drag would otherwise write sixty
      // times a second for as long as the button is held.
      dockPosition = position;
      void saveDockPosition(position);
    },
    // Every frame of the drag, and every other reason the dock moves: a resize
    // re-clamping a stored position, the `ResizeObserver` after a collapse. The settings
    // card belongs to the pill and has to keep up with the pointer, not with storage —
    // which is why this is not `onMove`.
    onDockShift: () => settingsCard?.anchorTo(toolbar.dockBox()),
  });
}

const settingsCallbacks = {
  onClose: () => toggleSettings(false),
  onHideUntilRestart: () => hideUntilRestart(),
  onChange: (patch: Partial<Settings>) => {
    // Changing the detail level moves `componentMode` to its preset, exactly as the
    // panel's own detail select does. A suggestion, not a lock: the components row can
    // be set to anything afterwards and stays there until the level changes again.
    const derived =
      patch.detailLevel !== undefined
        ? { componentMode: DETAIL_TO_COMPONENT_MODE[patch.detailLevel] }
        : {};

    settings = { ...settings, ...derived, ...patch };
    void saveSettings(settings);
    applyAppearance();
    render();
  },
};

const panelCallbacks = {
  onClose: () => togglePanel(false),
  onCopy: () => copyReport(),
  onDownload: () => downloadReport(),
  onClearAll: () => clearAll(),
  onSelect: (annotation: Annotation) => {
    scrollToAnnotation(annotation);
    openEditor(annotation);
  },
  onToggleStatus: (annotation: Annotation) => {
    annotation.status = isDone(annotation) ? "open" : "done";
    void persist();
    render();
  },
  onHoverChange: (annotation: Annotation | null) => {
    if (!annotation) {
      overlay.hideHighlights();
      return;
    }
    overlay.showHighlights(viewportBoxes(annotation), {
      primary: annotation.element,
      secondary: formatSource(annotation.source),
    });
  },
  onDetailChange: (level: OutputDetailLevel) => {
    settings = { ...settings, detailLevel: level, componentMode: DETAIL_TO_COMPONENT_MODE[level] };
    void saveSettings(settings);
    render();
  },
};

function render(): void {
  toolbar.update({
    active,
    mode,
    frozen,
    panelOpen,
    settingsOpen: !!settingsCard,
    collapsed: settings.toolbarCollapsed,
    count: annotations.length,
    page,
  });
  markers.render(annotations, settings.showMarkers && !!annotations.length);
  panel?.render(annotations, settings.detailLevel);
  settingsCard?.render(settings);
  void notifyBadge();
}

/**
 * Push the two looks — theme and accent — at the overlay.
 *
 * One function because they arrive together, from the same settings object, at all three
 * points where settings land: boot, a `storage.onChanged` from the popup, and the
 * `settings-changed` message. Three call sites each doing two calls is three chances to
 * add a third appearance setting to two of them.
 */
function applyAppearance(): void {
  ui.setTheme(settings.theme);
  ui.setAccent(settings.accentColor);
}

// -----------------------------------------------------------------------------
// Mode switching
// -----------------------------------------------------------------------------

function setActive(next: boolean): void {
  if (active === next) return;
  active = next;
  setActionTrailPaused(active);

  // A slow SSR app may still have been hydrating when boot() gave up looking.
  if (active && !page?.detected) void ensureDetection();

  if (!active) {
    resetMarquee();
    clearPicked();
    overlay.hideAll();
    hoveredElement = null;
    hoverLabel = null;
    document.body.style.removeProperty("cursor");
  } else {
    document.body.style.setProperty("cursor", "crosshair", "important");
    if (settings.freezeOnInspect && !frozen) void toggleFreeze(true);
  }

  // Frames have no toolbar of their own, so this is the only way they learn that
  // inspect mode changed.
  broadcastFrameState(active, mode);
  render();
}

async function toggleFreeze(force?: boolean): Promise<void> {
  const next = force ?? !frozen;
  if (next === frozen) return;
  frozen = next;
  await setFrozen(frozen);
  ui.toast(frozen ? "Animations frozen" : "Animations resumed");
  render();
}

/** Whether this tab was asked to hide the overlay for the rest of its session. */
function isHiddenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    // sessionStorage throws in a sandboxed frame or with storage disabled. Not hidden.
    return false;
  }
}

/**
 * Hide the whole overlay in this tab until the tab is closed.
 *
 * Not a `Settings` field: the other settings are preferences that follow the user
 * everywhere, this is a one-off "not on this tab, this session". The flag goes in
 * `sessionStorage` (see `HIDDEN_KEY`) and the host is hidden immediately; a reload
 * re-reads the flag in `installTopFrame` and stays hidden, a new tab never saw it.
 */
function hideUntilRestart(): void {
  try {
    window.sessionStorage.setItem(HIDDEN_KEY, "1");
  } catch {
    // If it cannot be stored the hide will not survive a reload; hiding now is still
    // the more useful half of what was asked.
  }
  ui.host.style.setProperty("display", "none", "important");
}

/**
 * The settings card and the annotations panel share one slot, so opening either closes
 * the other. Two cards stacked in the same 380px column is not a layout, and finding
 * room for both would mean giving one of them a permanently worse home.
 */
function toggleSettings(force?: boolean): void {
  const next = force ?? !settingsCard;
  if (next === !!settingsCard) return;

  if (next) {
    togglePanel(false);
    settingsCard = new SettingsCard(
      ui.cardLayer,
      settingsCallbacks,
      chrome.runtime.getManifest().version,
    );
    settingsCard.render(settings);
    // After `render`, not before: the flip to underneath the pill turns on the card's own
    // height, and a card whose rows have not been filled in yet measures short.
    settingsCard.anchorTo(toolbar.dockBox());
  } else {
    settingsCard?.destroy();
    settingsCard = null;
  }

  render();
}

function togglePanel(force?: boolean): void {
  const next = force ?? !panelOpen;
  panelOpen = next;

  if (panelOpen) toggleSettings(false);

  if (panelOpen && !panel) {
    panel = new Panel(ui.cardLayer, panelCallbacks);
    refreshCaptureSummary();
  }
  if (!panelOpen && panel) {
    panel.destroy();
    panel = null;
    overlay.hideHighlights();
  }

  render();
}

/**
 * The collapsed state is a setting rather than a session flag, so that a reload of
 * the page being reviewed does not put the pill back over the corner you were
 * looking at. `onSettingsChanged` carries it to the other open tabs for free.
 */
/**
 * Collapse means get out of the way, not merely get smaller.
 *
 * Inspect mode and the panel go with it. Leaving inspect armed behind a logo was the
 * older behaviour and it had a sharp edge: the toolbar you had just dismissed was still
 * intercepting every click on the page, so the next one opened a composer for no reason
 * the screen could explain. An open panel is the other thing a collapse would otherwise
 * leave floating over the page it was supposed to clear.
 *
 * Expanding restores neither. Turning inspect mode back on for someone is the same
 * surprise in the other direction — the state you get back should be the one you asked
 * for, and `h` only asks for the toolbar.
 */
function toggleCollapsed(force?: boolean): void {
  const next = force ?? !settings.toolbarCollapsed;
  if (next === settings.toolbarCollapsed) return;

  settings = { ...settings, toolbarCollapsed: next };
  void saveSettings(settings);

  if (next) {
    setActive(false);
    togglePanel(false);
    toggleSettings(false);
  }

  render();
}

function refreshCaptureSummary(): void {
  if (!panel || !settings.captureDiagnostics) return;
  panel.renderCaptureSummary({
    logs: diagnosticsCache?.logs.length ?? 0,
    requests: diagnosticsCache?.network.length ?? 0,
    actions: readActions().length,
  });
}

// -----------------------------------------------------------------------------
// Hover
// -----------------------------------------------------------------------------

let hoverToken = 0;
/** Kept so a scroll can redraw the highlight without re-querying the bridge. */
let hoverLabel: { primary: string; secondary?: string | null } | null = null;

async function updateHover(element: Element): Promise<void> {
  hoveredElement = element;
  const token = ++hoverToken;

  const { name } = identifyElement(element);

  // Draw immediately with what we already know, then enrich once the inspector
  // answers. Waiting for the bridge first would make the highlight feel laggy.
  hoverLabel = { primary: name };
  drawHover(element);

  if (settings.componentMode === "off") return;

  const framework = await inspectElement(
    element,
    settings.componentMode,
    settings.maxComponents,
    false,
  );

  // The pointer moved on while we waited — this result is stale.
  if (token !== hoverToken || hoveredElement !== element) return;

  hoverLabel = {
    primary: framework?.ownerComponent ? `<${framework.ownerComponent}>` : name,
    secondary: formatSource(resolveSource(element, framework)),
  };
  drawHover(element);
}

/**
 * One box for the hovered element — or the whole pick set, when one is being built.
 *
 * Both draws in `updateHover` go through here so that enriching the label a bridge
 * round-trip later cannot wipe the set the user has been assembling.
 */
function drawHover(element: Element): void {
  if (picked.length) {
    drawPicked();
    return;
  }
  overlay.showHighlights([element.getBoundingClientRect()], hoverLabel ?? undefined);
}

/**
 * Annotate the hovered element, triggered by a key rather than a click.
 *
 * `isConnected` is the guard that matters. A menu that re-renders between the
 * pointer settling and the key being pressed leaves a detached node here, and
 * capturing one yields a zero-size box and a selector that resolves to nothing —
 * an annotation that looks fine in the list and points at nowhere in the report.
 *
 * Losing the hover state to the composer's focus is expected and survivable: the
 * draft is fully captured before the composer is constructed, so the report is
 * complete even if the menu closes as the textarea takes focus. That is the same
 * conclusion `docs/modal-focus-leak/` reached for dialogs.
 */
function captureHovered(): void {
  if (mode !== "point") return;

  if (hoveredElement && !hoveredElement.isConnected) hoveredElement = null;

  if (!hoveredElement) {
    ui.toast("Hover an element first", "error");
    return;
  }

  // Over an instrumented iframe the key belongs to that frame: it is the only
  // document whose `elementFromPoint` can see what the pointer is actually on.
  // Keyboard focus is usually still up here, so the top frame has to hand it over.
  if (requestFrameHoverCapture(hoveredElement)) return;

  void beginAnnotation([hoveredElement]);
}

/**
 * Where to open the composer for a draft that came out of an iframe.
 *
 * Its boxes are in this document's coordinate space by the time they arrive, so the
 * anchor is the translated box back in viewport terms — or the middle of the screen
 * if the capture carried no box at all.
 */
function frameAnchor(draft: Draft): DOMRect {
  const box = draft.boundingBox;
  if (!box) return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  return new DOMRect(box.x - window.scrollX, box.y - window.scrollY, box.width, box.height);
}

// -----------------------------------------------------------------------------
// Creating annotations
// -----------------------------------------------------------------------------

async function beginAnnotation(elements: Element[], selectedText?: string): Promise<void> {
  const draft = await captureDraft(elements, { settings, selectedText });
  if (!draft) return;

  composerTargets = elements;
  openComposer(draft, elements[0].getBoundingClientRect(), null);
}

function openEditor(annotation: Annotation): void {
  const element = resolveElement(annotation);
  composerTargets = element ? [element] : [];

  const boxes = viewportBoxes(annotation);
  const anchor = boxes[0] ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  openComposer(annotation, anchor, annotation);
}

/**
 * Draft → the rows the composer shows. Shared by the initial build and each retarget.
 *
 * `ComposerMeta` and not `ComposerData`: a retarget replaces exactly these fields, and
 * carrying `initialComment`/`initialKind` here would build them on every arrow press for a
 * `setData` that has no way to use them — implying the composer might reset the note and
 * the chosen type, which is the one thing it promises never to do.
 */
function composerMeta(draft: Draft): ComposerMeta {
  const props = draft.framework?.props
    ? Object.entries(draft.framework.props)
        .slice(0, 4)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")
    : "";

  return {
    title: draft.element,
    source: formatSource(draft.source),
    components: draft.framework?.path ?? null,
    props: props || null,
    selectedText: draft.selectedText,
    elementCount: draft.elementBoundingBoxes?.length,
  };
}

/**
 * Hand the page back whatever the open composer borrowed. Idempotent, and safe to call
 * when nothing was ever previewed.
 */
function revertPreview(): void {
  if (designTarget && designSnapshot) revertDesign(designTarget, designSnapshot);
  designTarget = null;
  designSnapshot = null;
}

function openComposer(draft: Draft, anchor: DOMRect, existing: Annotation | null): void {
  // Before anything else: replacing an open composer is a close, and the element the old
  // one was previewing on has to be put back while we still know which one it was.
  revertPreview();

  composer?.destroy();
  composerEditing = existing;
  overlay.showHighlights(
    existing ? viewportBoxes(existing) : composerTargets.map((el) => el.getBoundingClientRect()),
    { primary: draft.element, secondary: formatSource(draft.source) },
  );

  // One element, no text selection: anything else has no single thing to preview on.
  const target = composerTargets.length === 1 && !draft.selectedText ? composerTargets[0] : null;
  designTarget = target;
  designSnapshot = target ? readDesign(target) : null;

  // The draft is replaced wholesale by a retarget, and `onSubmit` has to store the one on
  // screen rather than the one the composer opened with. Module state, not a closure: see
  // the declaration.
  composerDraft = draft;
  retargetFrom = composerTargets[0] ?? null;

  /**
   * The highlight is drawn from a measurement taken before the preview; a box that no
   * longer fits the element is worse than no box. Both previews move it, so both call this.
   */
  const redrawHighlight = (): void => {
    overlay.showHighlights(composerTargets.map((el) => el.getBoundingClientRect()), {
      primary: draft.element,
      secondary: formatSource(draft.source),
    });
  };

  const callbacks: ComposerCallbacks = {
    onSubmit: (comment, kind: AnnotationKind, design) => {
      const changes = designSnapshot ? diffDesign(designSnapshot, design.values) : [];
      // Undefined rather than an empty array or a null: an annotation with no design
      // edits keeps exactly the stored shape it had before this feature existed.
      const designChanges = changes.length ? changes : undefined;
      const textChange =
        design.text !== null && designSnapshot?.text != null
          ? { from: designSnapshot.text, to: design.text }
          : undefined;

      if (existing) {
        existing.comment = comment;
        existing.kind = kind;
        // Only when there was an element to diff against. Re-editing a note whose element
        // the page has since rebuilt gives no snapshot, so both of these are `undefined`
        // — and writing them through would delete the deltas the reviewer recorded
        // earlier, in exchange for fixing a typo in the comment. The Design section is
        // not even drawn in that state, so nothing would have warned them.
        if (designSnapshot) {
          existing.designChanges = designChanges;
          existing.textChange = textChange;
        }
      } else {
        annotations = [
          ...annotations,
          {
            ...(composerDraft ?? draft),
            id: newId(),
            comment,
            kind,
            designChanges,
            textChange,
            timestamp: Date.now(),
          } as Annotation,
        ];
      }
      closeComposer();
      void persist();
      render();
      ui.toast(existing ? "Annotation updated" : "Annotation added");
    },
    onCancel: () => closeComposer(),
    onScreenshot: () => void captureScreenshot(existing ?? composerDraft ?? draft),
    onDesignPreview: (property, value) => {
      if (designTarget) previewDesign(designTarget, property, value);
      redrawHighlight();
    },
    onTextPreview: (text) => {
      if (designTarget) previewText(designTarget, text);
      // Rewriting a label resizes the element as surely as changing its padding does.
      redrawHighlight();
    },
    onDelete: existing
      ? () => {
          annotations = annotations.filter((item) => item.id !== existing.id);
          closeComposer();
          void persist();
          render();
          ui.toast("Annotation deleted");
        }
      : undefined,
    onRetarget: retargetable(draft, existing)
      ? (direction) => void retargetComposer(direction)
      : undefined,
  };

  composer = new Composer(
    ui.cardLayer,
    anchor,
    {
      ...composerMeta(draft),
      initialComment: existing?.comment,
      initialKind: existing?.kind,
      design: designSnapshot
        ? {
            snapshot: designSnapshot,
            changes: existing?.designChanges,
            text: existing?.textChange?.to,
          }
        : undefined,
    },
    callbacks,
  );
}

/**
 * Whether an arrow press may land on this element.
 *
 * `eligible` plus a rendered area, and the area is the part the pointer path never had
 * to think about: `elementFromPoint` cannot return a `display: none` popover, a `hidden`
 * span or a collapsed accordion panel, so every stage downstream of a click has always
 * been handed something with a box. The arrows can reach all of them, and a zero-sized
 * target breaks three things at once — `showHighlights` draws a box with no size so the
 * highlight silently vanishes, `captureScreenshot` refuses with "Nothing to capture", and
 * the stored `x`/`y` collapse to 0 so the panel's marker parks in the top-left corner.
 * `marquee.ts` refuses zero-sized candidates for the same reason.
 *
 * Skipping them rather than stopping on them is what keeps the walk useful: a collapsed
 * sibling between two cards is stepped over, exactly like a `<script>`.
 */
function retargetCandidate(element: Element): boolean {
  if (!eligible(element)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/**
 * The element one step from `from` in `direction`, skipping anything not worth
 * annotating.
 *
 * Sibling steps *loop* over `nextElementSibling`/`previousElementSibling` until
 * `retargetCandidate` says yes, rather than filtering the whole child list: a `<script>`,
 * a comment wrapper or one of our own nodes between two cards must not read as a dead end,
 * but building the filtered array to find that out costs an allocation plus a measurement
 * plus an `eligible` call — and `eligible` walks ancestors through `isOurUi` — for every
 * sibling on the page. In a 2,000-row table that is the difference between O(k) and O(n)
 * per press. `marquee.ts` avoids the same call for the same reason.
 *
 * `document.body` is the ceiling, and it enforces itself: `NOT_ANNOTATABLE`
 * (`identify.ts`) holds `BODY` and `HTML`, so the parent walk runs out of eligible nodes
 * rather than being stopped here. Changing where the ceiling sits means changing that set.
 */
function stepFrom(from: Element, direction: RetargetDirection): Element | null {
  if (direction === "parent") {
    for (let node = from.parentElement; node; node = node.parentElement) {
      if (retargetCandidate(node)) return node;
    }
    return null;
  }

  if (direction === "child") {
    for (let node = from.firstElementChild; node; node = node.nextElementSibling) {
      if (retargetCandidate(node)) return node;
    }
    return null;
  }

  const forward = direction === "next";
  for (
    let node = forward ? from.nextElementSibling : from.previousElementSibling;
    node;
    node = forward ? node.nextElementSibling : node.previousElementSibling
  ) {
    if (retargetCandidate(node)) return node;
  }
  return null;
}

/**
 * Move the open composer onto a neighbouring element.
 *
 * The draft has to be captured afresh — element name, source, component chain and
 * props all belong to the element, not to the note — and that is a bridge round trip,
 * so a token drops the answer to any press that has since been superseded.
 */
async function retargetComposer(direction: RetargetDirection): Promise<void> {
  const owner = composer;
  if (!owner) return;

  // `setActive(false)` deliberately leaves an open composer alone — it only hides the
  // overlay — so switching Inspect off while the card is up keeps both the buttons and
  // the keys live. Without this the walk would paint a highlight back onto a page the
  // user has just told us to stop inspecting. `queueSync` refuses on the same test.
  if (!active) return;

  // A screenshot is a crop of one element's box. Retargeting after one would either lose
  // it — `deliverScreenshot` writes into whichever draft object it was handed, and a
  // retarget replaces that object — or keep a picture of the wrong element in the report.
  // Both are "the composer shows one thing and stores another", which is the failure this
  // whole feature exists to avoid, so it is refused instead. The markup editor is on top
  // of the composer and about to write into the same draft, and `screenshotPending` covers
  // the two windows on either side of it where there is no editor to see.
  if (composerDraft?.screenshot || shotEditor || screenshotPending) {
    ui.toast("Retake the screenshot after choosing the element", "error");
    return;
  }

  // The *requested* element, not the last confirmed one — see `retargetFrom`.
  const from = retargetFrom ?? composerTargets[0];
  if (!from) return;

  // The same guard `captureHovered` calls "the guard that matters". An element inside a
  // list the app re-renders — a virtualised row, a menu, a React reconciliation that
  // replaces the node — is detached by now, and `stepFrom` still succeeds on a detached
  // subtree for `child`. `captureDraft` would then return a zero-sized box and a selector
  // that resolves to nothing: an annotation that looks fine in the panel and points
  // nowhere.
  if (!from.isConnected) {
    ui.toast("That element is gone from the page", "error");
    return;
  }

  const next = stepFrom(from, direction);
  if (!next) {
    ui.toast("Nothing there", "error");
    return;
  }

  // Set before the await, so a burst of presses steps a level each instead of
  // recomputing the same neighbour n times and discarding all but one.
  retargetFrom = next;

  const token = ++retargetToken;

  // Move the highlight now, from the synchronous `identifyElement`, and let the bridge
  // answer enrich the label a round trip later — the same order `updateHover` uses, and
  // for a stronger reason: a keypress has one expected response, so up to 500ms of the
  // old element still being highlighted reads as the key having missed.
  overlay.showHighlights([next.getBoundingClientRect()], { primary: identifyElement(next).name });

  const draft = await captureDraft([next], { settings });

  // `composer === owner` and not merely `composer`: the token alone cannot tell a
  // superseded press from a *different composer*. Escape closes this one, a click opens
  // another, and this stale promise then resolves into it — setting its rows, its
  // highlight and its screenshot target to an element it was never about. `closeComposer`
  // bumps the token as well, which covers the same window from the other side.
  if (!draft || token !== retargetToken || composer !== owner) return;

  composerTargets = [next];
  composerDraft = draft;
  composer.setData(composerMeta(draft));
  overlay.showHighlights([next.getBoundingClientRect()], {
    primary: draft.element,
    secondary: formatSource(draft.source),
  });

  // Not *repositioned* — the composer stays anchored where the first pick was, because a
  // card that jumps on every arrow press makes the highlight much harder to follow. It is
  // re-clamped inside `setData`, which is a different thing: see the comment there.
}

/**
 * Retargeting applies to a fresh, single-element pick in this document and nothing else.
 *
 * A saved note is a stored record and moving it is an edit of different weight. A
 * text selection is anchored to a Range that the new element would not contain. A
 * multi-element draft has no single thing to walk from.
 *
 * Everything is read off the draft rather than off `composerTargets`, which is a module
 * global this function is not handed. `isMultiSelect` and `elementBoundingBoxes` already
 * encode the count, and requiring the element to be in *this* document is what makes the
 * iframe path safe by design: `onFrameDraft` happens to clear `composerTargets` before
 * opening, and a fourth caller that forgot that line would otherwise enable the arrows on
 * a draft whose element lives in a child document — `stepFrom` would then walk siblings of
 * a stale top-frame node.
 */
function retargetable(draft: Draft, existing: Annotation | null): boolean {
  if (existing || draft.selectedText || draft.isMultiSelect) return false;
  if ((draft.elementBoundingBoxes?.length ?? 1) > 1) return false;

  const target = composerTargets[0];
  return composerTargets.length === 1 && !!target && target.ownerDocument === document;
}

function closeComposer(): void {
  // The markup editor only ever exists on behalf of an open composer — the draft it
  // is decorating lives in that composer's closure. Leaving it up would strand a card
  // with nowhere to put its result.
  closeShotEditor();

  // Unconditionally — saving does not keep the preview either. The report describes a
  // change to make in the codebase; leaving the page wearing it would have the reviewer
  // testing against a mirage, and the next reload would silently take it away again.
  revertPreview();

  composer?.destroy();
  composer = null;
  composerEditing = null;
  composerTargets = [];
  composerDraft = null;
  retargetFrom = null;
  // The draft the picture was for is gone, so nothing can be stranded any more. It has to
  // be released *here* rather than left to whoever set it: closing takes the markup editor
  // down through `closeShotEditor` directly, so its `onCancel` never runs and the flag
  // would outlive this composer and kill the next one's arrows.
  screenshotPending = false;
  // Bumped so an in-flight `captureDraft` — up to 500ms on a page whose MAIN world never
  // answers the bridge — cannot resolve into whatever composer is open by then. The
  // `composer === owner` test covers the same window from the other side; this closes the
  // case where the *same* object is somehow reached first.
  retargetToken += 1;
  overlay.hideHighlights();
}

function newId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function persist(): Promise<void> {
  const result = await saveAnnotations(annotations);
  if (result.droppedImages) {
    ui.toast(
      `Stored without ${result.droppedImages} embedded image${result.droppedImages === 1 ? "" : "s"} — too large to keep`,
      "error",
    );
  }
}

function scrollToAnnotation(annotation: Annotation): void {
  const element = resolveElement(annotation);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!annotation.isFixed) {
    window.scrollTo({ top: Math.max(0, annotation.y - window.innerHeight / 2), behavior: "smooth" });
  }
}

// -----------------------------------------------------------------------------
// Report + screenshot
// -----------------------------------------------------------------------------

/**
 * Deliberately synchronous up to the clipboard call.
 *
 * `navigator.clipboard.writeText` needs the click's transient user activation,
 * and an `await` before it throws that away — the write then fails silently and
 * the user gets whatever was on their clipboard before. That is why diagnostics
 * are mirrored via a pushed event rather than fetched here.
 */
function buildReport(): string {
  return generateOutput(
    annotations,
    {
      pathname: location.pathname,
      href: location.href,
      page,
      diagnostics: settings.captureDiagnostics ? diagnosticsCache : null,
      actions: settings.captureDiagnostics ? readActions() : [],
    },
    settings.detailLevel,
  );
}

function copyReport(): void {
  if (!annotations.length) return;

  // One snapshot, taken before the clipboard call, and everything downstream reads it
  // rather than the live list: the count the toast quotes, and the set `clearOnCopy` is
  // allowed to remove. `annotations` is replaced rather than mutated on every add, so
  // holding the array is holding the exact list the report was built from.
  //
  // Both halves matter. `clearOnCopy` empties the list by the time the toast is written,
  // so a count read there would say `Copied 0 annotations` about a copy that succeeded —
  // and an annotation filed while the write was in flight was never in the report, so
  // clearing must leave it alone rather than destroy work it never handed over.
  const sent = annotations;
  const sentIds = new Set(sent.map((item) => item.id));
  const count = sent.length;

  const markdown = buildReport();

  void copyText(markdown, ui.shadow).then((copied) => {
    if (!copied) {
      ui.toast("Copy failed", "error");
      return;
    }

    const noun = `${count} annotation${count === 1 ? "" : "s"}`;

    // Only ever on a confirmed write. Clearing on the strength of having *asked* for
    // a copy would, the one time the clipboard refuses, throw the session away with
    // nothing to show for it — and `copyText` has a fallback path that can fail.
    if (settings.clearOnCopy) {
      wipeAnnotations(sentIds);
      ui.toast(`Copied ${noun} · cleared`, "success");
      return;
    }

    ui.toast(`Copied ${noun}`, "success");
  });
}

/**
 * The report as a file.
 *
 * The clipboard is the wrong channel past a certain size — a forensic report with an
 * embedded screenshot is hundreds of kilobytes of base64, and pasting that into a
 * terminal or a ticket field is unpleasant at best. Same `<a download>` route as the
 * screenshot, so this still costs no `downloads` permission.
 */
function downloadReport(): void {
  if (!annotations.length) return;

  const slug = `${location.hostname}${location.pathname}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const blob = new Blob([buildReport()], { type: "text/markdown" });
  const saved = downloadBlob(blob, `senannotate-${slug || "report"}.md`);
  ui.toast(saved ? "Report saved to Downloads" : "Could not save the report", saved ? "success" : "error");
}

async function captureScreenshot(target: Draft | Annotation): Promise<void> {
  // Claimed before the first await: from here until the markup editor exists, `target`
  // is the object the picture is going to be written into, and a retarget would replace
  // it underneath us. Handed over to the editor on success, released on every failure —
  // see `screenshotPending`.
  screenshotPending = true;
  let handedOver = false;
  try {
    const element = composerTargets[0];
    const box = element ? element.getBoundingClientRect() : viewportBoxes(target)[0];
    if (!box || box.width === 0 || box.height === 0) {
      ui.toast("Nothing to capture", "error");
      return;
    }

    // captureVisibleTab photographs whatever is on screen, our overlay included —
    // so it has to step out of the shot first.
    ui.host.style.setProperty("display", "none", "important");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    let response: RuntimeResponse | null = null;
    try {
      response = await sendRuntime({ kind: "capture" });
    } finally {
      ui.host.style.removeProperty("display");
    }

    if (!response?.ok || !response.dataUrl) {
      ui.toast("Screenshot failed", "error");
      return;
    }

    const canvas = await cropToCanvas(response.dataUrl, box);
    if (!canvas) {
      ui.toast("Screenshot failed", "error");
      return;
    }

    // Nothing is written to disk until the editor is saved — a cancelled markup is a
    // cancelled screenshot, not an unwanted file in Downloads.
    openShotEditor(canvas, target);
    handedOver = true;
  } finally {
    if (!handedOver) screenshotPending = false;
  }
}

function openShotEditor(canvas: HTMLCanvasElement, target: Draft | Annotation): void {
  closeShotEditor();
  shotEditor = new ShotEditor(
    ui.cardLayer,
    canvas,
    {
      // Cancelling ends the flow here, so the draft is nobody's subject any more and the
      // arrows may move again. `closeShotEditor` cannot do this itself: `onSave` calls it
      // *before* handing the canvas on, and clearing there would reopen the window
      // `deliverScreenshot` runs in.
      onCancel: () => {
        closeShotEditor();
        screenshotPending = false;
      },
      onSave: (edited) => {
        closeShotEditor();
        void deliverScreenshot(edited, target);
      },
    },
    settings.accentColor,
  );
}

function closeShotEditor(): void {
  if (!shotEditor) return;
  shotEditor.destroy();
  shotEditor = null;
  // The editor took focus so its own Escape and ⌘Z would work; hand it back, or the
  // note the user was halfway through typing needs a click to resume.
  composer?.focus();
}

/**
 * Save the marked-up shot and record how the report should reach it.
 *
 * The file is always written — `embed` adds a second, smaller copy inside the
 * report rather than replacing the first, so switching the setting never costs
 * anyone the full-resolution image.
 */
async function deliverScreenshot(
  canvas: HTMLCanvasElement,
  target: Draft | Annotation,
): Promise<void> {
  // The last stretch that still owns `target`, and the one with no editor on screen to
  // stand for it: `closeShotEditor` has already handed focus back to the note, so an
  // arrow press arrives here while `canvasToBlob` is still encoding.
  try {
    const blob = await canvasToBlob(canvas);
    if (!blob) {
      ui.toast("Could not save screenshot", "error");
      return;
    }

    const filename = `senannotate-${Date.now()}.png`;
    if (!downloadBlob(blob, filename)) {
      ui.toast("Could not save screenshot", "error");
      return;
    }

    target.screenshot = filename;
    target.screenshotPath = downloadPath(filename);
    target.screenshotData =
      settings.screenshotDelivery === "embed" ? (encodeForEmbed(canvas) ?? undefined) : undefined;

    ui.toast("Screenshot saved to Downloads");
    void persist();
  } finally {
    screenshotPending = false;
  }
}

/**
 * Drop annotations, and the diagnostics gathered alongside them.
 *
 * The trail goes too: keeping steps and errors from a bug you already filed would
 * attach them to the next, unrelated report. Deliberately silent — its two callers
 * are a deliberate "clear all" and the tail of a successful copy, and those want to
 * say quite different things.
 *
 * `only` is the set of ids the caller means, and the copy path is the reason it exists:
 * it may remove what its report described and nothing else. Omit it and every annotation
 * goes, which is what "Clear all" asks for.
 *
 * The diagnostics and the trail go regardless. They describe the report that was just
 * handed over, whether or not something arrived after it.
 */
function wipeAnnotations(only?: ReadonlySet<string>): void {
  annotations = only ? annotations.filter((item) => !only.has(item.id)) : [];

  // An editor whose annotation just went has nowhere to save back to, so it goes with it.
  // A composer holding an unsaved draft stays: it is work nothing here has copied, and a
  // clear that scopes itself to what it took cannot then take the one thing it did not.
  // Compared by id rather than identity, because a merge from the popup's import replaces
  // the objects in the list.
  if (composerEditing && !annotations.some((item) => item.id === composerEditing?.id)) {
    closeComposer();
  }

  // The highlights are the clear's business whenever no composer is left to own them.
  // The panel's hover preview is the case that matters: the row the pointer is over is
  // about to be removed, and a removed element never sends the `mouseleave` that would
  // otherwise take its box off the page.
  if (!composer) overlay.hideHighlights();
  clearActions();
  diagnosticsCache = null;
  void clearDiagnostics();
  void persist();
  render();
}

function clearAll(): void {
  if (!annotations.length) return;
  wipeAnnotations();
  ui.toast("All annotations cleared");
}

// -----------------------------------------------------------------------------
// Runtime messaging
// -----------------------------------------------------------------------------

async function sendRuntime(message: RuntimeMessage): Promise<RuntimeResponse | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  } catch {
    // The service worker restarted, or the extension was reloaded.
    return null;
  }
}

async function notifyBadge(): Promise<void> {
  await sendRuntime({ kind: "badge", count: annotations.length });
}


// -----------------------------------------------------------------------------
// Page event handling
// -----------------------------------------------------------------------------

/**
 * An `<iframe>` running our own capture is not annotatable from out here: the script
 * inside it is already highlighting the real element, and highlighting the frame as
 * well would draw two boxes for one thing. A frame we are *not* inside — sandboxed
 * without scripts, or too small to instrument — stays annotatable as an element,
 * which is the honest answer for it.
 */
function eligible(element: Element): boolean {
  return isAnnotatable(element) && !isOurUi(element) && !isLiveChildFrame(element);
}



// --- marquee -----------------------------------------------------------------

function marqueeHint(hits: MarqueeHits, carried = 0): string {
  if (hits.capped) return `${MAX_MARQUEE_ELEMENTS} elements (limit) · release to annotate`;

  const count = hits.elements.length + carried;
  if (count === 0) return "Nothing inside the box yet";
  return `${count} element${count === 1 ? "" : "s"} selected · release to annotate`;
}

// --- picking one at a time ---------------------------------------------------


function pickHint(): string {
  if (picked.length >= MAX_MARQUEE_ELEMENTS) {
    return `${MAX_MARQUEE_ELEMENTS} elements (limit) · Enter to annotate`;
  }
  // "⌘/Ctrl" rather than one of them: the modifier that works depends on the platform
  // (on macOS a Ctrl+click is a right-click), and the overlay has no reliable way to
  // ask which platform it is on.
  return `${picked.length} element${picked.length === 1 ? "" : "s"} picked · ⌘/Ctrl+click to add · Enter to annotate`;
}

/**
 * The set minus anything the page has re-rendered away.
 *
 * A detached node captures as a zero-size box and a selector that resolves to nothing —
 * an annotation that looks fine in the list and points at nowhere in the report. This is
 * the same guard `captureHovered()` needs, for the same reason, and a set that is held
 * across a re-render is far more exposed to it than a single hover.
 */
function livePicks(): Element[] {
  if (picked.some((element) => !element.isConnected)) {
    picked = picked.filter((element) => element.isConnected);
  }
  return picked;
}

/**
 * Draw the set, with the hovered element first so it keeps the label.
 *
 * `preview: true` is the marquee's "every box is the live selection" style, which is what
 * a pick set is: unlike a saved multi-element annotation there is no primary box and no
 * muted remainder. The hovered element is skipped when it is already in the set, so
 * nothing is drawn twice.
 */
function drawPicked(): void {
  const set = livePicks();
  if (!set.length) return;

  const hovered =
    hoveredElement && hoveredElement.isConnected && !set.includes(hoveredElement)
      ? hoveredElement
      : null;
  const elements = hovered ? [hovered, ...set] : set;

  overlay.showHighlights(
    elements.map((element) => element.getBoundingClientRect()),
    hovered ? (hoverLabel ?? undefined) : undefined,
    { preview: true },
  );
  toolbar.setHint(pickHint());
}

/** Forget the set. Callers that want the hover highlight back ask for it themselves. */
function clearPicked(): void {
  picked = [];
  overlay.hideHighlights();
  toolbar.setHint(null);
}

/** ⌘/Ctrl+click: in if it was out, out if it was in. */
function togglePick(element: Element): void {
  const set = livePicks();

  if (set.includes(element)) picked = set.filter((item) => item !== element);
  else if (set.length < MAX_MARQUEE_ELEMENTS) picked = [...set, element];

  if (!picked.length) {
    clearPicked();
    if (hoveredElement?.isConnected) void updateHover(hoveredElement);
    return;
  }
  drawPicked();
}

/**
 * Turn the set into one annotation. `extra` is the element a plain click landed on, which
 * joins the set rather than replacing it — a click that silently discarded three picks
 * would be the worst possible reading of "done".
 */
function commitPicked(extra?: Element): void {
  const set = livePicks();
  const elements = extra && !set.includes(extra) ? [...set, extra] : [...set];

  picked = [];
  toolbar.setHint(null);
  if (!elements.length) return;

  void beginAnnotation(elements.slice(0, MAX_MARQUEE_ELEMENTS));
}


/**
 * Start a live drag from `anchor`, in document coordinates.
 *
 * Shared by the two ways in: the `area` mode `pointerdown`, which drags from the first
 * pixel, and `promoteMarquee`, which gets here once a modifier press has moved enough
 * to stop being a pick. Candidates are measured here rather than at `pointerdown` so a
 * ⌘/Ctrl+click never pays for a measurement it does not use.
 */
function beginMarquee(anchor: { x: number; y: number }): void {
  marqueeStart = anchor;
  marqueePoint = anchor;
  marqueeCandidates = snapshotCandidates();
  marqueeHits = { elements: [], rects: [], capped: false };
  overlay.hideHighlights();
  toolbar.setHint(marqueeHint(marqueeHits));
}

/**
 * Turn a pending modifier press into a real drag, once it has moved far enough.
 *
 * Either axis is enough, deliberately: a long, flat drag is unmistakably a drag, and
 * `hitsInRect` will decide on its own that a six-pixel-tall box contains nothing — the
 * hint then says so, exactly as it does in `area` mode. Returns whether the caller
 * should carry on into the drawing path.
 */
function promoteMarquee(event: PointerEvent): boolean {
  if (!marqueePending) return false;

  const x = event.clientX + window.scrollX;
  const y = event.clientY + window.scrollY;
  if (
    Math.abs(x - marqueePending.x) < MIN_MARQUEE_SIZE &&
    Math.abs(y - marqueePending.y) < MIN_MARQUEE_SIZE
  ) {
    return false;
  }

  const anchor = marqueePending;
  marqueePending = null;
  beginMarquee(anchor);
  return true;
}

function resetMarquee(): void {
  if (marqueeFrame) {
    cancelAnimationFrame(marqueeFrame);
    marqueeFrame = 0;
  }
  marqueeStart = null;
  marqueePoint = null;
  marqueeCandidates = [];
  marqueeHits = { elements: [], rects: [], capped: false };
  overlay.hideMarquee();
  toolbar.setHint(null);
}

/** Recompute and repaint the drag. Cheap: arithmetic over the snapshot, no DOM reads. */
function drawMarquee(): void {
  if (!marqueeStart || !marqueePoint) return;

  const box = {
    left: Math.min(marqueeStart.x, marqueePoint.x),
    top: Math.min(marqueeStart.y, marqueePoint.y),
    right: Math.max(marqueeStart.x, marqueePoint.x),
    bottom: Math.max(marqueeStart.y, marqueePoint.y),
  };

  overlay.showMarquee(toViewport(box));
  marqueeHits = hitsInRect(marqueeCandidates, box);

  // Anything ⌘/Ctrl+click collected before the drag is committed with it, so it has to
  // be drawn and counted with it too. Previewing only the box would open a composer
  // holding more than was ever highlighted — the one thing the preview exists to rule
  // out. Elements the box also caught are not drawn twice.
  const carried = livePicks().filter((element) => !marqueeHits.elements.includes(element));

  overlay.showHighlights(
    [...carried.map((element) => element.getBoundingClientRect()), ...marqueeHits.rects.map(toViewport)],
    undefined,
    { preview: true },
  );
  toolbar.setHint(marqueeHint(marqueeHits, carried.length));
}


// --- keyboard ----------------------------------------------------------------


// --- viewport ----------------------------------------------------------------

let syncQueued = false;
/**
 * Set by `resize` only. The dock re-clamp is a `getBoundingClientRect()` plus two style
 * writes, and `scroll` — which shares this rAF — cannot change the viewport it clamps
 * against, so doing it on every scroll frame would be a forced layout for nothing.
 */
let resizeQueued = false;
function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    if (resizeQueued) {
      resizeQueued = false;
      // A window narrowed since the position was saved can leave the pill off-screen,
      // so the stored coordinates are re-clamped rather than trusted.
      toolbar.applyPosition(dockPosition);
    }
    // A dialog that resizes, or animates into place after it opened, changes whether it is a
    // containing block for our fixed host — and a resize changes the viewport we fit to.
    ui.syncPlacement();
    markers.syncPositions();
    if (composer || !active || mode !== "point") return;
    if (picked.length) drawPicked();
    else if (hoveredElement) {
      overlay.showHighlights([hoveredElement.getBoundingClientRect()], hoverLabel ?? undefined);
    }
  });
}


// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

/**
 * Poll for the Vue runtime until it shows up.
 *
 * The content script runs at `document_idle`, which on a server-rendered Nuxt app
 * is well before hydration finishes — especially against a dev server compiling
 * modules on demand. A single retry was not enough: real pages took longer than
 * that, and the toolbar sat there claiming "No Vue detected" while per-element
 * inspection was working perfectly. The schedule below backs off to ~15s total
 * and then stops, because by then the page genuinely has no Vue on it.
 */
const DETECT_DELAYS_MS = [0, 400, 1000, 2000, 4000, 8000];

let detecting = false;

async function ensureDetection(): Promise<void> {
  if (detecting || page?.detected) return;
  detecting = true;

  try {
    for (const delay of DETECT_DELAYS_MS) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));

      const result = await detectPage();
      if (!result) continue;

      // Render even on a negative result — that is what paints the "No Vue
      // detected" badge, and the version string can arrive on a later pass.
      page = result;
      render();
      if (result.detected) return;
    }
  } finally {
    detecting = false;
  }
}

async function boot(): Promise<void> {
  settings = await loadSettings();
  applyAppearance();
  annotations = await loadAnnotations();

  // Keyed like the annotations and loaded with them, because it answers the same
  // question: what did this page look like when you were last on it. Applied after the
  // first `render()` below rather than here: `createTopUi` never renders, so at this
  // point `data-collapsed` is still absent and the clamp would measure a fully expanded
  // pill for a user whose toolbar starts collapsed — moving a handle dropped at the
  // right edge some 300px inward on every reload.
  dockPosition = await loadDockPosition();

  onSettingsChanged((next) => {
    settings = next;
    applyAppearance();
    render();
  });

  if (settings.captureDiagnostics) {
    installActionTrail();
    onDiagnostics((diagnostics) => {
      diagnosticsCache = diagnostics;
      refreshCaptureSummary();
    });
    // Seed the mirror: anything recorded before this listener was attached (the
    // inspector starts at document_start, we start at document_idle) has already
    // been pushed and missed.
    diagnosticsCache = await fetchDiagnostics();
  }

  render();
  toolbar.applyPosition(dockPosition);
  await ensureDetection();
}

// -----------------------------------------------------------------------------
// Entry — which of the two shapes this document gets
// -----------------------------------------------------------------------------
//
// Everything above is the top frame's. A document inside an iframe runs the same
// bundle (`all_frames: true`) but must not build a second toolbar, must not answer
// the popup's status query, and must not own storage — so it takes the other branch
// and does nothing but highlight and capture. See `content/frames.ts`.

function installTopFrame(): void {
  createTopUi();

  // "Hide until restart" is a flag on this tab's session, so a tab that opened hidden
  // stays hidden across its own reloads and no other tab is touched. Applied before the
  // first paint would show anything, and left permanent for this session — there is no
  // in-tab control to bring it back, which is the whole point.
  if (isHiddenThisSession()) {
    ui.host.style.setProperty("display", "none", "important");
    return;
  }

  // A capture that happened inside an iframe arrives already translated into this
  // document's coordinate space, so from here it is an ordinary draft.
  onFrameDraft((draft) => {
    // Inspect mode off means the user is not annotating, so an iframe-originated draft
    // then can only be a forged one — the honest child path never captures while
    // inactive. Ignoring it keeps a hostile embedded frame from popping a composer on
    // a page the user was only reading.
    if (!active) return;
    composerTargets = [];
    // Screenshots are a top-frame flow; the honest child capture never sets this, so a
    // value here is fabricated. Drop it rather than let it into the report or storage.
    openComposer({ ...draft, screenshotData: undefined }, frameAnchor(draft), null);
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.kind === "toggle-inspect") {
      setActive(!active);
      sendResponse({ ok: true, active });
      return true;
    }
    if (message.kind === "get-status") {
      sendResponse({ ok: true, count: annotations.length, active });
      return true;
    }
    if (message.kind === "settings-changed") {
      void refreshSettings();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  async function refreshSettings(): Promise<void> {
    settings = await loadSettings();
    applyAppearance();
    render();
  }

  listen(
    document,
    "pointermove",
    (event) => {
      if (!active || composer || marqueeStart) return;
      if (mode !== "point") return;
      // Pointer capture retargets the toolbar drag's moves; it does not stop them
      // propagating, and `root.ts` deliberately lets `pointermove` through the host. So
      // during a fast drag the cursor outruns the pill, lands on page content, and this
      // would paint highlights across the page — one bridge RPC per element — and leave
      // `hoveredElement` on a page element for a following `C` to capture.
      if (toolbar.isDragging()) return;

      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !eligible(target)) {
        hoveredElement = null;
        hoverLabel = null;
        // Moving off an element must not erase a set that is still being built.
        if (picked.length) drawPicked();
        else overlay.hideHighlights();
        return;
      }
      if (target === hoveredElement) return;
      void updateHover(target);
    },
    { passive: true },
  );

  listen(
    document,
    "click",
    (event) => {
      // Ahead of the `composer` guard on purpose: a drag commits through the async
      // `beginAnnotation`, so the composer often does not exist yet when this fires,
      // and the modifier branch below would pick one more element on the way past.
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!active || composer) return;
      if (isOurUi(event.target as Element)) return;

      // In text mode a click is how you finish a selection, so let it through.
      if (mode === "text") return;

      event.preventDefault();
      event.stopPropagation();

      if (mode !== "point") return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !eligible(target)) return;

      // ⌘/Ctrl+click collects instead of annotating, so a note can cover three things
      // that no rectangle contains without taking half the page with them. A plain click
      // then means both "add this one" and "done".
      if (event.metaKey || event.ctrlKey) {
        togglePick(target);
        return;
      }
      if (picked.length) {
        commitPicked(target);
        return;
      }
      void beginAnnotation([target]);
    },
    { capture: true },
  );

  // Swallow the mousedown/mouseup pair too, so the page never sees a half-click.
  for (const type of ["mousedown", "mouseup"] as const) {
    listen(
      document,
      type,
      (event) => {
        if (!active || composer || mode === "text") return;
        if (isOurUi(event.target as Element)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      { capture: true },
    );
  }

  // --- text selection ----------------------------------------------------------

  listen(document, "mouseup", () => {
    if (!active || composer || mode !== "text") return;

    // Let the browser settle the selection before reading it.
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!selection || !text) return;

      const container = selection.getRangeAt(0).commonAncestorContainer;
      const element =
        container.nodeType === Node.ELEMENT_NODE
          ? (container as Element)
          : container.parentElement;

      if (!element || !eligible(element)) return;
      void beginAnnotation([element], text);
    }, 0);
  });

  listen(
    document,
    "pointerdown",
    (event) => {
      // Any new gesture cancels a suppression the last one armed but never spent.
      suppressNextClick = false;
      marqueePending = null;

      if (!active || composer) return;
      if (isOurUi(event.target as Element)) return;

      const anchor = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };

      // `area` is a drag from the first pixel — the mode says so. In `point` the drag
      // has to earn it, because the same press with the same modifier is also a pick.
      if (mode === "area") {
        beginMarquee(anchor);
        return;
      }
      if (mode === "point" && (event.metaKey || event.ctrlKey)) marqueePending = anchor;
    },
    { capture: true },
  );

  listen(
    document,
    "pointermove",
    (event) => {
      if (marqueePending && !promoteMarquee(event)) return;
      if (!marqueeStart) return;
      marqueePoint = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
      // One repaint per frame however fast the pointer reports.
      if (marqueeFrame) return;
      marqueeFrame = requestAnimationFrame(() => {
        marqueeFrame = 0;
        drawMarquee();
      });
    },
    { passive: true },
  );

  listen(
    document,
    "pointerup",
    () => {
      // A press that never moved far enough is not a drag, and the click that follows
      // is left alone to do what a modifier-click has always done: pick one element.
      marqueePending = null;
      if (!marqueeStart) return;

      // Flush a pending frame rather than dropping it, so what was annotated is
      // exactly what was highlighted when the button came up.
      if (marqueeFrame) {
        cancelAnimationFrame(marqueeFrame);
        marqueeFrame = 0;
        drawMarquee();
      }

      const hits = marqueeHits;
      resetMarquee();

      // The click that lands next belongs to this drag, not to the page.
      suppressNextClick = true;

      // Whatever ⌘/Ctrl+click collected joins the box, exactly as a plain click commits
      // the set together with the element it landed on. Dropping it would make the same
      // modifier mean two different things six pixels apart. In `area` mode `picked` is
      // always empty — switching mode clears it — so this costs that path nothing.
      const set = livePicks();
      const elements = [...set, ...hits.elements.filter((element) => !set.includes(element))];

      if (!elements.length) {
        overlay.hideHighlights();
        return;
      }

      picked = [];
      void beginAnnotation(elements.slice(0, MAX_MARQUEE_ELEMENTS));
    },
    { capture: true },
  );

  listen(document, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;

    if (keyboard.key === "Escape") {
      if (composer) {
        closeComposer();
        return;
      }
      // Escape closes the innermost thing first, so one press never takes two layers with
      // it. A tooltip opened by *focus* is the innermost of all — a hovered one is excluded
      // on purpose, see `isFocusTooltipVisible`. Asking here rather than in `tooltip.ts` is
      // the only way to know one was open at all: a handler on the trigger runs first and
      // would have hidden it before this chain could look.
      if (isFocusTooltipVisible()) {
        hideTooltip();
        return;
      }
      // Then the open card. Both of them: they are the overlay's dialogs, and a key that
      // closes the composer but leaves these two needing a second click is the kind of
      // inconsistency nobody reads a changelog to discover.
      if (settingsCard) {
        toggleSettings(false);
        return;
      }
      // A half-built pick set is the thing Escape is most likely to be aimed at, so it
      // goes before the panel and before leaving inspect mode entirely.
      if (picked.length) {
        clearPicked();
        if (hoveredElement?.isConnected) void updateHover(hoveredElement);
        return;
      }
      if (panelOpen) {
        togglePanel(false);
        return;
      }
      if (active) {
        setActive(false);
        return;
      }
    }

    if (composer) return;

    // Never hijack a key the user is typing into the page.
    const target = keyboard.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    if (keyboard.metaKey || keyboard.ctrlKey || keyboard.altKey) return;

    // Above the `active` guard on purpose: the pill covers the bottom-right corner
    // whether or not you are inspecting, so getting it out of the way must not require
    // turning inspect mode on first.
    if (keyboard.key === "h") {
      toggleCollapsed();
      return;
    }

    if (!active) return;

    switch (keyboard.key) {
      case "1":
        mode = "point";
        resetMarquee();
        clearPicked();
        overlay.hideAll();
        render();
        break;
      case "2":
        mode = "text";
        resetMarquee();
        clearPicked();
        overlay.hideAll();
        render();
        break;
      case "3":
        mode = "area";
        resetMarquee();
        clearPicked();
        overlay.hideAll();
        render();
        break;
      // Annotate what the pointer is already over, without clicking it.
      //
      // A click is the one thing that destroys the state worth annotating: a hover
      // menu, a tooltip, a `:hover` colour, an autocomplete list all disappear the
      // moment you press the mouse or move toward the toolbar. Freeze does not help —
      // it parks timers and animation frames, and those surfaces are driven by pointer
      // events, not by time.
      case "c":
      case "C":
      case "Enter":
        // With a set waiting, these keys finish it; the hovered element is already in it
        // if it was meant to be.
        if (picked.length) commitPicked();
        else captureHovered();
        break;
      case "f":
        void toggleFreeze();
        break;
      case "a":
        togglePanel();
        break;
      default:
        break;
    }
  });

  listen(window, "scroll", queueSync, { passive: true, capture: true });
  listen(
    window,
    "resize",
    () => {
      resizeQueued = true;
      queueSync();
    },
    { passive: true },
  );

  void boot();
}

if (isTopFrame()) {
  installTopFrame();
} else if (isFrameWorthInstrumenting()) {
  // The child needs settings for the detail level `captureDraft` works to, and
  // nothing else — no annotations, no diagnostics, no badge.
  installChildFrame(() => settings);
  void loadSettings().then((next) => {
    settings = next;
  });
}

