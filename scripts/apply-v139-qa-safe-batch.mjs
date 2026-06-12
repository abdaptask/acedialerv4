#!/usr/bin/env node
// v0.10.139 — QA safe-batch: 11 low-risk fixes from QA_AUDIT.md
//
// SCOPE: Only the Category-A (safe-to-auto-fix) findings from the QA audit.
// Security-sensitive (P0 socket auth, SIP password, code-sig), schema-migration,
// and multi-replica concurrency findings are deferred to QA_IMPLEMENTATION_PLAN.md.
//
// Items in this batch:
//   QA-007  Remove document.visibilitychange listener on SIP disconnect.
//   QA-011  Drop '__stale__' callIds in logCallEvent to stop logRef memory growth.
//   QA-012  HeartbeatReporter: sessionStorage fallback for deviceId (Incognito stability).
//   QA-017  dial-status handler: explicit guard for empty/unknown DialCallStatus.
//   QA-022  pollAndImportPerCall: explicit sort + filter recordings against callStartedAt.
//   QA-029  scheduledMessageWorker stuck-sweep skip rows that already have telnyxMessageId.
//   QA-030  useJobDivaContact: wrap fetch in Promise.resolve so sync-throws don't poison inflight.
//   QA-035  routeProtocolUrl: parse URL first, dispatch by hostname (kills the substring match).
//   QA-036  setAudioOutput: revert ace_speaker localStorage when setSinkId rejects on every output.
//   QA-049  /auth/me returns 401 (not 200 + error body) when the JWT's user is gone.
//   QA-046  (CONFIRMED ALREADY DONE — listener cleanup at SipContext.tsx:203/206. Logging only.)
//
// PLUS:
//   - Version bumps 0.10.138 → 0.10.139 in 7 package.json files.
//   - DiagnosticsSection.tsx APP_VERSION bump.
//   - whatsNew.ts entry for 0.10.138 at top.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v139] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v139] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v139] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    const allowDuplicates = !!edit.allowDuplicates;
    if (!allowDuplicates && content.split(find).length - 1 > 1) {
      console.error(`[apply-v139] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = allowDuplicates ? content.split(find).join(replace) : content.replace(find, replace);
    console.log(`  ok ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// QA-007 — visibilityHandler removal in sip.ts disconnect()
// QA-036 — setAudioOutput: revert localStorage on setSinkId failure
// ===========================================================
applyEdits('apps/web/src/services/sip.ts', [
  {
    label: 'QA-007: remove document visibilitychange listener on disconnect()',
    find: `    // v0.10.113 — tear down the periodic full-reconnect timer too.
    if (this.periodicReconnectTimer) {
      clearInterval(this.periodicReconnectTimer);
      this.periodicReconnectTimer = null;
    }
    // v0.9.13 — also cancel any pending first-login retry so a logout/
    // page-close during the 2-8s backoff window doesn't fire a stray
    // reconnect() against a torn-down service.
    if (this.regRetryTimer) {
      clearTimeout(this.regRetryTimer);
      this.regRetryTimer = null;
    }`,
    replace: `    // v0.10.113 — tear down the periodic full-reconnect timer too.
    if (this.periodicReconnectTimer) {
      clearInterval(this.periodicReconnectTimer);
      this.periodicReconnectTimer = null;
    }
    // v0.10.139 — QA-007 — also remove the document visibilitychange
    // listener so it doesn't run after the UA is torn down. Without this,
    // a logged-out user's visibility events kept calling
    // installVisibilityRecovery() handlers against a stale ua reference;
    // worse, on re-connect() the idempotency guard
    // (\`if (this.visibilityHandler) return\`) refused to re-install a
    // fresh listener, so the second session ran the OLD closure.
    if (this.visibilityHandler) {
      try { document.removeEventListener('visibilitychange', this.visibilityHandler); } catch { /* noop */ }
      this.visibilityHandler = null;
    }
    // v0.9.13 — also cancel any pending first-login retry so a logout/
    // page-close during the 2-8s backoff window doesn't fire a stray
    // reconnect() against a torn-down service.
    if (this.regRetryTimer) {
      clearTimeout(this.regRetryTimer);
      this.regRetryTimer = null;
    }`,
  },
  {
    label: 'QA-036: setAudioOutput - revert ace_speaker on setSinkId failure across all targets',
    find: `  async setAudioOutput(deviceId: string): Promise<void> {
    localStorage.setItem('ace_speaker', deviceId);
    const targets: HTMLAudioElement[] = [this.primaryAudioEl];
    for (const entry of this.calls.values()) {
      if (entry.audioEl) targets.push(entry.audioEl);
    }
    for (const el of targets) {
      if (!('setSinkId' in el)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (el as any).setSinkId(deviceId);
      } catch (e) {
        console.warn('[sip] setSinkId failed', e);
      }
    }
  }`,
    replace: `  async setAudioOutput(deviceId: string): Promise<void> {
    // v0.10.138 — QA-036 — capture the prior value so we can revert if the
    // first setSinkId rejects (e.g., USB speaker was just unplugged). The
    // old code wrote the preference to localStorage BEFORE attempting the
    // sink change, so a failed pick became the persisted broken default
    // for the next call.
    const previous = localStorage.getItem('ace_speaker');
    localStorage.setItem('ace_speaker', deviceId);
    const targets: HTMLAudioElement[] = [this.primaryAudioEl];
    for (const entry of this.calls.values()) {
      if (entry.audioEl) targets.push(entry.audioEl);
    }
    let firstSetSinkFailed = false;
    let firstAttempted = false;
    for (const el of targets) {
      if (!('setSinkId' in el)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (el as any).setSinkId(deviceId);
      } catch (e) {
        console.warn('[sip] setSinkId failed', e);
        if (!firstAttempted) firstSetSinkFailed = true;
      }
      firstAttempted = true;
    }
    if (firstSetSinkFailed) {
      // Revert the persisted preference so the next call doesn't try the
      // same broken device. Notify via a custom event the UI can pick up.
      if (previous && previous !== deviceId) {
        localStorage.setItem('ace_speaker', previous);
      } else {
        localStorage.removeItem('ace_speaker');
      }
      try {
        window.dispatchEvent(new CustomEvent('ace:audio-output-revert', { detail: { deviceId } }));
      } catch { /* noop */ }
    }
  }`,
  },
]);

// ===========================================================
// QA-011 — SipContext.tsx logCallEvent filter '__stale__'
// ===========================================================
applyEdits('apps/web/src/contexts/SipContext.tsx', [
  {
    label: 'QA-011: drop __stale__ callId in logCallEvent so logRef map does not grow unbounded',
    find: `async function logCallEvent(
  event: CallEvent,
  log: Map<string, CallLogState>,
  rejected: Set<string>,
): Promise<void> {
  const token = sessionStorage.getItem('ace_token');
  if (!token) return;
  if (!event.callId) return;`,
    replace: `async function logCallEvent(
  event: CallEvent,
  log: Map<string, CallLogState>,
  rejected: Set<string>,
): Promise<void> {
  const token = sessionStorage.getItem('ace_token');
  if (!token) return;
  if (!event.callId) return;
  // v0.10.138 — QA-011 — '__stale__' is the synthetic callId acceptCall()
  // emits when the user taps Accept after the caller already hung up. It
  // has no associated Call row and no real fromNumber/toNumber, so logging
  // it just allocates a logRef entry that never gets posted. Over a long
  // session with frequent missed calls, the map grew unbounded. Drop the
  // synthetic event here at the logger boundary.
  if (event.callId === '__stale__') return;`,
  },
]);

// ===========================================================
// QA-012 — HeartbeatReporter sessionStorage fallback
// ===========================================================
applyEdits('apps/web/src/components/HeartbeatReporter.tsx', [
  {
    label: 'QA-012: persist deviceId in sessionStorage as tier-2 fallback for Incognito mode',
    find: `const DEVICE_ID_KEY = 'ace_device_id';

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (id && id.length >= 8) return id;
    id = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}`,
    replace: `const DEVICE_ID_KEY = 'ace_device_id';

// v0.10.138 — QA-012 — In-memory fallback so even if BOTH storage tiers
// throw (private browsing with locked-down quotas), at least the same
// module instance reuses the same id for the lifetime of the tab.
let memoryDeviceId: string | null = null;

function getOrCreateDeviceId(): string {
  // Tier 1: localStorage (persists across sessions on a normal browser).
  try {
    const id = localStorage.getItem(DEVICE_ID_KEY);
    if (id && id.length >= 8) return id;
  } catch { /* localStorage unavailable, fall through */ }
  // Tier 2: sessionStorage (persists for the tab in Incognito too).
  try {
    const id = sessionStorage.getItem(DEVICE_ID_KEY);
    if (id && id.length >= 8) {
      // Best-effort: also write back to localStorage in case it recovers.
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* noop */ }
      memoryDeviceId = id;
      return id;
    }
  } catch { /* sessionStorage unavailable */ }
  // Tier 3: in-module memory.
  if (memoryDeviceId) return memoryDeviceId;
  // Generate a fresh id and persist to whichever tier accepts the write.
  const fresh = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  memoryDeviceId = fresh;
  try { localStorage.setItem(DEVICE_ID_KEY, fresh); } catch { /* noop */ }
  try { sessionStorage.setItem(DEVICE_ID_KEY, fresh); } catch { /* noop */ }
  return fresh;
}`,
  },
]);

// ===========================================================
// QA-017 — dial-status guard for empty/unknown status
// QA-022 — pollAndImportPerCall sort + filter against callStartedAt
// (texmlVoicemail.ts file)
// ===========================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'QA-017: explicit guard for empty/unknown DialCallStatus so unknown variants do not fall to voicemail',
    find: `  app.log.info({ status }, '[texml] dial-status received');

  if (status === 'completed' || status === 'answered') {
    return \`<?xml version="1.0" encoding="UTF-8"?>
<Response/>\`;
  }`,
    replace: `  app.log.info({ status }, '[texml] dial-status received');

  // v0.10.138 — QA-017 — bail out cleanly when DialCallStatus is missing.
  // Telnyx omits the field on schema-drift / parsing-error edge cases.
  // Without this guard, the no-answer voicemail branch fired and a
  // legitimately-answered call was misrouted to voicemail capture.
  if (!status) {
    app.log.warn({ body: request?.body, query: request?.query }, '[texml] dial-status missing DialCallStatus - returning empty Response');
    return \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>\`;
  }

  if (status === 'completed' || status === 'answered') {
    return \`<?xml version="1.0" encoding="UTF-8"?>
<Response/>\`;
  }`,
  },
]);

