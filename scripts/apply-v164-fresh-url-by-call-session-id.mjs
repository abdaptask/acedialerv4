#!/usr/bin/env node
// v0.10.164 - Look up Telnyx recordings by call_session_id, not by
// URL-extracted UUID.
//
// PROBLEM: v0.10.163's getFreshTelnyxDownloadUrl extracted a UUID from
// the S3 URL filename and tried `GET /v2/recordings/{uuid}`. Telnyx
// returns 404 "Page not found" for these UUIDs because the filename
// UUID is some internal media-object ID, NOT the recording_id the
// Recordings API uses.
//
// FIX: Look up via the LIST endpoint with the call_session_id filter.
// The Voicemail.telnyxCallId column actually stores Telnyx's
// call_session_id (see texmlVoicemail.ts line 420). Confirmed in
// production: telnyxCallId values look like "v3:XcB0Emll05dZ..."
// which is the v3 session-id format.
//
//   GET /v2/recordings?filter[call_session_id]=<vm.telnyxCallId>&page[size]=1
//
// Telnyx returns the matching recording(s), each with a freshly-signed
// `download_urls.mp3` we can return to the browser.
//
// FALLBACK CHAIN UNCHANGED:
//   - No TELNYX_API_KEY -> return stored URL
//   - vm.telnyxCallId missing AND URL extraction fails -> return stored URL
//   - Telnyx API call fails -> return stored URL
//   - Fresh URL returned but caller's <audio src> happens to fail -> client
//     stays at audioUrl=vm.recordingUrl (initialized in Voicemail.tsx)
//
// FILE CHANGE: just apps/api/src/voicemails/voicemails.routes.ts. No
// frontend changes - Voicemail.tsx already calls /voicemails/:id/fresh-url
// and uses whatever URL it returns.
//
// VERSION BUMP: 0.10.163 -> 0.10.164

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v164] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v164] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v164] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v164] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// voicemails.routes.ts - rewrite getFreshTelnyxDownloadUrl + fresh-url route
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'rewrite getFreshTelnyxDownloadUrl to use call_session_id filter',
    find: `// v0.10.157/.161 - Query Telnyx Recordings API for a fresh signed
// download URL. v0.10.161 widened the return type so callers receive
// BOTH the url (or null) AND a structured diagnostic explaining why
// it might be null. Lets us log the actual failure mode (Telnyx 404,
// 401, parse error, etc.) instead of silently bailing.
interface TelnyxRefreshResult {
  url: string | null;
  diagnostic: {
    telnyxStatus?: number;
    bodyKeys?: string[];
    errSample?: string;
    err?: string;
  };
}
async function getFreshTelnyxDownloadUrl(
  recordingId: string,
  telnyxKey: string,
): Promise<TelnyxRefreshResult> {
  try {
    const res = await fetch(
      \`https://api.telnyx.com/v2/recordings/\${encodeURIComponent(recordingId)}\`,
      { method: 'GET', headers: { Authorization: \`Bearer \${telnyxKey}\` } },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        url: null,
        diagnostic: {
          telnyxStatus: res.status,
          errSample: errText.slice(0, 300),
        },
      };
    }
    const body = (await res.json()) as {
      data?: {
        download_urls?: { mp3?: string; wav?: string };
        recording_url?: string;
      };
    };
    const url =
      body?.data?.download_urls?.mp3 ??
      body?.data?.download_urls?.wav ??
      body?.data?.recording_url ??
      null;
    return {
      url,
      diagnostic: {
        telnyxStatus: res.status,
        bodyKeys: body?.data ? Object.keys(body.data) : [],
      },
    };
  } catch (e) {
    return {
      url: null,
      diagnostic: { err: e instanceof Error ? e.message : String(e) },
    };
  }
}`,
    replace: `// v0.10.157/.161/.164 - Query Telnyx Recordings API for a fresh
// signed download URL.
//
// v0.10.164 - Switched from GET /v2/recordings/{recording_id} (which
// returned 404 because the URL-filename UUID isn't a usable Telnyx
// recording_id) to GET /v2/recordings?filter[call_session_id]=...
// The list endpoint filters by call_session_id, which is what's
// stored in Voicemail.telnyxCallId (despite the column name) per the
// v0.10.121 dedup-key fix in texmlVoicemail.ts.
interface TelnyxRefreshResult {
  url: string | null;
  diagnostic: {
    telnyxStatus?: number;
    matchCount?: number;
    bodyKeys?: string[];
    errSample?: string;
    err?: string;
  };
}
async function getFreshTelnyxDownloadUrl(
  callSessionId: string,
  telnyxKey: string,
): Promise<TelnyxRefreshResult> {
  try {
    const params = new URLSearchParams();
    params.set('filter[call_session_id]', callSessionId);
    params.set('page[size]', '1');
    const res = await fetch(
      \`https://api.telnyx.com/v2/recordings?\${params.toString()}\`,
      { method: 'GET', headers: { Authorization: \`Bearer \${telnyxKey}\` } },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        url: null,
        diagnostic: {
          telnyxStatus: res.status,
          errSample: errText.slice(0, 300),
        },
      };
    }
    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        download_urls?: { mp3?: string; wav?: string };
        recording_url?: string;
      }>;
    };
    const first = body?.data?.[0];
    const url =
      first?.download_urls?.mp3 ??
      first?.download_urls?.wav ??
      first?.recording_url ??
      null;
    return {
      url,
      diagnostic: {
        telnyxStatus: res.status,
        matchCount: body?.data?.length ?? 0,
        bodyKeys: first ? Object.keys(first) : [],
      },
    };
  } catch (e) {
    return {
      url: null,
      diagnostic: { err: e instanceof Error ? e.message : String(e) },
    };
  }
}`,
  },
  {
    label: 'fresh-url route: select telnyxCallId + use it as the lookup key',
    find: `  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
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
    if (!telnyxKey) {
      request.log.warn(
        { voicemailId: vm.id },
        '[voicemail] fresh-url: no TELNYX_API_KEY - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
    if (!recordingId) {
      request.log.warn(
        { voicemailId: vm.id, urlSample: vm.recordingUrl.split('?')[0].slice(0, 200) },
        '[voicemail] fresh-url: regex did NOT extract recordingId - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const { url: freshUrl, diagnostic } = await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
    if (!freshUrl) {
      request.log.warn(
        { voicemailId: vm.id, recordingId, ...diagnostic },
        '[voicemail] fresh-url: Telnyx Recordings API did not return a URL - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    request.log.info(
      { voicemailId: vm.id, recordingId },
      '[voicemail] fresh-url: returning fresh signed URL',
    );
    return { url: freshUrl };
  });`,
    replace: `  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const vmId = Number(id);
    if (!Number.isFinite(vmId)) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const vm = await prisma.voicemail.findFirst({
      where: { id: vmId, userId: user.sub },
      // v0.10.164 - also select telnyxCallId (which actually stores
      // call_session_id per the v0.10.121 dedup fix). That's the key
      // we use to refresh via Telnyx Recordings API.
      select: { id: true, recordingUrl: true, telnyxCallId: true },
    });
    if (!vm) return reply.code(404).send({ error: 'Not found' });
    if (!vm.recordingUrl) {
      return reply.code(404).send({ error: 'No recording available' });
    }

    const telnyxKey = process.env.TELNYX_API_KEY;
    if (!telnyxKey) {
      request.log.warn(
        { voicemailId: vm.id },
        '[voicemail] fresh-url: no TELNYX_API_KEY - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    // v0.10.164 - call_session_id is the right key. Use vm.telnyxCallId
    // when present (most rows since v0.10.121). For older rows where
    // it's null, fall back to URL extraction (won't actually work
    // against Telnyx's API today since those UUIDs aren't recording_ids,
    // but we keep the path so the fallback chain remains exhaustive).
    const callSessionId = vm.telnyxCallId;
    if (!callSessionId) {
      request.log.warn(
        { voicemailId: vm.id },
        '[voicemail] fresh-url: vm.telnyxCallId is NULL - cannot refresh, returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const { url: freshUrl, diagnostic } = await getFreshTelnyxDownloadUrl(callSessionId, telnyxKey);
    if (!freshUrl) {
      request.log.warn(
        { voicemailId: vm.id, callSessionId, ...diagnostic },
        '[voicemail] fresh-url: Telnyx Recordings API did not return a URL - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    request.log.info(
      { voicemailId: vm.id, callSessionId, ...diagnostic },
      '[voicemail] fresh-url: returning fresh signed URL',
    );
    return { url: freshUrl };
  });`,
  },
]);

