#!/usr/bin/env node
// v0.10.130 hotfix - the real fix for the Reply with Text crash.
//
// ROOT CAUSE (finally diagnosed):
//   v0.10.129 placed the Reply with Text useEffect AFTER IncomingCall.tsx's
//   `if (!incoming) return null;` guard. That made it a CONDITIONAL hook -
//   on first render (no call) the early-return prevented the hook from
//   running; on second render (call arrives) the hook ran. React error
//   #310 = "Rendered more hooks than during the previous render" =
//   renderer crash, blank window, JsSIP terminates session, caller goes
//   to voicemail.
//
//   This was the same root cause for v0.10.122, .125, .127 - we just
//   never captured DevTools to see React error #310. Today we did.
//
// FIX:
//   1. Remove the BAD useEffect (the one inserted after callerLabel)
//   2. Add the SAME logic as a useEffect BEFORE the early-return, in
//      the block where the other useEffects live (alongside the
//      ringtone, calledLine, desktop-notification effects).
//   3. Don't depend on callerLabel - compute label inside the handler.
//
// USAGE:
//   1. Copy this to acedialerv4\scripts\apply-v130-fix.mjs
//   2. cd acedialerv4
//   3. node scripts/apply-v130-fix.mjs
//   4. node scripts/strip-null-bytes.mjs
//   5. npx tsc --noEmit -p apps/web/tsconfig.json
//   6. git add -A && git commit -m "v0.10.130: hotfix Reply with Text React error #310" && git push
//
// Prereq: v0.10.129 must already be applied (commit 6b1cd89 or later).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v130] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v130] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v130] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  file uses: ${usesCRLF ? 'CRLF' : 'LF'}`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v130] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. Remove the BAD useEffect (the one v0.10.129 added after callerLabel)
// ===========================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: 'remove BAD useEffect that violated rules of hooks',
    find: `  const callerLabel = getFavoriteName(callerNumber) ?? jd?.name ?? formatNumber(callerNumber);\n\n  // v0.10.129 - subscribe to ace:reply-with-text-request from the Electron\n  // floater. Wrapped in try/catch + extensive console.log so when the\n  // previous v0.10.122/.125/.127-style crash happens we get diagnostic\n  // data instead of a silent renderer crash. THIS IS A DRAFT/DIAGNOSTIC\n  // BUILD - install with DevTools open (Ctrl+Shift+I) BEFORE making a\n  // test call, watch the Console tab for any red errors.\n  useEffect(() => {\n    if (!incoming) return;\n    console.log('[reply-with-text] subscribing, incoming.callId=', incoming?.callId, 'callerNumber=', callerNumber);\n    let offReply: (() => void) | undefined;\n    try {\n      offReply = window.ace?.onReplyWithTextRequest?.(() => {\n        try {\n          console.log('[reply-with-text] IPC received from floater, dispatching CustomEvent');\n          const to = callerNumber;\n          if (!to) {\n            console.warn('[reply-with-text] no callerNumber, aborting');\n            return;\n          }\n          window.dispatchEvent(new CustomEvent('ace:reply-after-decline', {\n            detail: { number: to, label: callerLabel },\n          }));\n          declineCall();\n        } catch (innerErr) {\n          console.error('[reply-with-text] handler threw:', innerErr);\n        }\n      });\n      console.log('[reply-with-text] subscribed OK, unsubscribe fn type=', typeof offReply);\n    } catch (err) {\n      console.error('[reply-with-text] subscribe threw:', err);\n    }\n    return () => {\n      try {\n        if (offReply) {\n          console.log('[reply-with-text] unsubscribing');\n          offReply();\n        }\n      } catch (cleanupErr) {\n        console.error('[reply-with-text] cleanup threw:', cleanupErr);\n      }\n    };\n  }, [incoming, callerNumber, callerLabel, declineCall]);`,
    replace: `  const callerLabel = getFavoriteName(callerNumber) ?? jd?.name ?? formatNumber(callerNumber);`,
  },
]);

