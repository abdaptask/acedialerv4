#!/usr/bin/env node
// v0.10.207 - Actually wire the ENABLE_60S_PERIODIC_RECONNECT feature flag.
//
// THE BUG
//   v0.10.135 introduced `const ENABLE_60S_PERIODIC_RECONNECT = false;` at
//   apps/web/src/services/sip.ts:36 with a comment explaining it as a
//   canary to test disabling the v0.10.113 periodic-UA-reconnect logic.
//   The flag was defined but NEVER CHECKED. installPeriodicReconnectTimer()
//   is invoked unconditionally at sip.ts:762 and the function body has no
//   guard for the flag. So the flag has been dead code for months while
//   every shipped client kept tearing down + rebuilding its SIP UA once
//   per minute.
//
//   Verified live via himankj@aptask.com v0.10.204 diagnostic log
//   (2026-06-25): the "60s periodic reconnect firing" message appears
//   every minute throughout the 3-hour session despite the flag being
//   false. The reconnect's 0.5-7s unregistered windows caused multiple
//   inbound INVITEs from real PSTN callers to fail and roll to voicemail
//   without ringing the dialer at all. Five inbound calls in the CDR,
//   zero accept events in the dialer log.
//
// THE FIX
//   Add `if (!ENABLE_60S_PERIODIC_RECONNECT) return;` at the very top of
//   installPeriodicReconnectTimer(). Guarding at the function entry rather
//   than at the call site so any future caller is automatically covered.
//
//   Net effect with flag=false: the every-minute UA-teardown vanishes.
//   The 15s force-register heartbeat continues unchanged - that one is
//   NON-destructive (it sends a fresh REGISTER refresh without tearing
//   the socket down). The visibility-recovery handler still re-registers
//   on tab focus / Electron resume.
//
//   What we lose: the prophylactic every-minute UA rebuild. That was a
//   workaround for a Telnyx server-side INVITE-routing-staleness bug
//   that PROJECT_STATE.md hypothesized may have been server-side-fixed
//   months ago. If stale-routing returns, the next sustained outage will
//   surface it and we re-evaluate.
//
//   Trivially reversible: flip the flag back to true if the bug resurfaces
//   in production.
//
// SCOPE OF CHANGES
//   - apps/web/src/services/sip.ts: 3-line guard at top of
//     installPeriodicReconnectTimer(). Flag itself was already false.
//   - apps/web/src/components/DiagnosticsSection.tsx: APP_VERSION bump.
//   - apps/web/src/data/whatsNew.ts: release note.
//   - 7 x package.json: 0.10.206 -> 0.10.207.
//
// VERIFY AFTER ROLLOUT
//   Pull a fresh diagnostic from a user on 0.10.207. The "60s periodic
//   reconnect firing" message should NOT appear. The 15s force-register
//   messages still should. Look for inbound calls that successfully
//   ring (progress event) and don't get Canceled at the 25s TeXML mark
//   - that confirms registration is staying alive through normal SIP
//   refresh without the destructive UA rebuild.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v207] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v207] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v207] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v207] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// apps/web/src/services/sip.ts - guard installPeriodicReconnectTimer
// =====================================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: 'guard installPeriodicReconnectTimer with the flag',
    find: `  private installPeriodicReconnectTimer(): void {
    if (this.periodicReconnectTimer) return;
    this.periodicReconnectTimer = setInterval(() => {
      if (!this.ua) return;
      // Never tear down during an active call — would kill audio.
      if (this.calls.size > 0 || this.incomingCallId !== null) {
        console.log('[sip] 60s periodic reconnect skipped — active call');
        return;
      }
      console.log('[sip] 60s periodic reconnect firing (v0.10.113: forces Telnyx to refresh inbound INVITE routing)');
      try {
        this.reconnect();
      } catch (e) {
        console.warn('[sip] 60s periodic reconnect threw', e);
      }
    }, 60_000);
  }`,
    replace: `  private installPeriodicReconnectTimer(): void {
    // v0.10.207 — Wire the v0.10.135 flag that was previously defined
    // but never actually checked. With the flag false, the every-minute
    // UA-teardown is suppressed; the non-destructive 15s force-register
    // continues to keep registration fresh via normal SIP REGISTER
    // refreshes. See header comment on ENABLE_60S_PERIODIC_RECONNECT.
    if (!ENABLE_60S_PERIODIC_RECONNECT) {
      console.log('[sip] 60s periodic reconnect disabled (v0.10.207 — flag is false)');
      return;
    }
    if (this.periodicReconnectTimer) return;
    this.periodicReconnectTimer = setInterval(() => {
      if (!this.ua) return;
      // Never tear down during an active call — would kill audio.
      if (this.calls.size > 0 || this.incomingCallId !== null) {
        console.log('[sip] 60s periodic reconnect skipped — active call');
        return;
      }
      console.log('[sip] 60s periodic reconnect firing (v0.10.113: forces Telnyx to refresh inbound INVITE routing)');
      try {
        this.reconnect();
      } catch (e) {
        console.warn('[sip] 60s periodic reconnect threw', e);
      }
    }, 60_000);
  }`,
  },
]);

// =====================================================================
// DiagnosticsSection APP_VERSION
// =====================================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.206';`,
    replace: `const APP_VERSION = '0.10.207';`,
  },
]);

// =====================================================================
// whatsNew.ts
// =====================================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.207 entry at top of WHATS_NEW',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.206',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.207',
    date: 'June 25, 2026',
    highlight: 'Fixed: inbound calls occasionally rolling to voicemail without the dialer ringing.',
    changes: [
      { type: 'fixed', text: 'Once a minute the SIP connection was being fully torn down and rebuilt as a safety measure against a Telnyx routing bug. That created a brief window (0.5–7 seconds) where the dialer was offline — and if a call landed in that window, it went straight to voicemail without ringing. The teardown was originally a temporary workaround; the underlying Telnyx bug has been quiet for months. Disabling the teardown should noticeably reduce missed inbound calls, especially for users on higher-latency networks.' },
    ],
  },
  {
    version: '0.10.206',`,
  },
]);

// =====================================================================
// Version bumps 0.10.206 -> 0.10.207
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
  c = c.replace(/"version":\s*"0\.10\.206"/, '"version": "0.10.207"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.206 -> 0.10.207`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v207] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}
if (bumped !== PKGS.length) {
  console.warn(`[apply-v207] WARN: only ${bumped}/${PKGS.length} package.json files bumped (expected all 7)`);
}

console.log('');
console.log('[apply-v207] DONE');
console.log('');
console.log('NEXT (run from the repo root in PowerShell):');
console.log('  node scripts/strip-null-bytes.mjs');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.207: wire the ENABLE_60S_PERIODIC_RECONNECT flag (was dead code)"');
console.log('  git tag v0.10.207');
console.log('  git push origin main');
console.log('  git push origin v0.10.207');
console.log('');
console.log('The tag push triggers build-desktop.yml which produces a Draft release.');
console.log('Leave it as Draft — users do NOT auto-update from Draft releases.');
console.log('Publish when you want it to roll to the fleet.');
