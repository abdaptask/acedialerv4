// ACE Dialer — background service worker.
//
// Two jobs:
//   1. Register the page scanner ONLY on domains the user or IT has granted.
//   2. Hand clicked numbers to a dialer — an open web dialer tab, else the
//      desktop app or a new web dialer tab (route.ts owns the decision).
//   3. Keep the toolbar follow-ups count fresh (badge.ts).
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

import { BADGE_ALARM, refreshBadge } from './badge';
import { isBuiltIn } from './sites';
import {
  DIALER_MATCH,
  effectiveOpenIn,
  fallbackRoute,
  pickDialerTab,
  type Route,
  type Target,
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
let syncing: Promise<void> = Promise.resolve();
function syncContentScripts(): Promise<void> {
  // One at a time. Adding a site fires permissions.onAdded AND
  // storage.onChanged within milliseconds; two overlapping runs both
  // unregister, then both register the same id, the second throws "Duplicate
  // script ID" (swallowed below), and the scanner is left matching whichever
  // run read storage first — the first store install ended up scanning www1
  // only, while JobDiva serves the candidate record from www2.
  syncing = syncing.then(doSync, doSync);
  return syncing;
}

async function doSync(): Promise<void> {
  // Built-in sites are injected by the manifest; registering them again
  // would run a second scanner in the same page.
  const wanted = (await getAllowedOrigins()).filter((o) => !isBuiltIn(o));
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
        // JobDiva renders the candidate record inside frames on the same host;
        // a top-frame-only scanner ran on a page holding no numbers at all.
        // Frames on a granted host only: matchOriginAsFallback stays off, so
        // the about:blank frames (rich-text editors among them) are never
        // injected, and neither is a third-party ad frame.
        allFrames: true,
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

chrome.runtime.onMessage.addListener(
  (msg: { type?: string; to?: string; action?: string }, sender, sendResponse) => {
    if (!msg?.to) return;
    if (msg.type === 'ace-dial') {
      // From the page scanner: text off someone else's page.
      void deliver({ to: msg.to, action: 'call', trusted: false });
    } else if (msg.type === 'ace-open' && fromOwnPanel(sender)) {
      // From the follow-ups panel: a number out of our own database.
      void deliver({ to: msg.to, action: msg.action === 'sms' ? 'sms' : 'call', trusted: true });
    } else {
      return;
    }
    sendResponse({ ok: true });
    return true;
  },
);

/**
 * Only our own panel page may send a TRUSTED number. Content scripts share
 * our extension id, so `sender.id` proves nothing; a content script's
 * sender.url is the page it runs in, never a chrome-extension:// URL. Without
 * this check, any page we scan could inject a number that skips the strict
 * parser.
 */
function fromOwnPanel(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL('panel.html'));
}

async function deliver(t: Target): Promise<void> {
  if (await handToOpenDialer(t)) return;
  const [managed, { openIn }] = await Promise.all([getManaged(), chrome.storage.sync.get('openIn')]);
  open(fallbackRoute(t, effectiveOpenIn(managed.openIn, openIn).value));
}

/**
 * Give the number to a web dialer tab that's already open, without reloading
 * it (dialerBridge.ts explains why a reload is off the table). True only when
 * the page acknowledged — anything else falls through to the preference, so a
 * click is never silently dropped.
 */
async function handToOpenDialer(t: Target): Promise<boolean> {
  const tabs = await chrome.tabs.query({ url: DIALER_MATCH }).catch(() => []);
  const tab = pickDialerTab(tabs);
  if (!tab?.id) return false;

  let ok = await sendToBridge(tab.id, t);
  if (ok === null) {
    // No bridge in the tab: it was open before the extension was installed or
    // updated, so the static content script never ran there. Inject and retry.
    const injected = await chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['dialerBridge.js'] })
      .then(() => true, () => false);
    if (injected) ok = await sendToBridge(tab.id, t);
  }
  if (!ok) return false;

  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return true;
}

/** true = delivered, false = the page didn't ack, null = no bridge listening. */
async function sendToBridge(tabId: number, t: Target): Promise<boolean | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: 'ace-dial',
      to: t.to,
      action: t.action,
      src: t.trusted ? undefined : 'selection',
    })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return null;
  }
}