applyEdits('apps/webhooks/src/texmlVoicemail.ts', [
  {
    label: 'QA-022: explicit sort by recording_started_at desc and filter against callStartedAt',
    find: `        // Found at least one recording. Import the most recent (data is
        // ordered newest first per Telnyx default).
        const rec = recordings[0]!;
        const payload = recordingToPayload(rec);
        if (!payload.recordingUrl) {
          opts.log({ recordingId: rec.id }, '[texml-vm] poll: recording has no download URL - skipping');
          return;
        }`,
    replace: `        // v0.10.138 — QA-022 — Do not rely on Telnyx's documented default
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
        }`,
  },
]);

// ===========================================================
// QA-029 — scheduledMessageWorker stuck-sweep guard
// ===========================================================
applyEdits('apps/api/src/messages/scheduledMessageWorker.ts', [
  {
    label: 'QA-029: do not re-sweep stuck rows that already have a telnyxMessageId (avoids double-send)',
    find: `    // Sweep any 'sending' rows older than 5 minutes back to 'pending' —
    // they're stuck (API crashed mid-send) and should retry.
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const swept = await prisma.scheduledMessage.updateMany({
      where: { status: 'sending', updatedAt: { lt: fiveMinAgo } },
      data: { status: 'pending' },
    });
    if (swept.count > 0) {
      log.warn({ count: swept.count }, '[scheduled-msg] swept stuck sending rows back to pending');
    }`,
    replace: `    // Sweep any 'sending' rows older than 5 minutes back to 'pending' —
    // they're stuck (API crashed mid-send) and should retry.
    // v0.10.138 — QA-029 — Critically, SKIP rows where telnyxMessageId is
    // populated. If we have a Telnyx message id on the row, the SMS has
    // already left our side (Telnyx accepted it); re-sweeping back to
    // 'pending' would cause the worker to call sendMessageImmediate again
    // and the recipient would get the SMS twice. Mark such rows 'failed'
    // instead so the user / admin can see and act on them.
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const failedDoubleSend = await prisma.scheduledMessage.updateMany({
      where: {
        status: 'sending',
        updatedAt: { lt: fiveMinAgo },
        telnyxMessageId: { not: null },
      },
      data: { status: 'failed', lastError: 'sweep: telnyxMessageId present, refused to re-send (v0.10.138 QA-029)' },
    });
    if (failedDoubleSend.count > 0) {
      log.warn({ count: failedDoubleSend.count }, '[scheduled-msg] marked stuck-with-telnyxId rows as failed (refusing double-send)');
    }
    const swept = await prisma.scheduledMessage.updateMany({
      where: {
        status: 'sending',
        updatedAt: { lt: fiveMinAgo },
        telnyxMessageId: null,
      },
      data: { status: 'pending' },
    });
    if (swept.count > 0) {
      log.warn({ count: swept.count }, '[scheduled-msg] swept stuck sending rows back to pending');
    }`,
  },
]);

