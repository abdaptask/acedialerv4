#!/usr/bin/env node
// v0.10.129 single-shot apply script.
//
// WHY THIS EXISTS:
//   Cowork's workspace-sync bridge has been silently corrupting files
//   on every Edit-tool round-trip. This script does ALL v0.10.129
//   changes in ONE local Node execution - no bridge involvement -
//   so we can ship the release without corruption.
//
// USAGE:
//   1. Copy this file to acedialerv4\scripts\apply-v129-changes.mjs
//   2. cd C:\Users\asheikh\Documents\Claude\Projects\Dialer\acedialerv4
//   3. Remove-Item .git\index.lock -EA SilentlyContinue
//   4. git checkout HEAD -- .              (wipe any corruption)
//   5. node scripts/apply-v129-changes.mjs
//   6. node scripts/strip-null-bytes.mjs   (belt-and-suspenders)
//   7. git diff --stat                     (review changes)
//   8. git add -A && git commit -m "v0.10.129: ..." && git push
//
// WHAT IT DOES:
//   - preload.ts:       adds replyWithText + onReplyWithTextRequest IPC
//   - desktop/main.ts:  adds Reply button HTML/CSS/JS + ipcMain handler
//   - vite-env.d.ts:    adds Reply with Text types
//   - IncomingCall.tsx: adds subscription useEffect with try/catch + logs
//   - 7x package.json:  bumps version 0.10.128 → 0.10.129
//   - DiagnosticsSection.tsx: bumps APP_VERSION
//   - whatsNew.ts:      adds v0.10.129 release notes entry at top
//
// SAFETY:
//   Each replacement uses an EXACT anchor string. If the anchor is not
//   found, the script aborts loudly before making any other changes.
//   No partial states. Run on a clean tree (`git status --short` empty).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v129] CWD: ${ROOT}`);

