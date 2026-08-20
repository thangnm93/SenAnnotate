// =============================================================================
// Service worker
// =============================================================================
//
// Deliberately thin. It exists for the two things a content script cannot do:
// photograph the tab, and paint the toolbar badge. Everything else — cropping,
// saving, all the state — lives in the content script.
// =============================================================================

import { DEFAULT_ACCENT, accentTheme } from "../shared/accent";
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
        sendResponse({ ok: true });
        return false;
      }

      default:
        return false;
    }
  },
);

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
function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ANNOTATE,
      title: "Annotate this element",
      // `page` and `frame` are not listed: the element under the pointer is what this
      // annotates, and every context below is a click on something.
      contexts: ["all"],
    });
    chrome.contextMenus.create({
      id: MENU_ANNOTATE_SELECTION,
      // Chrome substitutes the selected text for `%s`, truncated for the menu.
      title: 'Annotate the text "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_TOGGLE,
      title: "Toggle inspect mode",
      contexts: ["all"],
    });
  });
}

// `onInstalled` covers install and update. `onStartup` is deliberately *not* used to
// create them a second time — the entries persist, and recreating them per browser launch
// would be work for no change.
chrome.runtime.onInstalled.addListener(createMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id === undefined) return;

  const message: RuntimeMessage =
    info.menuItemId === MENU_TOGGLE
      ? { kind: "toggle-inspect" }
      : {
          kind: "annotate-context",
          selection: info.menuItemId === MENU_ANNOTATE_SELECTION,
          // A click inside an iframe reports a non-zero frameId. The composer belongs to
          // the top frame, so the message still goes there and this flag lets it say so
          // rather than annotate whatever the top frame last saw — which would be the
          // wrong element, silently.
          inFrame: (info.frameId ?? 0) !== 0,
        };

  if (message.kind !== "toggle-inspect" && message.kind !== "annotate-context") return;

  try {
    // Always frame 0: the toolbar, the composer and the annotation store are the top
    // frame's, and no other frame can answer for them.
    await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch {
    // No content script here — a chrome:// page, the Web Store, a PDF, or a site the
    // user's own domain rules excluded. Nothing to do and nothing to report: the menu
    // item is the only affordance and it has already closed.
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
