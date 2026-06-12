// ===========================================================================
// v0.10.119 - TeXML voicemail flow (Phase 2 trial, +16467379912 only).
//
// Architecture:
//   PSTN caller dials a TeXML-migrated DID
//      -> Telnyx routes call to our TeXML Application
//      -> Application's Voice URL: GET /texml/voicemail
//      -> We return TeXML: <Dial action=".../dial-status" timeout=25 answerOnBridge=true>
//                            <Sip>sip:USER@sip.telnyx.com</Sip>
//                          </Dial>
//      -> Telnyx tries the SIP URI for 25 sec
//         If answered: call bridges, no further TeXML
//         If no-answer/busy/failed: Telnyx POSTs DialCallStatus to /dial-status
//           which returns Play + Record TeXML
//      -> Record goes to /recording-complete which feeds the same
//         internal handler the Hosted-VM flow uses (Deepgram + Voicemail row)
//
// Greetings reuse the v0.10.100 User-level stack:
//   User.voicemailGreetingMode in { 'audio', 'tts', 'default' }
//     'audio'   -> <Play>(voicemailGreetingUrl)
//     'tts'     -> <Say>(voicemailGreetingText)
//     'default' / null -> <Say>("You have reached <First>. Please leave a message after the tone.")
//   Trial uses only the no-answer variant. The busy-variant columns exist
//   on User but TeXML ignores them.
//
// Boot:
//   ensureTeXMLApp() creates / reuses a Telnyx TeXML Application whose
//   voice_url points at our /texml/voicemail. App ID cached in
//   SystemConfig under 'telnyx.texml_vm.app_id'.
//
// Trial scope: TEXML_TRIAL_DIDS env var = comma-separated E.164 allowlist.
// For Phase 2 set TEXML_TRIAL_DIDS=+16467379912.
//
// Safety net: we INTENTIONALLY leave Hosted Voicemail enabled on the DID.
// Telnyx prefers TeXML; on 5xx falls back to Hosted VM with default greeting.
// ===========================================================================

import { prisma } from '@ace/db';

const TELNYX_API = 'https://api.telnyx.com/v2';
const SYSTEM_CONFIG_KEY_APP_ID = 'telnyx.texml_vm.app_id';

async function getSystemConfig(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSystemConfig(key: string, value: string, note?: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, note },
    create: { key, value, note },
  });
}

export async function ensureTeXMLApp(opts: {
  telnyxApiKey: string;
  publicBaseUrl: string;
  log?: (obj: Record<string, unknown>, msg: string) => void;
}): Promise<string> {
  const log = opts.log ?? ((o, m) => console.info(m, o));
  if (!opts.telnyxApiKey) throw new Error('ensureTeXMLApp: TELNYX_API_KEY required');
  if (!opts.publicBaseUrl) throw new Error('ensureTeXMLApp: WEBHOOKS_PUBLIC_URL required');

  const voiceUrl = `${opts.publicBaseUrl.replace(/\/+$/, '')}/texml/voicemail`;
  const statusCallbackUrl = `${opts.publicBaseUrl.replace(/\/+$/, '')}/texml/voicemail/app-status`;
  const FRIENDLY_NAME = 'ACE Dialer - TeXML Voicemail';

  const cachedId = await getSystemConfig(SYSTEM_CONFIG_KEY_APP_ID);
  if (cachedId) {
    const res = await fetch(`${TELNYX_API}/texml_applications/${encodeURIComponent(cachedId)}`, {
      headers: { Authorization: `Bearer ${opts.telnyxApiKey}` },
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as {
        data?: { id?: string; voice_url?: string };
      };
      const currentVoiceUrl = json?.data?.voice_url ?? '';
      if (currentVoiceUrl !== voiceUrl) {
        log(
          { cachedId, currentVoiceUrl, expectedVoiceUrl: voiceUrl },
          '[texml] App voice_url drifted - patching',
        );
        await fetch(`${TELNYX_API}/texml_applications/${encodeURIComponent(cachedId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.telnyxApiKey}`,
          },
          body: JSON.stringify({ voice_url: voiceUrl, status_callback: statusCallbackUrl }),
        });
      }
      log({ appId: cachedId, voiceUrl }, '[texml] App verified at Telnyx');
      return cachedId;
    }
    log({ cachedId, status: res.status }, '[texml] cached App ID stale - will recreate');
  }

  const createRes = await fetch(`${TELNYX_API}/texml_applications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.telnyxApiKey}`,
    },
    body: JSON.stringify({
      friendly_name: FRIENDLY_NAME,
      voice_url: voiceUrl,
      voice_method: 'GET',
      status_callback: statusCallbackUrl,
      status_callback_method: 'POST',
      active: true,
    }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(
      `Telnyx POST /texml_applications failed: ${createRes.status} ${errText.slice(0, 300)}`,
    );
  }
  const createJson = (await createRes.json()) as { data?: { id?: string } };
  const newId = createJson?.data?.id;
  if (!newId) throw new Error('Telnyx returned no App ID on create');

  await setSystemConfig(SYSTEM_CONFIG_KEY_APP_ID, newId, 'Telnyx TeXML Application for voicemail');
  log({ appId: newId, voiceUrl }, '[texml] created new TeXML Application');
  return newId;
}