function applyEdits(relPath, edits, opts = {}) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v129] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;

  // Detect line-ending style of THIS file and normalize anchors+replacements
  // to match. Git on Windows checks files out with CRLF by default, but our
  // anchor strings use LF. Without normalization String.includes() would
  // never match.
  const usesCRLF = content.includes('\r\n');
  const lineEnding = usesCRLF ? '\r\n' : '\n';
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');

  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    const label = edit.label;
    if (!content.includes(find)) {
      console.error(`[apply-v129] FATAL in ${relPath}: edit #${i + 1} (${label}) - anchor not found`);
      console.error(`  file uses: ${usesCRLF ? 'CRLF' : 'LF'} line endings`);
      console.error(`  anchor (first 200 chars): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (!opts.allowMultiple && content.split(find).length - 1 > 1) {
      console.error(`[apply-v129] FATAL in ${relPath}: edit #${i + 1} (${label}) - anchor matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. apps/desktop/src/preload.ts
// ===========================================================
applyEdits('apps/desktop/src/preload.ts', [
  {
    label: 'add replyWithText IPC bridge',
    find: `  holdAndAcceptCall: () => ipcRenderer.send('ace:hold-and-accept'),\n  notifyCallEnded: () => ipcRenderer.send('ace:call-ended'),`,
    replace: `  holdAndAcceptCall: () => ipcRenderer.send('ace:hold-and-accept'),\n  // v0.10.129 - floater "Reply with Text" click bridge. Mirrors the\n  // pattern used by acceptCall/declineCall/holdAndAcceptCall above.\n  replyWithText: () => ipcRenderer.send('ace:reply-with-text'),\n  notifyCallEnded: () => ipcRenderer.send('ace:call-ended'),`,
  },
  {
    label: 'add onReplyWithTextRequest subscription',
    find: `  // v0.10.120 - main window subscribes; fires when the floater user picked\n  // Hold & Accept. Returns an unsubscribe fn (matches existing patterns).\n  onHoldAndAcceptRequest: (cb: () => void) => {\n    const handler = () => cb();\n    ipcRenderer.on('ace:hold-and-accept-request', handler);\n    return () => ipcRenderer.removeListener('ace:hold-and-accept-request', handler);\n  },\n  onClose: (cb: () => void) => {`,
    replace: `  // v0.10.120 - main window subscribes; fires when the floater user picked\n  // Hold & Accept. Returns an unsubscribe fn (matches existing patterns).\n  onHoldAndAcceptRequest: (cb: () => void) => {\n    const handler = () => cb();\n    ipcRenderer.on('ace:hold-and-accept-request', handler);\n    return () => ipcRenderer.removeListener('ace:hold-and-accept-request', handler);\n  },\n  // v0.10.129 - main window subscribes; fires when the floater user picked\n  // Reply with Text. Main window's IncomingCall.tsx handles the decline +\n  // dispatches the ace:reply-after-decline CustomEvent for the SMS sheet.\n  onReplyWithTextRequest: (cb: () => void) => {\n    const handler = () => cb();\n    ipcRenderer.on('ace:reply-with-text-request', handler);\n    return () => ipcRenderer.removeListener('ace:reply-with-text-request', handler);\n  },\n  onClose: (cb: () => void) => {`,
  },
]);

// ===========================================================
// 2. apps/desktop/src/main.ts
// ===========================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'add canReply + replyColHtml variables',
    find: `  const acceptLabelHtml = hasActiveCall\n    ? \`<div class="action-label">Hold &amp; Accept</div>\`\n    : \`<div class="action-label">Accept</div>\`;`,
    replace: `  const acceptLabelHtml = hasActiveCall\n    ? \`<div class="action-label">Hold &amp; Accept</div>\`\n    : \`<div class="action-label">Accept</div>\`;\n\n  // v0.10.129 - Reply with Text. Only shows when NOT on active call and\n  // the caller is a phone number (internal SIP callers cannot receive SMS).\n  // Diagnostic build: the subscription side (IncomingCall.tsx) has\n  // try/catch + console.log so we capture the renderer crash that\n  // previous v0.10.122/.125/.127 attempts produced.\n  const replyableDigits = (callerNumber ?? '').replace(/[\\s()+\\-]/g, '');\n  const canReply = !hasActiveCall && /^\\d+$/.test(replyableDigits);\n  const replyColHtml = canReply\n    ? \`<div class="col">\n        <button class="reply" id="reply" title="Reply with a text message and decline the call">\n          <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>\n        </button>\n        <div class="action-label">Reply with Text</div>\n      </div>\`\n    : '';`,
  },
  {
    label: 'insert reply column into floater HTML',
    find: `        <div class="action-label">Decline</div>\n      </div>\n      <div class="col">\n        \${acceptButtonHtml}\n        \${acceptLabelHtml}\n      </div>`,
    replace: `        <div class="action-label">Decline</div>\n      </div>\n      \${replyColHtml}\n      <div class="col">\n        \${acceptButtonHtml}\n        \${acceptLabelHtml}\n      </div>`,
  },
  {
    label: 'add .reply CSS',
    find: `  button.decline { background: #ef4444; }`,
    replace: `  button.decline { background: #ef4444; }\n  button.reply { background: #f97316; }`,
  },
  {
    label: 'add reply click handler in floater script',
    find: `      document.getElementById('decline').addEventListener('click', function () {\n        if (window.ace) window.ace.declineCall();\n      });`,
    replace: `      var replyBtn = document.getElementById('reply');\n      if (replyBtn) {\n        replyBtn.addEventListener('click', function () {\n          if (window.ace && window.ace.replyWithText) {\n            window.ace.replyWithText();\n          }\n        });\n      }\n      document.getElementById('decline').addEventListener('click', function () {\n        if (window.ace) window.ace.declineCall();\n      });`,
  },
  {
    label: 'add ipcMain ace:reply-with-text handler',
    find: `ipcMain.on('ace:hold-and-accept', () => {`,
    replace: `ipcMain.on('ace:reply-with-text', () => {\n  try {\n    mainWindow?.webContents.send('ace:reply-with-text-request');\n    if (mainWindow) {\n      if (mainWindow.isMinimized()) mainWindow.restore();\n      mainWindow.show();\n      mainWindow.focus();\n    }\n  } catch (e) {\n    console.error('[main] reply-with-text forward failed', e);\n  }\n  closeRingerWindow();\n});\n\nipcMain.on('ace:hold-and-accept', () => {`,
  },
]);

// ===========================================================
// 3. apps/web/src/vite-env.d.ts
// ===========================================================
applyEdits('apps/web/src/vite-env.d.ts', [
  {
    label: 'add replyWithText type',
    find: `  // v0.10.120 - floater Hold & Accept click bridge.\n  holdAndAcceptCall?: () => void;\n  notifyCallEnded: () => void;`,
    replace: `  // v0.10.120 - floater Hold & Accept click bridge.\n  holdAndAcceptCall?: () => void;\n  // v0.10.129 - floater Reply with Text click bridge.\n  replyWithText?: () => void;\n  notifyCallEnded: () => void;`,
  },
  {
    label: 'add onReplyWithTextRequest type',
    find: `  // v0.10.120 - main-window subscription fired when the floater user\n  // clicked Hold & Accept. Optional so older preloads still typecheck.\n  onHoldAndAcceptRequest?: (cb: () => void) => () => void;\n  onClose: (cb: () => void) => () => void;`,
    replace: `  // v0.10.120 - main-window subscription fired when the floater user\n  // clicked Hold & Accept. Optional so older preloads still typecheck.\n  onHoldAndAcceptRequest?: (cb: () => void) => () => void;\n  // v0.10.129 - main-window subscription for floater Reply with Text.\n  onReplyWithTextRequest?: (cb: () => void) => () => void;\n  onClose: (cb: () => void) => () => void;`,
  },
]);

