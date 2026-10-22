// The page that hands a number to the desktop app. background.ts opens it as
// a short-lived ACTIVE tab and closes it once Chrome loses focus to the app.
//
// Why a visible tab: Chrome asks "Open ACE Dialer?" before launching any
// external protocol, and that prompt belongs to the tab that navigated. The
// first version launched from a background tab and closed it after 1.5s, so
// the prompt was never on screen and nothing ever opened (Oct 22 2026, the
// first store install). Navigating THIS page rather than the user's own tab
// keeps their ATS page untouched when the app isn't installed.

const PROTOCOL = 'ace-dialer://';

const url = new URLSearchParams(location.search).get('u') ?? '';
// Only ever our own scheme — this page must not become a launcher for
// whatever a caller puts in the query string.
const ok = url.startsWith(PROTOCOL);

const launch = () => {
  if (ok) location.href = url;
};

document.getElementById('again')!.addEventListener('click', launch);
document.getElementById('close')!.addEventListener('click', () => window.close());
if (!ok) document.getElementById('status')!.textContent = 'That link wasn’t an ACE Dialer number.';

launch();
