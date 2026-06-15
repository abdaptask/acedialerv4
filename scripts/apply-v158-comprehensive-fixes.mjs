#!/usr/bin/env node
// v0.10.158 - Comprehensive bundle:
//   - 5 Settings-page responsive CSS fixes (Users action icons clipped,
//     Audit Log timestamp column squashed, Bulk-sync table, etc.)
//   - Enhanced recording-ID extraction (handles Telnyx S3 URL pattern)
//   - Voicemail list-view audio plays through API proxy (not raw S3)
//
// FOLLOW-UP TO v0.10.157 which only partially fixed the older-voicemail
// 403 issue. After v0.10.157 deployed, abdulla confirmed the audio STILL
// returns the S3 expired-URL XML. DevTools showed the request going
// directly to s3.amazonaws.com (NOT our /voicemails/:id/audio proxy)
// because Voicemail.tsx list view binds <audio src={vm.recordingUrl}>
// directly. ALSO our v0.10.157 regex failed to match the real URL
// pattern: /telephony-recorder-prod/{accountId}/{date}/{recordingId}-{timestamp}.mp3
//
// FIXES IN THIS RELEASE:
//
// CSS (5 fixes in apps/web/src/styles.css):
//   1. .users-admin-actions: width:44px -> auto, nowrap, min-width:110px
//      so 3 icons (Phone/MessageSquare/MoreHorizontal) all show.
//   2. .settings-pane-body :has(.users-admin-section), :has(.audit-log-section)
//      max-width override 560px -> 720px so the wide tables don't clip.
//   3. .audit-log-row-main grid-template-columns shrink at max-width:700px.
//   4. .bulk-sync-results-table table-layout:fixed + proportional widths.
//   5. .users-admin-table responsive padding + email column hide @700px.
//
// API (apps/api/src/voicemails/voicemails.routes.ts):
//   6. extractRecordingIdFromUrl now tries 4 regex patterns including
//      the Telnyx S3 telephony-recorder-prod filename pattern. Falls back
//      to "any UUID in path, prefer the last one".
//
// WEB (apps/web/src/pages/Voicemail.tsx):
//   7. Voicemail list-view <audio> element now uses getVoicemailAudioBlob
//      (API proxy) instead of raw vm.recordingUrl. Audio actually
//      benefits from v0.10.157+v0.10.158 refresh logic. Drops the
//      lightweight duration probe (was using raw URL too; cant easily
//      proxy a metadata-only probe; we trust vm.durationSeconds for the
//      collapsed-row label and discover real duration on expand).
//
// VERSION BUMP: 0.10.157 -> 0.10.158

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v158] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v158] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v158] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v158] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// CSS FIXES (5)
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'fix #1 .users-admin-actions width auto + nowrap + min-width',
    find: `.users-admin-actions {
  position: relative;
  width: 44px;
  text-align: right;
}`,
    replace: `.users-admin-actions {
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
  },
  {
    label: 'fix #2 .settings-pane-body :has() override for users + audit tables',
    find: `.settings-pane-body {
  max-width: 560px;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  scroll-behavior: smooth;
}`,
    replace: `.settings-pane-body {
  max-width: 560px;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  scroll-behavior: smooth;
}
/* v0.10.158 - the 560px cap above blocks Users / Audit Log tables which
   need 650-700px to render all columns without horizontal clipping. Use
   :has() to widen ONLY the panes hosting those tables. Other Settings
   sub-pages keep the original 560px reading width. */
.settings-pane-body:has(.users-admin-table),
.settings-pane-body:has(.audit-log-row-main) {
  max-width: 720px;
}`,
  },
  {
    label: 'fix #3 .audit-log-row-main responsive grid at max-width:700px',
    find: `.users-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}`,
    replace: `/* v0.10.158 - audit log + users tables: responsive overrides at narrow
   viewport so column proportions don't squash text past readability.
   The 700px breakpoint matches the new .settings-pane-body :has()
   override above so the rules engage in the right viewport range. */
@media (max-width: 700px) {
  .audit-log-row-main {
    grid-template-columns: 80px 1fr 24px;
    font-size: 12px;
  }
  .audit-log-when { font-size: 11px; }
  .users-admin-table { font-size: 12px; }
  .users-admin-table th,
  .users-admin-table td { padding: 8px 6px; }
  /* Hide the email column at the narrowest viewport; the user's name and
     DID are still visible. Email is recoverable by hovering / clicking
     into the user row. */
  .users-admin-table .users-admin-email-cell { display: none; }
}

