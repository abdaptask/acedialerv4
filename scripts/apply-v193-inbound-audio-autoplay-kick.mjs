#!/usr/bin/env node
// v0.10.193 - Fix the "first inbound call has no audio" bug.
//
// SYMPTOM (multiple users reporting)
//   First inbound call after the dialer has been idle in the background:
//   user clicks Accept, call connects, but they hear no audio. Calling
//   the person back works fine. Doesn't always happen — depends on
//   whether the dialer has user activation when the call arrives.
//
// ROOT CAUSE
//   Chromium's autoplay policy blocks <audio>.play() unless the page has
//   user activation. Sequence on a "fresh" first inbound:
//     1. Invite arrives, JsSIP creates RTCPeerConnection.
//     2. SDP negotiation → remote audio track arrives (often during the
//        INVITE phase, before the user clicks Accept).
//     3. Track event handler attaches srcObject, calls safePlay().
//     4. play() is blocked by autoplay policy (no recent user gesture).
//     5. safePlay retries once at +250ms — still blocked, user still
//        hasn't clicked anything.
//     6. User clicks Accept → user activation is NOW fresh, but
//        IncomingCall.handleAccept() only calls acceptCall() (which
//        sends SIP 200 OK) and navigates. Nothing re-triggers play()
//        on the already-attached audio elements.
//     7. Stream flows through the PC but the audio element never
//        actually started playing. Silence.
//   On callback (outbound), the user just clicked the Recents row —
//   fresh user activation — and play() succeeds. That's why "calling
//   back works."
//
// FIX
//   1. Expose `kickAudioPlay()` on SipService — iterates every active
//      call's audioEl + the primaryAudioEl, calls safePlay() on each.
//      Designed to be called from a click handler (synchronous
//      user-gesture context) so play() is unblocked.
//   2. Surface kickAudioPlay through SipContext.
//   3. IncomingCall.handleAccept + handleHoldAndAccept call
//      kickAudioPlay() immediately after acceptCall()/holdAndAcceptCall().
//      The click's user activation makes the play() succeed even if
//      the track event already fired (and previously-failed) during
//      the pre-accept phase.
//   4. Beef up safePlay: 4 attempts with backoff (250ms, 500ms, 1s,
//      2s) so late track arrivals are still covered without infinite
//      retries.
//
// VERSION BUMP: 0.10.192 -> 0.10.193

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v193] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v193] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v193] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v193] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// apps/web/src/services/sip.ts
//   Edit 1: replace safePlay with 4-retry version.
//   Edit 2: add kickAudioPlay method to the class right before
//           acceptCall().
// =====================================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: '1: beef up safePlay to 4 retries with backoff',
    find: `// v0.10.31 — Robust play() wrapper. Chromium's autoplay policy can
// block audio.play() in backgrounded windows or after long idle. The
// audio element has the stream attached but emits no sound until
// play() succeeds. Retry once after a short delay; the user's Accept-
// button click counts as a user gesture that should unblock subsequent
// plays.
function safePlay(audioEl: HTMLAudioElement, label: string): void {
  void audioEl.play().catch((e) => {
    console.warn(\`[sip] \${label}.play failed — retrying in 250ms\`, e);
    setTimeout(() => {
      void audioEl.play().catch((e2) =>
        console.error(\`[sip] \${label}.play retry ALSO failed — user will hear no inbound audio\`, e2),
      );
    }, 250);
  });
}`,
    replace: `// v0.10.31 — Robust play() wrapper. Chromium's autoplay policy can
// block audio.play() in backgrounded windows or after long idle. The
// audio element has the stream attached but emits no sound until
// play() succeeds.
// v0.10.193 — Bumped to 4 attempts with backoff (250ms, 500ms, 1s, 2s).
// Pair with SipService.kickAudioPlay() called from the Accept-button
// click handler — the fresh user gesture unblocks play() even when
// earlier attempts (during the pre-accept track event) were blocked.
function safePlay(audioEl: HTMLAudioElement, label: string): void {
  const DELAYS = [250, 500, 1000, 2000];
  let attempt = 0;
  const tryPlay = (): void => {
    audioEl.play()
      .then(() => {
        if (attempt > 0) {
          console.log(\`[sip] \${label}.play succeeded on attempt \${attempt + 1}\`);
        }
      })
      .catch((e: Error) => {
        if (attempt >= DELAYS.length) {
          console.error(\`[sip] \${label}.play failed after \${attempt + 1} attempts — user will hear no inbound audio\`, e);
          return;
        }
        const delay = DELAYS[attempt];
        console.warn(\`[sip] \${label}.play attempt \${attempt + 1} failed — retrying in \${delay}ms\`, e);
        attempt += 1;
        setTimeout(tryPlay, delay);
      });
  };
  tryPlay();
}`,
  },
  {
    label: '2: add kickAudioPlay method right before acceptCall()',
    find: `    }
    return null;
  }

  acceptCall(): void {`,
    replace: `    }
    return null;
  }

  /**
   * v0.10.193 — Re-trigger play() on every audio element from a
   * synchronous user-gesture context. Designed to be called from
   * IncomingCall.handleAccept right after acceptCall() so the click's
   * user activation unblocks play() that was previously blocked by
   * Chromium's autoplay policy (typical first-inbound-call symptom:
   * stream is attached, no sound; calling back works).
   */
  kickAudioPlay(): void {
    console.log('[sip] kickAudioPlay — user gesture, re-issuing play() on all audio elements');
    safePlay(this.primaryAudioEl, 'primaryAudioEl-kick');
    for (const entry of this.calls.values()) {
      if (entry.audioEl) {
        safePlay(entry.audioEl, \`call-\${entry.id}-audioEl-kick\`);
      }
    }
  }

  acceptCall(): void {`,
  },
]);

