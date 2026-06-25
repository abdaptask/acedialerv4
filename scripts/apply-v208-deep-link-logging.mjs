#!/usr/bin/env node
// v0.10.208 - Telemetry for the Teams-card deep-link path.
//
// PROBLEM
//   Users report clicking "Reply" / "Call back" / "Listen" on Teams
//   notification cards opens the dialer (the OS-level ace-dialer://
//   protocol handler works) but the dialer stays on whatever tab it
//   was on instead of navigating to /messages?to=... / /keypad?to=...
//   / /voicemail/<id>/play.
//
//   The deep-link path has FOUR moving parts:
//     1. AutoRoute.tsx fires window.location.href='ace-dialer://...'
//     2. main.ts routeProtocolUrl parses the URL and IPCs the renderer
//     3. preload.ts bridges the IPC to window.ace.onDeepLink
//     4. App.tsx onDeepLink handler calls navigate(...)
//
//   None of these log anything currently. The diagnostic logBuffer
//   has no entries from any of them. So when a click silently fails
//   we have no way to tell which step died.
//
// FIX
//   Add console.info logging at each step. Logs flow into the log
//   buffer via the existing console-intercept, so the next diagnostic
//   download from any affected user will pinpoint the failure layer.
//
//   No behavior change. Pure telemetry.
//
// SCOPE
//   - apps/web/src/pages/AutoRoute.tsx: log the URL we're about to fire.
//   - apps/web/src/App.tsx: log onDeepLink receipt + navigate target.
//   - apps/web/src/components/DiagnosticsSection.tsx: APP_VERSION bump.
//   - apps/web/src/data/whatsNew.ts: release note (silent — internal).
//   - 7 x package.json: 0.10.207 -> 0.10.208.
//
// HOW TO USE THE OUTPUT
//   After rollout, ask an affected user to:
//     1. Open Settings -> Diagnostics -> Clear log (if there's a button)
//        OR just note current time.
//     2. From Teams, click any card action button.
//     3. Wait 5s.
//     4. Settings -> Diagnostics -> Download logs.
//
//   The log should show one of these patterns:
//
//     (a) [autoroute] firing protocol url: ace-dialer://sms?to=...
//         (no [deep-link] entry follows)
//         -> IPC failed: main.ts received the URL but didn't reach renderer.
//
//     (b) (no [autoroute] entry at all)
//         -> The browser never ran AutoRoute. Window.location.href to
//            the protocol URL probably didn't fire (browser autoplay
//            policy / popup blocker). User may have manually opened
//            the dialer.
//
//     (c) [autoroute] firing protocol url: ace-dialer://sms?to=...
//         [deep-link] received: {action:'sms',to:'+1...'}
//         [deep-link] navigating: /messages?to=+1...
//         (still ends up on wrong tab visually)
//         -> Navigation fired but React Router didn't honor it. Likely
//            an auth-guard remount eating the URL.
//
//     (d) [deep-link] received without [autoroute]
//         -> Cold-start path: browser AutoRoute fired pre-Electron-launch,
//            tab closed, the deep-link IPC arrived after cold-boot. This
//            is the expected behavior on first launch.
//
// VERSION BUMP: 0.10.207 -> 0.10.208
// CODE CHANGES: 2 console.info() additions, 1 console.info() in AutoRoute.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v208] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v208] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v208] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v208] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// apps/web/src/pages/AutoRoute.tsx - log the protocol URL we fire
// =====================================================================
applyEdits('apps/web/src/pages/AutoRoute.tsx', [
  {
    label: 'log protocol URL before firing window.location.href',
    find: `    const url = action === 'voicemail'
      ? \`ace-dialer://voicemail?id=\${encodeURIComponent(to)}\`
      : \`ace-dialer://\${action}?to=\${encodeURIComponent(to)}\`;
    try {
      window.location.href = url;
    } catch {
      /* harmless — we'll just rely on the fallback */
    }
    setProtocolTried(true);`,
    replace: `    const url = action === 'voicemail'
      ? \`ace-dialer://voicemail?id=\${encodeURIComponent(to)}\`
      : \`ace-dialer://\${action}?to=\${encodeURIComponent(to)}\`;
    // v0.10.208 - Telemetry. Lets us confirm in diagnostic logs that the
    // browser tab actually fired the protocol launch when a user reports
    // "I clicked the Teams Reply button and nothing happened."
    console.info('[autoroute] firing protocol url:', url);
    try {
      window.location.href = url;
    } catch (e) {
      console.warn('[autoroute] window.location.href threw', e);
    }
    setProtocolTried(true);`,
  },
]);