export async function getTeXMLAppId(): Promise<string | null> {
  return getSystemConfig(SYSTEM_CONFIG_KEY_APP_ID);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface GreetingConfig {
  mode: 'audio' | 'tts' | 'default' | null;
  url: string | null;
  text: string | null;
}

export function buildDialTeXML(opts: {
  sipUsername: string | null;
  publicBaseUrl: string;
  callerId?: string | null;
  // v0.10.119 hotfix - original DID (the callee). Telnyx's <Dial> action
  // callback mutates `To` to the dial target (SIP URI of the credential),
  // so we can't re-look-up the owner there. Pass the original DID via
  // query string instead.
  didNumber?: string | null;
}): string {
  const baseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
  const didQs = opts.didNumber ? `?did=${encodeURIComponent(opts.didNumber)}` : '';
  const dialActionUrl = `${baseUrl}/texml/voicemail/dial-status${didQs}`;
  const recordingActionUrl = `${baseUrl}/texml/voicemail/recording-complete${didQs}`;

  if (!opts.sipUsername) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Say voice="Polly.Joanna">The person you are calling is not available. Please leave a message after the tone.</Say>',
      `  <Record maxLength="300" playBeep="true" timeout="10" recordingStatusCallback="${xmlEscape(recordingActionUrl)}" recordingStatusCallbackMethod="POST" />`,
      '  <Hangup/>',
      '</Response>',
    ].join('\n');
  }

  const sipTarget = `sip:${xmlEscape(opts.sipUsername)}@sip.telnyx.com`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Dial action="${xmlEscape(dialActionUrl)}" timeout="25" answerOnBridge="true">`,
    `    <Sip>${sipTarget}</Sip>`,
    '  </Dial>',
    '</Response>',
  ].join('\n');
}

export function buildVoicemailTeXML(opts: {
  greeting: GreetingConfig;
  ownerFirstName: string | null;
  publicBaseUrl: string;
  // v0.10.119 hotfix - propagate original DID via ?did= so the recording-
  // complete handler can attribute the Voicemail row to the right user.
  didNumber?: string | null;
}): string {
  const baseUrl = opts.publicBaseUrl.replace(/\/+$/, '');
  const didQs = opts.didNumber ? `?did=${encodeURIComponent(opts.didNumber)}` : '';
  const recordingActionUrl = `${baseUrl}/texml/voicemail/recording-complete${didQs}`;

  let greetingLine: string;
  if (opts.greeting.mode === 'audio' && opts.greeting.url) {
    greetingLine = `  <Play>${xmlEscape(opts.greeting.url)}</Play>`;
  } else if (opts.greeting.mode === 'tts' && opts.greeting.text) {
    greetingLine = `  <Say voice="Polly.Joanna">${xmlEscape(opts.greeting.text)}</Say>`;
  } else {
    const who = opts.ownerFirstName ?? 'this user';
    greetingLine = `  <Say voice="Polly.Joanna">You have reached ${xmlEscape(who)}. Please leave a message after the tone.</Say>`;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    greetingLine,
    `  <Record maxLength="300" playBeep="true" timeout="10" recordingStatusCallback="${xmlEscape(recordingActionUrl)}" recordingStatusCallbackMethod="POST" />`,
      '  <Hangup/>',
    '</Response>',
  ].join('\n');
}

export async function lookupDidOwner(
  toE164: string,
): Promise<{
  userDidId: number;
  userId: number | null;
  sipUsername: string | null;
  firstName: string | null;
  greeting: GreetingConfig;
} | null> {
  const normalized = toE164.startsWith('+') ? toE164 : `+${toE164}`;
  const userDid = await prisma.userDid.findFirst({
    where: { didNumber: normalized },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          sipUsername: true,
          firstName: true,
          voicemailGreetingUrl: true,
          voicemailGreetingText: true,
          voicemailGreetingMode: true,
        },
      },
    },
  });
  if (!userDid) return null;
  const modeRaw = (userDid.user?.voicemailGreetingMode ?? null) as string | null;
  const mode: GreetingConfig['mode'] =
    modeRaw === 'audio' || modeRaw === 'tts' || modeRaw === 'default' ? modeRaw : null;
  return {
    userDidId: userDid.id,
    userId: userDid.userId ?? null,
    sipUsername: userDid.user?.sipUsername ?? null,
    firstName: userDid.user?.firstName ?? null,
    greeting: {
      mode,
      url: userDid.user?.voicemailGreetingUrl ?? null,
      text: userDid.user?.voicemailGreetingText ?? null,
    },
  };
}


// ---------------------------------------------------------------------------
// buildDialStatusTeXML - called when Telnyx POSTs DialCallStatus to our
// /texml/voicemail/dial-status endpoint. We branch on the status:
//   completed / answered -> empty <Response/> (call already done)
//   busy                 -> Play greeting + Record (treat busy as
//                           "go to voicemail"; matches the v0.10.100
//                           busy-greeting behavior even though for the
//                           trial we use a single greeting for both cases)
//   no-answer / failed / canceled / anything else -> Play greeting + Record
//
// We need the same greeting + ownerFirstName context that buildVoicemailTeXML
// uses. The caller (route handler in main.ts) re-looks-up the DID owner via
// lookupDidOwner using the To number that Telnyx echoes back in this
// callback's body, so we get the right user even though this is a separate
// HTTP request from the initial /texml/voicemail dial.
// ---------------------------------------------------------------------------
export function buildDialStatusTeXML(opts: {
  dialCallStatus: string;
  greeting: GreetingConfig;
  ownerFirstName: string | null;
  publicBaseUrl: string;
  // v0.10.119 hotfix - propagate to buildVoicemailTeXML's recording URL
  didNumber?: string | null;
}): string {
  const status = (opts.dialCallStatus ?? '').toLowerCase();

  // Call already completed — nothing more to do. Empty Response tells
  // Telnyx to just terminate the call cleanly.
  if (status === 'completed' || status === 'answered') {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<Response/>';
  }

  // Everything else (busy, no-answer, failed, canceled, ...) falls
  // through to voicemail. buildVoicemailTeXML handles the greeting
  // selection (audio / tts / default).
  return buildVoicemailTeXML({
    greeting: opts.greeting,
    ownerFirstName: opts.ownerFirstName,
    publicBaseUrl: opts.publicBaseUrl,
    didNumber: opts.didNumber,
  });
}


// ===========================================================================
// v0.10.119 hotfix3 - Telnyx Recordings API polling.
//
// Background: Telnyx confirmed via support ticket that <Record recordingStatusCallback>
// inside a Dial-then-Record TeXML flow does NOT fire the callback (their bug,
// engineering investigating, ETA unknown). The recording IS being created
// successfully and is accessible via their List Recordings API. This module
// implements the recommended workaround:
//
//   1. PRIMARY: per-call polling - when /texml/voicemail/app-status fires
//      with CallStatus=no-answer (or busy/failed), schedule a delayed poll
//      that queries GET /v2/recordings?filter[from]=..&filter[to]=..&filter[created_at][gte]=..
//      Retries with backoff up to ~45 sec total. Fast voicemail capture
//      latency in the common case.
//
//   2. SAFETY NET: 5-min sweep - runs every 5 min in the background. Queries
//      Telnyx for recordings created in the last 10 min, imports any that
//      aren't already in our DB (dedup by recording.id). Catches recordings
//      missed by per-call polling (e.g., webhooks service restarted mid-poll).
//
// Dedup: we use recording.id as the telnyxCallId on the Voicemail row. The
// existing processVoicemail() helper's dedup-by-telnyxCallId check then
// prevents duplicate inserts across the two polling paths.
// ===========================================================================

export interface TelnyxRecording {
  id: string;
  call_session_id?: string;
  call_leg_id?: string;
  from?: string;
  to?: string;
  duration_millis?: number;
  recording_started_at?: string;
  recording_ended_at?: string;
  status?: string;
  download_urls?: { mp3?: string; wav?: string };
}

// Normalized payload shape passed to processVoicemail() in main.ts. We
// re-declare it here so this module doesn't have to import from main.ts.
export interface NormalizedVmPayload {
  fromNumber: string;
  toNumber?: string;
  recordingUrl: string;
  durationSeconds: number;
  telnyxCallId?: string;
  receivedAt: Date;
  transcription?: string;
  connectionId?: string;
}

export type ProcessVoicemailFn = (
  payload: NormalizedVmPayload,
  source: string,
) => Promise<{ stored: boolean; reason?: string; voicemailId?: number }>;

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

// ---------------------------------------------------------------------------
// listTelnyxRecordings - thin wrapper over GET /v2/recordings with the
// filter shape we need. Returns at most `pageSize` matching recordings,
// most recent first.
// ---------------------------------------------------------------------------
export async function listTelnyxRecordings(opts: {
  telnyxApiKey: string;
  from?: string;
  to?: string;
  createdAtGte?: Date;
  createdAtLte?: Date;
  pageSize?: number;
  log?: LogFn;
}): Promise<TelnyxRecording[]> {
  const params = new URLSearchParams();
  if (opts.from) params.set('filter[from]', opts.from);
  if (opts.to) params.set('filter[to]', opts.to);
  if (opts.createdAtGte) params.set('filter[created_at][gte]', opts.createdAtGte.toISOString());
  if (opts.createdAtLte) params.set('filter[created_at][lte]', opts.createdAtLte.toISOString());
  params.set('page[size]', String(opts.pageSize ?? 25));
  const url = `${TELNYX_API}/recordings?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.telnyxApiKey}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    opts.log?.(
      { status: res.status, body: errText.slice(0, 300), url },
      '[texml-vm] listTelnyxRecordings failed',
    );
    return [];
  }
  const json = (await res.json().catch(() => ({}))) as { data?: TelnyxRecording[] };
  return Array.isArray(json.data) ? json.data : [];
}