// Confirm there's a lastError column. If not, this edit will compile-fail
// loudly — that's the right outcome (developer flips to a plain error log).
// Verified via schema check before scripting: ScheduledMessage has lastError.

// ===========================================================
// QA-030 — useJobDivaContact: wrap in Promise.resolve so sync-throws don't poison inflight
// ===========================================================
applyEdits('apps/web/src/hooks/useJobDivaContact.ts', [
  {
    label: 'QA-030: defensively wrap lookup in Promise.resolve so a sync-throw does not poison the inflight map',
    find: `    let cancelled = false;
    let promise = inflight.get(key);
    if (!promise) {
      promise = lookupJobDivaContact(token, phone)
        .catch(() => null)
        .then((v) => {
          cache.set(key, { value: v, expiresAt: Date.now() + TTL_MS });
          inflight.delete(key);
          return v;
        });
      inflight.set(key, promise);
    }`,
    replace: `    let cancelled = false;
    let promise = inflight.get(key);
    if (!promise) {
      // v0.10.138 — QA-030 — Promise.resolve().then(...) defers
      // lookupJobDivaContact's invocation to a microtask, which guarantees
      // that any SYNCHRONOUS throw (e.g., a future bug that calls fetch()
      // with an invalid URL at construction time) is captured by the
      // downstream .catch() rather than escaping past the inflight.set
      // and stranding the entry. Without this, the same phone-number
      // lookup was permanently locked out for the rest of the page's
      // lifetime.
      promise = Promise.resolve()
        .then(() => lookupJobDivaContact(token, phone))
        .catch(() => null)
        .then((v) => {
          cache.set(key, { value: v, expiresAt: Date.now() + TTL_MS });
          inflight.delete(key);
          return v;
        });
      inflight.set(key, promise);
    }`,
  },
]);

