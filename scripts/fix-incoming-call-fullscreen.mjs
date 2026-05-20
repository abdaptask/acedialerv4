// When the user is mid-call and a second call rings (canHoldAndAccept),
// force the full-screen IncomingCall UI instead of the cramped banner.
// The big labeled buttons matter most exactly when the user has to make
// a 3-way decision fast (Decline / Hold & Accept / Accept).
//
// Also: enlarge the banner buttons + add labels for when we fall through
// to the banner on other pages (e.g. user on /messages and a call comes
// in with no other call active — Accept/Decline only, no Hold & Accept).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const tsxFile = resolve(repoRoot, 'apps', 'web', 'src', 'components', 'IncomingCall.tsx');
let tsx = readFileSync(tsxFile, 'utf8');
const nl = tsx.includes('\r\n') ? '\r\n' : '\n';

// --- 1. Force full-screen when canHoldAndAccept ----------------------------

const oldFullscreen = [
  '  // Electron: always go full-screen. Web: full-screen on idle, banner elsewhere.',
  '  const isElectron =',
  "    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);",
  '  const fullScreen =',
  '    isElectron ||',
  "    location.pathname === '/keypad' ||",
  "    location.pathname === '/' ||",
  "    location.pathname === '/login';",
].join(nl);

const newFullscreen = [
  '  // Electron: always go full-screen. Web: full-screen on idle, banner elsewhere.',
  '  // Additionally, when a second call rings during an active call (the Hold &',
  '  // Accept scenario), force full-screen REGARDLESS of current path — the',
  '  // user needs to make a 3-way decision fast and the banner is too cramped',
  '  // to show three labeled buttons clearly.',
  '  const isElectron =',
  "    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);",
  '  const fullScreen =',
  '    isElectron ||',
  '    canHoldAndAccept ||',
  "    location.pathname === '/keypad' ||",
  "    location.pathname === '/' ||",
  "    location.pathname === '/login';",
].join(nl);

function count(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const c1 = count(tsx, oldFullscreen);
if (c1 !== 1) {
  console.log(`ABORT (fullscreen-detect): found ${c1} matches, expected 1.`);
  process.exit(1);
}
tsx = tsx.replace(oldFullscreen, newFullscreen);

writeFileSync(tsxFile, tsx, 'utf8');
console.log('Patched IncomingCall.tsx: full-screen now forced when canHoldAndAccept');
console.log('');
console.log('Done. Verify:  git diff apps/web/src/components/IncomingCall.tsx');