// Reshape a TelnyxRecording into our NormalizedVmPayload shape.
function recordingToPayload(rec: TelnyxRecording): NormalizedVmPayload {
  const url = rec.download_urls?.mp3 ?? rec.download_urls?.wav ?? '';
  const durationSeconds = rec.duration_millis ? Math.floor(rec.duration_millis / 1000) : 0;
  const receivedAt = rec.recording_started_at ? new Date(rec.recording_started_at) : new Date();
  return {
    fromNumber: rec.from ?? '',
    toNumber: rec.to,
    recordingUrl: url,
    durationSeconds,
    // v0.10.121 - dedup-key bug fix. Previously we used rec.id (the Telnyx
    // RECORDING ID) here, while /texml/voicemail/recording-complete and
    // /webhooks/telnyx/voicemail both use call_session_id. That mismatch
    // meant a single voicemail processed by BOTH a polling path AND the
    // recording-complete callback would yield two Voicemail rows (the
    // findFirst-by-telnyxCallId dedup check missed because the two strings
    // were different identifier types). Now we align on call_session_id
    // (matching what TeXML's CallSid form field and Hosted-VM's
    // payload.call_session_id resolve to). Falls back to rec.id if Telnyx
    // omits call_session_id, which keeps the previous semantics for edge
    // cases without re-opening the dedup gap in normal flows.
    telnyxCallId: rec.call_session_id ?? rec.id,
    receivedAt,
  };
}

