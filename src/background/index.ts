// =============================================================================
// Service worker
// =============================================================================
//
// Deliberately thin. It exists for the things a content script cannot do: photograph
// the tab, paint the toolbar badge, and — when the reviewer turns it on — hold the
// connection to the agent's MCP server, which has to outlive any one tab (`mcp.ts`).
// Everything else — cropping, saving, all the state — lives in the content script.
// =============================================================================

import { DEFAULT_ACCENT, accentTheme } from "../shared/accent";
import { installMcpBridge, mcpStatus, wakeMcpBridge } from "./mcp";
import { SETTINGS_KEY, type RuntimeMessage, type RuntimeResponse } from "../shared/protocol";
import type { Settings } from "../shared/types";

/**
 * The badge colour, read at paint time rather than cached.
 *
 * The badge is repainted on every count change, so there is nothing to invalidate and no
 * listener to keep in sync — and a service worker is torn down between events anyway, so
 * a cache would mostly be cold. `SETTINGS_KEY` comes from `shared/protocol` because the
 * worker may not import from `content/`; that is the whole reason the key lives there.
 */
async function badgeColor(): Promise<string> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
    return accentTheme(settings?.accentColor ?? DEFAULT_ACCENT).accent;
  } catch {
    return DEFAULT_ACCENT;
  }
}

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse: (response: RuntimeResponse) => void) => {
    switch (message.kind) {
      case "capture": {
        const windowId = sender.tab?.windowId;
        chrome.tabs
          .captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: "png" })
          .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
          .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
        return true; // keep the channel open for the async reply
      }

      case "badge": {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
          void chrome.action.setBadgeText({ tabId, text: message.count ? String(message.count) : "" });
          void badgeColor().then((color) => chrome.action.setBadgeBackgroundColor({ tabId, color }));
        }
        // Every page with the toolbar sends this as it renders, which makes it the wake-up
        // call for a bridge whose worker was asleep. A no-op while the switch is off.
        wakeMcpBridge();
        sendResponse({ ok: true });
        return false;
      }

      case "mcp-status": {
        sendResponse({ ok: true, mcp: mcpStatus() });
        return false;
      }

      default:
        return false;
    }
  },
);

installMcpBridge();

// -----------------------------------------------------------------------------
// Right-click menu
// -----------------------------------------------------------------------------
//
// The third way in, alongside the toolbar and Alt+Shift+S, and the one that matches how
// a debugging tool is normally reached: right-click the thing, pick it out of the menu.
// DevTools' own *Inspect* sets that expectation and this is the same gesture.
//
// `chrome.contextMenus` is the only API for it and it hands an extension **no element and
// no coordinates** — `OnClickData` carries the frame, the page URL, and any selection.
// So the element is recorded on the content side, where `contextmenu` fires before the
// menu opens, and these handlers only say "use it". See `docs/context-menu/context.md`.

const MENU_ANNOTATE = "senannotate:annotate";
const MENU_ANNOTATE_SELECTION = "senannotate:annotate-selection";
const MENU_TOGGLE = "senannotate:toggle";

/**
 * Menu entries survive a browser restart, so `removeAll` runs first.
 *
 * Without it, `onInstalled` firing for an update on top of entries the previous version
 * created fails with a duplicate-id error, and the entries left behind are the *old*
 * version's — pointing at a handler that may no longer exist.
 */
/**
 * Where the entries may appear: on page content, never on the extension's own icon.
 *
 * `"all"` is documented as *every* context except `launcher`, which includes `action` — the
 * right-click menu of our own toolbar button. Invoked from there no right-click on a page
 * happened at all, so the content script's record still holds whatever was right-clicked
 * minutes ago and the composer opens on it: the "annotates whatever was recorded last,
 * silently" failure this feature is built to avoid, reached through a menu nobody expected
 * these items in. Listing the contexts is the fix.
 */
const MENU_CONTEXTS: chrome.contextMenus.ContextType[] = [
  "page",
  "frame",
  "link",
  "image",
  "video",
  "audio",
  "editable",
  "selection",
];

/**
 * Pages an entry may appear on: the ones a content script actually runs on.
 *
 * Without this the entries are offered on `chrome://` pages, the Web Store and PDFs, where
 * `chrome.tabs.sendMessage` below rejects straight into the empty `catch` — the user picks
 * an item and nothing happens, with nothing said. Not offering the item is the honest
 * version of that.
 */
const MENU_URL_PATTERNS = ["http://*/*", "https://*/*", "file://*/*"];

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ANNOTATE,
      title: "Annotate this element",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: MENU_URL_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_ANNOTATE_SELECTION,
      // Chrome substitutes the selected text for `%s`, truncated for the menu.
      title: 'Annotate the text "%s"',
      contexts: ["selection"],
      documentUrlPatterns: MENU_URL_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_TOGGLE,
      title: "Toggle inspect mode",
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: MENU_URL_PATTERNS,
    });
  });
}

// `onInstalled` covers install and update. `onStartup` is deliberately *not* used to
// create them a second time — the entries persist, and recreating them per browser launch
// would be work for no change.
chrome.runtime.onInstalled.addListener(createMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id === undefined) return;

  // Match the id explicitly. Treating "not the toggle" as "annotate" would wire any entry
  // added later — or left behind by a test — to the composer.
  if (
    info.menuItemId !== MENU_ANNOTATE &&
    info.menuItemId !== MENU_ANNOTATE_SELECTION &&
    info.menuItemId !== MENU_TOGGLE
  ) {
    return;
  }

  const message: RuntimeMessage =
    info.menuItemId === MENU_TOGGLE
      ? { kind: "toggle-inspect" }
      : {
          kind: "annotate-context",
          selection: info.menuItemId === MENU_ANNOTATE_SELECTION,
          // Chrome's own reading of the selection, which the content script cannot always
          // reproduce: text selected inside an `<input>` or `<textarea>` is not part of the
          // document selection, so `window.getSelection()` returns "" for it — while Chrome
          // populates `selectionText` and therefore *offers* the item. Passing it is what
          // stops the quote being silently dropped from the annotation the user asked for.
          selectionText: info.selectionText,
          // A click inside an iframe reports a non-zero frameId. The composer belongs to
          // the top frame, so the message still goes there and this flag lets it say so
          // rather than annotate whatever the top frame last saw — which would be the
          // wrong element, silently.
          inFrame: (info.frameId ?? 0) !== 0,
        };

  try {
    // Always frame 0: the toolbar, the composer and the annotation store are the top
    // frame's, and no other frame can answer for them.
    await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch {
    // `documentUrlPatterns` keeps the entries off the pages with no content script at all,
    // so what is left here is the narrow case it cannot express: a tab where
    // `installTopFrame()` bailed out early because the user hid the toolbar for the
    // session. Nothing to report — the menu has already closed, and there is no UI of ours
    // on that page to report it in.
  }
});

// -----------------------------------------------------------------------------
// Keyboard command
// -----------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-inspect") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { kind: "toggle-inspect" } satisfies RuntimeMessage);
  } catch {
    // No content script on this tab — a chrome:// page, the web store, or a PDF.
  }
});
