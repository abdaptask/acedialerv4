#!/usr/bin/env node
// v0.10.152 - Switch voicemail greeting transcode from MP3 -> WAV.
//
// PROBLEM:
//   ACE dialer users report the voicemail greeting sounds choppy/staticky
//   when they call abdulla and hit voicemail. PSTN callers hear the same
//   greeting cleanly. Cause: double-lossy audio chain.
//
//     Browser webm/Opus  ->  our mp3 64kbps  ->  Telnyx mp3->Opus delivery
//                lossy           lossy                   lossy
//
//   Opus and MP3 use incompatible psychoacoustic models, so re-encoding
//   between them generates "warble" / metallic / staticky artifacts.
//   PSTN listeners only get mp3 -> G.711 (one lossy step), which is
//   transcode-friendly and sounds fine.
//
// FIX:
//   Change our server-side transcode output from MP3 -> WAV PCM 16-bit
//   mono at 48 kHz. WAV is lossless, so there's no codec-mismatch
//   artifact when Telnyx encodes wav -> Opus for WebRTC delivery, or
//   wav -> G.711 for PSTN delivery. Single transcode each way, clean.
//
//   Trade-off: file size grows ~10x (a 10s greeting at 48 kHz mono PCM
//   is ~960 KB vs ~80 KB mp3). Still well under Telnyx Play's limit and
//   negligible at our user count.
//
// SCOPE:
//   Only affects the webm->X transcode path (in-app recording). Pre-
//   recorded MP3/WAV/M4A uploads pass through unchanged. If those also
//   sound bad on WebRTC playback, address in a follow-up.
//
// PREREQUISITE:
//   Run apply-v151-restore-bypass.mjs first (bumps repo to 0.10.151).
//   This script assumes current version is 0.10.151 and bumps to .152.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v152] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v152] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v152] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200 chars): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v152] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. voicemailGreeting.routes.ts - rewrite transcode + caller
// ---------------------------------------------------------------------
applyEdits('apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts', [
  {
    label: 'update import comment block (webm->mp3 -> webm->wav)',
    find: `// v0.10.149 - bundled ffmpeg binary for webm→mp3 transcode at upload time.
// In-app MediaRecorder produces audio/webm which Telnyx <Play> cannot
// decode, causing "application error has occurred" during voicemail
// playback for TeXML trial users. Transcoding at upload fixes the
// playback path without changing the client-side recording flow.`,
    replace: `// v0.10.152 - bundled ffmpeg binary for webm→wav transcode at upload time.
// In-app MediaRecorder produces audio/webm which Telnyx <Play> cannot
// decode (caused "application error has occurred" for TeXML trial
// users in v0.10.149). v0.10.149 transcoded webm→mp3 64kbps, which
// fixed playback but produced choppy/staticky audio for WebRTC
// listeners because Telnyx then re-encoded mp3→Opus for delivery
// (double-lossy chain with incompatible psychoacoustic models).
// v0.10.152 switches the output to WAV PCM 16-bit mono 48kHz - lossless
// so Telnyx can do a single clean wav→Opus (or wav→G.711) on the
// delivery path. Larger file (~10x mp3) but acceptable at this scale.`,
  },
  {
    label: 'rewrite transcode docstring',
    find: `/**
 * v0.10.149 - Transcode a buffer of webm-encoded audio to MP3 using the
 * bundled ffmpeg-static binary. Writes input to a temp file, runs
 * ffmpeg with libmp3lame at 64kbps (voice quality, small file), reads
 * the output back into a buffer, and cleans up both temp files.
 *
 * 64kbps mono is plenty for a voicemail greeting (Telnyx caps audio
 * quality at 8kHz/PCM anyway on the call path).
 *
 * Throws if ffmpeg fails. Caller should catch and return 502 to the
 * client with a friendly message.
 */
async function transcodeWebmToMp3(input: Buffer): Promise<Buffer<ArrayBufferLike>> {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tmpIn = pathJoin(tmpdir(), \`vm-greeting-\${stamp}.webm\`);
  const tmpOut = pathJoin(tmpdir(), \`vm-greeting-\${stamp}.mp3\`);
  await writeFile(tmpIn, input);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .audioChannels(1)
        .toFormat('mp3')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(tmpOut);
    });
    return await readFile(tmpOut);
  } finally {
    // Best-effort cleanup. If unlink fails (e.g. transcode crashed
    // before writing tmpOut), don't surface that to the caller.
    await Promise.allSettled([unlink(tmpIn), unlink(tmpOut)]);
  }
}`,
    replace: `/**
 * v0.10.152 - Transcode a buffer of webm-encoded audio to lossless WAV
 * (PCM 16-bit mono 48kHz) using the bundled ffmpeg-static binary.
 *
 * Why WAV instead of MP3: Telnyx <Play> re-encodes whatever we hand it
 * into Opus (for WebRTC listeners) or G.711 (for PSTN listeners). If
 * our file is already MP3, Telnyx has to go MP3 -> Opus, which is a
 * lossy-to-lossy transcode between two codecs with incompatible
 * psychoacoustic models. The result is audible warble/static for
 * WebRTC listeners (PSTN listeners are fine because MP3 -> G.711 is
 * fundamentally a downsample/quantize). Handing Telnyx a lossless
 * WAV eliminates the codec-mismatch artifact entirely - it becomes a
 * single clean WAV -> {Opus|G.711} step.
 *
 * Trade-off: 10s of 48kHz mono PCM 16-bit ~= 960 KB (vs ~80 KB at
 * 64kbps mp3). Acceptable at our scale and well under Telnyx Play's
 * media size cap.
 *
 * Throws if ffmpeg fails. Caller should catch and return 502 to the
 * client with a friendly message.
 */
async function transcodeWebmToWav(input: Buffer): Promise<Buffer<ArrayBufferLike>> {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tmpIn = pathJoin(tmpdir(), \`vm-greeting-\${stamp}.webm\`);
  const tmpOut = pathJoin(tmpdir(), \`vm-greeting-\${stamp}.wav\`);
  await writeFile(tmpIn, input);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        // PCM 16-bit signed little-endian = standard uncompressed WAV.
        .audioCodec('pcm_s16le')
        // 48 kHz matches WebRTC Opus native sample rate so Telnyx can
        // pass through to Opus without resampling. PSTN path resamples
        // cleanly 48k -> 8k regardless.
        .audioFrequency(48000)
        .audioChannels(1)
        .toFormat('wav')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(tmpOut);
    });
    return await readFile(tmpOut);
  } finally {
    // Best-effort cleanup. If unlink fails (e.g. transcode crashed
    // before writing tmpOut), don't surface that to the caller.
    await Promise.allSettled([unlink(tmpIn), unlink(tmpOut)]);
  }
}`,
  },
  {
    label: 'update call-site comment block',
    find: `      // transcode to mp3 so Telnyx <Play> can decode it. We adjust both
      // the bytes and the downstream filename/mime so the storage write
      // and the User row record reflect mp3.`,
    replace: `      // v0.10.152 - transcode to WAV (lossless) so Telnyx <Play> can
      // decode it AND so Telnyx's onward Opus / G.711 transcoding for
      // WebRTC / PSTN listeners is a single clean step (no codec-
      // mismatch artifacts). We adjust both the bytes and the
      // downstream filename/mime so storage + User row reflect wav.`,
  },
  {
    label: 'update transcode call and effective mime/filename',
    find: `      if (normalizedMime === 'audio/webm') {
        try {
          const startMs = Date.now();
          bytes = await transcodeWebmToMp3(bytes);
          effectiveMime = 'audio/mpeg';
          effectiveFilename = filename.replace(/\\.[^.]+$/, '') + '.mp3';
          app.log.info(
            { userId: u.sub, type, durMs: Date.now() - startMs, outBytes: bytes.length },
            '[vm-greeting] webm→mp3 transcoded',`,
    replace: `      if (normalizedMime === 'audio/webm') {
        try {
          const startMs = Date.now();
          bytes = await transcodeWebmToWav(bytes);
          effectiveMime = 'audio/wav';
          effectiveFilename = filename.replace(/\\.[^.]+$/, '') + '.wav';
          app.log.info(
            { userId: u.sub, type, durMs: Date.now() - startMs, outBytes: bytes.length },
            '[vm-greeting] webm→wav transcoded',`,
  },
  {
    label: 'update Content-Type comment',
    find: `          // v0.10.149 - use effectiveMime so transcoded webm files get
          // stored with audio/mpeg content-type. Telnyx + browsers
          // then receive the right MIME on fetch.
          'Content-Type': effectiveMime,`,
    replace: `          // v0.10.152 - use effectiveMime so transcoded webm files get
          // stored with audio/wav content-type. Telnyx + browsers
          // then receive the right MIME on fetch.
          'Content-Type': effectiveMime,`,
  },
  {
    label: 'update filename comment',
    find: `          // v0.10.149 - record the *effective* filename so the Settings
          // UI shows the .mp3 extension that's actually stored.`,
    replace: `          // v0.10.152 - record the *effective* filename so the Settings
          // UI shows the .wav extension that's actually stored.`,
  },
]);