// =====================================================================
// apps/web/src/contexts/SipContext.tsx
//   Edit 1: add kickAudioPlay to the SipContextValue interface.
//   Edit 2: add kickAudioPlay to the context value object.
// =====================================================================
applyEdits('apps/web/src/contexts/SipContext.tsx', [
  {
    label: '1: add kickAudioPlay to SipContextValue interface',
    find: `  acceptCall: () => void;
  /** Put the currently active call on hold and answer the incoming call.
   *  No-op if there's no incoming. Falls back to plain accept if there's
   *  no active call to hold. */
  holdAndAcceptCall: () => void;`,
    replace: `  acceptCall: () => void;
  /** Put the currently active call on hold and answer the incoming call.
   *  No-op if there's no incoming. Falls back to plain accept if there's
   *  no active call to hold. */
  holdAndAcceptCall: () => void;
  /** v0.10.193 — Re-trigger play() on every audio element. Call this
   *  from a synchronous user-gesture context (e.g. an Accept button
   *  click handler) to unblock Chromium's autoplay policy when the
   *  earlier play() during the track event was blocked. Fixes the
   *  "first inbound call has no audio" recurring complaint. */
  kickAudioPlay: () => void;`,
  },
  {
    label: '2: add kickAudioPlay to the context value object',
    find: `    acceptCall: () => sipService.acceptCall(),
    holdAndAcceptCall: () => {`,
    replace: `    acceptCall: () => sipService.acceptCall(),
    kickAudioPlay: () => sipService.kickAudioPlay(),
    holdAndAcceptCall: () => {`,
  },
]);

// =====================================================================
// apps/web/src/components/IncomingCall.tsx
//   Edit 1: pull kickAudioPlay from useSip + call from handleAccept and
//           handleHoldAndAccept.
// =====================================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: '1: destructure kickAudioPlay + call from accept handlers',
    find: `  const { incoming, acceptCall, declineCall, holdAndAcceptCall, callState, hasSecondCall } = useSip();
  const location = useLocation();
  const navigate = useNavigate();

  const hasActiveCall = callState.state === 'connected';
  const canHoldAndAccept = hasActiveCall && !hasSecondCall;

  const handleAccept = () => {
    acceptCall();
    navigate('/in-call');
  };

  const handleHoldAndAccept = () => {
    holdAndAcceptCall();
    navigate('/in-call');
  };`,
    replace: `  const { incoming, acceptCall, declineCall, holdAndAcceptCall, kickAudioPlay, callState, hasSecondCall } = useSip();
  const location = useLocation();
  const navigate = useNavigate();

  const hasActiveCall = callState.state === 'connected';
  const canHoldAndAccept = hasActiveCall && !hasSecondCall;

  const handleAccept = () => {
    acceptCall();
    // v0.10.193 — Re-issue play() on the audio elements while we're
    // still synchronously inside the user-gesture click. This is what
    // unblocks Chromium's autoplay policy on first-call scenarios
    // where the earlier play() (fired during the track event before
    // the user clicked anything) was rejected.
    kickAudioPlay();
    navigate('/in-call');
  };

  const handleHoldAndAccept = () => {
    holdAndAcceptCall();
    // v0.10.193 — Same audio-kick as handleAccept; the second leg
    // needs the user-gesture-context play() too.
    kickAudioPlay();
    navigate('/in-call');
  };`,
  },
]);

// =====================================================================
// Version bumps 0.10.192 -> 0.10.193
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
  c = c.replace(/"version":\s*"0\.10\.192"/, '"version": "0.10.193"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.192 -> 0.10.193`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v193] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.192';`,
    replace: `const APP_VERSION = '0.10.193';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.193 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.192',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.193',
    date: 'June 19, 2026',
    highlight: 'Fixed: first inbound call sometimes had no audio.',
    changes: [
      { type: 'fixed', text: 'On the first inbound call after the dialer has been idle, some users heard no audio from the caller (calling back worked). Cause was Chromium\\'s autoplay policy blocking audio playback before the user clicked Accept. The Accept button now re-issues the play() inside the click handler so the user gesture unblocks audio reliably. Also extended internal retry budget from 1 to 4 attempts with backoff for late track arrivals.' },
    ],
  },
  {
    version: '0.10.192',`,
  },
]);

console.log('\n[apply-v193] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.193: Fix first-inbound-call silent audio (kickAudioPlay on Accept click)"');
console.log('  git tag v0.10.193');
console.log('  git push origin main');
console.log('  git push origin v0.10.193');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Build + install fresh (covered separately).');
console.log('  2. Leave the dialer running, switch to another window for 2-3 min so');
console.log('     the document loses user activation. Have someone call you.');
console.log('  3. Click Accept. Verify you hear the caller immediately.');
console.log('  4. Hang up. Repeat 2-3 times to confirm consistency.');
console.log('  5. Edge case: while in a call, accept a 2nd inbound via Hold & Accept.');
console.log('     Verify audio on the new leg.');
