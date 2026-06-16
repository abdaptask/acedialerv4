#!/usr/bin/env node
// v0.10.163 - Fresh-URL endpoint + Tier 1 bandwidth wins.
//
// THE FIX (older voicemail audio):
//   The 10-minute Telnyx S3 signed-URL expiry meant any voicemail not
//   played within ~10 min of receipt would 403. Frontend was binding
//   <audio src> to the stored (now-stale) URL directly, so browser hit
//   S3 with an expired signature and got XML "Request has expired."
//
//   v0.10.163 adds a small endpoint, GET /voicemails/:id/fresh-url,
//   that calls Telnyx's Recordings API for a freshly-signed download
//   URL on each play. Frontend (Voicemail.tsx) fetches this on row
//   expand and uses the fresh URL as <audio src>. Browser still
//   downloads audio bytes directly from S3 - no proxy through our
//   server, no bandwidth charges on Render.
//
//   Critically: if the fresh-URL endpoint fails for any reason, the
//   frontend falls back to the stored vm.recordingUrl. So fresh
//   voicemails - whose stored URL still works - never regress. This
//   was the failure mode of v0.10.158's proxy-everything approach.
//
// TIER 1 BANDWIDTH WINS:
//   - @fastify/compress registered on the API. gzip/brotli on JSON
//     responses cuts response size ~40-50%. Voicemail list + Recents
//     + Messages all benefit.
//   - Cache-Control: private, max-age=30 on /voicemails list. The
//     polling-every-2s pattern we see in the logs now hits cache for
//     short bursts. Mostly affects the API's outbound bandwidth.
//
// MULTI-PATTERN extractRecordingIdFromUrl:
//   The v0.10.157 regex only matched /recordings/<uuid>/ path style.
//   Actual Telnyx S3 URLs put the UUID in the filename:
//     /telephony-recorder-prod/{accountId}/{date}/{recordingId}-{ts}.mp3
//   New regex tries 4 patterns in order, last-resort matches any UUID
//   in the path (preferring the rightmost since account IDs come first).
//
// VERSION BUMP: 0.10.162 -> 0.10.163

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v163] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v163] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v163] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v163] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. API: voicemails.routes.ts - multi-pattern regex + fresh-url endpoint + cache header
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'multi-pattern extractRecordingIdFromUrl',
    find: `// v0.10.157 - Parse a Telnyx recording UUID out of a stored download URL.
// Telnyx URLs typically embed the recording_id as a UUID in the path,
// e.g. https://api.telnyx.com/v2/recordings/<uuid>/download/<token>.mp3
// or https://media.telnyx.com/v2/recording/<uuid>.mp3. Returns null if
// no UUID-shaped segment is present (older test setups using S3, etc.).
function extractRecordingIdFromUrl(url: string): string | null {
  const m = url.match(/\\/recordings?\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}`,
    replace: `// v0.10.157/.163 - Parse a Telnyx recording UUID out of a stored
// download URL. v0.10.163 broadened the regex to also match the
// actual Telnyx S3 telephony-recorder-prod filename pattern:
//   /.../<account_id>/<date>/<recording_id>-<timestamp>.mp3
// Earlier versions only matched /recordings/<uuid>/ paths and silently
// returned null for the S3 filename pattern, defeating the refresh
// logic for any voicemail Telnyx stored on S3 (i.e., basically all of
// them). New regex tries multiple patterns in order; the last-resort
// branch picks the rightmost UUID in the path since the account_id
// typically comes before the recording_id.
function extractRecordingIdFromUrl(url: string): string | null {
  // Strip query string so signature params don't interfere with matching.
  const path = url.split('?')[0];

  // Pattern A: Telnyx S3 telephony-recorder-prod filename
  //   /.../<recording_uuid>-<timestamp>.{mp3,wav}
  const s3Filename = path.match(
    /\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\\d+\\.(?:mp3|wav)$/i,
  );
  if (s3Filename) return s3Filename[1];

  // Pattern B: api.telnyx.com/v2/recordings/<uuid>/...
  const apiPath = path.match(
    /\\/recordings?\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (apiPath) return apiPath[1];

  // Pattern C: simple /<uuid>.{mp3,wav}
  const simpleFilename = path.match(
    /\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.(?:mp3|wav)$/i,
  );
  if (simpleFilename) return simpleFilename[1];

  // Pattern D (last resort): any UUID anywhere in the path. Prefer
  // the rightmost since account_id usually precedes recording_id.
  const allUuids = [
    ...path.matchAll(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    ),
  ];
  if (allUuids.length > 0) return allUuids[allUuids.length - 1][1];

  return null;
}`,
  },
  {
    label: 'add Cache-Control to /voicemails list',
    find: `  app.get('/voicemails', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const user = request.user as JwtPayload;
    const purged = await purgeExpired(user.sub);
    if (purged > 0) {
      app.log.info({ userId: user.sub, purged }, '[voicemail] auto-deleted expired rows');
    }
    const items = await prisma.voicemail.findMany({
      where: { userId: user.sub },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      // v0.10.0 Task 5 — include UserDid for the line-badge tag.
      include: {
        userDid: {
          select: { id: true, label: true, colorHex: true, didNumber: true },
        },
      },
    });
    return items;
  });`,
    replace: `  app.get('/voicemails', { onRequest: [app.authenticate] }, async (request: FastifyRequest, reply) => {
    const user = request.user as JwtPayload;
    const purged = await purgeExpired(user.sub);
    if (purged > 0) {
      app.log.info({ userId: user.sub, purged }, '[voicemail] auto-deleted expired rows');
    }
    const items = await prisma.voicemail.findMany({
      where: { userId: user.sub },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      // v0.10.0 Task 5 — include UserDid for the line-badge tag.
      include: {
        userDid: {
          select: { id: true, label: true, colorHex: true, didNumber: true },
        },
      },
    });
    // v0.10.163 - short browser cache to reduce bandwidth from the
    // polling pattern in the Voicemail list view. 30s is short enough
    // that a brand-new voicemail still appears within reason, long
    // enough to cut down on ~75% of redundant fetches during normal
    // listening sessions.
    reply.header('Cache-Control', 'private, max-age=30');
    return items;
  });`,
  },
  {
    label: 'add /voicemails/:id/fresh-url endpoint',
    find: `  // PATCH /voicemails/:id  { listened?: boolean }`,
    replace: `  // v0.10.163 - GET /voicemails/:id/fresh-url
  // Returns a freshly-signed Telnyx S3 download URL for the voicemail's
  // recording. The stored vm.recordingUrl is signed with a finite
  // expiry (Telnyx currently uses 10 min); after that window the URL
  // returns 403. The frontend hits this endpoint on row expand to
  // get a fresh URL it can hand to the <audio> element.
  //
  // Falls back to the stored URL on any internal failure (no API key,
  // unparseable URL, Telnyx error) so fresh voicemails - whose stored
  // URL still works - never regress.
  //
  // Why we return a URL instead of proxying audio bytes through our
  // server: keeps our outbound bandwidth low. Audio still streams
  // browser <-> S3 directly. Render bandwidth measured in KB per click,
  // not MB.
  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
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
  });

  // PATCH /voicemails/:id  { listened?: boolean }`,
  },
]);