// ---------------------------------------------------------------------------
// pollAndImportPerCall - PRIMARY workaround path. Called from app-status
// handler when CallStatus=no-answer (or other terminal status that may have
// produced a recording). Polls Telnyx Recordings API with retries.
//
// Schedules itself with setTimeout. Returns immediately (fire-and-forget).
// Retry schedule: 10s, 15s, 25s (total ~50s). Each attempt fetches
// recordings created since callStartedAt, filtered by from + to, and
// imports the first match.
// ---------------------------------------------------------------------------
export function pollAndImportPerCall(opts: {
  telnyxApiKey: string;
  from: string;
  to: string;
  callStartedAt: Date;
  processVoicemail: ProcessVoicemailFn;
  log: LogFn;
  attemptDelays?: number[]; // override for tests; default [10000, 15000, 25000]
}): void {
  const delays = opts.attemptDelays ?? [10_000, 15_000, 25_000];

  function tryOnce(attemptIdx: number): void {
    setTimeout(async () => {
      try {
        const recordings = await listTelnyxRecordings({
          telnyxApiKey: opts.telnyxApiKey,
          from: opts.from,
          to: opts.to,
          createdAtGte: opts.callStartedAt,
          pageSize: 5,
          log: opts.log,
        });
        if (recordings.length === 0) {
          opts.log(
            { attemptIdx, from: opts.from, to: opts.to, callStartedAt: opts.callStartedAt.toISOString() },
            '[texml-vm] poll: no recordings yet',
          );
          if (attemptIdx + 1 < delays.length) {
            tryOnce(attemptIdx + 1);
          } else {
            opts.log(
              { from: opts.from, to: opts.to },
              '[texml-vm] poll: gave up after all attempts - safety net sweep will catch later',
            );
          }
          return;
        }
        // v0.10.138 — QA-022 — Do not rely on Telnyx's documented default
        // sort order. (a) Explicitly sort by recording_started_at DESC so the
        // newest is always at [0]. (b) Filter out any recording whose
        // recording_started_at is BEFORE this call's callStartedAt — those
        // belong to an earlier call from the same caller and a previous poll
        // already imported them.
        const sorted = [...recordings].sort((a, b) => {
          const ta = a.recording_started_at ? Date.parse(a.recording_started_at) : 0;
          const tb = b.recording_started_at ? Date.parse(b.recording_started_at) : 0;
          return tb - ta; // newest first
        });
        const callStartedMs = opts.callStartedAt.getTime();
        // Allow a 5-second clock-skew tolerance so we don't drop the
        // legitimate recording due to Telnyx's clock being slightly ahead
        // of ours at the call-start timestamp.
        const SKEW_MS = 5_000;
        const fresh = sorted.find((r) => {
          if (!r.recording_started_at) return false;
          const t = Date.parse(r.recording_started_at);
          if (Number.isNaN(t)) return false;
          return t >= callStartedMs - SKEW_MS;
        });
        if (!fresh) {
          opts.log(
            { attemptIdx, callStartedAt: opts.callStartedAt.toISOString(), candidates: sorted.length },
            '[texml-vm] poll: no recordings started after callStartedAt yet - retrying',
          );
          if (attemptIdx + 1 < delays.length) {
            tryOnce(attemptIdx + 1);
          }
          return;
        }
        const rec = fresh;
        const payload = recordingToPayload(rec);
        if (!payload.recordingUrl) {
          opts.log({ recordingId: rec.id }, '[texml-vm] poll: recording has no download URL - skipping');
          return;
        }
        const result = await opts.processVoicemail(payload, 'texml-vm-poll');
        opts.log(
          { recordingId: rec.id, stored: result.stored, reason: result.reason, voicemailId: result.voicemailId },
          '[texml-vm] poll: imported recording',
        );
      } catch (err) {
        opts.log(
          { err: err instanceof Error ? err.message : String(err) },
          '[texml-vm] poll: attempt threw',
        );
        if (attemptIdx + 1 < delays.length) tryOnce(attemptIdx + 1);
      }
    }, delays[attemptIdx]!);
  }

  tryOnce(0);
}