// =====================================================================
// apps/web/src/App.tsx - log deep-link IPC receipt + navigation
// =====================================================================
applyEdits('apps/web/src/App.tsx', [
  {
    label: 'log deep-link receipt + navigate target',
    find: `    if (!window.ace?.onDeepLink) return;
    const unsub = window.ace.onDeepLink((data) => {
      // v0.10.156 - voicemail variant carries id, not to.
      if (data.action === 'voicemail') {
        if (!data.id) return;
        navigate(\`/voicemail/\${encodeURIComponent(data.id)}/play\`);
        return;
      }
      if (!data.to) return;
      const route =
        data.action === 'call'
          ? \`/keypad?to=\${encodeURIComponent(data.to)}\`
          : \`/messages?to=\${encodeURIComponent(data.to)}\`;
      navigate(route);
    });`,
    replace: `    if (!window.ace?.onDeepLink) return;
    const unsub = window.ace.onDeepLink((data) => {
      // v0.10.208 - Telemetry. The deep-link path is reported as flaky
      // by some users (clicked card, dialer opens, but stays on the
      // wrong tab). Logging here pinpoints whether the IPC reached the
      // renderer and what navigate target we computed.
      console.info('[deep-link] received:', data);
      // v0.10.156 - voicemail variant carries id, not to.
      if (data.action === 'voicemail') {
        if (!data.id) {
          console.warn('[deep-link] voicemail missing id, ignoring');
          return;
        }
        const route = \`/voicemail/\${encodeURIComponent(data.id)}/play\`;
        console.info('[deep-link] navigating:', route);
        navigate(route);
        return;
      }
      if (!data.to) {
        console.warn('[deep-link] missing to, ignoring');
        return;
      }
      const route =
        data.action === 'call'
          ? \`/keypad?to=\${encodeURIComponent(data.to)}\`
          : \`/messages?to=\${encodeURIComponent(data.to)}\`;
      console.info('[deep-link] navigating:', route);
      navigate(route);
    });`,
  },
]);

// =====================================================================
// DiagnosticsSection APP_VERSION
// =====================================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.207';`,
    replace: `const APP_VERSION = '0.10.208';`,
  },
]);

// =====================================================================
// whatsNew.ts
// =====================================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.208 entry at top of WHATS_NEW',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.207',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.208',
    date: 'June 25, 2026',
    highlight: 'Diagnostic logging for Teams notification deep-links.',
    changes: [
      { type: 'improved', text: 'Added diagnostic logging to the Teams-card click flow (Reply, Call back, Listen). If you have ever clicked one of these and the dialer opens on the wrong tab, the next diagnostic log download will pinpoint exactly where the navigation died so we can fix it.' },
    ],
  },
  {
    version: '0.10.207',`,
  },
]);

// =====================================================================
// Version bumps 0.10.207 -> 0.10.208
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
  c = c.replace(/"version":\s*"0\.10\.207"/, '"version": "0.10.208"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.207 -> 0.10.208`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v208] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}
if (bumped !== PKGS.length) {
  console.warn(`[apply-v208] WARN: only ${bumped}/${PKGS.length} package.json files bumped (expected all 7)`);
}

console.log('');
console.log('[apply-v208] DONE');
console.log('');
console.log('NEXT (run from the repo root in PowerShell):');
console.log('  node scripts/strip-null-bytes.mjs');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.208: log Teams-card deep-link path for triage"');
console.log('  git tag v0.10.208');
console.log('  git push origin main');
console.log('  git push origin v0.10.208');
console.log('');
console.log('Draft release will appear at github.com/abdaptask/acedialerv4/releases');
console.log('after Actions finishes (~5 min). Leave as Draft, install on the');
console.log('affected user(s) manually, have them click a Teams card button,');
console.log('then download diagnostic logs.');
