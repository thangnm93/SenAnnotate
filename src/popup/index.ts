// =============================================================================
// Extension popup — status, pages, and the archive
// =============================================================================
//
// Settings used to live here and now live in the toolbar's settings card, next to the
// page they describe. What is left is the work that is genuinely *across* pages and has
// no home inside any one of them: which pages hold notes, the session report, and
// export/import.
//
// The popup still reads settings — it paints itself from `theme` and `accentColor` —
// and writes exactly one group of them: the domain rules.
//
// That is a deliberate exception to "one owner, one writer", and the reason is the whole
// point of the feature. The settings card lives *inside the overlay*, and the overlay is
// precisely what a blocked domain does not get. A setting that can switch the UI off
// cannot be edited from inside that UI — you would have to visit an allowed site to give
// yourself back the site you excluded. The popup is the only surface that opens on every
// page, including the ones where nothing was injected at all.
// =============================================================================

import { accentTheme } from "../shared/accent";
import { clearAllPages, exportAll, importAll } from "../shared/archive";
import {
  DOMAIN_RULE_OPTIONS,
  evaluateHost,
  parseRuleList,
} from "../shared/domain-rules";
import { generateSessionOutput } from "../shared/output";
import { SETTINGS_KEY, type RuntimeMessage, type RuntimeResponse } from "../shared/protocol";
import { DEFAULT_SETTINGS, type Annotation, type Settings } from "../shared/types";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusBox = $("status");
const statusText = $("status-text");
const statusCount = $("status-count");
const toggleButton = $<HTMLButtonElement>("toggle");
const clearButton = $<HTMLButtonElement>("clear");
const pagesBox = $("pages");
const copySessionButton = $<HTMLButtonElement>("copy-session");
const exportButton = $<HTMLButtonElement>("export");
const importButton = $<HTMLButtonElement>("import");
const importInput = $<HTMLInputElement>("import-file");
const archiveHint = $("archive-hint");
const ruleModeSelect = $<HTMLSelectElement>("rule-mode");
const rulesInput = $<HTMLTextAreaElement>("rules");
const verdictBox = $("verdict");
const verdictText = $("verdict-text");
/** Preset colour → its button, so the current one can be marked without a re-render. */

let settings: Settings = { ...DEFAULT_SETTINGS };



// -----------------------------------------------------------------------------
// Settings — read only
// -----------------------------------------------------------------------------

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    settings = { ...DEFAULT_SETTINGS, ...((stored[SETTINGS_KEY] as Partial<Settings>) ?? {}) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }

  applyAccent();
  paintRules();
  await refreshVerdict();
}

// -----------------------------------------------------------------------------
// Accent
// -----------------------------------------------------------------------------

/**
 * Recolour the popup itself.
 *
 * The popup is its own document with its own `--accent`, so it inherits nothing from the
 * overlay. It no longer *picks* the colour — the settings card does — but it still has
 * to wear it, or the accent you chose would stop at the edge of the page.
 */
function applyAccent(): void {
  const { accent, ink } = accentTheme(settings.accentColor);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-ink", ink);
}

// -----------------------------------------------------------------------------
// Active tab
// -----------------------------------------------------------------------------

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/**
 * The active tab's hostname, or `null` when there is nothing a rule could match.
 *
 * Read from the tab's URL rather than asked of the content script, because the whole
 * situation this has to describe is the one where **no content script is running**.
 */
async function activeTabHost(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).hostname || null;
  } catch {
    return null;
  }
}

async function askTab(message: RuntimeMessage): Promise<RuntimeResponse | null> {
  const tabId = await activeTabId();
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as RuntimeResponse;
  } catch {
    // No content script here — a chrome:// page, the Web Store, or a PDF viewer.
    return null;
  }
}