// ---------------------------------------------------------------------
// 2. Version bumps 0.10.151 -> 0.10.152
// ---------------------------------------------------------------------
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
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.151"/, '"version": "0.10.152"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.151 -> 0.10.152`);
  } else {
    console.log(`  - ${rp}: no 0.10.151 found (run apply-v151-restore-bypass.mjs first?)`);
  }
}

// ---------------------------------------------------------------------
// 3. DiagnosticsSection.tsx - bump APP_VERSION
// ---------------------------------------------------------------------
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.151';`,
    replace: `const APP_VERSION = '0.10.152';`,
  },
]);

// ---------------------------------------------------------------------
// 4. whatsNew.ts - add v0.10.152 entry
// ---------------------------------------------------------------------
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.152 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.151',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.152',
    date: 'June 15, 2026',
    highlight: 'Fixed: voicemail greeting sounded choppy/staticky when other ACE Dialer users called you.',
    changes: [
      { type: 'fixed', text: 'When another ACE Dialer user called you and hit your voicemail, your greeting sounded choppy or staticky. Phone (PSTN) callers heard the same greeting fine. The dialer was storing greetings as MP3, and Telnyx then had to re-encode that MP3 to a different audio codec for delivery to dialer listeners, which generated audible warble. We now store greetings as lossless WAV so Telnyx can deliver them cleanly to both phone and dialer callers. Existing greetings need to be re-recorded once to get the improvement.' },
    ],
  },
  {
    version: '0.10.151',`,
  },
]);

console.log('\n[apply-v152] DONE');
console.log('');
console.log('IMPORTANT: existing greetings stored as .mp3 (from v0.10.149) will keep');
console.log('sounding choppy until users re-record. The fix only applies to NEW recordings.');
console.log('After deploy, ask the testers to re-record their greeting in Settings.');
console.log('');
console.log('NEXT STEPS (run in repo root):');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.152: voicemail greeting transcode mp3 -> wav (fix WebRTC playback static)"');
console.log('  git tag v0.10.152');
console.log('  git push origin main');
console.log('  git push origin v0.10.152');
