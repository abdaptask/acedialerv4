#!/usr/bin/env node
// v0.10.161 - Verbose voicemail audio proxy logging.
//
// PURPOSE: pure diagnostic release. Adds detailed logs at every
// decision point in the audio proxy refresh chain so we can read the
// Render logs after a failed playback and see EXACTLY which step
// broke. NO behavior change - this only adds log lines.
//
// AFTER PUSH AND DEPLOY:
//   1. Click play on an OLD voicemail (one that 403s like id=1070)
//   2. Open Render dashboard -> ace-dialer-api -> Logs
//   3. Copy ALL lines containing "[voicemail]" from the last 60 seconds
//   4. Paste here - the logs will pinpoint the exact failure:
//        * "regex did NOT extract" -> our extraction missed; fix that
//        * "Telnyx Recordings API lookup result" with telnyxStatus 404
//          -> recording ID we extracted isn't valid in Telnyx's API
//        * telnyxStatus 401 -> TELNYX_API_KEY is stale
//        * "retry with fresh URL result" status 200 -> bug fixed!
//        * "retry with fresh URL result" status 403 -> Telnyx's own
//          fresh URLs are still failing somehow
//
// CHANGES (one file only, additive):
//   apps/api/src/voicemails/voicemails.routes.ts
//     - getFreshTelnyxDownloadUrl returns { url, diagnostic } instead
//       of just url, so route logging includes Telnyx response details.
//     - Audio proxy route emits structured logs at every step:
//         start, first fetch result, recordingId extraction result,
//         Telnyx lookup result, retry result, final failure body sample.
//
// SAFE TO DEPLOY: zero functional change. Same input -> same output.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v161] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v161] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v161] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v161] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. getFreshTelnyxDownloadUrl returns diagnostic info
// ---------------------------------------------------------------------
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'getFreshTelnyxDownloadUrl returns diagnostic info',
    find: `// v0.10.157 - Query Telnyx Recordings API for a fresh signed download URL.
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
    replace: `// v0.10.157/.161 - Query Telnyx Recordings API for a fresh signed
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
  },
  {
    label: 'audio proxy route: verbose logging at every decision point',
    find: `      const tryFetch = async (url: string) => {
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
        }`,
    replace: `      const tryFetch = async (url: string) => {
        const headers: Record<string, string> = {};
        if (telnyxKey && /(^|\\.)telnyx\\.com\\//.test(url)) {
          headers.Authorization = \`Bearer \${telnyxKey}\`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      // v0.10.161 - log every decision point so failures can be
      // diagnosed from Render logs alone. The previous code only
      // logged the generic "fetch failed" line at the end and we
      // couldn't tell which step in the chain broke (regex, Telnyx
      // API call, retry, etc.). All log lines include voicemailId.
      const urlHost = (() => {
        try { return new URL(vm.recordingUrl).hostname; }
        catch { return 'invalid-url'; }
      })();
      request.log.info(
        { voicemailId: vm.id, hasTelnyxKey: !!telnyxKey, urlHost },
        '[voicemail] audio proxy: start',
      );

      try {
        let upstream = await tryFetch(vm.recordingUrl);
        request.log.info(
          { voicemailId: vm.id, firstAttemptStatus: upstream.status },
          '[voicemail] audio proxy: first fetch attempt',
        );

        if (
          (upstream.status === 401 || upstream.status === 403) &&
          telnyxKey
        ) {
          const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
          if (!recordingId) {
            request.log.warn(
              {
                voicemailId: vm.id,
                urlSample: vm.recordingUrl.split('?')[0].slice(0, 200),
              },
              '[voicemail] regex did NOT extract a recordingId from URL',
            );
          } else {
            const { url: freshUrl, diagnostic } =
              await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
            request.log.info(
              {
                voicemailId: vm.id,
                recordingId,
                gotFreshUrl: !!freshUrl,
                ...diagnostic,
              },
              '[voicemail] Telnyx Recordings API lookup result',
            );
            if (freshUrl) {
              request.log.info(
                { voicemailId: vm.id, recordingId },
                '[voicemail] stored URL expired, retrying with fresh signed URL',
              );
              upstream = await tryFetch(freshUrl);
              request.log.info(
                { voicemailId: vm.id, retryStatus: upstream.status },
                '[voicemail] retry with fresh URL result',
              );
            }
          }
        } else if (
          (upstream.status === 401 || upstream.status === 403) &&
          !telnyxKey
        ) {
          request.log.warn(
            { voicemailId: vm.id, firstAttemptStatus: upstream.status },
            '[voicemail] TELNYX_API_KEY not set - cannot refresh expired URLs',
          );
        }

        if (!upstream.ok) {
          // Capture upstream body sample so a 403 XML from S3 (or
          // anything else) is visible in the log line.
          const bodySample = await upstream
            .text()
            .catch(() => '')
            .then((t) => t.slice(0, 300));
          request.log.warn(
            { voicemailId: vm.id, status: upstream.status, bodySample },
            '[voicemail] upstream audio fetch failed (after refresh attempt)',
          );
          return reply.code(502).send({
            error: \`Failed to fetch audio: HTTP \${upstream.status}\`,
          });
        }`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.160 -> 0.10.161
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
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.160"/, '"version": "0.10.161"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.160 -> 0.10.161`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.160';`,
    replace: `const APP_VERSION = '0.10.161';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.161 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.160',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.161',
    date: 'June 15, 2026',
    highlight: 'Internal diagnostic improvements (no user-visible changes).',
    changes: [
      { type: 'improved', text: 'Server-side: voicemail audio playback now writes detailed step-by-step logs so the engineering team can diagnose any future playback issue from the server logs alone. No change to how the dialer behaves.' },
    ],
  },
  {
    version: '0.10.160',`,
  },
]);

console.log('\n[apply-v161] DONE');
console.log('');
console.log('AFTER PUSH AND DEPLOY (~5 min for Render):');
console.log('  1. Click play on an older voicemail (one that 403s)');
console.log('  2. Open Render dashboard -> ace-dialer-api -> Logs');
console.log('  3. Copy ALL lines containing "[voicemail]" from the last 60s');
console.log('  4. Paste them here. They will pinpoint the failing step:');
console.log('       . urlHost = which CDN/host the URL points to');
console.log('       . firstAttemptStatus = upstream response to the stored URL');
console.log('       . If "regex did NOT extract" appears -> regex bug to fix');
console.log('       . Telnyx lookup result includes telnyxStatus + body keys');
console.log('       . retry result tells us if the fresh URL worked');
console.log('       . final bodySample shows the upstream error response');
console.log('');
console.log('Then:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.161: verbose voicemail audio proxy logs (no behavior change)"');
console.log('  git tag v0.10.161');
console.log('  git push origin main');
console.log('  git push origin v0.10.161');