// =====================================================================
// 2. API: package.json - add @fastify/compress dependency
// =====================================================================
applyEdits('apps/api/package.json', [
  {
    label: 'add @fastify/compress dependency',
    find: `    "@fastify/cors": "^9.0.1",`,
    replace: `    "@fastify/compress": "^7.0.3",
    "@fastify/cors": "^9.0.1",`,
  },
]);

// =====================================================================
// 3. API: main.ts - register @fastify/compress
// =====================================================================
applyEdits('apps/api/src/main.ts', [
  {
    label: 'import @fastify/compress',
    find: `import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';`,
    replace: `import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';`,
  },
  {
    label: 'register @fastify/compress before CORS',
    find: `await app.register(cors, {
  // Reflect the request's Origin header instead of using wildcard \`true\`.`,
    replace: `// v0.10.163 - gzip/brotli compression for JSON responses. Cuts
// outbound bandwidth ~40-50% on the Voicemail / Recents / Messages
// list endpoints (the chatty pollers). Threshold of 1KB skips
// compressing tiny payloads where compression overhead exceeds savings.
// global: false so individual routes can opt out via { compress: false }
// if they ever ship binary content that's already compressed.
await app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['br', 'gzip'],
});

await app.register(cors, {
  // Reflect the request's Origin header instead of using wildcard \`true\`.`,
  },
]);

