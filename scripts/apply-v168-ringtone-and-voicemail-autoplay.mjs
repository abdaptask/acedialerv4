#!/usr/bin/env node
// v0.10.168 - Two small audio-related bug fixes.
//
// BUG 1: Outbound calls play the user's CUSTOM ringtone in their own ear
// while waiting for the other side to pick up. Should play the standard
// "classic" ringback instead. The user's selected ringtone is for
// INCOMING calls only.
//
// Root cause: apps/web/src/pages/InCall.tsx line 94 calls
//   ringtone.start()
// which, with no slug arg, uses the user's saved ringtone (e.g. their
// "Pulse" preset). The intent was a local ringback tone for VoIP
// destinations that don't send early media (so the caller wouldn't
// hear silence). Fix: pass 'classic' explicitly. That's the standard
// 440+480 Hz North-American ringback - what a normal phone sounds like.
//
// BUG 2: Voicemail list row's Play button requires being pressed twice
// to actually hear audio. First press expands the row but no playback;
// user has to press the audio element's own Play button to actually
// start.
//
// Root cause: apps/web/src/pages/Voicemail.tsx line 526-539 useEffect
// auto-plays when `expanded` flips true, but at that moment audioUrl
// is still the stale stored URL (vm.recordingUrl). The play() call
// either silently fails or loads an expired URL. Meanwhile the OTHER
// useEffect fetches the fresh URL via /voicemails/:id/fresh-url and
// updates audioUrl - but the audio element doesn't auto-play because
// the deps array is [expanded], not [expanded, audioUrl].
// Fix: add audioUrl to the deps so play() re-fires when the fresh URL
// arrives.
//
// VERSION BUMP: 0.10.167 -> 0.10.168

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v168] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v168] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v168] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v168] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// Bug 1: InCall.tsx - use 'classic' ringback, not user's ringtone
// =====================================================================
applyEdits('apps/web/src/pages/InCall.tsx', [
  {
    label: 'outbound calls play classic ringback, not user ringtone',
    find: `  // Local ringback while we're waiting for the other side to pick up.
  // Some VoIP destinations don't send early media so we'd otherwise hear silence.
  useEffect(() => {
    if (callState.state === 'calling' || callState.state === 'ringing') {
      ringtone.start();
      return () => ringtone.stop();
    }
    return undefined;
  }, [callState.state]);`,
    replace: `  // Local ringback while we're waiting for the other side to pick up.
  // Some VoIP destinations don't send early media so we'd otherwise hear silence.
  //
  // v0.10.168 - explicit 'classic' slug. ringtone.start() with no args
  // defaults to the user's SAVED ringtone preference (the one they
  // chose for INCOMING calls). That meant outbound calls played the
  // user's custom ringtone in their own ear - users who picked the
  // "Pulse" low-square preset for incoming heard that on outbound,
  // which sounds wrong. 'classic' is 440+480 Hz - the standard
  // North-American PSTN ringback that everyone recognizes as
  // "phone is ringing on the other end."
  useEffect(() => {
    if (callState.state === 'calling' || callState.state === 'ringing') {
      ringtone.start('classic');
      return () => ringtone.stop();
    }
    return undefined;
  }, [callState.state]);`,
  },
]);

// =====================================================================
// Bug 2: Voicemail.tsx - play() re-fires when audioUrl updates
// =====================================================================
applyEdits('apps/web/src/pages/Voicemail.tsx', [
  {
    label: 'voicemail auto-play depends on audioUrl so fresh URL triggers playback',
    find: `  // When the row expands, start playback automatically and capture the
  // real duration from the audio element's metadata.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;
    const el = audioRef.current;
    const onLoaded = () => {
      if (isFinite(el.duration) && el.duration > 0) {
        setActualDuration(el.duration);
      }
    };
    el.addEventListener('loadedmetadata', onLoaded);
    // Auto-play on expand so a single click on the row's play button
    // both opens the player AND starts playing.
    el.play().catch(() => { /* autoplay may be blocked; user can press play */ });
    return () => el.removeEventListener('loadedmetadata', onLoaded);
  }, [expanded]);`,
    replace: `  // When the row expands, start playback automatically and capture the
  // real duration from the audio element's metadata.
  //
  // v0.10.168 - dep array also includes audioUrl. Before this fix:
  // clicking the row's play button expanded the row, but the auto-play
  // tried to play the STALE vm.recordingUrl (which 403s for older
  // voicemails). By the time the fresh URL arrived from
  // /voicemails/:id/fresh-url, the play() had already failed silently
  // and the user had to press the <audio> element's own play button to
  // actually start. With audioUrl in deps, this effect re-runs the
  // moment the fresh URL is set, calling play() with the now-valid src.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;
    const el = audioRef.current;
    const onLoaded = () => {
      if (isFinite(el.duration) && el.duration > 0) {
        setActualDuration(el.duration);
      }
    };
    el.addEventListener('loadedmetadata', onLoaded);
    // Auto-play on expand so a single click on the row's play button
    // both opens the player AND starts playing.
    el.play().catch(() => { /* autoplay may be blocked; user can press play */ });
    return () => el.removeEventListener('loadedmetadata', onLoaded);
  }, [expanded, audioUrl]);`,
  },
]);

// =====================================================================
// Version bumps 0.10.167 -> 0.10.168
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
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.167"/, '"version": "0.10.168"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.167 -> 0.10.168`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.167';`,
    replace: `const APP_VERSION = '0.10.168';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.168 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.167',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.168',
    date: 'June 16, 2026',
    highlight: 'Two audio bug fixes.',
    changes: [
      { type: 'fixed', text: 'When dialing out, the dialer used to play your selected ringtone in your own ear while waiting for the other side to pick up. It now plays the standard phone ringback instead. Your selected ringtone still plays as expected for incoming calls.' },
      { type: 'fixed', text: 'Voicemail play button on the main list used to require two clicks - the first expanded the row but did not start playback. Now a single click expands AND starts playing the recording.' },
    ],
  },
  {
    version: '0.10.167',`,
  },
]);

console.log('\n[apply-v168] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.168: outbound calls play classic ringback; voicemail play button single-click"');
console.log('  git tag v0.10.168');
console.log('  git push origin main');
console.log('  git push origin v0.10.168');
