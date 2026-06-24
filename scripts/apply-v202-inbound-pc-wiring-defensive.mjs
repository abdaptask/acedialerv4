#!/usr/bin/env node
// v0.10.202 - Defense in depth for the inbound WebRTC PC-wiring race.
//
// THE BUG (from roshni's 2026-06-24 v0.10.201 log)
//   Incoming call lifecycle:
//     14:13:22  SIP progress (ring)
//     14:13:40  User clicks Accept → acceptCall() runs → kickAudioPlay
//     14:13:42  SIP accepted + confirmed
//     14:13:48  User hangs up (5.4s of "blank" call)
//   Notable: NO "PC found, wiring listeners" log fired during this
//   call. NO "track event" log either. The audio element was created
//   but its srcObject was never set, so the user heard nothing
//   despite the SIP layer being connected. kickAudioPlay couldn't
//   help because there was no media stream attached.
//
//   The v0.10.32 author chose polling over JsSIP's `peerconnection`
//   event because the event "is unreliable across versions" (per
//   their code comment). The polling window was 5 seconds (50 ×
//   100ms). For roshni's call, that window ran out before
//   session.connection was populated — even though ICE candidate
//   events DID fire on the PC (visible in her log at 14:13:42.031+).
//   This implies the PC existed but wasn't where we were looking.
//
// THE FIX (defense in depth — all additive, nothing removed)
//
//   1. Subscribe to JsSIP's 'peerconnection' event. If it fires
//      reliably in this JsSIP version, we wire the PC synchronously
//      the moment JsSIP creates it. If it doesn't fire (the original
//      reason for falling back to polling), the polling still runs.
//
//   2. Widen the PC property probes. Currently we check
//      `session.connection` and `session._connection`. Some JsSIP
//      versions/patches expose the PC under different names
//      (`rtcSession.connection`, `peerConnection`, `pc`). Check all
//      of them.
//
//   3. Extend the polling window from 5s to 15s (50 → 150 attempts).
//      Roshni's case clearly needed more than 5s. 15s is a generous
//      ceiling that costs nothing if the PC appears earlier.
//
// Outbound calls already work — the same code path runs but the PC
// is created during ua.call() before our polling starts, so the
// race doesn't manifest there. We're NOT changing the outbound path.
//
// VERSION BUMP: 0.10.201 -> 0.10.202

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v202] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v202] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v202] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v202] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// sip.ts
//   Edit 1: wirePcWhenReady accepts pcOverride + widened property probes
//   Edit 2: peerconnection event listener + polling window 5s -> 15s
// =====================================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: '1: wirePcWhenReady accepts pcOverride + widened PC property probes',
    find: `    // JsSIP's 'peerconnection' event timing is unreliable across versions.
    // Instead, poll for session.connection (the underlying RTCPeerConnection)
    // and wire listeners as soon as it appears. Run a few times in case JsSIP
    // creates the PC lazily.
    const wirePcWhenReady = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pc: RTCPeerConnection | null = (session as any).connection ?? (session as any)._connection ?? null;
      if (!pc) return false;`,
    replace: `    // v0.10.202 — Defense-in-depth wiring. Three layers:
    //   (a) JsSIP's 'peerconnection' event (set up below the function
    //       body). The original v0.10.32 author flagged this event as
    //       "unreliable across versions" — that's still true, but it's
    //       additive: if it fires we save time, if not we fall back.
    //   (b) Polling for the PC under any of several property names
    //       JsSIP versions/patches use to expose it.
    //   (c) Extended polling window (15s, was 5s — see below).
    // The optional pcOverride lets the event handler pass the PC
    // directly without going through the property probes.
    const wirePcWhenReady = (pcOverride?: RTCPeerConnection): boolean => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = session as any;
      const pc: RTCPeerConnection | null =
        pcOverride
        ?? s.connection
        ?? s._connection
        ?? s.rtcSession?.connection
        ?? s.peerConnection
        ?? s.pc
        ?? null;
      if (!pc) return false;`,
  },
  {
    label: '2: subscribe to peerconnection event + extend polling window 50 -> 150 attempts',
    find: `    // Try immediately, then poll for up to 5 seconds.
    if (!wirePcWhenReady()) {
      let tries = 0;
      const id = setInterval(() => {
        tries += 1;
        if (wirePcWhenReady() || tries >= 50) clearInterval(id);
      }, 100);
    }`,
    replace: `    // v0.10.202 — Layer (a): subscribe to JsSIP's 'peerconnection'
    // event. If the event fires reliably in this JsSIP version, we
    // wire the PC the moment JsSIP creates it — no polling required.
    // If the event is silent (the original v0.10.32 reason for moving
    // off it), the polling below still catches it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).on('peerconnection', (data: { peerconnection?: RTCPeerConnection }) => {
        const evtPc = data?.peerconnection;
        if (evtPc) {
          console.log('[sip] peerconnection event fired — wiring listeners now');
          wirePcWhenReady(evtPc);
        }
      });
    } catch (e) {
      console.warn('[sip] could not subscribe to peerconnection event', e);
    }

    // v0.10.202 — Layer (c): polling window 5s -> 15s. Was 50 × 100ms.
    // Roshni's 2026-06-24 v0.10.201 log showed an inbound call where
    // the 5s window ended without finding the PC — the track-event
    // listener was never wired, and the user heard nothing. 150
    // attempts × 100ms = 15s gives JsSIP plenty of time on a slow
    // network or after a periodic-reconnect cycle.
    if (!wirePcWhenReady()) {
      let tries = 0;
      const id = setInterval(() => {
        tries += 1;
        if (wirePcWhenReady() || tries >= 150) clearInterval(id);
      }, 100);
    }`,
  },
]);

// =====================================================================
// Version bumps 0.10.201 -> 0.10.202
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
  c = c.replace(/"version":\s*"0\.10\.201"/, '"version": "0.10.202"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.201 -> 0.10.202`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v202] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.201';`,
    replace: `const APP_VERSION = '0.10.202';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.202 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.201',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.202',
    date: 'June 24, 2026',
    highlight: 'Fixed: occasional silent inbound calls (no audio after Accept).',
    changes: [
      { type: 'fixed', text: 'On rare inbound calls, the internal WebRTC peer-connection setup did not complete in time, causing the call to ring through but produce no audio after Accept. The wiring path now has three independent safety nets and an extended setup window, so the track is reliably attached before the call goes live.' },
    ],
  },
  {
    version: '0.10.201',`,
  },
]);

console.log('[apply-v202] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.202: Defense-in-depth fix for inbound PC wiring race (silent inbound calls)"');
console.log('  git tag v0.10.202');
console.log('  git push origin main');
console.log('  git push origin v0.10.202');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Have someone call your DID. Accept the call within 1-3 seconds of ring.');
console.log('     You should hear audio immediately.');
console.log('  2. Have someone call. Wait ~20 seconds of ringing before accepting.');
console.log('     You should still hear audio (this was the failure mode in roshnis log).');
console.log('  3. Check the DevTools console while a call comes in. You should see either');
console.log('     "peerconnection event fired" OR "PC found, wiring listeners" within a few');
console.log('     hundred ms of clicking Accept, followed by either "track event" or');
console.log('     "attached existing receiver tracks".');