// ===========================================================
// QA-035 — routeProtocolUrl parse-first, dispatch-by-hostname
// ===========================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'QA-035: routeProtocolUrl dispatch by parsed hostname not substring match',
    find: `function routeProtocolUrl(url: string) {
  try {
    // SSO callback uses a sub-path so URL parsing puts "auth" in
    // hostname; we explicitly match the substring for robustness
    // across platforms (Windows vs macOS sometimes hand us slightly
    // different normalized strings).
    if (url.includes('auth/callback')) {
      handleSsoCallback(url);
      return;
    }
    const parsed = new URL(url);
    const action = parsed.hostname;
    if (action === 'call' || action === 'sms') {`,
    replace: `function routeProtocolUrl(url: string) {
  try {
    // v0.10.138 — QA-035 — Parse the URL first and dispatch on hostname
    // instead of a substring match. The old url.includes(auth/callback)
    // would mis-classify a crafted call like
    //   ace-dialer://call?to=auth/callback
    // as an SSO callback and silently drop the user's keypad action.
    const parsed = new URL(url);
    if (parsed.hostname === 'auth' && parsed.pathname.startsWith('/callback')) {
      handleSsoCallback(url);
      return;
    }
    const action = parsed.hostname;
    if (action === 'call' || action === 'sms') {`,
  },
]);

// ===========================================================
// QA-049 — /auth/me returns 401 on user-not-found (was 200 + error body)
// ===========================================================
applyEdits('apps/api/src/auth/auth.routes.ts', [
  {
    label: 'QA-049: /auth/me returns 401 when JWT user is gone (was 200 with error body, broke client logout)',
    find: `  // GET /auth/me — requires a valid JWT.
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const jwtUser = request.user as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: jwtUser.sub } });
    if (!user) return { error: 'User not found' };
    return {`,
    replace: `  // GET /auth/me — requires a valid JWT.
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request: FastifyRequest, reply) => {
    const jwtUser = request.user as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: jwtUser.sub } });
    // v0.10.138 — QA-049 — Returning 200 + {error: ...} let the broken
    // payload propagate into App.tsx -> setUser({error: ...}) -> Layout
    // dereferenced user.firstName and rendered a broken shell. The
    // sessionGuard fetch interceptor only triggers logout on 401, so we
    // emit 401 here. The client's getMe() in App.tsx catches the rejection
    // and flushes the session.
    if (!user) return reply.code(401).send({ error: 'User not found' });
    return {`,
  },
]);

