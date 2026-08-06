// ACE Dialer — background service worker.
//
// Two jobs:
//   1. Register the page scanner ONLY on domains the user or IT has granted.
//   2. Hand clicked numbers to the desktop app.
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

const SCRIPT_ID_PREFIX = 'ace-scanner-';
const STORAGE_KEY = 'allowedOrigins';

async function getAllowedOrigins(): Promise<string[]> {
  const { [STORAGE_KEY]: list } = await chrome.storage.sync.get(STORAGE_KEY);
  return Array.isArray(list) ? (list as string[]) : [];
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
  if (area === 'sync' && STORAGE_KEY in changes) void syncContentScripts();
});

// ── Handing a number to the desktop app ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type?: string; to?: string }, _sender, sendResponse) => {
  if (msg?.type !== 'ace-dial' || !msg.to) return;
  launchProtocol(`ace-dialer://call?to=${encodeURIComponent(msg.to.slice(0, 200))}&src=selection`);
  sendResponse({ ok: true });
  return true;
});

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

export {};