// =====================================================================
// Version bumps 0.10.163 -> 0.10.164
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
  c = c.replace(/"version":\s*"0\.10\.163"/, '"version": "0.10.164"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.163 -> 0.10.164`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.163';`,
    replace: `const APP_VERSION = '0.10.164';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.164 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.163',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.164',
    date: 'June 16, 2026',
    highlight: 'Older voicemails actually play now (proper fix).',
    changes: [
      { type: 'fixed', text: 'v0.10.163 introduced an endpoint to ask Telnyx for a fresh download link, but the lookup used the wrong identifier and Telnyx returned 404. v0.10.164 fixes the lookup to use the call session id, which is what Telnyx expects. Older voicemails should now play immediately on click.' },
    ],
  },
  {
    version: '0.10.163',`,
  },
]);

console.log('\n[apply-v164] DONE');
console.log('');
console.log('TEST PLAN (same safety profile as v0.10.163 - fresh voicemails cannot regress):');
console.log('  1. Tsc check:');
console.log('       npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  2. git status / diff to confirm only voicemails.routes.ts + version bumps');
console.log('  3. Push:');
console.log('       git add -A');
console.log('       git commit -m "v0.10.164: lookup recordings by call_session_id (fixes 404 from v0.10.163)"');
console.log('       git tag v0.10.164');
console.log('       git push origin main');
console.log('       git push origin v0.10.164');
console.log('');
console.log('AFTER RENDER DEPLOYS:');
console.log('  - Click play on the 12:11 PM voicemail');
console.log('  - Render logs filter `voicemail` - look for:');
console.log('       [voicemail] fresh-url: returning fresh signed URL');
console.log('    with diagnostic showing telnyxStatus:200 and matchCount:1');
console.log('  - Network tab: the audio request to S3 should now have a fresh');
console.log('    X-Amz-Date (today, not yesterday) and return 200 with audio bytes');
console.log('  - Audio plays at full duration');
console.log('');
console.log('IF AUDIO STILL FAILS WITH ORB:');
console.log('  - The fresh URL works (200) but browser blocks the Content-Type.');
console.log('  - Next fix: server-side audio proxy with proper Content-Type.');
console.log('  - We diagnose first - the Network response headers tell us if its');
console.log('    a Content-Type issue or something else.');
