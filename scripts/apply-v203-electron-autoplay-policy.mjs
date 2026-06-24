#!/usr/bin/env node
// v0.10.203 - Disable Electron's Chromium autoplay gesture requirement
// for the dialer's BrowserWindows.
//
// THE REAL BUG (uncovered after v0.10.202)
//   v0.10.193 added kickAudioPlay (gesture-context play() re-trigger).
//   v0.10.202 added defense in depth for the JsSIP PC wiring race.
//   Both helped some calls but not all. roshni's v0.10.202 log showed
//   the WebRTC wiring succeeding cleanly (peerconnection event fires,
//   track attaches, ICE connects) — yet she still heard nothing.
//
//   Cause: Electron is a Chromium app and the BrowserWindow inherits
//   Chromium's default autoplayPolicy, which is
//   'document-user-activation-required'. That blocks <audio>.play()
//   unless the document has a recent transient user activation. For
//   our flows:
//     - Floater Accept → click happens in the FLOATER window;
//       acceptCall is IPC-bridged to the MAIN window; main window
//       has no recent gesture → play() blocked.
//     - In-window Accept after a long ring → gesture has expired
//       (transient activation lasts ~5 seconds) → play() blocked.
//   No log fires for these blocks because Chromium just resolves the
//   play() Promise without producing sound, instead of rejecting it.
//
// THE FIX
//   Set webPreferences.autoplayPolicy = 'no-user-gesture-required' on
//   both BrowserWindows (main + ringer). This removes the gesture
//   requirement entirely. Standard for a dedicated softphone app
//   that isn't a web browser. Audio elements play whenever the page
//   calls .play() — no gesture, no timing race, no kicker needed.
//
//   After this fix, the v0.10.193 kickAudioPlay and v0.10.202
//   defense-in-depth become belt-and-suspenders. They still help on
//   the OFF chance Chromium changes defaults, but they're no longer
//   load-bearing.
//
// NOTE
//   This is a desktop main-process change. Renderer/web auto-update
//   does NOT pick it up — users need to install a fresh .exe (same
//   path as v0.10.202 desktop testing).
//
//   The existing apply-v203-provisioning-retry-on-not-ready.mjs in
//   /scripts/ is now a numbering conflict; renumber it to v0.10.204
//   when you decide to ship that fix.
//
// VERSION BUMP: 0.10.202 -> 0.10.203

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v203] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v203] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v203] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v203] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// main.ts
//   Edit 1: main window webPreferences gets autoplayPolicy
//   Edit 2: ringer window webPreferences gets autoplayPolicy
// =====================================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: '1: main window — add autoplayPolicy: no-user-gesture-required',
    find: `      // CRITICAL: don't throttle the page when the window is hidden.
      // When the user X's out, the window is hidden (not destroyed) so
      // any active call keeps running. With background throttling on
      // (the default), setInterval/setTimeout get clamped to 1Hz and
      // the JsSIP register-refresh timer misses its 60s window — Telnyx
      // drops the registration and the next inbound call goes to
      // voicemail. Off = the renderer stays as responsive when hidden
      // as when visible.
      backgroundThrottling: false,
    },`,
    replace: `      // CRITICAL: don't throttle the page when the window is hidden.
      // When the user X's out, the window is hidden (not destroyed) so
      // any active call keeps running. With background throttling on
      // (the default), setInterval/setTimeout get clamped to 1Hz and
      // the JsSIP register-refresh timer misses its 60s window — Telnyx
      // drops the registration and the next inbound call goes to
      // voicemail. Off = the renderer stays as responsive when hidden
      // as when visible.
      backgroundThrottling: false,
      // v0.10.203 — Disable Chromium's autoplay gesture requirement.
      // ACE Dialer is a dedicated softphone, not a web browser; we
      // need <audio>.play() to work whenever the renderer calls it,
      // regardless of which window had the most recent click. Without
      // this, the floater Accept path produced silent inbound calls
      // (gesture was in the floater window, audio element lives in
      // the main window — Chromium treated them as separate gesture
      // contexts and blocked play()).
      autoplayPolicy: 'no-user-gesture-required',
    },`,
  },
  {
    label: '2: ringer window — add autoplayPolicy: no-user-gesture-required',
    find: `    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    // v0.10.82 — macOS click-through fix. CRITICAL for the floating ringer:`,
    replace: `    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // v0.10.203 — same autoplay-policy override as the main window.
      // The ringer plays the incoming-call ringtone audio; under
      // Chromium's default policy, that ringtone wouldn't always
      // start if the user hadn't gestured in this window recently.
      autoplayPolicy: 'no-user-gesture-required',
    },
    // v0.10.82 — macOS click-through fix. CRITICAL for the floating ringer:`,
  },
]);

// =====================================================================
// Version bumps 0.10.202 -> 0.10.203
// =====================================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.202"/, '"version": "0.10.203"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.202 -> 0.10.203`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v203] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.202';`,
    replace: `const APP_VERSION = '0.10.203';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.203 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.202',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.203',
    date: 'June 24, 2026',
    highlight: 'Fixed: silent inbound calls — root-cause level fix.',
    changes: [
      { type: 'fixed', text: 'Some incoming calls would connect but produce no audio, especially when accepted from the floating ringer window or after the phone had been ringing for several seconds. The dialer was inheriting a web-browser autoplay restriction that blocks audio playback without a recent click in the same window. That restriction has been disabled for the desktop app — audio now plays reliably the moment the call is accepted, regardless of which window had focus.' },
    ],
  },
  {
    version: '0.10.202',`,
  },
]);

console.log('[apply-v203] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  cd apps/web && npm run build && cd ../desktop && npm run build && npm run package:win');
console.log('  # The .exe in apps/desktop/release/ is the v203 build.');
console.log('  git add -A');
console.log('  git commit -m "v0.10.203: Disable Electron autoplay gesture requirement (silent inbound audio root-cause fix)"');
console.log('  git tag v0.10.203');
console.log('  git push origin main');
console.log('  git push origin v0.10.203');
console.log('');
console.log('MANUAL TEST (critical — desktop change, web auto-update does NOT push it):');
console.log('  1. Install the fresh .exe.');
console.log('  2. Have someone call you. Click Accept on the floater popup.');
console.log('     Audio should work IMMEDIATELY (previously silent).');
console.log('  3. Have someone call. Let it ring 20+ seconds, then click Accept');
console.log('     in the main dialer window. Audio should work (previously sometimes silent).');
console.log('  4. Open DevTools console. The "[sip] kickAudioPlay" log may still');
console.log('     fire on in-window accepts. That is fine; the kicker is now');
console.log('     belt-and-suspenders (no longer load-bearing).');
console.log('');
console.log('IF YOU ALSO WANT TO SHIP THE PROVISIONING RETRY:');
console.log('  Rename the existing apply-v203-provisioning-retry-on-not-ready.mjs');
console.log('  to apply-v204-... and change its version bumps from "0.10.202 -> 0.10.203"');
console.log('  to "0.10.203 -> 0.10.204". Or ask me to write a fresh v204.');