function open(route: Route): void {
  if (route.kind === 'desktop') void launchProtocol(route.url);
  // A new tab has empty sessionStorage, so this lands on sign-in first; the
  // route guard keeps the URL and comes back to it. That's why an OPEN tab
  // is tried before this.
  else chrome.tabs.create({ url: route.url, active: true });
}

const LAUNCH_KEY = 'launchTabs';
const LEFT_KEY = 'launchFocusLeft';
const LAUNCH_ALARM = 'ace-launch-cleanup';

/**
 * Open a protocol URL without disturbing what the user is looking at.
 *
 * Deliberately NOT a navigation of the user's tab: when the app isn't
 * installed that can leave their half-filled ATS form on an error page. And
 * NOT a hidden background tab either — that was the first version, and
 * Chrome's "Open ACE Dialer?" prompt appeared in the hidden tab, which closed
 * after 1.5s with the question unanswered, so nothing ever opened. launch.html
 * is a visible tab of our own that the prompt can sit on; the listeners above
 * close it, and openerTabId sends the user back to the page they came from.
 */
async function launchProtocol(url: string): Promise<void> {
  const [opener] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const created = await chrome.tabs
    .create({
      url: chrome.runtime.getURL(`launch.html?u=${encodeURIComponent(url)}`),
      active: true,
      openerTabId: opener?.id,
    })
    .catch(() => undefined);
  if (!created?.id) return;
  await chrome.storage.session.remove(LEFT_KEY);
  await chrome.storage.session.set({ [LAUNCH_KEY]: [...(await launchTabs()), created.id] });
  // Backstop for a tab nothing else closed (prompt ignored, app not installed).
  void chrome.alarms.create(LAUNCH_ALARM, { delayInMinutes: 2 });
}

// The worker can be suspended between a launch and the event that ends it,
// so the open launch tabs live in session storage, not a module variable.
async function launchTabs(): Promise<number[]> {
  const { [LAUNCH_KEY]: ids } = await chrome.storage.session.get(LAUNCH_KEY);
  return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === 'number') : [];
}

/** Removing only; onRemoved owns the list, so a launch recorded while this
 *  runs can't be written over. */
async function closeLaunchTabs(keep?: number): Promise<void> {
  const closing = (await launchTabs()).filter((id) => id !== keep);
  if (closing.length) await chrome.tabs.remove(closing).catch(() => undefined);
}

// Close once focus comes BACK to Chrome, never when it leaves. On Windows the
// "Open ACE Dialer?" prompt is its own native window, so focus leaving Chrome
// can be the prompt itself appearing — closing then would repeat the original
// bug. Focus returning means the prompt was answered (or the app opened and
// the user has come back), and either way the tab has done its job.
chrome.windows.onFocusChanged.addListener(async (w) => {
  if (w === chrome.windows.WINDOW_ID_NONE) {
    if ((await launchTabs()).length) await chrome.storage.session.set({ [LEFT_KEY]: true });
    return;
  }
  const { [LEFT_KEY]: left } = await chrome.storage.session.get(LEFT_KEY);
  if (!left) return;
  await chrome.storage.session.remove(LEFT_KEY);
  await closeLaunchTabs();
});
// The user moved on (Cancel, then back to their page) — tidy up behind them.
chrome.tabs.onActivated.addListener(({ tabId }) => void closeLaunchTabs(tabId));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const ids = await launchTabs();
  if (ids.includes(tabId)) await chrome.storage.session.set({ [LAUNCH_KEY]: ids.filter((id) => id !== tabId) });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === LAUNCH_ALARM) void closeLaunchTabs();
});

// ── Toolbar: the icon opens the follow-ups panel; its count is the badge ──

function setUpToolbar(): void {
  // Browsers without the side panel API get the same page in a tab (below).
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 2, delayInMinutes: 0.1 });
}
chrome.runtime.onInstalled.addListener(setUpToolbar);
chrome.runtime.onStartup.addListener(setUpToolbar);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === BADGE_ALARM) void refreshBadge();
});
// Only fires when the side panel didn't claim the click.
chrome.action.onClicked.addListener(() => {
  if (!chrome.sidePanel) void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
});
