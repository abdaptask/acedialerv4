// ACE Dialer — Click to Call (MV3 service worker)
//
// Adds "Call with ACE Dialer" to the right-click menu whenever text is
// selected, and hands that text to the desktop app via the ace-dialer://
// protocol the app already registers.
//
// ── Why the permissions are this small ─────────────────────────────────
// The manifest requests "contextMenus" and NOTHING else. In particular there
// is no content script and no host permission. That matters here more than in
// a normal extension: our users work all day inside an ATS and a CRM full of
// candidate PII, and a content script with <all_urls> would mean this
// extension could read every one of those pages. It can't. Chrome hands us
// the selected text in the click event itself (info.selectionText), which is
// all we need, and the browser only provides it for the selection the user
// explicitly right-clicked.
//
// The selected text never leaves the machine: it goes into a local
// ace-dialer:// URL. There is no network call anywhere in this extension.
//
// ── Why validation happens in the app, not here ────────────────────────
// The dialer already owns parseSelectedNumber() (libphonenumber-based), and a
// second, weaker copy here would drift and disagree. So we do the cheapest
// possible sanity check — is there anything that could plausibly be a number
// — and let the app render a proper error for anything else. src=selection
// tells the app this came from highlighted text so it validates strictly.

const MENU_ID = 'ace-dialer-call-selection';
/** Matches the app's own cap; keeps a whole-page selection out of the URL. */
const MAX_SELECTION_CHARS = 200;

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Call "%s" with ACE Dialer',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
// MV3 service workers are torn down when idle; rebuild the menu on wake so it
// doesn't silently disappear after the worker is recycled.
chrome.runtime.onStartup.addListener(createMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const selection = (info.selectionText || '').trim().slice(0, MAX_SELECTION_CHARS);
  if (!selection) return;

  // Cheap pre-filter only: at least a few digits. Anything subtler is the
  // app's job — it has libphonenumber and can explain WHY something failed.
  const digits = (selection.match(/\d/g) || []).length;
  if (digits < 7) {
    notify('That selection doesn’t look like a phone number.');
    return;
  }

  const url = `ace-dialer://call?to=${encodeURIComponent(selection)}&src=selection`;
  launchProtocol(url);
});

/**
 * Hand a protocol URL to the OS.
 *
 * Deliberately NOT chrome.tabs.update() on the active tab. That works when
 * the desktop app is installed — Chrome shows its "Open ACE Dialer?" prompt
 * and leaves the page alone — but when it ISN'T installed, Chrome navigates
 * the tab to an error page and the user loses whatever they were looking at.
 * Destroying a recruiter's half-filled ATS form because they right-clicked a
 * number is a far worse outcome than the feature simply not working.
 *
 * So: open a background tab (active:false, no focus stolen), let it trigger
 * the handler, then close it. Worst case the user sees a tab flicker.
 */
function launchProtocol(url) {
  chrome.tabs.create({ url, active: false }, (created) => {
    if (chrome.runtime.lastError || !created?.id) {
      notify('Could not open ACE Dialer.');
      return;
    }
    // Long enough for the OS handoff, short enough not to leave litter.
    setTimeout(() => {
      chrome.tabs.remove(created.id, () => void chrome.runtime.lastError);
    }, 1500);
  });
}

/** Best-effort user feedback. `notifications` is not in permissions — if it's
 *  unavailable we simply log, rather than requesting a broader permission
 *  just to show a toast. */
function notify(message) {
  if (chrome.notifications?.create) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'ACE Dialer',
      message,
    });
  } else {
    console.info('[ace-dialer]', message);
  }
}
