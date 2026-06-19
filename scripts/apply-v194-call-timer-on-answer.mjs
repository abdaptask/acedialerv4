#!/usr/bin/env node
// v0.10.194 - Call duration timer starts only when audio actually means
// something (Option C). Outbound call symptom before this fix: the
// clock would start ticking as soon as SIP 183 Session Progress
// arrived, which many carriers send with ringback tone DURING ringing,
// not at answer. Result: Recents durations were inflated by ringback
// time.
//
// FIX (Option C — hybrid, validated with Abd)
//   New CallState 'early-media' interposed between 'ringing' and
//   'connected'. On SIP 183 we now emit 'early-media' (NOT 'connected'),
//   and schedule a 5-second timer. Then:
//     - If SIP 200 OK ('accepted') arrives in those 5 seconds → it was
//       a real human pickup. Clear the timer, emit 'connected'
//       immediately, the duration timer starts at the moment of answer.
//     - If 5 seconds elapse and we're still in 'early-media' → it's
//       almost certainly voicemail (carrier ringback typically
//       transitions in/out within ~6s; only voicemail / extended
//       early-media sustains). Promote to 'connected', timer starts.
//     - If the call ends ('ended' / cleanupCall) before either of the
//       above → clear the timer, no duration tick.
//
// UPSHOT
//   - Pure carrier ringback before answer: timer never starts during
//     ring (we stay in 'early-media' for those few seconds and
//     transition to 'ringing' or 'ended' before the 5s expires, OR
//     200 OK arrives and we use that timestamp).
//   - Human picks up: timer starts at 200 OK, exactly when the user
//     expects.
//   - Voicemail (Telnyx Hosted VM, 183 with greeting, never 200 OK):
//     timer starts ~5s in. Recents row's duration reflects time spent
//     interacting with voicemail.
//
// PRESERVED BEHAVIOR
//   - Local ringback (the 440+480 Hz "classic" tone in InCall.tsx)
//     still stops when state transitions from 'ringing' to
//     'early-media' (the existing useEffect cleanup runs). User hears
//     the voicemail greeting cleanly without our ringback playing over
//     it — the original v0.10.10 intent is intact.
//   - entry.hadEarlyMedia stays true on 183 so 'accepted' is still
//     idempotent.
//
// FILES TOUCHED
//   apps/web/src/services/sip.ts           — CallState union, CallEntry
//                                            interface, progress handler,
//                                            accepted handler, cleanupCall
//   apps/web/src/contexts/SipContext.tsx   — stateToStatus mapping
//   apps/web/src/pages/InCall.tsx          — subtitle for 'early-media'
//
// VERSION BUMP: 0.10.193 -> 0.10.194

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v194] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v194] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v194] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v194] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
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
//   Edit 1: add 'early-media' to CallState
//   Edit 2: add earlyMediaTimer field to CallEntry
//   Edit 3: progress handler — 183 emits 'early-media' + sets 5s timer
//   Edit 4: 'accepted' clears the early-media timer before emitting 'connected'
//   Edit 5: cleanupCall clears the early-media timer
// =====================================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: '1: add early-media to CallState union',
    find: `export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'incoming';`,
    replace: `export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  // v0.10.194 — Interposed between 'ringing' and 'connected' to model
  // SIP 183 Session Progress (early media). The duration timer in
  // InCall.tsx ignores this state, so the clock doesn't tick during
  // carrier ringback. Promotes to 'connected' either on 200 OK
  // (real answer) or after 5 seconds of sustained 183 (voicemail).
  | 'early-media'
  | 'connected'
  | 'ended'
  | 'incoming';`,
  },
  {
    label: '2: add earlyMediaTimer field to CallEntry',
    find: `  // v0.10.10 — true when we received SIP 183 Session Progress with
  // early media (remote audio flowing before formal answer — voicemail
  // greetings, busy tones, custom carrier messages). Used to suppress
  // local ringback so the user can hear the remote audio.
  hadEarlyMedia?: boolean;
}`,
    replace: `  // v0.10.10 — true when we received SIP 183 Session Progress with
  // early media (remote audio flowing before formal answer — voicemail
  // greetings, busy tones, custom carrier messages). Used to suppress
  // local ringback so the user can hear the remote audio.
  hadEarlyMedia?: boolean;
  // v0.10.194 — handle to the 5-second timeout set when 183 arrives.
  // If 200 OK arrives first, the 'accepted' handler clears this and
  // emits 'connected' directly. If the timeout fires, we promote
  // 'early-media' to 'connected' (voicemail case). cleanupCall clears
  // it on call end so we don't promote a dead session.
  earlyMediaTimer?: ReturnType<typeof setTimeout>;
}`,
  },
  {
    label: '3: progress handler — 183 emits early-media + schedules promote-to-connected',
    find: `        if (status === 183) {
          // Track this so 'accepted' later doesn't re-emit (idempotent).
          entry.hadEarlyMedia = true;
          this.emit<CallEvent>('call', this.buildEvent(entry, 'connected'));
        } else {
          this.emit<CallEvent>('call', this.buildEvent(entry, 'ringing'));
        }`,
    replace: `        if (status === 183) {
          // Track this so 'accepted' later doesn't re-emit (idempotent).
          entry.hadEarlyMedia = true;
          // v0.10.194 — Don't go straight to 'connected' here. Emit a
          // new 'early-media' state which the duration timer ignores,
          // and set a 5-second timer. If 200 OK arrives in that window
          // (human pickup after ringback), the 'accepted' handler
          // clears this and emits 'connected' fresh. If 5s elapse with
          // no answer (voicemail greeting playing — carrier ringback
          // would have transitioned by then), promote to 'connected'
          // so the user still gets a duration counter while
          // interacting with voicemail.
          this.emit<CallEvent>('call', this.buildEvent(entry, 'early-media'));
          if (!entry.earlyMediaTimer) {
            entry.earlyMediaTimer = setTimeout(() => {
              const current = this.calls.get(entry.id);
              if (current === entry) {
                console.log('[sip] early-media held 5s — promoting to connected (voicemail case)', entry.id);
                entry.earlyMediaTimer = undefined;
                this.emit<CallEvent>('call', this.buildEvent(entry, 'connected'));
              }
            }, 5000);
          }
        } else {
          this.emit<CallEvent>('call', this.buildEvent(entry, 'ringing'));
        }`,
  },
  {
    label: '4: accepted handler — clear early-media timer before emitting connected',
    find: `    session.on('accepted', () => {
      console.log('[sip] accepted', callId);
      if (this.incomingCallId === callId) this.incomingCallId = null;
      this.activeCallId = callId;
      this.emit<CallEvent>('call', this.buildEvent(entry, 'connected'));
      this.startQualityPolling();
    });`,
    replace: `    session.on('accepted', () => {
      console.log('[sip] accepted', callId);
      // v0.10.194 — Cancel any pending early-media promote. 200 OK
      // means we have a real human pickup; the timer should start from
      // here, not from whenever the 5s would have elapsed.
      if (entry.earlyMediaTimer) {
        clearTimeout(entry.earlyMediaTimer);
        entry.earlyMediaTimer = undefined;
      }
      if (this.incomingCallId === callId) this.incomingCallId = null;
      this.activeCallId = callId;
      this.emit<CallEvent>('call', this.buildEvent(entry, 'connected'));
      this.startQualityPolling();
    });`,
  },
  {
    label: '5: cleanupCall — clear early-media timer so the timeout cannot promote a dead session',
    find: `  private cleanupCall(callId: string, cause: string): void {
    const entry = this.calls.get(callId);
    if (!entry) return;
    // Snapshot the 'ended' event BEFORE we mutate state so the receiver can
    // compare e.callId against the post-cleanup activeCallId to decide
    // whether to swap callState to a promoted call.
    const endedEvent: CallEvent = { ...this.buildEvent(entry, 'ended'), hangupCause: cause };`,
    replace: `  private cleanupCall(callId: string, cause: string): void {
    const entry = this.calls.get(callId);
    if (!entry) return;
    // v0.10.194 — Cancel the early-media promote timer if it was
    // scheduled. The call is ending; we don't want a stale setTimeout
    // to fire and emit 'connected' for a session that's already gone.
    if (entry.earlyMediaTimer) {
      clearTimeout(entry.earlyMediaTimer);
      entry.earlyMediaTimer = undefined;
    }
    // Snapshot the 'ended' event BEFORE we mutate state so the receiver can
    // compare e.callId against the post-cleanup activeCallId to decide
    // whether to swap callState to a promoted call.
    const endedEvent: CallEvent = { ...this.buildEvent(entry, 'ended'), hangupCause: cause };`,
  },
]);

