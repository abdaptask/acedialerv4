#!/usr/bin/env node
// v0.10.159 - Bundle:
//   - Verbose step-by-step logging in the voicemail audio proxy so we can
//     pinpoint where the refresh chain is silently bailing.
//   - Users admin table: horizontal scroll inside the pane + sticky-right
//     Actions column so Call/Text/Menu icons are always reachable even
//     when the table is wider than the pane.
//
// CONTEXT: v0.10.158 added the refresh path + widened the pane but
// abdulla reports:
//   1. Voicemail still 0:00/0:00. Render logs show only the generic
//      "[voicemail] upstream audio fetch failed (after refresh attempt)"
//      message - we can't tell if the regex extracted a recordingId,
//      if Telnyx returned a fresh URL, or if the retry itself 403'd.
//      Need granular logging at every decision point.
//   2. Users admin table now shows MORE columns (Version, Last Login)
//      but the rightmost Actions column is still off-screen at common
//      viewport widths because the table is ~960px wide and the pane
//      caps at 720px.
//
// VOICEMAIL CHANGES (apps/api/src/voicemails/voicemails.routes.ts):
//   - getFreshTelnyxDownloadUrl returns { url, diagnostic } instead of
//     just url, so route logging can include Telnyx response details.
//   - Audio proxy route adds log lines at each step:
//       . start (with telnyxKey present? + URL host)
//       . first fetch result (status)
//       . extracted recordingId (or warn if regex returned null)
//       . Telnyx API response (status + body keys or error sample)
//       . retry fetch result (status)
//   - All logs include voicemailId so the trail can be reconstructed
//     even if multiple users hit the route concurrently.
//
// USERS PAGE CHANGES (apps/web/src/styles.css):
//   - .settings-pane-body:has(.users-admin-table): cap widened from 720
//     to min(960px, calc(100vw - 240px)) AND overflow-x: auto so a
//     1280px monitor fits all columns and a 1366px window scrolls
//     horizontally only as needed.
//   - .users-admin-actions: position:sticky; right:0 with a solid
//     background, so the Call/Text/Menu cluster stays glued to the
//     right edge whether the table is scrolled or not.
//
// VERSION BUMP: 0.10.158 -> 0.10.159

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v159] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v159] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v159] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v159] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. voicemails.routes.ts - verbose logging
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'getFreshTelnyxDownloadUrl now returns diagnostic info',
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
    replace: `// v0.10.157/.159 - Query Telnyx Recordings API for a fresh signed
// download URL. Returns BOTH the url (or null) AND diagnostic info so
// the calling route can log exactly why a refresh failed. The previous
// silent-null pattern hid root causes (no API key? wrong recordingId?
// Telnyx 404? unexpected response shape?). Now every failure mode has
// a structured diagnostic the caller logs.
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

      // v0.10.159 - log every decision point in the refresh chain.
      // The previous logging only fired the generic "fetch failed"
      // line; we couldn't tell which link broke (regex? Telnyx API?
      // retry?). Now each step emits a structured log with voicemailId
      // so multi-user concurrent calls can still be traced.
      request.log.info(
        {
          voicemailId: vm.id,
          hasTelnyxKey: !!telnyxKey,
          urlHost: (() => {
            try { return new URL(vm.recordingUrl).hostname; }
            catch { return 'invalid-url'; }
          })(),
        },
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
              { voicemailId: vm.id, recordingId, gotFreshUrl: !!freshUrl, ...diagnostic },
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
        } else if (!telnyxKey) {
          request.log.warn(
            { voicemailId: vm.id, firstAttemptStatus: upstream.status },
            '[voicemail] TELNYX_API_KEY not set - cannot refresh expired URLs',
          );
        }

        if (!upstream.ok) {
          // Capture upstream body sample for diagnostics (e.g. S3 XML
          // error tells us if the URL itself is malformed vs the
          // signature being expired).
          const bodySample = await upstream.text().catch(() => '').then((t) => t.slice(0, 300));
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

// =====================================================================
// 2. styles.css - Users page horizontal scroll + sticky-right Actions
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'widen pane + add overflow-x for Users/Audit tables',
    find: `/* v0.10.158 - the 560px cap above blocks Users / Audit Log tables which
   need 650-700px to render all columns without horizontal clipping. Use
   :has() to widen ONLY the panes hosting those tables. Other Settings
   sub-pages keep the original 560px reading width. */
.settings-pane-body:has(.users-admin-table),
.settings-pane-body:has(.audit-log-row-main) {
  max-width: 720px;
}`,
    replace: `/* v0.10.158 - the 560px cap above blocks Users / Audit Log tables which
   need 650-700px to render all columns without horizontal clipping. Use
   :has() to widen ONLY the panes hosting those tables. Other Settings
   sub-pages keep the original 560px reading width.
   v0.10.159 - bumped cap to min(960px, calc(100vw - 240px)) so on a
   typical 1280-1366px window the full table fits (8 columns ~= 960px),
   and on narrower windows the pane shrinks down so SOMETHING fits.
   Added overflow-x:auto so when the table is still wider than the pane
   it scrolls horizontally rather than clipping. Combined with the
   sticky-right Actions column below, the Call/Text/Menu icons stay
   reachable at any viewport width. */
