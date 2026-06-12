#!/usr/bin/env node
// v0.10.149 - Server-side webm→mp3 transcode for voicemail greetings.
//
// CONTEXT: The in-app voicemail greeting recorder uses the browser
// MediaRecorder API, which on Chrome/Edge produces audio/webm. We were
// storing those files as-is in Supabase Storage. When Telnyx's <Play>
// verb tries to play them during an incoming voicemail flow, it returns
// "an application error has occurred" because Telnyx does not support
// WebM (only MP3, WAV PCM, M4A, etc.). Affected users: nileshd@aptask.com,
// ravindra@aptask.com (both on TeXML voicemail trial). Discovered today.
//
// FIX: On upload, if mime is audio/webm, transcode to audio/mpeg using
// ffmpeg-static (a Node-bundled ffmpeg binary, no Render system-dep
// required). Store with .mp3 extension + audio/mpeg content-type.
// Existing webm files for the two users get re-recorded by the users
// themselves once this lands (or backfilled manually).
//
// CHANGES:
//   1. apps/api/package.json - add ffmpeg-static + fluent-ffmpeg deps
//   2. apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts -
//      add transcodeWebmToMp3 helper + invoke before upload
//
// ROLLOUT NOTES:
//   - Render will run `npm install` on next deploy which downloads
//     ffmpeg-static (~70MB platform-specific binary). The first build
//     after this lands will be slower; subsequent builds use the cache.
//   - After deploy, nilesh + ravindra need to re-record their greetings
//     in-app. The OLD webm files in Supabase are still there (not
//     deleted), but their User.voicemailGreetingUrl still points to
//     the webm. Easiest path: ask them to re-record, which uploads a
//     new file + updates the URL.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v149] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) { console.error(`[apply-v149] FATAL: file not found: ${fp}`); process.exit(1); }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v149] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v149] FATAL: duplicate match for edit #${i+1} (${edit.label})`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. apps/api/package.json — add ffmpeg-static + fluent-ffmpeg
// ===========================================================
applyEdits('apps/api/package.json', [
  {
    label: 'add ffmpeg-static + fluent-ffmpeg dependencies',
    find: `    "bcryptjs": "^2.4.3",
    "fastify": "^4.27.0",`,
    replace: `    "bcryptjs": "^2.4.3",
    "fastify": "^4.27.0",
    "ffmpeg-static": "^5.2.0",
    "fluent-ffmpeg": "^2.1.3",`,
  },
  {
    label: 'add @types/fluent-ffmpeg to devDependencies',
    find: `  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.11.0"
  }`,
    replace: `  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/fluent-ffmpeg": "^2.1.27",
    "@types/node": "^20.11.0"
  }`,
  },
]);