// ===========================================================
// 2. Add the CORRECT useEffect BEFORE the early-return guard.
//    Anchor: the desktop-notification useEffect that ends with
//    `}, [incoming, jd, callerNumber, navigate]);`, then `\n\n  if (!incoming)`
// ===========================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: 'add Reply with Text useEffect BEFORE early-return',
    find: `  }, [incoming, jd, callerNumber, navigate]);\n\n  if (!incoming) return null;`,
    replace: `  }, [incoming, jd, callerNumber, navigate]);\n\n  // v0.10.130 - Reply with Text floater subscription. MUST be declared\n  // before the \`if (!incoming) return null\` guard below, otherwise it\n  // becomes a conditional hook and triggers React error #310 (rendered\n  // more hooks than previous render). v0.10.122/.125/.127/.129 all\n  // crashed for exactly this reason - finally caught via DevTools.\n  // The handler computes the caller label inline so we don't have to\n  // depend on callerLabel (which is computed AFTER the early-return).\n  useEffect(() => {\n    if (!incoming) return;\n    let offReply: (() => void) | undefined;\n    try {\n      offReply = window.ace?.onReplyWithTextRequest?.(() => {\n        try {\n          const to = callerNumber;\n          if (!to) return;\n          const label = getFavoriteName(to) ?? jd?.name ?? formatNumber(to);\n          window.dispatchEvent(new CustomEvent('ace:reply-after-decline', {\n            detail: { number: to, label },\n          }));\n          declineCall();\n        } catch (innerErr) {\n          console.error('[reply-with-text] handler threw:', innerErr);\n        }\n      });\n    } catch (err) {\n      console.error('[reply-with-text] subscribe threw:', err);\n    }\n    return () => {\n      try { if (offReply) offReply(); } catch { /* noop */ }\n    };\n  }, [incoming, callerNumber, jd, declineCall]);\n\n  if (!incoming) return null;`,
  },
]);

// ===========================================================
// 3. Version bumps to 0.10.130
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
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.129"/, '"version": "0.10.130"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.129 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.129 → 0.10.130`);
  }
}

// ===========================================================
// 4. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.130',
    find: `const APP_VERSION = '0.10.129';`,
    replace: `const APP_VERSION = '0.10.130';`,
  },
]);

// ===========================================================
// 5. whatsNew.ts v0.10.130 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.130 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.129',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.130',\n    date: 'June 12, 2026',\n    highlight: 'Reply with Text crash FINALLY fixed - root cause was a React rules-of-hooks violation',\n    changes: [\n      { type: 'fixed', text: 'Fixed the Reply with Text crash that has been blocking 4 release attempts (v0.10.122/.125/.127/.129). Root cause was finally caught via DevTools console capture: React error #310 (rendered more hooks than during the previous render). The Reply with Text useEffect was inserted AFTER the components if-no-incoming early-return guard, making it a conditional hook. On first render (no call) only 3 hooks ran; on second render (call arrives) the 4th hook tried to run, React detected the count mismatch and threw, the renderer crashed, the main window went blank, JsSIP terminated the session, and the caller got bounced to voicemail. Fix moves the useEffect to BEFORE the early-return guard so the hook count is identical across renders. Reply with Text on the floater now works without crashing the dialer.' },\n      { type: 'fixed', text: 'Bonus: the immediate voicemail bounce (caller hearing voicemail after 1 ring) that has been seen in tandem with this crash was the downstream consequence of the renderer crash - a dead renderer cannot accept SIP INVITEs or refresh REGISTER, so Telnyx routed the call to voicemail. Fixing the crash fixes the bounce.' },\n    ],\n  },\n  {\n    version: '0.10.129',`,
  },
]);

console.log('\n[apply-v130] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.130: hotfix React error #310 in Reply with Text useEffect"');
console.log('  5. git push');