// ---------------------------------------------------------------------------
// sweepRecentRecordings - SAFETY NET path. Called periodically (every 5
// min) from a setInterval in main.ts. Queries the last 10 min of recordings
// account-wide, filters to TEXML_TRIAL_DIDS, attempts to import each.
//
// Dedup is handled by processVoicemail()'s existing telnyxCallId check
// (which we set to recording.id). So calling this repeatedly is safe.
// ---------------------------------------------------------------------------
export async function sweepRecentRecordings(opts: {
  telnyxApiKey: string;
  trialDids: string[]; // E.164 list, the DIDs we care about
  lookbackMinutes?: number; // default 10
  processVoicemail: ProcessVoicemailFn;
  log: LogFn;
}): Promise<{ checked: number; imported: number }> {
  if (opts.trialDids.length === 0) {
    return { checked: 0, imported: 0 };
  }
  const lookback = opts.lookbackMinutes ?? 10;
  const since = new Date(Date.now() - lookback * 60_000);
  let checked = 0;
  let imported = 0;
  // Telnyx List Recordings supports filter[to]=<one number>. Loop one per DID.
  for (const did of opts.trialDids) {
    try {
      const recordings = await listTelnyxRecordings({
        telnyxApiKey: opts.telnyxApiKey,
        to: did,
        createdAtGte: since,
        pageSize: 25,
        log: opts.log,
      });
      checked += recordings.length;
      for (const rec of recordings) {
        const payload = recordingToPayload(rec);
        if (!payload.recordingUrl) continue;
        const result = await opts.processVoicemail(payload, 'texml-vm-sweep');
        if (result.stored) imported++;
      }
    } catch (err) {
      opts.log(
        { err: err instanceof Error ? err.message : String(err), did },
        '[texml-vm] sweep: per-DID error',
      );
    }
  }
  opts.log({ checked, imported, lookbackMinutes: lookback }, '[texml-vm] sweep: complete');
  return { checked, imported };
}