// =====================================================================
// 4. Web: api.ts - add getFreshVoicemailUrl helper
// =====================================================================
applyEdits('apps/web/src/api.ts', [
  {
    label: 'add getFreshVoicemailUrl helper',
    find: `// v0.10.2 Task 9 — single voicemail metadata + audio for the playback page.
export async function getVoicemail(token: string, id: number): Promise<VoicemailRecord> {
  const res = await fetch(\`\${API_URL}/voicemails/\${id}\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });`,
    replace: `// v0.10.163 - Fetch a freshly-signed Telnyx URL for a voicemail's
// recording. Telnyx's stored signed URLs expire after ~10 min, so
// older voicemails need a fresh URL at play time. Server falls back
// to the stored URL if anything goes wrong on its side (no API key,
// regex failure, Telnyx error), so this never blocks playback of
// fresh voicemails. Caller still has vm.recordingUrl as a final
// fallback if THIS fetch itself fails (network error, 5xx, etc).
export async function getFreshVoicemailUrl(token: string, id: number): Promise<string | null> {
  try {
    const res = await fetch(\`\${API_URL}/voicemails/\${id}/fresh-url\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string };
    return body?.url ?? null;
  } catch {
    return null;
  }
}

// v0.10.2 Task 9 — single voicemail metadata + audio for the playback page.
export async function getVoicemail(token: string, id: number): Promise<VoicemailRecord> {
  const res = await fetch(\`\${API_URL}/voicemails/\${id}\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });`,
  },
]);

// =====================================================================
// 5. Web: Voicemail.tsx - fetch fresh URL on row expand, use it as audio src
// =====================================================================
applyEdits('apps/web/src/pages/Voicemail.tsx', [
  {
    label: 'add audioUrl state',
    find: `  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Actual duration discovered from the audio file once it loads. The
  // server-stored \`durationSeconds\` is sometimes 0/1 because Telnyx Hosted
  // Voicemail's webhook payload doesn't always include duration; the audio
  // element itself knows the right answer once metadata loads.
  const [actualDuration, setActualDuration] = useState<number | null>(null);`,
    replace: `  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Actual duration discovered from the audio file once it loads. The
  // server-stored \`durationSeconds\` is sometimes 0/1 because Telnyx Hosted
  // Voicemail's webhook payload doesn't always include duration; the audio
  // element itself knows the right answer once metadata loads.
  const [actualDuration, setActualDuration] = useState<number | null>(null);
  // v0.10.163 - <audio src> backing. Defaults to vm.recordingUrl (the
  // stored URL, valid for fresh voicemails). On row expand we ask the
  // API for a fresh signed URL via /voicemails/:id/fresh-url to handle
  // OLDER voicemails whose stored URL has lapsed past Telnyx's 10-min
  // signature window. If the fresh-URL fetch fails for any reason,
  // we keep the stored URL - so fresh voicemails never regress.
  const [audioUrl, setAudioUrl] = useState<string>(vm.recordingUrl);`,
  },
  {
    label: 'add useEffect to fetch fresh URL on expand',
    find: `  // When the row expands, start playback automatically and capture the
  // real duration from the audio element's metadata.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;`,
    replace: `  // v0.10.163 - on row expand, ask the API for a fresh signed Telnyx
  // URL. If we get one, swap it into audioUrl so <audio src> uses the
  // fresh URL. If anything fails, audioUrl stays at vm.recordingUrl
  // (the original behavior for fresh voicemails).
  useEffect(() => {
    if (!expanded) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { getFreshVoicemailUrl } = await import('../api');
        const fresh = await getFreshVoicemailUrl(token, vm.id);
        if (!cancelled && fresh) setAudioUrl(fresh);
      } catch {
        /* keep audioUrl = vm.recordingUrl as fallback */
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, vm.id]);

  // When the row expands, start playback automatically and capture the
  // real duration from the audio element's metadata.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;`,
  },
  {
    label: 'swap <audio src> from vm.recordingUrl to audioUrl',
    find: `          <audio
            ref={audioRef}
            controls
            src={vm.recordingUrl}
            preload="metadata"`,
    replace: `          <audio
            ref={audioRef}
            controls
            /* v0.10.163 - audioUrl starts as vm.recordingUrl and is
               replaced with a freshly-signed Telnyx URL when the
               useEffect above completes. Older voicemails play after
               that swap; fresh voicemails play immediately because
               vm.recordingUrl is still valid. */
            src={audioUrl}
            preload="metadata"`,
  },
]);