// =====================================================================
// SipContext.tsx
//   Edit 6: stateToStatus maps 'early-media' to 'ringing' (UI/log treats
//           it as part of the ringing phase).
// =====================================================================
applyEdits('apps/web/src/contexts/SipContext.tsx', [
  {
    label: '6: stateToStatus — early-media maps to ringing',
    find: `    case 'calling':
      return 'initiated';
    case 'ringing':
      return 'ringing';
    case 'incoming':
      return 'ringing';
    case 'connected':
      return 'answered';`,
    replace: `    case 'calling':
      return 'initiated';
    case 'ringing':
      return 'ringing';
    // v0.10.194 — early-media is still part of the "ringing" phase
    // from the user's perspective. Carrier ringback / very-brief
    // voicemail-greeting handover — no duration counter yet.
    case 'early-media':
      return 'ringing';
    case 'incoming':
      return 'ringing';
    case 'connected':
      return 'answered';`,
  },
]);

// =====================================================================
// InCall.tsx
//   Edit 7: subtitle handles 'early-media' → "Ringing…" (no duration).
// =====================================================================
applyEdits('apps/web/src/pages/InCall.tsx', [
  {
    label: '7: subtitle — render Ringing… for early-media state',
    find: `  const subtitle =
    callState.state === 'calling' ? 'Calling…' :
    callState.state === 'ringing' ? 'Ringing…' :
    callState.state === 'connected' ? formatDuration(duration) :
    callState.state === 'ended' ? (callState.hangupCause ? \`Ended (\${callState.hangupCause})\` : 'Ended') :
    '';`,
    replace: `  const subtitle =
    callState.state === 'calling' ? 'Calling…' :
    callState.state === 'ringing' ? 'Ringing…' :
    // v0.10.194 — 'early-media' = remote sending audio but no answer
    // yet (typically carrier ringback or the first few seconds of
    // voicemail). Show "Ringing…" so the user knows nothing's
    // committed; no duration counter until truly 'connected'.
    callState.state === 'early-media' ? 'Ringing…' :
    callState.state === 'connected' ? formatDuration(duration) :
    callState.state === 'ended' ? (callState.hangupCause ? \`Ended (\${callState.hangupCause})\` : 'Ended') :
    '';`,
  },
]);