.settings-pane-body:has(.users-admin-table),
.settings-pane-body:has(.audit-log-row-main) {
  max-width: min(960px, calc(100vw - 240px));
  overflow-x: auto;
}`,
  },
  {
    label: 'sticky-right Actions column',
    find: `.users-admin-actions {
  /* v0.10.158 - width was 44px (sized for the original kebab-only column).
     v0.10.94 added Call + Text icons making 3 icons total. The 44px cap
     clipped the new icons. Auto width + nowrap lets the row decide how
     much horizontal space the action cluster needs. min-width guarantees
     room for all three icons even at the narrowest pane width. */
  position: relative;
  width: auto;
  min-width: 110px;
  white-space: nowrap;
  text-align: right;
}`,
    replace: `.users-admin-actions {
  /* v0.10.158 - auto width + nowrap + 110px min so 3 icons all show.
     v0.10.159 - position:sticky pins the cell to the right edge of the
     scrollable pane. Solid background prevents the cells underneath
     from showing through during horizontal scroll. z-index keeps it
     above the table rows. The "Last Login" / "Version" columns can
     scroll under this sticky cell on narrow viewports without hiding
     Call/Text/Menu. */
  position: sticky;
  right: 0;
  min-width: 110px;
  white-space: nowrap;
  text-align: right;
  background: #1c1c1e;
  z-index: 1;
  box-shadow: -8px 0 12px -8px rgba(0, 0, 0, 0.35);
}
[data-theme="light"] .users-admin-actions {
  background: #fff;
  box-shadow: -8px 0 12px -8px rgba(0, 0, 0, 0.08);
}
/* The header cell that aligns with .users-admin-actions also needs to
   stick so the column header stays glued to the right edge of the
   scrolled table. */
.users-admin-table thead th:last-child {
  position: sticky;
  right: 0;
  background: #1c1c1e;
  z-index: 2;
}
[data-theme="light"] .users-admin-table thead th:last-child {
  background: #fff;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.158 -> 0.10.159
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
  c = c.replace(/"version":\s*"0\.10\.158"/, '"version": "0.10.159"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.158 -> 0.10.159`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.158';`,
    replace: `const APP_VERSION = '0.10.159';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.159 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.158',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.159',
    date: 'June 15, 2026',
    highlight: 'Diagnostic logging for voicemail audio + Users admin table fixes.',
    changes: [
      { type: 'improved', text: 'Admin > Users: the Call, Text, and More-actions icons now stick to the right edge of the table at any window width. On narrower windows, the table scrolls horizontally if needed while the actions column stays visible.' },
      { type: 'improved', text: 'Internal: the voicemail audio proxy now emits detailed logs at every step of the refresh chain so we can diagnose the remaining older-voicemail playback issue from server logs alone.' },
    ],
  },
  {
    version: '0.10.158',`,
  },
]);

console.log('\n[apply-v159] DONE');
console.log('');
console.log('AFTER PUSH AND DEPLOY:');
console.log('  1. Click play on the 12:11 PM voicemail in the dialer');
console.log('  2. Open Render dashboard -> ace-dialer-api -> Logs');
console.log('  3. Copy ALL lines containing [voicemail] from the last 60 seconds');
console.log('  4. Paste here. The log lines will show exactly which step in');
console.log('     the refresh chain is breaking:');
console.log('       . "regex did NOT extract" -> regex bug, fix that');
console.log('       . "Telnyx Recordings API lookup result" with telnyxStatus 404');
console.log('         -> recordingId is wrong, need different lookup strategy');
console.log('       . "Telnyx Recordings API lookup result" with telnyxStatus 401');
console.log('         -> TELNYX_API_KEY is stale, rotate it');
console.log('       . "retry with fresh URL result" status 200 -> bug fixed!');
console.log('       . "retry with fresh URL result" status 403 -> Telnyx is');
console.log('         giving us URLs that don\\'t work even when fresh');
console.log('');
console.log('USERS PAGE: refresh the dialer, navigate to Settings > Users');
console.log('  -> Call/Text/Menu icons should be glued to the right edge with');
console.log('     a subtle shadow showing the table can scroll under them.');
console.log('');
console.log('  git add -A');
console.log('  git commit -m "v0.10.159: verbose voicemail-audio logs + Users sticky-right Actions"');
console.log('  git tag v0.10.159');
console.log('  git push origin main');
console.log('  git push origin v0.10.159');