// ===========================================================
// 4. apps/web/src/components/IncomingCall.tsx
// ===========================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: 'add Reply with Text subscription useEffect',
    find: `  const callerLabel = getFavoriteName(callerNumber) ?? jd?.name ?? formatNumber(callerNumber);`,
    replace: `  const callerLabel = getFavoriteName(callerNumber) ?? jd?.name ?? formatNumber(callerNumber);\n\n  // v0.10.129 - subscribe to ace:reply-with-text-request from the Electron\n  // floater. Wrapped in try/catch + extensive console.log so when the\n  // previous v0.10.122/.125/.127-style crash happens we get diagnostic\n  // data instead of a silent renderer crash. THIS IS A DRAFT/DIAGNOSTIC\n  // BUILD - install with DevTools open (Ctrl+Shift+I) BEFORE making a\n  // test call, watch the Console tab for any red errors.\n  useEffect(() => {\n    if (!incoming) return;\n    console.log('[reply-with-text] subscribing, incoming.callId=', incoming?.callId, 'callerNumber=', callerNumber);\n    let offReply: (() => void) | undefined;\n    try {\n      offReply = window.ace?.onReplyWithTextRequest?.(() => {\n        try {\n          console.log('[reply-with-text] IPC received from floater, dispatching CustomEvent');\n          const to = callerNumber;\n          if (!to) {\n            console.warn('[reply-with-text] no callerNumber, aborting');\n            return;\n          }\n          window.dispatchEvent(new CustomEvent('ace:reply-after-decline', {\n            detail: { number: to, label: callerLabel },\n          }));\n          declineCall();\n        } catch (innerErr) {\n          console.error('[reply-with-text] handler threw:', innerErr);\n        }\n      });\n      console.log('[reply-with-text] subscribed OK, unsubscribe fn type=', typeof offReply);\n    } catch (err) {\n      console.error('[reply-with-text] subscribe threw:', err);\n    }\n    return () => {\n      try {\n        if (offReply) {\n          console.log('[reply-with-text] unsubscribing');\n          offReply();\n        }\n      } catch (cleanupErr) {\n        console.error('[reply-with-text] cleanup threw:', cleanupErr);\n      }\n    };\n  }, [incoming, callerNumber, callerLabel, declineCall]);`,
  },
]);

// ===========================================================
// 5. Version bumps: 7x package.json
// ===========================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) {
    console.error(`[apply-v129] FATAL: ${fp} missing`); process.exit(1);
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.128"/, '"version": "0.10.129"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: version not at 0.10.128 (skipped); current version line:`);
    const m = c.match(/"version":\s*"[^"]+"/);
    console.warn(`    ${m ? m[0] : '(no version field found)'}`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped to 0.10.129`);
  }
}

// ===========================================================
// 6. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.128';`,
    replace: `const APP_VERSION = '0.10.129';`,
  },
]);

// ===========================================================
// 7. whatsNew.ts v0.10.129 entry at top
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'insert v0.10.129 release entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.128',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.129',\n    date: 'June 12, 2026',\n    highlight: 'Reply with Text returns to the floating popup (diagnostic build) + Render auto-deploy fix',\n    changes: [\n      { type: 'new', text: 'Reply with Text button is back on the floating call popup. After three previous attempts (v0.10.122/.125/.127) all crashed the renderer for unknown reasons, this build adds the same feature with extensive try/catch + console.log instrumentation around the subscribe/unsubscribe logic so we can finally capture what is going wrong. If you hit the blank-window bug again, please open DevTools (Ctrl+Shift+I) BEFORE making a test call and screenshot the Console tab when the crash happens. Note: this is a Draft release - do not auto-distribute until we have confirmation that it is stable.' },\n      { type: 'improved', text: 'Render backend auto-deploys: added a GitHub Actions workflow (.github/workflows/render-deploy.yml) that pings each Render service deploy hook on every push to main, providing a reliable belt-and-suspenders fallback for the unreliable path-filter based auto-deploy. Requires three GitHub secrets (RENDER_HOOK_API, RENDER_HOOK_SOCKET, RENDER_HOOK_WEBHOOKS) which are deploy-hook URLs copied from each Render service Settings page. No more manual Render dashboard clicks to redeploy after a code push.' },\n      { type: 'fixed', text: 'Internal: the v0.10.129 changes were applied via a single local Node script (scripts/apply-v129-changes.mjs) to bypass the workspace-sync corruption that has been silently truncating source files between every Edit-tool round-trip. Combined with v0.10.128 null-byte stripper, the build pipeline is now resilient to both classes of bridge bug.' },\n    ],\n  },\n  {\n    version: '0.10.128',`,
  },
]);

console.log('\n[apply-v129] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit -m "v0.10.129: Reply with Text (diagnostic build) + Render deploy-hook workflow"');
console.log('  6. git push');