// =====================================================================
// Version bumps 0.10.193 -> 0.10.194
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
  c = c.replace(/"version":\s*"0\.10\.193"/, '"version": "0.10.194"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.193 -> 0.10.194`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v194] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.193';`,
    replace: `const APP_VERSION = '0.10.194';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.194 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.193',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.194',
    date: 'June 19, 2026',
    highlight: 'Call duration timer no longer ticks during ringback.',
    changes: [
      { type: 'fixed', text: 'The outbound call duration timer used to start the moment the other carrier sent any audio (often ringback while still ringing), inflating Recents durations. Timer now waits for the call to actually be answered (human pickup), or for the audio to have been flowing for 5+ seconds (voicemail greeting). Brief carrier ringback before answer no longer counts.' },
    ],
  },
  {
    version: '0.10.193',`,
  },
]);

console.log('\n[apply-v194] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.194: Call timer starts only on actual answer or 5s of sustained audio (no ringback inflation)"');
console.log('  git tag v0.10.194');
console.log('  git push origin main');
console.log('  git push origin v0.10.194');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Outbound to a number with carrier ringback that picks up after 4 rings:');
console.log('     Bubble shows Ringing... throughout ring. Timer starts AT pickup, shows 00:00.');
console.log('  2. Outbound to a number that goes to voicemail (no answer):');
console.log('     Ringing... while ringing. Around 5s into the voicemail greeting, timer starts.');
console.log('  3. Outbound that hangs up during ringing (recipient declines):');
console.log('     Ringing... then Ended. No duration counter shown.');
