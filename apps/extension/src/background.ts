// ACE Dialer — background service worker.
//
// Two jobs:
//   1. Register the page scanner ONLY on domains the user or IT has granted.
//   2. Hand clicked numbers to a dialer — an open web dialer tab, else the
//      desktop app or a new web dialer tab (route.ts owns the decision).
//
// ── Why there is no <all_urls> content script ──────────────────────────
// Auto-detecting numbers means reading page text, and there is no way around
// that. But it does NOT follow that the extension needs to read *every* page.
// Our users work all day in systems full of candidate PII, so this uses
// `optional_host_permissions` plus dynamic registration: on a fresh install
// the extension has access to nothing at all, and each domain is granted
// explicitly on the options page (or pre-granted by Intune policy). Chrome
// shows the real permission prompt at that moment, so the grant is visible
// and revocable per site.
//
// The practical difference: if this extension were ever compromised, blanket
// access would expose every page a recruiter visits; this exposes only the
// ATS domains someone deliberately turned on.

import {
  DIALER_MATCH,
  effectiveOpenIn,
  fallbackRoute,
  pickDialerTab,
  type Route,
} from './route';

const SCRIPT_ID_PREFIX = 'ace-scanner-';
const STORAGE_KEY = 'allowedOrigins';

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Policy (Intune `3rdparty/extensions/<id>`) is read-only and may be absent;
 *  storage.managed rejects outright on an unmanaged install. */
async function getManaged(): Promise<Record<string, unknown>> {
  try {
    return await chrome.storage.managed.get(null);
  } catch {
    return {};
  }
}

/** User-added sites plus IT-set ones. A policy can NAME a site but cannot
 *  grant host access — Chrome still wants one click — so syncContentScripts
 *  only registers the subset that is actually granted. */
async function getAllowedOrigins(): Promise<string[]> {
  const [{ [STORAGE_KEY]: mine }, managed] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEY),
    getManaged(),
  ]);
  return [...new Set([...strings(managed[STORAGE_KEY]), ...strings(mine)])];
}

/**
 * Reconcile registered content scripts with (a) what the user asked for and
 * (b) what Chrome has actually granted. Both matter: a user can revoke a host
 * permission from chrome://extensions at any time, and registering a script
 * for a revoked origin throws.
 */
async function syncContentScripts(): Promise<void> {
  const wanted = await getAllowedOrigins();
  const granted: string[] = [];
  for (const origin of wanted) {
    try {
      if (await chrome.permissions.contains({ origins: [origin] })) granted.push(origin);
    } catch {
      /* malformed pattern in storage — skip it */
    }
  }

  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const existingIds = existing.map((s) => s.id).filter((id) => id.startsWith(SCRIPT_ID_PREFIX));
  if (existingIds.length) {
    await chrome.scripting.unregisterContentScripts({ ids: existingIds }).catch(() => undefined);
  }

  if (granted.length === 0) return;

  await chrome.scripting
    .registerContentScripts([
      {
        id: `${SCRIPT_ID_PREFIX}main`,
        matches: granted,
        js: ['content.js'],
        css: ['content.css'],
        runAt: 'document_idle',
        allFrames: false, // iframes are usually ads/widgets; scanning them is cost without benefit
      },
    ])
    .catch((e) => console.warn('[ace-dialer] could not register scanner', e));
}

chrome.runtime.onInstalled.addListener(() => void syncContentScripts());
chrome.runtime.onStartup.addListener(() => void syncContentScripts());
chrome.permissions.onAdded.addListener(() => void syncContentScripts());
chrome.permissions.onRemoved.addListener(() => void syncContentScripts());
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' || area === 'managed') && STORAGE_KEY in changes) void syncContentScripts();
});

// ── Handing a number to a dialer ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type?: string; to?: string }, _sender, sendResponse) => {
  if (msg?.type !== 'ace-dial' || !msg.to) return;
  void deliver(msg.to);
  sendResponse({ ok: true });
  return true;
});

async function deliver(to: string): Promise<void> {
  if (await handToOpenDialer(to)) return;
  const [managed, { openIn }] = await Promise.all([getManaged(), chrome.storage.sync.get('openIn')]);
  open(fallbackRoute(to, effectiveOpenIn(managed.openIn, openIn).value));
}

/**
 * Give the number to a web dialer tab that's already open, without reloading
 * it (dialerBridge.ts explains why a reload is off the table). True only when
 * the page acknowledged — anything else falls through to the preference, so a
 * click is never silently dropped.
 */
async function handToOpenDialer(to: string): Promise<boolean> {
  const tabs = await chrome.tabs.query({ url: DIALER_MATCH }).catch(() => []);
  const tab = pickDialerTab(tabs);
  if (!tab?.id) return false;

  let ok = await sendToBridge(tab.id, to);
  if (ok === null) {
    // No bridge in the tab: it was open before the extension was installed or
    // updated, so the static content script never ran there. Inject and retry.
    const injected = await chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['dialerBridge.js'] })
      .then(() => true, () => false);
    if (injected) ok = await sendToBridge(tab.id, to);
  }
  if (!ok) return false;

  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return true;
}

/** true = delivered, false = the page didn't ack, null = no bridge listening. */
async function sendToBridge(tabId: number, to: string): Promise<boolean | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: 'ace-dial', to })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return null;
  }
}

function open(route: Route): void {
  if (route.kind === 'desktop') launchProtocol(route.url);
  // A new tab has empty sessionStorage, so this lands on sign-in first; the
  // route guard keeps the URL and comes back to it. That's why an OPEN tab
  // is tried before this.
  else chrome.tabs.create({ url: route.url, active: true });
}

/**
 * Open a protocol URL without disturbing what the user is looking at.
 *
 * Deliberately NOT a navigation of the active tab. That works when the app is
 * installed, but when it isn't, Chrome navigates the tab to an error page and
 * the user loses their work — destroying a half-filled ATS form because
 * someone clicked a phone number is far worse than the feature not working.
 * A background tab, closed right after, keeps the failure mode invisible.
 */
function launchProtocol(url: string): void {
  chrome.tabs.create({ url, active: false }, (created) => {
    if (chrome.runtime.lastError || !created?.id) return;
    setTimeout(() => {
      chrome.tabs.remove(created.id!, () => void chrome.runtime.lastError);
    }, 1500);
  });
}

// Clicking the toolbar icon opens the allowlist — the only place with UI.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