.users-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}`,
  },
  {
    label: 'fix #4 .bulk-sync-results-table CSS file insert at end of users-admin block',
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
}

/* v0.10.158 - bulk-sync results table (Settings > Migrate > Bulk-refresh
   SMS output) was rendered inline with overflow:auto on the wrapper but
   no column constraints. Adding table-layout:fixed + proportional widths
   keeps the table inside its pane without horizontal scroll juggling. */
.bulk-sync-results-table {
  width: 100%;
  table-layout: fixed;
}
.bulk-sync-results-table th:nth-child(1),
.bulk-sync-results-table td:nth-child(1) { width: 35%; }
.bulk-sync-results-table th:nth-child(2),
.bulk-sync-results-table td:nth-child(2) { width: 25%; }
.bulk-sync-results-table th:nth-child(3),
.bulk-sync-results-table td:nth-child(3) { width: 20%; }
.bulk-sync-results-table th:nth-child(4),
.bulk-sync-results-table td:nth-child(4) { width: 20%; }
.bulk-sync-results-table td {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}`,
  },
]);

// =====================================================================
// API: enhanced extractRecordingIdFromUrl + better logging
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'fix #6 multi-pattern extractRecordingIdFromUrl',
    find: `// v0.10.157 - Parse a Telnyx recording UUID out of a stored download URL.
// Telnyx URLs typically embed the recording_id as a UUID in the path,
// e.g. https://api.telnyx.com/v2/recordings/<uuid>/download/<token>.mp3
// or https://media.telnyx.com/v2/recording/<uuid>.mp3. Returns null if
// no UUID-shaped segment is present (older test setups using S3, etc.).
function extractRecordingIdFromUrl(url: string): string | null {
  const m = url.match(/\\/recordings?\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}`,
    replace: `// v0.10.157/.158 - Parse a Telnyx recording UUID out of a stored
// download URL. The previous v0.10.157 regex only matched the
// /recordings/<uuid>/ path style which DIDN'T cover the actual S3
// pattern Telnyx uses for hosted-voicemail recordings:
//   https://s3.amazonaws.com/telephony-recorder-prod/<account_uuid>/
//     <YYYY-MM-DD>/<recording_uuid>-<timestamp>.mp3
// v0.10.158 tries multiple patterns in order, falling back to "any
// UUID in the path, prefer the last one" so future Telnyx URL shape
// changes don't silently break the refresh path again.
function extractRecordingIdFromUrl(url: string): string | null {
  // Strip query string so signature params don't interfere with matching.
  const path = url.split('?')[0];

  // Pattern A: Telnyx S3 telephony-recorder-prod filename:
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

  // Pattern D (last resort): any UUID anywhere in the path. Multiple
  // UUIDs are common (account_id + recording_id); prefer the LAST one
  // since the account/connection id usually comes first in the path.
  const allUuids = [
    ...path.matchAll(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    ),
  ];
  if (allUuids.length > 0) {
    return allUuids[allUuids.length - 1][1];
  }

  return null;
}`,
  },
]);

