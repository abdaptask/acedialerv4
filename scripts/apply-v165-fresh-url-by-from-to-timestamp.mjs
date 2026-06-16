#!/usr/bin/env node
// v0.10.165 - Look up Telnyx recordings by from/to/timestamp window
// instead of call_session_id.
//
// PROBLEM TRAIL:
//   v0.10.157: regex-extracted UUID from URL filename. Telnyx 404 "Page
//              not found" - that UUID isn't a Telnyx recording_id.
//   v0.10.164: switched to filter[call_session_id] using vm.telnyxCallId.
//              Telnyx 422 "is invalid" with pointer /telnyx_session_uuid -
//              the filter exists but expects a UUID format, NOT the
//              v3:... opaque string our column actually stores.
//
// v0.10.165: copy the from+to+created_at filter pattern from
//   texmlVoicemail.ts:listTelnyxRecordings (which works for our per-call
//   polling at receipt time). Filter:
//     filter[from]=<vm.fromNumber>
//     filter[to]=<vm.toNumber>
//     filter[created_at][gte]=<vm.receivedAt - 5s>
//     filter[created_at][lte]=<vm.receivedAt + 30s>
//   The tight time window narrows to the one recording matching this
//   call. Returns the first result's download_urls.mp3.
//
// FILE CHANGES:
//   apps/api/src/voicemails/voicemails.routes.ts only.
//
// FALLBACK CHAIN UNCHANGED: any failure path returns stored URL so
// fresh voicemails can't regress.
//
// VERSION BUMP: 0.10.164 -> 0.10.165

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v165] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v165] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v165] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v165] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// voicemails.routes.ts - filter by from+to+timestamp window
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'rewrite getFreshTelnyxDownloadUrl with from+to+created_at filter',
    find: `// v0.10.157/.161/.164 - Query Telnyx Recordings API for a fresh
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
    replace: `// v0.10.157/.161/.164/.165 - Query Telnyx Recordings API for a fresh
// signed download URL.
//
// v0.10.165 - Switched to from+to+created_at filter pattern (mirroring
// texmlVoicemail.ts:listTelnyxRecordings which is known-working). The
// call_session_id filter Telnyx exposes expects a UUID format, but our
// vm.telnyxCallId stores the v3:... opaque session ID - so 422
// "is invalid". The from/to/timestamp combination uniquely identifies
// a voicemail in practice (caller hangs up exactly once per call) and
// a tight ±window means we always pick the right recording.
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
  fromNumber: string,
  toNumber: string,
  receivedAt: Date,
  telnyxKey: string,
): Promise<TelnyxRefreshResult> {
  try {
    // Window: 5 seconds before to 30 seconds after receivedAt. The
    // recording's created_at on Telnyx's side usually lands within a
    // few seconds of when we wrote the Voicemail row. ±30s gives us
    // enough slack without overlapping a subsequent voicemail from
    // the same caller.
    const gteMs = receivedAt.getTime() - 5_000;
    const lteMs = receivedAt.getTime() + 30_000;
    const params = new URLSearchParams();
    params.set('filter[from]', fromNumber);
    params.set('filter[to]', toNumber);
    params.set('filter[created_at][gte]', new Date(gteMs).toISOString());
    params.set('filter[created_at][lte]', new Date(lteMs).toISOString());
    params.set('page[size]', '5');
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
        recording_started_at?: string;
      }>;
    };
    // Pick the recording whose recording_started_at is closest to
    // receivedAt. In practice the window should contain only one
    // match; this is just belt-and-suspenders for callers who left
    // back-to-back voicemails within the window.
    const candidates = body?.data ?? [];
    const target = receivedAt.getTime();
    let best: typeof candidates[number] | undefined = candidates[0];
    let bestDelta = Infinity;
    for (const c of candidates) {
      if (!c.recording_started_at) continue;
      const t = Date.parse(c.recording_started_at);
      if (Number.isNaN(t)) continue;
      const delta = Math.abs(t - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = c;
      }
    }
    const url =
      best?.download_urls?.mp3 ??
      best?.download_urls?.wav ??
      best?.recording_url ??
      null;
    return {
      url,
      diagnostic: {
        telnyxStatus: res.status,
        matchCount: candidates.length,
        bodyKeys: best ? Object.keys(best) : [],
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
    label: 'fresh-url route: use from/to/receivedAt as the lookup',
    find: `  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
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
    replace: `  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const vmId = Number(id);
    if (!Number.isFinite(vmId)) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const vm = await prisma.voicemail.findFirst({
      where: { id: vmId, userId: user.sub },
      // v0.10.165 - select fromNumber/toNumber/receivedAt instead of
      // telnyxCallId. Those three together uniquely identify a
      // voicemail in Telnyx's recordings index (caller hangs up
      // exactly once per call).
      select: { id: true, recordingUrl: true, fromNumber: true, toNumber: true, receivedAt: true },
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

    // v0.10.165 - all three fields are required to filter Telnyx
    // recordings reliably. If any is missing, the row is corrupt and
    // we can't refresh.
    if (!vm.fromNumber || !vm.toNumber || !vm.receivedAt) {
      request.log.warn(
        { voicemailId: vm.id, hasFrom: !!vm.fromNumber, hasTo: !!vm.toNumber, hasReceivedAt: !!vm.receivedAt },
        '[voicemail] fresh-url: missing fromNumber/toNumber/receivedAt - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const { url: freshUrl, diagnostic } = await getFreshTelnyxDownloadUrl(
      vm.fromNumber,
      vm.toNumber,
      vm.receivedAt,
      telnyxKey,
    );
    if (!freshUrl) {
      request.log.warn(
        { voicemailId: vm.id, fromNumber: vm.fromNumber, toNumber: vm.toNumber, ...diagnostic },
        '[voicemail] fresh-url: Telnyx Recordings API did not return a URL - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    request.log.info(
      { voicemailId: vm.id, ...diagnostic },
      '[voicemail] fresh-url: returning fresh signed URL',
    );
    return { url: freshUrl };
  });`,
  },
]);

// =====================================================================
// Version bumps 0.10.164 -> 0.10.165
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
  c = c.replace(/"version":\s*"0\.10\.164"/, '"version": "0.10.165"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.164 -> 0.10.165`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.164';`,
    replace: `const APP_VERSION = '0.10.165';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.165 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.164',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.165',
    date: 'June 16, 2026',
    highlight: 'Older voicemails play - take three.',
    changes: [
      { type: 'fixed', text: 'Continued the fix for older-voicemail playback. The previous attempts looked up recordings by the wrong identifier. This release uses caller number + recipient number + timestamp - the same lookup pattern our voicemail-receipt code already uses successfully.' },
    ],
  },
  {
    version: '0.10.164',`,
  },
]);

console.log('\n[apply-v165] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.165: fresh-URL lookup by from/to/timestamp (Telnyx 422 fix)"');
console.log('  git tag v0.10.165');
console.log('  git push origin main');
console.log('  git push origin v0.10.165');
console.log('');
console.log('AFTER RENDER REDEPLOYS:');
console.log('  Click play on 12:11 PM voicemail. Render logs should show:');
console.log('    [voicemail] fresh-url: returning fresh signed URL');
console.log('    with telnyxStatus:200 matchCount:1');
console.log('  Audio should play.');
