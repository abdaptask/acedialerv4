#!/usr/bin/env node
// v0.10.135 - Feature-flag the v0.10.113 60s periodic reconnect.
//
// PROBLEM (diagnosed via DiagnosticsSection logBuffer capture):
//   Every 60s, sip.ts does a wildcard unregister + full UA tear-down +
//   reconnect. Creates a ~600ms gap each minute where SIP is fully
//   torn down. Inbound INVITEs arriving in that gap can't be delivered;
//   Telnyx falls them back to TeXML voicemail. ~1% baseline inbound
//   failure rate independent of network/React state. Likely the real
//   cause of "Disconnected after SSO" (user lands during a gap) and
//   the 1-ring-to-voicemail bounces we saw all day (those were
//   ALSO caused by the React #310 crash, but that's now fixed in v0.10.130).
//
// THE FIX (v0.10.113) MAY NO LONGER BE NEEDED:
//   v0.10.113 added the periodic reconnect to fight a Telnyx server-side
//   bug where inbound INVITE routing went stale despite an active REGISTER.
//   That bug may have been fixed server-side since June 9 (3 days old).
//   Plus the 15s force-register (added v0.10.110) sends a normal REGISTER
//   every 15s which should keep Telnyx's routing fresh through normal means.
//
// EXPERIMENT:
//   Feature-flag the 60s reconnect (default OFF). Abdulla installs the
//   Draft build, runs it for 24h, monitors for any "calls go to voicemail
//   despite Registered" symptoms. 8 testers stay on v0.10.131/.132 with
//   the original reconnect active - zero risk to them.
//
//   Outcomes:
//     - 24h clean: promote v0.10.135 to testers
//     - Failure: revert by installing v0.10.131 .exe on abdulla's machine
//
// IMPLEMENTATION DETAIL:
//   The 60s timer KEEPS FIRING (so we can see in logs that the timer is
//   alive and the flag is being checked). Only the actual reconnect()
//   call is skipped. Log line changes to make the experiment state
//   obvious in diagnostic exports.
//
// USAGE:
//   1. Copy to acedialerv4\scripts\apply-v135-disable-periodic-reconnect.mjs
//   2. cd acedialerv4
//   3. node scripts/apply-v135-disable-periodic-reconnect.mjs
//   4. node scripts/strip-null-bytes.mjs
//   5. npx tsc --noEmit -p apps/web/tsconfig.json
//   6. git diff --stat
//   7. git add -A && git commit -m "v0.10.135: feature-flag 60s periodic reconnect (OFF by default)"
//   8. git push
//   9. WAIT FOR GITHUB ACTIONS BUILD TO COMPLETE
//   10. Download the v0.10.135 .exe from Draft release
//   11. Install on YOUR machine ONLY. Do NOT publish the release - leave it as Draft.
//   12. Monitor for 24h via Settings > Diagnostics > Download logs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v135] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v135] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v135] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v135] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. Wrap the 60s periodic reconnect's actual reconnect() call in a flag check
// ===========================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: 'gate v0.10.113 periodic reconnect behind ENABLE_60S_PERIODIC_RECONNECT flag',
    find: `      console.log('[sip] 60s periodic reconnect firing (v0.10.113: forces Telnyx to refresh inbound INVITE routing)');
      try {
        this.reconnect();
      } catch (e) {
        console.warn('[sip] 60s periodic reconnect threw', e);
      }`,
    replace: `      // v0.10.135 EXPERIMENT - feature-flagged. If false, the timer
      // still fires (for log visibility + observability that the timer
      // is alive) but the actual reconnect is SKIPPED. The 15s force-
      // register continues to keep the registration alive via normal
      // SIP REGISTER refresh. If Telnyx's INVITE-routing-staleness bug
      // still exists, we'll see calls going to voicemail despite
      // Registered=green; flip ENABLE_60S_PERIODIC_RECONNECT back to
      // true and ship v0.10.136 to restore the heavy-handed reconnect.
      if (!ENABLE_60S_PERIODIC_RECONNECT) {
        console.log('[sip] 60s periodic reconnect SKIPPED (v0.10.135 experiment: flag OFF, keep-alive via 15s force-register only)');
        return;
      }
      console.log('[sip] 60s periodic reconnect firing (v0.10.113: forces Telnyx to refresh inbound INVITE routing)');
      try {
        this.reconnect();
      } catch (e) {
        console.warn('[sip] 60s periodic reconnect threw', e);
      }`,
  },
  {
    label: 'declare ENABLE_60S_PERIODIC_RECONNECT constant near the top of the file',
    find: `// v0.10.110: WebSocket keep_alive_interval=15s (tightened from 25s to fight silent eviction)`,
    replace: `// v0.10.110: WebSocket keep_alive_interval=15s (tightened from 25s to fight silent eviction)
//
// v0.10.135 EXPERIMENT - 60s periodic reconnect feature flag.
//
// The v0.10.113 critical fix tears down + rebuilds the entire JsSIP UA
// every 60 seconds to combat a Telnyx server-side bug where inbound
// INVITE routing went stale despite an active REGISTER. The trade-off
// (per the v0.10.113 commit message): "~2-5 seconds of disconnected
// state per cycle; incoming calls in that brief window still fail, but
// the overall reliability improves dramatically."
//
// PROBLEM CAUGHT IN v0.10.132 DIAGNOSTIC EXPORT:
// In practice the gap is ~600ms (faster than the commit message
// estimate) but it happens every 60s. That's a ~1% inbound failure
// rate baseline. Plus if a user happens to log in during one of those
// gaps, the UI shows Disconnected and they're stuck until the next
// REGISTER fires - which led to today's Ctrl+Shift+R workaround.
//
// HYPOTHESIS: the Telnyx INVITE-routing-staleness bug may have been
// fixed server-side since June 9 (when v0.10.113 shipped). And the
// 15s force-register (gentle SIP REGISTER, no tear-down) should be
// sufficient to keep routing fresh.
//
// CANARY APPROACH: flag is OFF on this build. Abdulla installs the
// Draft .exe on his machine for 24h. Other testers stay on .131/.132
// with the original reconnect active. If 24h is clean, promote v0.10.135
// to everyone (flag stays OFF). If routing goes stale, flip the flag
// to true in v0.10.136 and reship.
const ENABLE_60S_PERIODIC_RECONNECT = false;`,
  },
]);

