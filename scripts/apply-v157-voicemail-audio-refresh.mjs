#!/usr/bin/env node
// v0.10.157 - Voicemail audio refresh: re-fetch a fresh download URL
// from Telnyx when the stored URL 401/403's.
//
// PROBLEM:
//   The Voicemail table stores `recordingUrl` captured at receive-time.
//   Telnyx recording download URLs are signed with a limited lifetime
//   (sometimes hours, sometimes days). Months later, the stored URL
//   returns 403 even with a valid Bearer token because the URL signature
//   itself has expired. Result: older voicemails show transcript fine
//   but the audio fetch fails. Reproduced by abdulla on voicemail id=1070
//   after v0.10.156 deep-link landed in the desktop app.
//
// FIX (Option A from task #28 - quick fix; Option B persist-to-Supabase
// planned for v0.11.0 as part of Voicemail Retention work):
//   When the stored URL fails with 401/403, extract the recording ID
//   from the URL (it's a UUID embedded in the path), query Telnyx's
//   Recordings API to get a fresh signed download URL, and retry once.
//   New voicemails are unaffected - their stored URLs still work, so
//   the fresh-URL path is never hit for them.
//
// API SHAPE we rely on (Telnyx Recordings v2):
//   GET https://api.telnyx.com/v2/recordings/{recording_id}
//   -> { data: { id, download_urls: { mp3, wav }, ... } }
//
// SCOPE:
//   - apps/api/src/voicemails/voicemails.routes.ts only
//   - No schema change
//   - No data migration
//   - Bump 0.10.156 -> 0.10.157

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v157] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v157] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v157] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v157] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. voicemails.routes.ts - add helpers + retry-with-fresh-URL logic
// ---------------------------------------------------------------------
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'add Telnyx recording-id helpers at top of file',
    find: `// Voicemail endpoints. Phase 5.6.
// Voicemail records are inserted by the webhook handler when Telnyx finishes
// recording an unanswered call. The user endpoints below read + mark as
// listened.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';`,
    replace: `// Voicemail endpoints. Phase 5.6.
// Voicemail records are inserted by the webhook handler when Telnyx finishes
// recording an unanswered call. The user endpoints below read + mark as
// listened.
//
// v0.10.157 - audio refresh helper for older recordings whose stored
// signed URL has expired. See task #28 + the audio proxy route below.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';

// v0.10.157 - Parse a Telnyx recording UUID out of a stored download URL.
// Telnyx URLs typically embed the recording_id as a UUID in the path,
// e.g. https://api.telnyx.com/v2/recordings/<uuid>/download/<token>.mp3
// or https://media.telnyx.com/v2/recording/<uuid>.mp3. Returns null if
// no UUID-shaped segment is present (older test setups using S3, etc.).
function extractRecordingIdFromUrl(url: string): string | null {
  const m = url.match(/\\/recordings?\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

// v0.10.157 - Query Telnyx Recordings API for a fresh signed download URL.
// Used when the stored URL returns 401/403 (signature expired). Returns
// null on any error so the caller can surface the original failure
// without masking it. We prefer the mp3 download_url; fall back to wav.
async function getFreshTelnyxDownloadUrl(
  recordingId: string,
  telnyxKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      \`https://api.telnyx.com/v2/recordings/\${encodeURIComponent(recordingId)}\`,
      { method: 'GET', headers: { Authorization: \`Bearer \${telnyxKey}\` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        download_urls?: { mp3?: string; wav?: string };
        // Some Telnyx responses use 'recording_url' as a flat field
        // (older API shape). Accept either.
        recording_url?: string;
      };
    };
    return (
      body?.data?.download_urls?.mp3 ??
      body?.data?.download_urls?.wav ??
      body?.data?.recording_url ??
      null
    );
  } catch {
    return null;
  }
}`,
  },
  {
    label: 'replace audio proxy body with retry-on-401/403 logic',
    find: `  // v0.10.2 Task 9 — audio proxy. Telnyx hosted-voicemail recordings
  // live behind a Bearer-auth-protected URL on api.telnyx.com — the
  // browser can't fetch them directly. We proxy: authenticate the
  // requesting user via JWT, verify they own the voicemail, fetch the
  // upstream MP3 with our Telnyx API key, stream the bytes back with
  // an audio Content-Type so the HTML5 <audio> tag plays it.
  //
  // We DON'T cache the upstream URL — it's tied to our Telnyx account
  // and rotating credentials means a stale URL would 401 anyway. Each
  // playback fetches fresh.
  app.get(
    '/voicemails/:id/audio',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const vmId = Number(id);
      if (!Number.isFinite(vmId)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const vm = await prisma.voicemail.findFirst({
        where: { id: vmId, userId: user.sub },
        select: { id: true, recordingUrl: true },
      });
      if (!vm) return reply.code(404).send({ error: 'Not found' });
      if (!vm.recordingUrl) {
        return reply.code(404).send({ error: 'No recording available' });
      }
      const telnyxKey = process.env.TELNYX_API_KEY;
      try {
        const headers: Record<string, string> = {};
        // Only attach Telnyx Bearer when the URL is actually on
        // api.telnyx.com. Some legacy rows might point at signed S3
        // URLs from older test setups — sending Bearer on those is
        // harmless but explicit-gating avoids leaking the key.
        if (telnyxKey && /(^|\\.)telnyx\\.com\\//.test(vm.recordingUrl)) {
          headers.Authorization = \`Bearer \${telnyxKey}\`;
        }
        const upstream = await fetch(vm.recordingUrl, { method: 'GET', headers });
        if (!upstream.ok) {
          request.log.warn(
            { voicemailId: vm.id, status: upstream.status },
            '[voicemail] upstream audio fetch failed',
          );
          return reply.code(502).send({
            error: \`Failed to fetch audio: HTTP \${upstream.status}\`,
          });
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // Telnyx recordings are MP3. Set explicit Content-Type so the
        // browser's <audio> element plays without guessing. Allow
        // caching since the recording itself is immutable.
        reply
          .header('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
          .header('Content-Length', String(buf.length))
          .header('Cache-Control', 'private, max-age=3600')
          .header('Accept-Ranges', 'bytes');
        return reply.send(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        request.log.error({ err: msg }, '[voicemail] audio proxy error');
        return reply.code(502).send({ error: \`Audio proxy error: \${msg}\` });
      }
    },
  );`,
    replace: `  // v0.10.2 Task 9 — audio proxy. Telnyx hosted-voicemail recordings
  // live behind a Bearer-auth-protected URL on api.telnyx.com — the
  // browser can't fetch them directly. We proxy: authenticate the
  // requesting user via JWT, verify they own the voicemail, fetch the
  // upstream MP3 with our Telnyx API key, stream the bytes back with
  // an audio Content-Type so the HTML5 <audio> tag plays it.
  //
  // v0.10.157 - older recordings (months back) have a stored
  // recordingUrl whose signature has expired, so the upstream fetch
  // returns 401 or 403 even with a valid Bearer token. When that
  // happens, parse the recording UUID out of the stored URL, query
  // Telnyx Recordings API to get a fresh signed download URL, and
  // retry once. Brand-new voicemails are unaffected because their
  // stored URL still works on the first try.
  app.get(
    '/voicemails/:id/audio',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const vmId = Number(id);
      if (!Number.isFinite(vmId)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const vm = await prisma.voicemail.findFirst({
        where: { id: vmId, userId: user.sub },
        select: { id: true, recordingUrl: true },
      });
      if (!vm) return reply.code(404).send({ error: 'Not found' });
      if (!vm.recordingUrl) {
        return reply.code(404).send({ error: 'No recording available' });
      }
      const telnyxKey = process.env.TELNYX_API_KEY;

      // Helper: attempt a single upstream fetch with appropriate auth.
      const tryFetch = async (url: string) => {
        const headers: Record<string, string> = {};
        if (telnyxKey && /(^|\\.)telnyx\\.com\\//.test(url)) {
          headers.Authorization = \`Bearer \${telnyxKey}\`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      try {
        // First attempt: the URL captured at receive-time.
        let upstream = await tryFetch(vm.recordingUrl);

        // v0.10.157 - recover from expired signed URLs. 401/403 on a
        // Telnyx URL almost always means the URL signature lapsed
        // (not an auth-key issue, since the same key works for fresh
        // recordings). Try refreshing once.
        if (
          (upstream.status === 401 || upstream.status === 403) &&
          telnyxKey
        ) {
          const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
          if (recordingId) {
            const freshUrl = await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
            if (freshUrl) {
              request.log.info(
                { voicemailId: vm.id, recordingId },
                '[voicemail] stored URL expired, retrying with fresh signed URL',
              );
              upstream = await tryFetch(freshUrl);
            }
          }
        }

        if (!upstream.ok) {
          request.log.warn(
            { voicemailId: vm.id, status: upstream.status },
            '[voicemail] upstream audio fetch failed (after refresh attempt)',
          );
          return reply.code(502).send({
            error: \`Failed to fetch audio: HTTP \${upstream.status}\`,
          });
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // Telnyx recordings are MP3. Set explicit Content-Type so the
        // browser's <audio> element plays without guessing. Allow
        // caching since the recording itself is immutable.
        reply
          .header('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
          .header('Content-Length', String(buf.length))
          .header('Cache-Control', 'private, max-age=3600')
          .header('Accept-Ranges', 'bytes');
        return reply.send(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        request.log.error({ err: msg }, '[voicemail] audio proxy error');
        return reply.code(502).send({ error: \`Audio proxy error: \${msg}\` });
      }
    },
  );`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.156 -> 0.10.157
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
  c = c.replace(/"version":\s*"0\.10\.156"/, '"version": "0.10.157"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.156 -> 0.10.157`);
  } else {
    console.log(`  - ${rp}: no 0.10.156 found (run apply-v156-* first?)`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.156';`,
    replace: `const APP_VERSION = '0.10.157';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.157 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.156',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.157',
    date: 'June 15, 2026',
    highlight: 'Fixed: older voicemails now play correctly.',
    changes: [
      { type: 'fixed', text: 'Older voicemails would show their transcript but fail with "Failed to fetch audio: HTTP 403" when you pressed play. The audio links Telnyx gave us at the time the message was left have a limited lifetime and were expiring on older recordings. The dialer now automatically fetches a fresh audio link from Telnyx when the original one stops working, so every voicemail in your inbox plays again — no action required from you.' },
    ],
  },
  {
    version: '0.10.156',`,
  },
]);

console.log('\n[apply-v157] DONE');
console.log('');
console.log('TEST PLAN:');
console.log('  1. After Render redeploys ace-dialer-api, open the SAME old voicemail');
console.log('     (id=1070 or any other historical one that was 403-ing).');
console.log('  2. Audio should now play. Check the Render API logs for an entry like:');
console.log('     [voicemail] stored URL expired, retrying with fresh signed URL');
console.log('     That confirms the refresh path activated.');
console.log('  3. NEW voicemails should still play with no extra log line (their');
console.log('     stored URL still works first try).');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  git status');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.157: voicemail audio refresh on expired URL (Option A; Option B in v0.11.0)"');
console.log('  git tag v0.10.157');
console.log('  git push origin main');
console.log('  git push origin v0.10.157');