// =====================================================================
// WEB: Voicemail.tsx list view uses API proxy for audio
// =====================================================================
applyEdits('apps/web/src/pages/Voicemail.tsx', [
  {
    label: 'fix #7a remove raw-URL duration probe (used vm.recordingUrl directly)',
    find: `  // Lightweight pre-fetch of duration for the *collapsed* row too. We hide
  // the audio element off-screen, ask for metadata only, and update state
  // when the duration arrives. No data downloaded beyond the headers.
  useEffect(() => {
    if (!vm.recordingUrl || actualDuration !== null) return;
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = vm.recordingUrl;
    const onLoaded = () => {
      if (isFinite(probe.duration) && probe.duration > 0) {
        setActualDuration(probe.duration);
      }
    };
    probe.addEventListener('loadedmetadata', onLoaded);
    // Cleanup so we don't leak audio elements.
    return () => {
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.src = '';
    };
  }, [vm.recordingUrl, actualDuration]);`,
    replace: `  // v0.10.158 - REMOVED the collapsed-row duration probe. It pointed
  // <audio src> at the raw vm.recordingUrl which now 403s for older
  // voicemails (Telnyx S3 signed URLs expire after 10 minutes). We
  // could re-implement as a proxy-based probe but it'd fetch the entire
  // audio file just to read metadata - expensive at list-view scale.
  // Instead we trust vm.durationSeconds (server-stored) for the
  // collapsed-row label; the real duration is discovered when the user
  // expands the row and the proxied <audio> loads metadata (see the
  // useEffect at "When the row expands..." above).`,
  },
  {
    label: 'fix #7b add audioBlobUrl state + proxy fetch on expand',
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
  // v0.10.158 - blob URL backing the <audio> element. Built from a JWT-
  // authenticated fetch of our /voicemails/:id/audio proxy endpoint
  // (which now refreshes expired Telnyx signed URLs server-side via
  // v0.10.157+v0.10.158 refresh logic). Replaces the old approach of
  // pointing <audio src> at raw vm.recordingUrl, which only works while
  // the Telnyx signed URL is still in its 10-minute lifetime.
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);`,
  },
  {
    label: 'fix #7c fetch audio via proxy when row expands',
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
  }, [expanded, audioBlobUrl]);

  // v0.10.158 - fetch the audio bytes through our API proxy when the
  // row expands, then expose them as a blob URL to the <audio> element.
  // Why: <audio src=...> can't carry an Authorization header, so we
  // can't point it at /voicemails/:id/audio directly. Blob URL is the
  // standard workaround (same pattern as VoicemailPlay.tsx).
  // Cleanup: revoke the URL on collapse/unmount so we don't leak memory.
  useEffect(() => {
    if (!expanded) {
      // Row collapsed - free the blob URL we may have created.
      setAudioBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const { getVoicemailAudioBlob } = await import('../api');
        const url = await getVoicemailAudioBlob(token, vm.id);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setAudioBlobUrl(url);
      } catch (e) {
        console.warn('[vm-row] audio proxy fetch failed', e);
        // Leave audioBlobUrl null - the <audio> shows 0:00 / 0:00 and
        // user gets visual feedback that something didn't work. Server
        // logs (apps/api logs) will have the upstream details.
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [expanded, vm.id]);`,
  },
  {
    label: 'fix #7d <audio src> uses blob URL instead of raw vm.recordingUrl',
    find: `          <audio
            ref={audioRef}
            controls
            src={vm.recordingUrl}
            preload="metadata"
            style={{ width: '100%' }}`,
    replace: `          <audio
            ref={audioRef}
            controls
            /* v0.10.158 - audioBlobUrl is built from our authenticated
               /voicemails/:id/audio proxy, which transparently refreshes
               expired Telnyx signed URLs server-side. While the blob is
               still being fetched the src is empty (audio element shows
               0:00 / 0:00) - acceptable; usually finishes in <500ms. */
            src={audioBlobUrl ?? undefined}
            preload="metadata"
            style={{ width: '100%' }}`,
  },
]);

// =====================================================================
// Add users-admin-email-cell class to email <td> (so the @media hide rule
// in fix #3 has something to target)
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'add users-admin-email-cell class to email column',
    find: `                <td className="users-admin-email">`,
    replace: `                <td className="users-admin-email users-admin-email-cell">`,
  },
]);

// =====================================================================
// Version bumps 0.10.157 -> 0.10.158
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
  if (!existsSync(fp)) {
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.157"/, '"version": "0.10.158"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.157 -> 0.10.158`);
  } else {
    console.log(`  - ${rp}: no 0.10.157 found (run apply-v157-* first?)`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.157';`,
    replace: `const APP_VERSION = '0.10.158';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.158 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.157',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.158',
    date: 'June 15, 2026',
    highlight: 'Older voicemails play again, and the Users admin page shows all action icons.',
    changes: [
      { type: 'fixed', text: 'Voicemails older than 10 minutes now play correctly. The audio player goes through the dialer API which automatically refreshes the stored audio link with a fresh one, so the 403 expired-URL error is fixed for both the in-list player and the dedicated playback page.' },
      { type: 'fixed', text: 'Admin > Users: the Call, Text, and More-actions icons on each user row were getting clipped at narrower window widths because the action column was set to a fixed 44px width that pre-dated those features. The column now sizes to its content, so all three icons are reachable at any window size.' },
      { type: 'improved', text: 'Admin > Audit Log and Admin > Users tables now have more horizontal room at narrower window widths so the columns don\\'t get squashed. The Settings sub-panes for these tables widen automatically; other Settings sub-pages keep their original reading width.' },
    ],
  },
  {
    version: '0.10.157',`,
  },
]);

console.log('\n[apply-v158] DONE');
console.log('');
console.log('TEST PLAN:');
console.log('  1. After Render redeploys ace-dialer-api AND Vercel redeploys');
console.log('     acedialerv4-web (both take ~3-5 min after push):');
console.log('  2. Open old voicemail in list view -> audio plays (proxy fetches');
console.log('     fresh URL transparently). Watch Render API logs for');
console.log('     "[voicemail] stored URL expired, retrying with fresh signed URL".');
console.log('  3. Open Settings > Users -> each user row shows Call + Text + menu');
console.log('     icons in the right-hand actions column.');
console.log('  4. Open Settings > Audit Log -> table renders with readable columns');
console.log('     at the current window width.');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.158: voicemail proxy + recording-id regex + Settings responsive CSS"');
console.log('  git tag v0.10.158');
console.log('  git push origin main');
console.log('  git push origin v0.10.158');