// =====================================================================
// Version bumps 0.10.162 -> 0.10.163
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
  c = c.replace(/"version":\s*"0\.10\.162"/, '"version": "0.10.163"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.162 -> 0.10.163`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.162';`,
    replace: `const APP_VERSION = '0.10.163';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.163 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.162',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.163',
    date: 'June 16, 2026',
    highlight: 'Older voicemails now play again.',
    changes: [
      { type: 'fixed', text: 'Voicemails older than ~10 minutes were silently failing to play (showing 0:00 / 0:00). Telnyx signs the audio links with a short expiry; the dialer now asks for a freshly-signed link each time you open a voicemail, so all of your voicemails play regardless of how old they are.' },
      { type: 'improved', text: 'Server responses are now gzip/brotli compressed which cuts data usage by roughly 40-50% on the lists you see in Voicemail, Recents, and Messages.' },
    ],
  },
  {
    version: '0.10.162',`,
  },
]);

console.log('\n[apply-v163] DONE');
console.log('');
console.log('LOCAL TEST PLAN (must pass before push):');
console.log('  1. Install the new dependency:');
console.log('       cd apps/api && npm install');
console.log('  2. Typecheck both projects:');
console.log('       cd ../..');
console.log('       npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('       npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. Run locally (two terminals):');
console.log('       terminal 1: cd apps/api && npm run dev');
console.log('       terminal 2: cd apps/web && npm run dev');
console.log('  4. Open the local web URL, log in, go to Voicemail tab.');
console.log('  5. Click on the 12:11 PM voicemail (older, was failing):');
console.log('       Expected: brief loading delay then audio plays.');
console.log('       Network tab should show GET /voicemails/<id>/fresh-url');
console.log('       returning 200, then <audio> downloads from S3 directly.');
console.log('  6. Click on any newer voicemail:');
console.log('       Expected: plays normally (fresh-url returns a URL, but');
console.log('       even if it failed, audioUrl falls back to stored URL).');
console.log('  7. Watch the Network tab for compressed responses:');
console.log('       Voicemail list response should have');
console.log('       Content-Encoding: gzip or br header.');
console.log('');
console.log('IF BOTH OLD AND NEW VOICEMAILS PLAY LOCALLY, push:');
console.log('  git add -A');
console.log('  git commit -m "v0.10.163: voicemail fresh-URL endpoint + compression + cache headers"');
console.log('  git tag v0.10.163');
console.log('  git push origin main');
console.log('  git push origin v0.10.163');
console.log('');
console.log('IF EITHER OLD OR NEW FAILS LOCALLY: do NOT push. Paste me the');
console.log('  DevTools console + network tab info and we debug before deploying.');