// ===========================================================
// 2. Version bumps to 0.10.135
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
  c = c.replace(/"version":\s*"0\.10\.134"/, '"version": "0.10.135"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.134 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.134 → 0.10.135`);
  }
}

// ===========================================================
// 3. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.135',
    find: `const APP_VERSION = '0.10.134';`,
    replace: `const APP_VERSION = '0.10.135';`,
  },
]);

// ===========================================================
// 4. whatsNew.ts v0.10.135 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.135 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.134',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.135',\n    date: 'June 12, 2026',\n    highlight: 'EXPERIMENT - 60s periodic full SIP reconnect disabled (canary build)',\n    changes: [\n      { type: 'improved', text: 'Experimental Draft build. The v0.10.113 "tear down and rebuild the entire SIP connection every 60 seconds" behavior - originally added to combat a Telnyx server-side bug where inbound call routing would silently go stale - is feature-flagged OFF in this build. The 15-second normal SIP REGISTER refresh (added in v0.10.110) is still active and should keep the registration alive through Telnyx normal means. We suspect the original Telnyx bug may have been fixed server-side since June 9, and the heavy-handed periodic reconnect is now doing more harm than good - the 600 millisecond gap each minute where the dialer is fully torn down is when about 1 percent of inbound calls bounce to voicemail. This build is canary-only on Abdullas machine for 24 hours. If inbound call delivery stays clean, this gets promoted to all testers as the new default. If routing goes stale, this version is reverted and the heavy reconnect comes back in v0.10.136.' },\n      { type: 'fixed', text: 'No other behavioral changes. Same UI as v0.10.132 (incoming-call unification + orange-pause-badge Hold and Accept).' },\n    ],\n  },\n  {\n    version: '0.10.134',`,
  },
]);

console.log('\n[apply-v135] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.135: feature-flag 60s periodic reconnect (OFF by default - canary)"');
console.log('  5. git push');
console.log('  6. WAIT FOR GITHUB ACTIONS to build .exe');
console.log('  7. Install v0.10.135 ON YOUR MACHINE ONLY');
console.log('  8. DO NOT PUBLISH the GitHub release - leave it as DRAFT');
console.log('  9. Monitor for 24 hours via Settings -> Diagnostics -> Download logs');
console.log('     - Look for "60s periodic reconnect SKIPPED" lines (confirms flag is off)');
console.log('     - Watch for any "calls going to voicemail despite Registered" symptoms');
console.log(' 10. If clean after 24h: publish v0.10.135 release for all testers');
console.log('     If problems: install previous .exe (v0.10.131 or v0.10.132) on your machine,');
console.log('     and we ship v0.10.136 with the flag flipped back to true.');