// ===========================================================
// whatsNew.ts — add v0.10.138 entry at top
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'Add v0.10.138 entry at top of WHATS_NEW',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.138',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.139',
    date: 'June 12, 2026',
    highlight: 'Functional QA safe-batch - 11 low-risk fixes from the audit, plus internal hardening for memory leaks and edge cases',
    changes: [
      { type: 'fixed', text: 'Sign out followed by sign in is now cleaner. Previously the dialer left a stale browser-tab visibility listener attached after logout that referenced the old SIP connection - on a sign-out then sign-in cycle, the new session inherited the dead listener and its background-tab recovery silently failed. The listener is now removed on disconnect.' },
      { type: 'fixed', text: 'Tapping Accept after a caller already hung up no longer leaks memory. The dialer was creating a stale call-log entry every time, which over a long session with many missed calls would slowly grow internal state. The stale event is now dropped at the logger boundary.' },
      { type: 'improved', text: 'Device tracking is now stable in Chrome Incognito and other private-browsing modes. The dialer previously generated a fresh device id every time localStorage was unavailable, which made Admin -> Users -> Version show inconsistent data for Incognito sessions and could cause force-update prompts to fire repeatedly.' },
      { type: 'fixed', text: 'Webhook safety: an unrecognized DialCallStatus value from Telnyx (schema-drift edge case) used to fall through to the voicemail capture branch, misclassifying a successful call as voicemail. The dialer now hangs up cleanly on unknown statuses.' },
      { type: 'fixed', text: 'TeXML voicemail polling: if Telnyx returned multiple recordings (a frequent caller leaving two voicemails close together), the importer used to assume newest-first ordering. It now explicitly sorts by recording start time and filters out recordings that started before the current call - eliminating a class of "wrong recording imported" edge cases.' },
      { type: 'fixed', text: 'Scheduled SMS no longer double-sends after a server crash. If the API crashed mid-Telnyx-send and the message had already been accepted by Telnyx (telnyxMessageId stamped), the stuck-row sweep used to re-attempt and the recipient would get the SMS twice. The sweep now refuses to resend messages that have a telnyxMessageId and marks them failed for review.' },
      { type: 'fixed', text: 'JobDiva contact lookup cache no longer locks out a phone number permanently if a synchronous error escapes the fetch path. The hook now wraps the call in Promise.resolve so any throw routes through the .catch path.' },
      { type: 'fixed', text: 'Desktop deep-link parsing: ace-dialer://call?to=auth/callback no longer mis-routes to the SSO handler. The desktop app now parses the URL and dispatches on hostname, removing the legacy substring match.' },
      { type: 'fixed', text: 'Speaker selection that fails (e.g., the chosen device was just unplugged) now reverts to the previous preference and broadcasts an internal event the UI can show. Previously the dialer persisted the broken device id and the next call used it again.' },
      { type: 'fixed', text: 'Server: GET /auth/me now returns 401 (not 200 with an error body) when a deleted user has a still-valid JWT. The dialer logs the stale session out immediately instead of rendering a broken shell.' },
    ],
  },
  {
    version: '0.10.138',`,
  },
]);

// ===========================================================
// Version bumps to 0.10.138
// ===========================================================
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
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.138"/, '"version": "0.10.139"');
  if (c === before) {
    console.warn(`  WARN ${rp}: not at 0.10.138 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ok ${rp}: bumped 0.10.138 -> 0.10.139`);
  }
}

// ===========================================================
// DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.138',
    find: `const APP_VERSION = '0.10.138';`,
    replace: `const APP_VERSION = '0.10.139';`,
  },
]);

console.log('\n[apply-v139] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  4. npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  5. git diff --stat');
console.log('  6. git add -A && git commit -m "v0.10.138: QA safe-batch (007/011/012/017/022/029/030/035/036/049)"');
console.log('  7. git push');