async function refreshStatus(): Promise<void> {
  const response = await askTab({ kind: "get-status" });

  if (!response?.ok) {
    statusBox.dataset.detected = "false";
    statusCount.textContent = "";
    toggleButton.disabled = true;

    // "Not available" is also what a chrome:// page gets, and the two need telling apart:
    // one is the browser's rule and permanent, the other is the user's own and one line
    // away from being changed. The Sites section below says which pattern did it.
    const host = await activeTabHost();
    const excluded =
      host !== null &&
      settings.domainRuleMode !== "off" &&
      !evaluateHost(host, settings.domainRuleMode, settings.domainRules).enabled;

    statusText.textContent = excluded ? "Off on this site by your rules" : "Not available on this page";
    return;
  }

  statusBox.dataset.detected = "true";
  statusText.textContent = response.active ? "Inspect mode is on" : "Ready";
  statusCount.textContent = response.count ? `${response.count} note${response.count === 1 ? "" : "s"}` : "";
  toggleButton.disabled = false;
  toggleButton.textContent = response.active ? "Stop inspecting" : "Start inspecting";
}

// -----------------------------------------------------------------------------
// Domain rules — the one group of settings this document owns
// -----------------------------------------------------------------------------

function paintRules(): void {
  if (!ruleModeSelect.options.length) {
    for (const { value, label, hint } of DOMAIN_RULE_OPTIONS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.title = hint;
      ruleModeSelect.append(option);
    }
  }
  ruleModeSelect.value = settings.domainRuleMode;
  // The list is meaningless in `off` mode, and a live-looking field that changes nothing
  // is worse than a disabled one. The contents are kept, so switching back restores them.
  rulesInput.disabled = settings.domainRuleMode === "off";
  // Only rewritten when it does not have focus: doing it mid-typing would move the caret
  // to the end on every keystroke.
  if (document.activeElement !== rulesInput) rulesInput.value = settings.domainRules.join("\n");
}

/**
 * Say whether *this* tab is covered, and by which pattern.
 *
 * The verdict is computed here rather than read off the content script for the same
 * reason `activeTabHost` exists: on a page the rules excluded there is nothing to ask.
 */
async function refreshVerdict(): Promise<void> {
  const host = await activeTabHost();

  if (settings.domainRuleMode === "off") {
    verdictBox.dataset.state = "on";
    verdictText.textContent = "Running everywhere the browser allows.";
    return;
  }

  if (!host) {
    verdictBox.dataset.state = settings.domainRuleMode === "allowlist" ? "off" : "on";
    verdictText.textContent =
      settings.domainRuleMode === "allowlist"
        ? "This page has no hostname, so no pattern but * can cover it."
        : "This page has no hostname, so no pattern excludes it.";
    return;
  }

  const { enabled, rule } = evaluateHost(host, settings.domainRuleMode, settings.domainRules);
  verdictBox.dataset.state = enabled ? "on" : "off";

  const because = rule ? `matches ${rule}` : "matches nothing in the list";
  verdictText.replaceChildren();
  const hostSpan = document.createElement("span");
  hostSpan.className = "verdict__host";
  hostSpan.textContent = host;
  verdictText.append(
    hostSpan,
    document.createTextNode(` ${because} — SenAnnotate is ${enabled ? "on" : "off"} here.`),
  );
}

async function saveRules(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  try {
    // Read-modify-write on the whole object, because the settings card owns every other
    // field and may have changed one since this popup opened.
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    const current = (stored[SETTINGS_KEY] as Partial<Settings>) ?? {};
    await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...current, ...patch } });
  } catch {
    // Over quota, or storage disabled. The verdict below would then describe a rule that
    // was not saved, so it is repainted from `settings` either way and a reload will show
    // the truth.
  }
  paintRules();
  await refreshVerdict();
}

ruleModeSelect.addEventListener("change", () => {
  void saveRules({ domainRuleMode: ruleModeSelect.value as Settings["domainRuleMode"] });
});

// On `change` rather than on every keystroke: a rule list is edited in bursts, and saving
// per character would write to `sync` — which is quota'd per minute — dozens of times.
rulesInput.addEventListener("change", () => {
  void saveRules({ domainRules: parseRuleList(rulesInput.value) });
});

toggleButton.addEventListener("click", async () => {
  await askTab({ kind: "toggle-inspect" });
  await refreshStatus();
  window.close();
});

// -----------------------------------------------------------------------------
// The session — every page that holds notes
// -----------------------------------------------------------------------------
//
// A tester walking a checkout flow annotates four screens, and until now had to
// visit each one again to copy four reports and paste them together by hand. The
// data was always here; only the button was missing.