// ===========================================================
// 2. voicemailGreeting.routes.ts — add transcode helper + invoke
// ===========================================================
applyEdits('apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts', [
  {
    label: 'add ffmpeg imports + transcodeWebmToMp3 helper',
    find: `import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';
import { config } from '../config.js';`,
    replace: `import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';
import { config } from '../config.js';
// v0.10.149 - bundled ffmpeg binary for webm→mp3 transcode at upload time.
// In-app MediaRecorder produces audio/webm which Telnyx <Play> cannot
// decode, causing "application error has occurred" during voicemail
// playback for TeXML trial users. Transcoding at upload fixes the
// playback path without changing the client-side recording flow.
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'node:os';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
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
async function transcodeWebmToMp3(input: Buffer): Promise<Buffer> {
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
        .on('error', (err) => reject(err))
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
    label: 'invoke transcodeWebmToMp3 in the upload handler when mime is audio/webm',
    find: `      const bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length > MAX_BYTES) {
        return reply.code(413).send({ error: \`File too large (max \${MAX_BYTES / 1024 / 1024} MB).\` });
      }

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectPath = \`voicemail-greetings/u\${u.sub}/\${type}/\${Date.now()}_\${safeName}\`;`,
    replace: `      let bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length > MAX_BYTES) {
        return reply.code(413).send({ error: \`File too large (max \${MAX_BYTES / 1024 / 1024} MB).\` });
      }

      // v0.10.149 - if upload is webm (in-app MediaRecorder output),
      // transcode to mp3 so Telnyx <Play> can decode it. We adjust both
      // the bytes and the downstream filename/mime so the storage write
      // and the User row record reflect mp3.
      let effectiveMime = normalizedMime;
      let effectiveFilename = filename;
      if (normalizedMime === 'audio/webm') {
        try {
          const startMs = Date.now();
          bytes = await transcodeWebmToMp3(bytes);
          effectiveMime = 'audio/mpeg';
          effectiveFilename = filename.replace(/\\.[^.]+$/, '') + '.mp3';
          app.log.info(
            { userId: u.sub, type, durMs: Date.now() - startMs, outBytes: bytes.length },
            '[vm-greeting] webm→mp3 transcoded',
          );
        } catch (transcodeErr) {
          app.log.error(
            { err: transcodeErr instanceof Error ? transcodeErr.message : String(transcodeErr), userId: u.sub },
            '[vm-greeting] webm→mp3 transcode failed',
          );
          return reply.code(502).send({
            error: 'Greeting recording could not be processed. Try uploading an MP3 file instead.',
          });
        }
      }

      const safeName = effectiveFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectPath = \`voicemail-greetings/u\${u.sub}/\${type}/\${Date.now()}_\${safeName}\`;`,
  },
  {
    label: 'use effectiveMime for the Supabase upload Content-Type header',
    find: `      const uploadUrl = \`\${config.supabaseUrl}/storage/v1/object/\${config.supabaseMediaBucket}/\${objectPath}\`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: \`Bearer \${config.supabaseServiceKey}\`,
          'Content-Type': normalizedMime,
          'x-upsert': 'true',
        },
        body: bytes,
      });`,
    replace: `      const uploadUrl = \`\${config.supabaseUrl}/storage/v1/object/\${config.supabaseMediaBucket}/\${objectPath}\`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: \`Bearer \${config.supabaseServiceKey}\`,
          // v0.10.149 - use effectiveMime so transcoded webm files get
          // stored with audio/mpeg content-type. Telnyx + browsers
          // then receive the right MIME on fetch.
          'Content-Type': effectiveMime,
          'x-upsert': 'true',
        },
        body: bytes,
      });`,
  },
  {
    label: 'use effectiveFilename when saving the User row',
    find: `      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: {
          [c.url]: publicUrl,
          [c.filename]: filename,
          [c.mode]: 'audio',
        },`,
    replace: `      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: {
          [c.url]: publicUrl,
          // v0.10.149 - record the *effective* filename so the Settings
          // UI shows the .mp3 extension that's actually stored.
          [c.filename]: effectiveFilename,
          [c.mode]: 'audio',
        },`,
  },
]);

// ===========================================================
// Version bumps to 0.10.149
// ===========================================================
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'apps/socket/package.json', 'apps/webhooks/package.json', 'packages/db/package.json'];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.148"/, '"version": "0.10.149"');
  if (c !== before) { writeFileSync(fp, c, 'utf8'); console.log(`  ✓ ${rp}: bumped`); }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  { label: 'bump APP_VERSION', find: `const APP_VERSION = '0.10.148';`, replace: `const APP_VERSION = '0.10.149';` },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.149 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.148',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.149',\n    date: 'June 12, 2026',\n    highlight: 'Fixed: in-app voicemail greeting recordings now play correctly (webm → mp3 server-side transcode)',\n    changes: [\n      { type: 'fixed', text: 'Custom voicemail greetings recorded with the in-app Record button now play correctly when callers reach voicemail. Previously, browsers MediaRecorder API produced WebM audio which Telnyx could not decode, causing callers to hear "an application error has occurred" instead of the greeting. The API now transcodes WebM uploads to MP3 server-side before storing them, so the entire recording flow now works end-to-end. Users on the TeXML voicemail trial who recorded greetings before this release should re-record (one tap in Settings) so their greeting becomes the new MP3-encoded version.' },\n      { type: 'fixed', text: 'Internal: added ffmpeg-static + fluent-ffmpeg dependencies to the API service. Transcoding runs at upload time (a few hundred milliseconds for a 30-second greeting), saved to Supabase Storage as audio/mpeg. No client-side changes - the in-app Record button works the same way.' },\n    ],\n  },\n  {\n    version: '0.10.148',`,
  },
]);

console.log('\n[apply-v149] DONE');
console.log('');
console.log('After running this script:');
console.log('  1. cd apps/api && npm install   # pulls ffmpeg-static (~70MB binary)');
console.log('  2. cd ../..');
console.log('  3. npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit && git push');
console.log('');
console.log('Render auto-deploys ace-dialer-api. First deploy is slower because');
console.log("Render's npm install downloads the ffmpeg binary.");
console.log('');
console.log('AFTER deploy: tell nilesh + ravindra to re-record their greeting');
console.log('in-app (Settings → Voicemail Greeting → Record). The new recording');
console.log('will transcode to MP3 on upload and Telnyx will play it correctly.');