let sessionPages: { page: string; annotations: Annotation[] }[] = [];

async function refreshPages(): Promise<void> {
  try {
    sessionPages = (await exportAll()).pages;
  } catch {
    sessionPages = [];
  }

  pagesBox.replaceChildren();
  copySessionButton.disabled = sessionPages.length === 0;

  if (!sessionPages.length) {
    const empty = document.createElement("div");
    empty.className = "page-row page-row__origin";
    empty.textContent = "No annotations stored yet.";
    pagesBox.append(empty);
    return;
  }

  for (const entry of sessionPages) {
    // The stored key is `https://host/path`. Split it so the path — the part that
    // identifies the screen — gets the width, and the origin stays legible but small.
    let origin = "";
    let path = entry.page;
    try {
      const url = new URL(entry.page);
      origin = url.host;
      path = url.pathname;
    } catch {
      // A key from an exotic scheme; show it whole rather than guessing.
    }

    const row = document.createElement("div");
    row.className = "page-row";

    const label = document.createElement("span");
    label.className = "page-row__path";
    label.textContent = path;
    label.title = entry.page;

    const host = document.createElement("span");
    host.className = "page-row__origin";
    host.textContent = origin;

    const count = document.createElement("span");
    count.className = "page-row__count";
    count.textContent = String(entry.annotations.length);

    row.append(label, host, count);
    pagesBox.append(row);
  }
}

copySessionButton.addEventListener("click", async () => {
  const markdown = generateSessionOutput(sessionPages, settings.detailLevel);
  if (!markdown) return;

  try {
    await navigator.clipboard.writeText(markdown);
    const notes = sessionPages.reduce((total, entry) => total + entry.annotations.length, 0);
    copySessionButton.textContent = `Copied ${notes} note${notes === 1 ? "" : "s"}`;
  } catch {
    copySessionButton.textContent = "Copy failed";
  }
});

// -----------------------------------------------------------------------------
// Export / import
// -----------------------------------------------------------------------------
//
// Reported in the hint line rather than an alert: the popup closes the moment focus
// leaves it, and an alert would take the focus with it.

function reportArchive(message: string, tone: "ok" | "error" = "ok"): void {
  archiveHint.textContent = message;
  archiveHint.dataset.tone = tone;
}

exportButton.addEventListener("click", async () => {
  try {
    const file = await exportAll();
    if (!file.pages.length) {
      reportArchive("Nothing to export yet.", "error");
      return;
    }

    // Blob + `<a download>`, the same permission-free route the screenshot takes.
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `senannotate-${file.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    const notes = file.pages.reduce((total, entry) => total + entry.annotations.length, 0);
    reportArchive(`Exported ${notes} note${notes === 1 ? "" : "s"} from ${file.pages.length} page${file.pages.length === 1 ? "" : "s"}.`);
  } catch {
    reportArchive("Could not export.", "error");
  }
});

importButton.addEventListener("click", () => importInput.click());

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;

  try {
    const summary = await importAll(JSON.parse(await file.text()));
    if (!summary) {
      reportArchive("That is not a SenAnnotate export.", "error");
      return;
    }
    const skipped = summary.skipped ? `, ${summary.skipped} skipped` : "";
    reportArchive(
      `Imported ${summary.annotations} note${summary.annotations === 1 ? "" : "s"} across ${summary.pages} page${summary.pages === 1 ? "" : "s"}${skipped}.`,
    );
  } catch {
    reportArchive("Could not read that file.", "error");
  } finally {
    // Same file twice in a row would not fire `change` without this.
    importInput.value = "";
    await refreshStatus();
  }
});

clearButton.addEventListener("click", async () => {
  const cleared = await clearAllPages();
  clearButton.textContent = `Cleared ${cleared} page${cleared === 1 ? "" : "s"}`;
  await refreshPages();
  await refreshStatus();
});

// `refreshStatus` reads the domain rules to explain a page it could not reach, so it runs
// after the settings are in rather than racing them.
void loadSettings().then(() => refreshStatus());
void refreshPages();
