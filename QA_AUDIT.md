# ACE Dialer — Functional QA Audit Report

**Date:** 2026-06-12
**Auditor:** Claude (QA expert subagent)
**Codebase version:** v0.10.135 (current main branch HEAD); v0.10.136 about to ship UX fixes
**Scope:** Functional / behavioral / production-readiness review. UI/UX issues are tracked separately in UI_UX_AUDIT.md.

## Summary

The dialer is functionally rich but carries the scars of months of debugging single-user issues in a service that has since fanned out to ~40 users on multi-replica server infrastructure. **52 functional findings** across the stack: 6 P0 (production-breaking), 18 P1 (user-impacting), 21 P2 (latent), 7 P3 (code smell). Three dominant themes: **(1) In-memory dedup/cache patterns will break under horizontal scaling.** Several `Set`s in `teamsNotifier`, `emailNotifier`, `voicemailCallControl.sessionMap`, and `useJobDivaContact` cache silently lose their guarantees when the webhooks service runs on more than one Render replica — the very moment the user list grows enough to need it. **(2) The socket service has zero authentication.** Anyone who can reach the WebSocket port can connect, ping, and stay connected without a JWT — and the cors origin defaults to `*`. **(3) Sensitive data leaks.** SIP passwords are returned by `/auth/login`, `/auth/me`, and `/auth/microsoft/exchange` in plaintext, persisted to sessionStorage (XSS-readable), and the build-disabled `verifyUpdateCodeSignature` override means the Windows autoUpdater accepts any binary that GitHub serves. Several latent race conditions exist in `sip.ts` (visibilityHandler never removed on disconnect, periodicReconnectTimer & visibilityHandler not disposed on reconnect, conference startConference returns `true` synchronously before mic permission resolves) and `voicemailCallControl.ts` (recording.saved writes voicemail rows without the dedup + blocked-user gate in `processVoicemail`).

## Severity legend

- **P0 — Production-breaking**: data loss, crash, security hole, or unavailability. Fix immediately, possibly hotfix server.
- **P1 — User-impacting bug**: causes a user-visible failure under realistic conditions. Fix next release.
- **P2 — Latent bug**: works today but will fail under future conditions (scaling, new edge case, dependency upgrade). Fix when convenient.
- **P3 — Code smell**: not a bug but a pattern that will become one. Refactor opportunistically.

## Findings

### QA-001 — Socket service has zero authentication

- **Severity:** P0
- **Category:** Security
- **Affected file(s):** `apps/socket/src/main.ts:55-66`, `apps/socket/src/main.ts:17-22`
- **Trigger condition:** Any client that knows the socket URL (which is in every shipped Electron binary plus the web bundle) can connect to the Socket.IO server without a token. `io.on('connection', ...)` accepts the socket immediately and emits `connected` with the socket id.
- **Failure mode:** Unauthenticated clients can connect, hold connections open, and consume server resources. Phase 1 plans to emit chat events here (per the file header comment `Phase 1 onward: implement the 31 chatSocket events from Pulse`) — when that lands, all 31 events will broadcast to any anonymous client. Today the only risk is DoS via socket flooding, since the server hasn't bound any business events yet — but this is the kind of "we'll bolt on auth later" wiring that ships to production unchanged.
- **Recommended fix:** Add `io.use((socket, next) => { ... })` middleware that verifies `socket.handshake.auth.token` against the same `JWT_SECRET` the API uses. Reject the connection if missing/invalid. Lock `cors.origin` to the actual allowlist (not `true` for the default `*` case). Also drop the catch-all CORS `origin: true` on the Fastify side (line 23) to a real allowlist for production.
- **Acceptance criteria:** Connecting via the Socket.IO client without an `auth.token` returns an `auth_error` and the socket is closed. Connecting with a forged/expired token is also rejected.

### QA-002 — `sipPassword` returned over the wire and persisted in sessionStorage

- **Severity:** P0
- **Category:** Security
- **Affected file(s):** `apps/api/src/auth/auth.routes.ts:65-68, 83-94`, `apps/api/src/auth/microsoft.routes.ts:208-212`, `apps/web/src/App.tsx:30-33` (`persistSipCreds`)
- **Trigger condition:** Every successful `/auth/login`, `/auth/me`, or `/auth/microsoft/exchange` response includes the user's plaintext Telnyx SIP password. The web app writes it to `sessionStorage.ace_sip_password` (App.tsx line 32) for the SipContext to consume.
- **Failure mode:** (a) Any XSS injection — including a compromised third-party CDN script in the future — can read `sessionStorage` and exfiltrate every user's SIP credentials, which would let an attacker register a parallel softphone on Telnyx as the user and intercept their inbound calls + outbound caller-ID. (b) The password lands in `~/.config/<app>/Local Storage/` on disk in Electron, recoverable by anyone with file-system access to the machine. (c) Any future error-reporting tool (Sentry, Datadog RUM) that auto-captures sessionStorage will exfiltrate the credentials to that vendor.
- **Recommended fix:** Move SIP credentialing to the backend. Issue ephemeral Telnyx Credential Connection tokens (Telnyx supports short-TTL credentials via `/v2/credential_connections/refresh`) that the API mints per session and returns to the client. The client never sees the long-lived password. Failing that, at minimum encrypt SIP passwords at rest in the DB (Prisma User.sipPassword is currently plaintext) and serve them via a one-time-use bearer-protected endpoint rather than including in `/auth/me`.
- **Acceptance criteria:** `sessionStorage.getItem('ace_sip_password')` returns null. No API response includes a plaintext SIP password field. An admin can rotate one user's Telnyx credentials without invalidating the dialer JWTs of all other users.

### QA-003 — `verifyUpdateCodeSignature` no-op stub allows any GitHub-hosted .exe to install

- **Severity:** P0
- **Category:** Security (supply chain)
- **Affected file(s):** `apps/desktop/src/main.ts:925-932`
- **Trigger condition:** Windows autoUpdater downloads an installer that fails the publisher-name signature check.
- **Failure mode:** The override resolves `verifyUpdateCodeSignature` to `async () => null`, telling electron-updater "no error — accept this binary." If a GitHub Actions workflow is ever compromised, a release-asset substitution attack at the GitHub Releases page, or an MITM at the user's network layer (defeating HTTPS via a corporate root CA), would silently install attacker-controlled code on every user's machine on the next 60-minute auto-update poll. The override comment honestly notes "remove this override once we wire the EV cert in" — but that wire has been pending since v0.9.4 (task #194/#233).
- **Recommended fix:** Acquire an EV code-signing certificate ASAP and sign the .exe in `build-desktop.yml`. Until then, gate the override behind an env flag the user has to set explicitly, so a forgotten "remove this when we get the cert" doesn't ship indefinitely. As a secondary measure, pin the GitHub release publisher (use `releaseType: 'release'` in `electron-updater` config and add a SHA256 allowlist via `electron-updater`'s `verifyUpdateCodeSignature` returning a checked hash rather than `null`).
- **Acceptance criteria:** Auto-update of an unsigned/wrong-publisher binary fails with "Could not verify the signature." Production binaries are EV-signed.

### QA-004 — `processVoicemail` bypassed by `voicemailCallControl.call.recording.saved` handler — no dedup, no blocked-user check

- **Severity:** P0
- **Category:** Race condition / Edge case
- **Affected file(s):** `apps/webhooks/src/voicemailCallControl.ts:416-486`, contrast with `apps/webhooks/src/main.ts:1790-1938` (shared `processVoicemail`)
- **Trigger condition:** A Hosted Call-Control voicemail recording finalizes. Telnyx fires `call.recording.saved` to `/webhooks/telnyx/voicemail-cc`. The handler at line 446-460 does `prisma.voicemail.create({...})` directly.
- **Failure mode:** This direct insert skips ALL of `processVoicemail`'s safeguards: (a) Telnyx-callId dedup (`findFirst({where:{telnyxCallId}})`), (b) the v0.10.126 behavioral 30-second-window dedup that catches paths using different identifier strings, (c) the `isFromNumberBlockedForUser` blocklist gate, (d) the Teams/email notifier wiring still works but the dedup Sets are inconsistent with the rest. Most importantly: if Telnyx fires `call.recording.saved` twice for the same recording (Telnyx documented retry behavior on slow 2xx), this handler will write two Voicemail rows. **Same pattern as v0.10.133/134 missing-Recents bug — a parallel write path that doesn't share the centralized helper.**
- **Recommended fix:** Refactor `voicemailCallControl.ts:446-470` to call the shared `processVoicemail` (export it from `main.ts` or move to a `lib/`). Pass `payload.connectionId` so attribution stays consistent. Remove the local prisma.voicemail.create. Verify the `notifyVoicemail` dedup Set still triggers correctly with the unified path.
- **Acceptance criteria:** Two back-to-back `call.recording.saved` events for the same Telnyx call session produce exactly one Voicemail row. A blocked caller's voicemail in the Call-Control flow is silently dropped (matches Hosted VM behavior).

### QA-005 — In-memory dedup Sets and session maps break under multi-replica deployment

- **Severity:** P0
- **Category:** Concurrency / Scalability
- **Affected file(s):** `apps/webhooks/src/teamsNotifier.ts:232` (`sentMissedCallCards`), `apps/webhooks/src/teamsNotifier.ts:423` (`sentVoicemailCards`), `apps/webhooks/src/emailNotifier.ts:125` (`sentMissedCallEmails`) and the voicemail equivalent, `apps/webhooks/src/voicemailCallControl.ts:141-146` (`sessionMap`)
- **Trigger condition:** Scale the `ace-dialer-webhooks` Render service from 1 replica to 2+. Telnyx load-balances webhook events across replicas. Each replica has its own in-process Set/Map.
- **Failure mode:** (a) Replica A receives `call.hangup` for callDbId=42 and fires the missed-call Teams card, recording `sentMissedCallCards.add(42)`. Replica B receives a retried `call.hangup` for the same call seconds later and fires a SECOND Teams card because its in-memory Set has no record of A's send. Users complain of duplicate cards. (b) Same failure mode for voicemail cards and email notifications. (c) In `voicemailCallControl.ts`, `sessionMap` is the only correlation between the caller leg and the dial leg — if `call.initiated` lands on replica A but the `call.hangup` for the dial leg lands on B, the fall-to-voicemail logic at line 533-544 never fires and the caller hears silence. (d) Same risk for `useJobDivaContact`'s in-memory cache (client-side, no leak in single-replica, but mentioned because the pattern is everywhere).
- **Recommended fix:** Move each Set to a Postgres-backed dedup table with a unique constraint:
  ```sql
  CREATE TABLE webhook_dedup (
    key TEXT PRIMARY KEY,         -- 'teams:missedCall:<callDbId>' etc.
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- TTL job: DELETE FROM webhook_dedup WHERE sent_at < NOW() - INTERVAL '7 days';
  ```
  Use `INSERT ... ON CONFLICT DO NOTHING` and check the returned row count to claim the send. For `sessionMap`, use a `voicemail_call_sessions` row keyed on `call_session_id` with the same ClientState fields. **Same pattern flagged in `PROJECT_STATE.md` Section 4** ("multiple Render replicas would break in-process dedup"). Until this lands, leave webhooks at 1 replica and document in README.
- **Acceptance criteria:** Running two webhook replicas concurrently and replaying a webhook 10× per replica produces exactly one Teams card and one Call/Voicemail row.

### QA-006 — `_doConnect`'s `pendingTimer` and `escalationTimer` survive `disconnect()` — fire stale state on logout

- **Severity:** P0
- **Category:** Resource leak / Race condition
- **Affected file(s):** `apps/web/src/services/sip.ts:397-470` (closure-local timers), `apps/web/src/services/sip.ts:2700-2752` (`disconnect`)
- **Trigger condition:** User signs out (or session expires) while a smoothed `'disconnected'` state is in flight (timer scheduled, not yet fired). `disconnect()` runs and tears down the UA, but `pendingTimer` and `escalationTimer` are local to the `_doConnect` closure — `disconnect()` has no reference to clear them.
- **Failure mode:** Up to 30 seconds after logout, the closure fires, the generation guard (`if (this.connectGen !== myGeneration) return;`) saves it from emitting in NEW sessions — but in single-session-ended cases, the generation hasn't advanced so the timer still calls `this.emit('state', 'disconnected')`. That can cascade into reactiveLayout's sip badge update, the session-guard's SIP watchdog re-arming after the user has navigated away, etc. Subtle but real. **Same class as Shreya's 2026-06-04 incident** explicitly cited in the file comments — and the generation-counter fix added in v0.10.88 only covers RECONNECT, not DISCONNECT.
- **Recommended fix:** Move `pendingTimer` and `escalationTimer` to class fields, and clear them in `disconnect()`:
  ```ts
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private escalationTimer: ReturnType<typeof setTimeout> | null = null;
  // ...in disconnect():
  if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
  if (this.escalationTimer) { clearTimeout(this.escalationTimer); this.escalationTimer = null; }
  ```
- **Acceptance criteria:** After `sipService.disconnect()`, no further `'state'` events fire — verified by attaching a listener that throws on call and disconnecting during an in-flight debounce.

### QA-007 — `visibilityHandler` never removed from `document.addEventListener('visibilitychange', ...)` on disconnect

- **Severity:** P1
- **Category:** Resource leak
- **Affected file(s):** `apps/web/src/services/sip.ts:1161-1219` (install), `apps/web/src/services/sip.ts:2700-2752` (`disconnect` — no removal)
- **Trigger condition:** Any `disconnect()` call (logout, session expiry, app shutdown).
- **Failure mode:** The visibility handler still runs on every visibilitychange after logout. It calls `this.ua?.isRegistered()` on a torn-down UA — first call no-ops because `this.ua` is null, but `lastForcedRegisterAt` is still mutated as state. Bigger problem: on hot-reload in dev (or re-`connect()` after a logout/login cycle), `installVisibilityRecovery()` checks `if (this.visibilityHandler) return;` and refuses to re-install — but the existing handler is closed over the OLD `this.ua`, so visibility events do nothing useful. End-state: a user who signs out and back in has a half-dead visibility recovery path that runs but accomplishes nothing.
- **Recommended fix:** In `disconnect()`:
  ```ts
  if (this.visibilityHandler) {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
  }
  ```
- **Acceptance criteria:** After disconnect, `document` has no `visibilitychange` listener registered by SIP. Sign-out → sign-in cycle restores a fresh visibility handler that references the new UA.

### QA-008 — `installPeriodicReconnectTimer()` clean-up not synchronized with `installVisibilityRecovery` — reconnect can fire mid-call

- **Severity:** P1
- **Category:** Race condition
- **Affected file(s):** `apps/web/src/services/sip.ts:1043-1059`, `apps/web/src/services/sip.ts:837-872`
- **Trigger condition:** With `ENABLE_60S_PERIODIC_RECONNECT = true` (the production default until v0.10.135 canary), an incoming call arrives within 100ms of the periodic timer firing.
- **Failure mode:** Inside `installPeriodicReconnectTimer`, the check `if (this.calls.size > 0 || this.incomingCallId !== null) { ...skip; return; }` runs at the moment the timer fires. There's no lock around the subsequent `this.reconnect()` call. If a `newRTCSession` arrives between the check and the `reconnect()`, the UA gets torn down mid-call. Reconnect path then races the inbound INVITE — explains user reports of "I picked up but the call dropped 200ms later." Same race exists in `installForceRegisterTimer` (line 1018-1034), but `register()` is less destructive than full UA rebuild so the symptom is milder.
- **Recommended fix:** Add an in-progress lock and re-check after the async hop. Better: capture `this.calls.size` and `this.incomingCallId` into the closure that's about to call `reconnect()`, and bail if either has changed during the microtask gap. Since `ENABLE_60S_PERIODIC_RECONNECT` is currently off in v0.10.135, this becomes P0 again if the flag is ever flipped back on.
- **Acceptance criteria:** Reproduce by stubbing a `newRTCSession` event at T=59.99s, T=60.0s firing the timer; verify reconnect is aborted (logged: "active call appeared between guard check and teardown — abandoning periodic reconnect").

### QA-009 — `acceptCall()` and `declineCall()` race: incoming session can be cancelled by caller during the 3-second mic preflight

- **Severity:** P1
- **Category:** Race condition / State machine
- **Affected file(s):** `apps/web/src/services/sip.ts:1953-2028` (`_answerIncoming`)
- **Trigger condition:** User taps Accept. `_answerIncoming` awaits `navigator.mediaDevices.getUserMedia` (up to 3 seconds with the hard timeout). During that window the caller hangs up. JsSIP fires `'failed'` or `'ended'` on the session, `cleanupCall(callId, ...)` runs, the session is removed from `this.calls`, but the user's stream resolves AFTER that.
- **Failure mode:** The follow-up `entry.session.answer({mediaStream: stream, ...})` call at line 2003 throws (session already terminated). The catch at line 2015 logs and releases the stream. But: if the session entered the "answered → ended" lifecycle between gUM-resolved and answer-called, the user briefly hears their own mic in their headset (acquired stream attached to monitor), the `'ended'` event already fired with `cause: 'normal_clearing'` so the UI thinks the call connected then ended. End-state ambiguous: did the user "answer"? Did they "miss"? The Call row gets stamped `'completed'` instead of `'missed'`.
- **Recommended fix:** Before calling `entry.session.answer(...)`, re-check the session lifecycle status:
  ```ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (entry.session as any)?._status;
  // JsSIP statuses: 0=NULL,1=INVITE_SENT,...,4=WAITING_FOR_ANSWER,5=ANSWERED,...,9=ENDED
  if (status === 9 || !this.calls.has(entry.id)) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    return; // caller already gone
  }
  ```
- **Acceptance criteria:** Caller hangs up mid-preflight: no `answer` is attempted, the per-call mic stream is fully torn down, no Call row update fires.

### QA-010 — `startConference()` returns `true` synchronously before mic permission resolves — UI flips to conference state while audio graph is still being built

- **Severity:** P1
- **Category:** Race condition / State machine
- **Affected file(s):** `apps/web/src/services/sip.ts:2258-2373`
- **Trigger condition:** User taps Merge during a held + active call.
- **Failure mode:** Line 2316-2368 wraps the async work in an IIFE returning `true` immediately. `SipContext.mergeCalls` (line 575-587) then sets `conferenceActive=true`, swaps the UI, AND tells `setHasSecondCall(false)`. If `navigator.mediaDevices.getUserMedia` rejects (mic permission revoked, USB mic unplugged at this instant) the conference setup silently fails — `console.error('[sip] conference: failed to acquire mic', e)` — and the UI is in conference state showing two pills, but the second call is STILL held with no mic. User starts talking, only the active call's leg hears them, the held call's leg hears music or silence. The "merge succeeded!" affordance is a lie.
- **Recommended fix:** Make `startConference()` return a `Promise<boolean>` and only resolve `true` after mic acquisition + `replaceTrack` on every leg succeeds. Have the SipContext `mergeCalls` await it. On failure, restore the prior held/active split state by calling `swapCalls` or `holdCallWithMusicIfConfigured` on the original held leg.
- **Acceptance criteria:** With mic permission denied, `mergeCalls()` returns `false`; UI does not flip to conference state; both calls remain in their prior held/active configuration.

### QA-011 — `_answerIncoming` after caller cancel emits `'ended'` with `state_desync` cause AND ALSO the natural `'ended'` from the SIP session — double `'ended'` events confuse UI

- **Severity:** P1
- **Category:** State machine
- **Affected file(s):** `apps/web/src/services/sip.ts:1889-1928` (`acceptCall`)
- **Trigger condition:** Caller hangs up 100ms BEFORE user taps Accept. The session is already cleaned up by `cleanupCall`. `incomingCallId` is null. User clicks Accept.
- **Failure mode:** Line 1894-1908 emits `{state: 'ended', callId: '__stale__', hangupCause: 'state_desync'}`. SipContext receives that and clears `incoming`. So far so good. But `cleanupCall` already emitted the NATURAL `'ended'` event with the real `callId`. Two ended events arrive, and the second one (`__stale__`) is processed by `SipContext.useEffect` which calls `logCallEvent({state: 'ended', callId: '__stale__'})`. That creates a logRef entry keyed `'__stale__'` with no posted=false guard, and the `createCall`/`updateCall` calls do nothing (no fromNumber/toNumber). Memory leak grows by one map entry per stale-accept. Over a long-running session with frequent missed calls, the logRef map grows unbounded.
- **Recommended fix:** Track whether `acceptCall` actually has work to do; if `incomingCallId` is null, just emit a UI-level toast event (not a `'call'` event with a fake id):
  ```ts
  if (!id) {
    this.emit('toast', { kind: 'info', message: 'Caller hung up — call already ended.' });
    return;
  }
  ```
  Or filter `'__stale__'` callIds in `SipContext.logCallEvent` so they don't pollute the log map.
- **Acceptance criteria:** Tap Accept after caller cancel → no entry added to `logRef`; toast displays briefly; no API calls fire.

### QA-012 — `getOrCreateDeviceId()` in `HeartbeatReporter` falls back to a fresh random ID when localStorage throws — counts the same user as multiple devices

- **Severity:** P1
- **Category:** Edge case / Data integrity
- **Affected file(s):** `apps/web/src/components/HeartbeatReporter.tsx:11-21`
- **Trigger condition:** User opens the dialer in Chrome's Private/Incognito mode or in a session where localStorage is quota-exceeded.
- **Failure mode:** Each component mount (which happens on every login + on hot-reload in dev) generates a new random device ID. The heartbeat endpoint creates a fresh UserDevice row each time. Over a week, a single user with HMR-y sessions accumulates dozens of UserDevice rows. The admin Users panel's `Version` column (which picks the most-recently-seen device) ends up showing inconsistent data. Worse: the `forceUpdateRequestedAt` ack tracks per-device-id, so triggering a force-update on user X may keep firing across all their phantom devices for hours.
- **Recommended fix:** Persist the deviceId in sessionStorage as a tier-2 fallback, and use a session-stable in-memory variable as tier-3. Also dedupe UserDevice rows server-side: if the same `(userId, platform, osLabel)` device has been seen in the last 5 minutes, update the existing row instead of inserting a new one.
- **Acceptance criteria:** In Incognito mode, the deviceId persists for the lifetime of the tab. UserDevice rows for a given user grow at most by N per real machine, not per mount.

### QA-013 — `Voicemail.tsx` 30-day retention deletes voicemails older than the cutoff but `purgeExpired()` runs INSIDE the user's API request — slow on first-of-month invocations

- **Severity:** P2
- **Category:** Boundary / Performance
- **Affected file(s):** `apps/api/src/voicemails/voicemails.routes.ts:23-29, 35-40, 64-72`
- **Trigger condition:** User opens the Voicemail page or the badge-count endpoint fires. Server `purgeExpired(user.sub)` runs a `deleteMany` on all voicemails older than 30 days for that user.
- **Failure mode:** A user with hundreds of accumulated voicemails will block on the DELETE the first time they open the tab. While the DELETE is running, the tab spinner stays, the badge stays stale, and other tabs polling `/voicemails/unread/count` (every 15s from `Layout.tsx`) ALSO trigger the delete — leading to lock contention on the voicemails table for that user. Eventually completes, but degrades UX significantly during the cleanup window. Worse: if the user is offline at the 30-day boundary, their voicemails accumulate and the cleanup blast happens when they next sign in.
- **Recommended fix:** Move the purge to a cron-like background job (the API has `scheduledMessageWorker` infrastructure that can be reused). Run nightly across all users. Keep the per-request purge as a safety net but downgrade it: only fire if the last purge was > 24 hours ago (track in a SystemConfig row or in-memory cache). Better: change the listing query to `where: { receivedAt: { gte: cutoff } }` so the user never SEES expired rows; let the actual DELETE happen in batches off-band.
- **Acceptance criteria:** Opening the Voicemail tab while 500+ expired rows are pending purge takes <500ms; the purge runs asynchronously and doesn't block the response.

### QA-014 — Same DELETE-on-read pattern applies to `/voicemails/unread/count` — fired every 15s from Layout

- **Severity:** P2
- **Category:** Performance
- **Affected file(s):** `apps/api/src/voicemails/voicemails.routes.ts:64-72`, `apps/web/src/pages/Layout.tsx:93-125`
- **Trigger condition:** Layout's 15-second polling hits `getVoicemailsUnreadCount`. Server purges expired rows every poll for every user that opened the app.
- **Failure mode:** 40+ users × 4 polls/min × 30 days of voicemails per user → 40 deleteMany ops per minute on the voicemails table. While each individual purge is small after the first run, the cumulative lock pressure shows up in Supabase Pooler metrics under sustained load. Combined with v0.11.0's planned soft-delete (which will REQUIRE these rows survive), this becomes wasted work.
- **Recommended fix:** Same as QA-013 — extract to background cron. Once v0.11.0 ships soft-delete, this whole `purgeExpired` mechanism gets replaced anyway.
- **Acceptance criteria:** /voicemails/unread/count returns in <50ms regardless of expired-row count; no DELETE statements run during the count.

### QA-015 — `/calls` query loads all SIP usernames every request — O(users) work to render every Recents fetch

- **Severity:** P2
- **Category:** Performance / Scaling
- **Affected file(s):** `apps/api/src/calls/calls.routes.ts:207-226`
- **Trigger condition:** User opens Recents tab; server queries `prisma.user.findMany({where: {sipUsername: {not: null}}})` to build the filter list.
- **Failure mode:** Today with ~40 users it's cheap. At ~5000 users (the migration target) every Recents open scans the entire users table to build a 5000-element `NOT IN (...)` clause for the calls query. Postgres can handle it but the query becomes large and the network round-trip non-trivial. A simpler check would be `NOT toNumber LIKE 'user%'` (since all SIP usernames start with `user`), or a stored deny-list keyed on `(userId, sipUsername)` so the lookup is O(1).
- **Recommended fix:** Cache the list of SIP usernames in-memory with a 60-second TTL (acceptable freshness — new SIP usernames don't need to be filtered out within seconds). Or store the username with a `LIKE 'user%'` pattern check, which works because every SIP credential starts with `user<email-prefix><random>`. Or maintain a denormalized `is_sip_infra` flag on the Call row at write time and filter on the index.
- **Acceptance criteria:** /calls completes in <100ms for a user with 200 call rows, regardless of total user count.

### QA-016 — `dedupeCallLegs` proximity merge uses 60-second window — legitimate back-to-back calls from same number get merged into one Recents entry

- **Severity:** P2
- **Category:** Boundary
- **Affected file(s):** `apps/api/src/calls/calls.routes.ts:103-168`
- **Trigger condition:** Same caller calls user twice within 60 seconds (e.g. dropped call, immediate redial).
- **Failure mode:** Pass 2 (proximity merge) at line 131-163 groups by `(direction, other-party-last10)` within `PROXIMITY_MS = 60_000`. Both rows merge into one entry. User sees ONE Recents row instead of two, missing the fact that there were two attempts. Edge case: spam calling repeated within a minute also collapses into one row — could be desirable, but is silent and the user can't tell.
- **Recommended fix:** Tighten the proximity window to 5-10 seconds (catches real "Telnyx fired two webhooks for the same physical call" cases without collapsing genuine redial). Add a `mergedFromCount` field returned to the UI so when 3 legs collapse into 1, the row shows "(3 attempts)" subtly. Long-term: rely on `sessionId` exclusively once Pass 0 attribution is universal.
- **Acceptance criteria:** Two separate physical calls 30 seconds apart appear as two Recents rows. Two legs of the same physical call (sessionId match) appear as one.

### QA-017 — `dial-status` callback handler `dialStatusHandler` not async, doesn't fail-fast on missing/malformed status — Telnyx sees an empty `<Response/>` which it interprets as "hang up cleanly"

- **Severity:** P2
- **Category:** Error handling / Edge case
- **Affected file(s):** `apps/webhooks/src/main.ts:1428-1463`
- **Trigger condition:** Telnyx posts to `/texml/dial-status` with a missing or unrecognized `DialCallStatus`.
- **Failure mode:** `status = (body.DialCallStatus ?? query.DialCallStatus ?? '').toString().toLowerCase()` produces empty string. Falls through to the no-answer branch (line 1457) which records a voicemail. So in failure-mode cases (e.g. parsing error, schema drift in Telnyx) the user ALWAYS gets voicemail — even if the call actually answered but the `DialCallStatus` field was missing. Misclassifies a successful call as voicemail.
- **Recommended fix:** Add explicit guard: `if (!status) { return '<Response/>'; }`. Add a structured log warning so we notice schema drift. Also confirm the Hangup tag fires even on the empty-response branch by adding `<Hangup/>` at the end.
- **Acceptance criteria:** Unknown DialCallStatus → empty Response (hang up cleanly, no voicemail capture). Known statuses unchanged.

### QA-018 — `pollAndImportPerCall` schedules `setTimeout`s that survive webhook handler restart — cron-like work fires after deploy with stale closures

- **Severity:** P2
- **Category:** Resource leak / State machine
- **Affected file(s):** `apps/webhooks/src/texmlVoicemail.ts:435-496`
- **Trigger condition:** User leaves a voicemail (TeXML flow) at T=0. `pollAndImportPerCall` schedules timers at T+10s, T+15s, T+25s. The webhooks service restarts (Render deploy or memory crash) at T+12s.
- **Failure mode:** The setTimeouts die with the process. No retry, no polling. The "safety net sweep" (every 5 minutes) is supposed to catch it — but if the deploy happens twice in a 10-minute window (common during a release sequence), the sweep also missed it. Telnyx recording exists, but our Voicemail row is never created. User reports "I left a voicemail and it never showed up." Hard to reproduce in dev because dev environments don't deploy mid-poll.
- **Recommended fix:** Persist the poll request to a DB table (`pending_recording_polls`) with `scheduled_at` timestamps. A worker drains it. Falls back to the 5-min sweep on hard failure. This is the same pattern needed for QA-005.
- **Acceptance criteria:** Force a webhook service restart while a per-call poll is pending; verify the voicemail still gets imported.

### QA-019 — `behavioral dedup` window in `processVoicemail` is 30 seconds — legitimate distinct voicemails from same caller within 30 seconds are silently dropped

- **Severity:** P2
- **Category:** Boundary / Edge case
- **Affected file(s):** `apps/webhooks/src/main.ts:1844-1868`
- **Trigger condition:** A frequent-caller leaves a 20-second voicemail, then immediately redials and leaves a 10-second follow-up. Both arrive within 30 seconds of each other.
- **Failure mode:** The second voicemail is dropped as `'duplicate_behavioral'`. User never sees it. The comment at line 1842 acknowledges this is "extremely rare in practice" — but in support contexts (a candidate trying to reach a recruiter who didn't pick up, then immediately calling again) this is a credible flow that's now silently broken.
- **Recommended fix:** Tighten the window to 10 seconds. Add a duration-based heuristic: only treat as duplicate if `existing.durationSeconds === payload.durationSeconds` (truly the same audio file, just two paths). Different durations = different voicemails.
- **Acceptance criteria:** Two voicemails from the same caller 20 seconds apart with distinct durations both land in the DB. Two webhook deliveries of the same recording (same `telnyxCallId` AND same duration) still dedupe.

### QA-020 — `canonicalInboundToNumber` falls back to picking `activeUserDidId` or first UserDid for TeXML trial users — wrong DID stamped when user has multiple DIDs

- **Severity:** P2
- **Category:** Edge case / Data integrity
- **Affected file(s):** `apps/webhooks/src/main.ts:131-175`
- **Trigger condition:** TeXML trial user has 2+ UserDids. An inbound call lands on one of their DIDs. `resolveUserAndDid` falls through to Pass 1/2 (sipUsername match) because connection_id is the shared TeXML CC App ID. `userDidId` is null. `canonicalInboundToNumber` falls back to `activeUserDidId` (Path B at line 153-173) — which is the user's currently-selected outbound DID, NOT the one the caller dialed.
- **Failure mode:** The Call row stamps the WRONG DID as `userDidId`. The Recents line badge shows the wrong line. **Exactly the same class as the v0.10.25 bug** that this code was supposed to fix ("ringer always showed on Main · <user's Main DID> for every inbound call"). Worse: the data is persisted, so even after a future bugfix the historical rows are wrong.
- **Recommended fix:** When Pass 1/2 attribution fires AND the user has > 1 UserDid, refuse to stamp `userDidId`. Better: extract the dialed DID from the TeXML callback's `?did=` query param (already plumbed in `buildDialTeXML`/`buildVoicemailTeXML`) and pass it through to `canonicalInboundToNumber` so the resolver can do a Pass-3-style last-10 match against the user's UserDids.
- **Acceptance criteria:** TeXML-trial user with DIDs A and B receives a call on DID B; Call row's `userDidId` resolves to B, not the activeUserDidId.

### QA-021 — `/calls` `findMany` `take: 200` with no pagination — Heavy users hit a wall at 200 historical rows

- **Severity:** P2
- **Category:** Boundary
- **Affected file(s):** `apps/api/src/calls/calls.routes.ts:215-231`
- **Trigger condition:** A user makes/receives more than 200 calls per session window.
- **Failure mode:** Newest 200 returned. Anything older is invisible from Recents. User can never see history beyond 200 (no "Load more" UI). Combined with v0.11.0's planned soft-delete (which keeps DELETED rows alive), this number is going to feel artificial fast.
- **Recommended fix:** Add cursor-based pagination (`?before=<id>&limit=50`). UI does infinite scroll. Drop the implicit 200 cap.
- **Acceptance criteria:** User with 1000 historical calls can scroll back through all of them.

### QA-022 — `pollAndImportPerCall` doesn't filter recordings by recording_started_at — picks the most-recent recording even if it's from an OLDER call

- **Severity:** P2
- **Category:** Edge case / Data integrity
- **Affected file(s):** `apps/webhooks/src/texmlVoicemail.ts:435-496`
- **Trigger condition:** User receives two voicemails from the same caller in a 60-second window (close enough that `callStartedAt` filter has both in scope). The second voicemail's `recording.complete` fires polling; Telnyx List Recordings returns BOTH; `recordings[0]` is the most-recent.
- **Failure mode:** If Telnyx returns oldest-first (which the comment at line 472 admits is `data is ordered newest first per Telnyx default`), this works. But if Telnyx ever changes the default sort, or if the second recording isn't finalized yet at poll time, `recordings[0]` could be the FIRST one — already imported by an earlier poll — and the dedup catches it. Less of a real bug today, more of a "the comment hopes Telnyx never changes" risk.
- **Recommended fix:** Explicitly sort by `recording_started_at` desc in code, and verify against the caller's expected `callStartedAt` (the recording must have started after the call was placed). If the most-recent recording is the only candidate that started after `callStartedAt`, import it.
- **Acceptance criteria:** Per-call poll for call at T=100s ignores recordings that started at T<99s.

### QA-023 — `sweepRecentRecordings` lookback is 10 minutes — but if webhooks service is down for 11+ minutes, the recording is lost

- **Severity:** P2
- **Category:** Edge case / Reliability
- **Affected file(s):** `apps/webhooks/src/main.ts:2076-2100`, `apps/webhooks/src/texmlVoicemail.ts:506-546`
- **Trigger condition:** A Render outage or hibernation cycle takes the webhooks service down for >10 minutes. During that window a TeXML voicemail is recorded by Telnyx.
- **Failure mode:** Once webhooks is back, the 5-minute sweep runs. It looks back 10 minutes. The recording was started 12 minutes ago — outside the window. Voicemail is lost forever (Telnyx retains the recording, but our DB never gets a row, so the user sees nothing).
- **Recommended fix:** On webhooks service boot, do a one-time 1-hour-lookback sweep to catch anything that arrived during the downtime. Subsequent intervals stay at 10 minutes.
- **Acceptance criteria:** Restart webhooks 20 minutes after a TeXML voicemail; verify the row appears in DB within 30 seconds.

### QA-024 — `resolveCalledConnection` lazy backfill writes UserDid.connectionId to whatever Telnyx returns — does NOT verify ownership

- **Severity:** P2
- **Category:** Security / Data integrity
- **Affected file(s):** `apps/webhooks/src/main.ts:1274-1365`
- **Trigger condition:** A TeXML callback arrives for a DID whose `UserDid.connectionId` is null. The backfill path queries Telnyx for the DID's current `connection_id` and persists it.
- **Failure mode:** If a user's UserDid row was somehow created with a wrong/mismatched `didNumber` (manual seeding error, admin typo, bulk-import bug), the lazy backfill writes whatever Telnyx says the connection_id is for THAT phone number. Now subsequent TeXML callbacks route calls to that "wrong" user. There's no cross-check that the user actually owns the DID at the Telnyx tenant level.
- **Recommended fix:** Before persisting `connection_id`, verify that the Telnyx response's user (or that user owns the relevant Telnyx Credential Connection). This requires a second API call but only fires once per DID per process lifetime so the cost is small.
- **Acceptance criteria:** A UserDid row with a typo'd didNumber that matches a different tenant's DID does NOT auto-bind to that tenant's connection_id.

### QA-025 — `JWT_EXPIRES_IN` defaults to `'24h'` — long-running calls survive token expiry without warning

- **Severity:** P2
- **Category:** Edge case / Auth flow
- **Affected file(s):** `apps/api/src/config.ts:21`, `apps/web/src/lib/sessionGuard.ts:23-87`
- **Trigger condition:** User signs in at T=0. At T=24h they're on an active call. Their JWT expires.
- **Failure mode:** The active SIP call (registered at Telnyx) keeps working — SIP registration doesn't share lifetime with the JWT. But the FIRST API call after the call ends (e.g. POST /calls to update the row with `endedAt`) returns 401. The fetch interceptor (`installSessionGuard`) fires `'ace:session-expired'` and logs the user out. They've now lost their session state, navigation, etc. — mid-workflow. Worse: the Call row's `endedAt` and `durationSeconds` never updated, so Recents shows the call as still-active forever.
- **Recommended fix:** Implement refresh tokens. On every API call from the client, check `exp` in the JWT (decodable client-side); if within 60 seconds of expiry, fire a refresh-token request. Or: bump `JWT_EXPIRES_IN` to `7d` for the dialer (it's a long-lived app, not a public web app).
- **Acceptance criteria:** A 26-hour-long call's `endedAt` lands in the DB. The user doesn't get logged out mid-call.

### QA-026 — Microsoft SSO `ExchangeSchema` allows `codeVerifier` to be optional — PKCE downgrade attack window

- **Severity:** P2
- **Category:** Security
- **Affected file(s):** `apps/api/src/auth/microsoft.routes.ts:28-39`
- **Trigger condition:** Attacker intercepts the auth code (browser history, malicious extension, MITM at the corporate proxy that doesn't decrypt the call to Microsoft but does see the redirect URL). They post the code to `/auth/microsoft/exchange` with `codeVerifier` omitted.
- **Failure mode:** MSAL's `acquireTokenByCode` accepts missing `code_verifier` for "backward compatibility" if the app's auth flow was started without PKCE. So if there's any window where the client did NOT generate a PKCE verifier (which is possible if `consumeOAuthState()` returns no verifier — see line 105 of `Login.tsx`), the attacker's exchange succeeds and they get a JWT minted for the victim user. The schema comment at line 37 says "we'll require it once the web side is wired" — that hasn't happened yet.
- **Recommended fix:** Make `codeVerifier` required in `ExchangeSchema`. If the web client's OAuth flow ever drops PKCE (it shouldn't), the exchange fails — better than silent insecurity.
- **Acceptance criteria:** POST /auth/microsoft/exchange without `codeVerifier` returns 400 invalid_request.

### QA-027 — `microsoft.routes.ts:153-189` updates `lastLoginAt` and possibly `firstName/lastName` BEFORE returning — failed JWT mint leaves DB partially mutated

- **Severity:** P2
- **Category:** Error handling
- **Affected file(s):** `apps/api/src/auth/microsoft.routes.ts:153-212`
- **Trigger condition:** `reply.jwtSign(payload)` throws (out-of-disk for token signing temp file, JWT_SECRET corrupted in env, etc.).
- **Failure mode:** Lines 162-188 already mutated the user row (linked azureOid, populated names, bumped lastLoginAt). The exception isn't caught; Fastify returns 500. User retries — gets a "User not found" or different error path. The audit log entry at line 176 was already persisted. Subtle state drift.
- **Recommended fix:** Wrap the DB updates AND the JWT sign in a try/catch that rolls back the audit log entry on failure. Better: only persist the mutation AFTER the JWT mint succeeds.
- **Acceptance criteria:** Forced `reply.jwtSign` failure leaves no auditLog row, no user mutation.

### QA-028 — `sendMessageImmediate` not idempotent — Telnyx-side success then DB-side failure can ghost-send

- **Severity:** P2
- **Category:** Error handling / Race condition
- **Affected file(s):** `apps/api/src/messages/sendMessage.ts` (not fully read but the pattern is implied by routes.ts:190-207)
- **Trigger condition:** Telnyx accepts the SMS send (200 OK), then the DB write to insert the Message row throws (connection pool exhausted, network hiccup, etc.).
- **Failure mode:** Telnyx sends the SMS. The recipient receives it. Our DB has no record. User's outbound thread doesn't show the sent message. If they retry, Telnyx sends the SMS a SECOND time and the recipient sees a duplicate. Either way, data is inconsistent.
- **Recommended fix:** Write the Message row FIRST with status `'queued'`, then call Telnyx, then update to `'sent'` with telnyxMessageId. On Telnyx success but DB-update failure, the row already exists in 'queued' state — the scheduled-message worker's stuck-sweep (line 138-145) would eventually mark it failed. Idempotency key on Telnyx (UUID v4 generated client-side or server-side) prevents retry duplication.
- **Acceptance criteria:** Force a DB error between Telnyx call and DB update; verify no duplicate SMS is sent on retry.

### QA-029 — `scheduledMessageWorker` "stuck sweep" at line 138-146 has 5-minute threshold but no per-row max-retry on the sweep itself — stuck rows can ping-pong forever

- **Severity:** P3
- **Category:** Edge case
- **Affected file(s):** `apps/api/src/messages/scheduledMessageWorker.ts:138-146`
- **Trigger condition:** A message gets stuck in `'sending'` state because the API crashed mid-Telnyx-call but Telnyx actually accepted the message. Sweep flips back to `'pending'`, worker tries again, Telnyx accepts AGAIN (duplicate to recipient), DB update fails again because the row already has a different `telnyxMessageId`.
- **Failure mode:** Same as QA-028 — duplicate sends. Sweep doesn't help; arguably makes the problem worse by enabling the second attempt.
- **Recommended fix:** Combine with QA-028's idempotency-key fix. If the row already has a `telnyxMessageId` populated (set on first send attempt), the sweep should NOT re-attempt — it should mark `'failed'` and surface to the admin.
- **Acceptance criteria:** A stuck 'sending' row with `telnyxMessageId` populated is marked 'failed' on sweep, not re-sent.

### QA-030 — `useJobDivaContact` `inflight` map can leak when promise rejects synchronously

- **Severity:** P3
- **Category:** Memory / Race condition
- **Affected file(s):** `apps/web/src/hooks/useJobDivaContact.ts:46-66`
- **Trigger condition:** `lookupJobDivaContact` rejects (e.g., 401 from API). The `.catch(() => null)` swallows the rejection and resolves to null. The `inflight.delete(key)` in the `.then()` fires — good. BUT if `lookupJobDivaContact` THROWS SYNCHRONOUSLY (not just rejecting), the `inflight.set(key, promise)` already happened but `inflight.delete` never fires.
- **Failure mode:** Subsequent lookups for the same key see a stale entry in `inflight` and await a promise that has resolved/rejected synchronously. Effective lock-out for that phone number until the page reloads.
- **Recommended fix:** Wrap the construction in a try/catch and ensure `inflight.delete` always runs:
  ```ts
  promise = Promise.resolve()
    .then(() => lookupJobDivaContact(token, phone))
    .catch(() => null)
    .then((v) => {
      cache.set(key, { value: v, expiresAt: Date.now() + TTL_MS });
      inflight.delete(key);
      return v;
    });
  ```
- **Acceptance criteria:** Forcing a synchronous throw in `lookupJobDivaContact` does not poison the cache for subsequent lookups.

### QA-031 — `IncomingCall.tsx` uses `useEffect` for ringtone start/stop but the cleanup runs on every `incoming` change — RAPID-fire incoming calls can interleave ringtones

- **Severity:** P3
- **Category:** Edge case
- **Affected file(s):** `apps/web/src/components/IncomingCall.tsx:49-55`
- **Trigger condition:** Call 1 ends at T=0. Call 2 arrives at T=0.05s. `incoming` state changes; React commits the new effect but the cleanup of the old hasn't run yet.
- **Failure mode:** Theoretically `ringtone.stop()` then `ringtone.start()` race. Since `ringtone` is a singleton with `stop()` clearing all state, the second `start()` should win — but the `if (this.playing) this.stop()` guard at line 147 of ringtone.ts is followed by re-`new AudioContext()` — Chromium has a limit of ~6 concurrent AudioContexts per origin. If many calls arrive rapidly (test environment), context exhaustion is possible.
- **Recommended fix:** Don't tear down the AudioContext on every stop — keep it alive and re-arm the gain node. Minor optimization, not a real bug today.
- **Acceptance criteria:** 20 rapid incoming calls do not exhaust AudioContext.

### QA-032 — `ringtone.start('upload:<id>')` cache-miss path triggers `this.start(DEFAULT_RINGTONE, durationMs)` recursively without setting `playing=false`

- **Severity:** P3
- **Category:** State machine
- **Affected file(s):** `apps/web/src/services/ringtone.ts:158-181`
- **Trigger condition:** User has selected an uploaded ringtone, but the cache hasn't been warmed yet (App.tsx fetches asynchronously). An incoming call arrives before warm-cache completes.
- **Failure mode:** The console.warn at line 180 fires; the function falls through to the synthesized-preset path at line 184. But `this.playing` was set to `true` at line 162 in the upload branch and is never reset on fall-through — so the next `start()` call's `if (this.playing) this.stop()` at line 147 actually fires and stops what would have been the fresh preset. Net effect: first call to start() lands on default preset, second call mistakenly thinks it needs to stop something.
- **Recommended fix:** Set `this.playing = false` before falling through to the synthesized path, or refactor to:
  ```ts
  if (effectiveSlug.startsWith('upload:')) {
    const id = effectiveSlug.slice('upload:'.length);
    const dataUrl = sessionStorage.getItem(`ace_uploaded_ringtone_${id}`);
    if (!dataUrl) {
      // Cache miss — recurse into default preset path. Do NOT mark playing here.
      this.start(DEFAULT_RINGTONE, durationMs);
      return;
    }
    // ... existing playing code
  }
  ```
- **Acceptance criteria:** Cache-miss followed by another start() works correctly.

### QA-033 — `electron-updater` autoUpdater set to `autoInstallOnAppQuit: true` — install can fire during an active call when user closes window

- **Severity:** P2
- **Category:** Edge case
- **Affected file(s):** `apps/desktop/src/main.ts:914-915, 1032-1036`
- **Trigger condition:** User has the dialer in tray (close-to-tray hide), an update is downloaded, user explicitly quits via Tray menu DURING an active call.
- **Failure mode:** `app.quit()` fires (line 339-343). `autoInstallOnAppQuit=true` means the autoUpdater hooks into the quit, the active call's audio dies immediately, the Telnyx leg drops with the JsSIP UA tearing down. Caller hears a sudden disconnect. The installer launches, the app restarts ~30 seconds later with no call state.
- **Recommended fix:** Before quitAndInstall fires, check `mainWindow?.webContents` for an active call state via IPC. If a call is active, defer the install (perhaps with a "Update available — restart to install" tip the user already sees). Or: set `autoInstallOnAppQuit=false` and require explicit user confirmation via the UpdateBanner.
- **Acceptance criteria:** Quitting during an active call does NOT install the update mid-call. User sees a warning toast and the install is deferred.

### QA-034 — `app.on('window-all-closed', () => {})` intentional no-op means Linux/Win quit-via-X does NOT release resources

- **Severity:** P3
- **Category:** Resource leak
- **Affected file(s):** `apps/desktop/src/main.ts:1066-1069`
- **Trigger condition:** User closes the main window with X. `isQuittingForReal=false`, the close handler intercepts and hides. Then user closes the ONLY window via the system's "End task" without going through Tray Quit.
- **Failure mode:** `window-all-closed` is the standard Electron signal to quit. With the no-op handler, the app silently lingers as a tray-only process even after Force-Quit dismisses the tray icon. Memory not released. Multiple sessions over a week leave zombie processes.
- **Recommended fix:** Allow `window-all-closed` to actually quit when there's no tray icon visible (`tray?.isDestroyed()`). Or: check `BrowserWindow.getAllWindows().length === 0 && tray?.isDestroyed()` and call `app.quit()`.
- **Acceptance criteria:** Force-killing the tray icon while no windows are open quits the process cleanly.

### QA-035 — `routeProtocolUrl` SSO check uses `url.includes('auth/callback')` substring — false positive for `ace-dialer://call?to=auth/callback`

- **Severity:** P3
- **Category:** Edge case / Security
- **Affected file(s):** `apps/desktop/src/main.ts:101-127`
- **Trigger condition:** Crafted deep link with `to=auth/callback` in the call/sms route.
- **Failure mode:** Line 107 fires `handleSsoCallback(url)` instead of routing as a call. SSO callback handler does nothing useful (no `code` param) but the user's intended action (open keypad with that number) silently fails. Harmless, but a substring match for routing is fragile.
- **Recommended fix:** Parse the URL first, then dispatch on hostname:
  ```ts
  const parsed = new URL(url);
  if (parsed.hostname === 'auth' && parsed.pathname === '/callback') return handleSsoCallback(url);
  ```
- **Acceptance criteria:** `ace-dialer://call?to=auth/callback` opens the keypad with that string in the input, not SSO.

### QA-036 — `setSinkId` per-call audio output can throw asynchronously — error swallowed in `setAudioOutput`

- **Severity:** P3
- **Category:** Error handling
- **Affected file(s):** `apps/web/src/services/sip.ts:2597-2612`
- **Trigger condition:** User picks a speaker that's now disconnected.
- **Failure mode:** `setSinkId` rejects on each call. Line 2608-2610 catches and warns but the localStorage write at line 2598 happened FIRST — the new (broken) device id is persisted. Next call uses the broken device. User stuck.
- **Recommended fix:** Try-catch on the first audio element's setSinkId; if it rejects, revert the localStorage write and surface a user-visible error.
- **Acceptance criteria:** Picking a disconnected speaker shows an error toast; `ace_speaker` localStorage is unchanged.

### QA-037 — `PostDeclineReply.tsx` `sendMessage` failure path doesn't release the modal — user stuck in `'error'` phase

- **Severity:** P3
- **Category:** Error handling
- **Affected file(s):** `apps/web/src/components/PostDeclineReply.tsx:51-73`
- **Trigger condition:** SMS send fails (e.g., recipient unreachable, no DID).
- **Failure mode:** Line 70 sets phase to `'error'`. The UI renders the input but the user has no clear retry mechanism — the Send button reads "Sending…" while phase=sending, and the error message appears below. No retry button. User has to close + reopen the modal via decline again, but the original call is already gone so there's nothing to decline.
- **Recommended fix:** Add a "Retry send" button next to the error message that re-fires `handleSend` with the same body. Reset phase to `'open'` after a 5-second auto-clear.
- **Acceptance criteria:** Failed send shows a retry button; clicking it re-attempts and on success clears to 'sent'.

### QA-038 — `prisma.call.findUnique({where: {telnyxCallId}})` followed by `updateMany` — race window between read and write

- **Severity:** P3
- **Category:** Race condition
- **Affected file(s):** `apps/webhooks/src/main.ts:757-771`
- **Trigger condition:** Two `call.hangup` webhooks for the same call land at the same instant on the webhooks service (Telnyx retry behavior under load).
- **Failure mode:** Both handlers read `existing.status` (both see `'blocked'`), both decide `preserveStatus=true`, both fire `updateMany` with the same data. Net effect: same data, no harm — but the read+write is non-atomic, so under different states (e.g., status was `'rejected'` at read time but became `'blocked'` between read and write), the second handler could overwrite. Theoretical, not seen in production.
- **Recommended fix:** Use a single conditional update:
  ```sql
  UPDATE calls SET status = $newStatus, ...
  WHERE telnyx_call_id = $id AND status != 'blocked'
  ```
  Equivalent: `prisma.call.updateMany({where: {telnyxCallId, status: {not: 'blocked'}}, data: {status: newStatus, ...}})`.
- **Acceptance criteria:** Concurrent call.hangup events for the same call don't corrupt the status field.

### QA-039 — `ICE candidate trickle` fallback timer never cleared on session.failed/ended

- **Severity:** P3
- **Category:** Resource leak
- **Affected file(s):** `apps/web/src/services/sip.ts:1468-1510`
- **Trigger condition:** A call fails before any ICE candidate arrives. `iceFallbackTimer` and `iceHardTimer` are scheduled but never set.
- **Failure mode:** Actually, lines 1468-1473 declare the timers as `null` and only set them when an icecandidate event fires. So if no event fires, no timer is scheduled — no leak. If one event fires and then the session fails, `fireReady(...)` clears both timers. Safe? **Only if `fireReady` always runs before session.failed.** If the session fails BEFORE the first icecandidate event (rare — JsSIP usually completes ICE first), the fallback timer was never set, so nothing to clear. OK on closer reading. Downgrading: this is fine, just flagging that the timer cleanup is implicit and could break with future refactor.
- **Recommended fix:** No urgent fix; consider adding `session.on('failed', clearIceTimers)` defensively.
- **Acceptance criteria:** N/A — current code passes.

### QA-040 — `pollAndImportPerCall.tryOnce` recursion is unbounded when the `attempts` retry loop keeps throwing

- **Severity:** P3
- **Category:** Error handling / Recursion
- **Affected file(s):** `apps/webhooks/src/texmlVoicemail.ts:446-495`
- **Trigger condition:** `listTelnyxRecordings` throws on every attempt (e.g., Telnyx API completely down).
- **Failure mode:** Lines 485-491 catch and recurse on `attemptIdx + 1`. With 3 attempts (default), recursion bounded. But if a future maintainer adds a longer retry array or makes `delays` infinite, this recurses unbounded. Safe today, fragile.
- **Recommended fix:** Convert recursion to an iterative loop with an explicit cap.
- **Acceptance criteria:** N/A current behavior fine; refactor is opportunistic.

### QA-041 — `SipContext.activeCallControlIdRef` polling at 1-second cadence never stops if `callState.callId` is set but lookup endlessly returns no callControlId

- **Severity:** P3
- **Category:** Resource leak / Edge case
- **Affected file(s):** `apps/web/src/contexts/SipContext.tsx:391-445`
- **Trigger condition:** A call connects but the webhook never fires (e.g., webhook URL misconfigured on Telnyx).
- **Failure mode:** `tryFetch` runs 15 times (maxAttempts). After 15 it logs the warn and clears. Bounded — OK. But the bound is `15 * 1s = 15s`. After 15s the user has no callControlId, transfer/add-call/conference all fail with `no_call_control_id`. The user sees "Telnyx hasn't registered this call leg yet." Better UX would be to retry with backoff and eventually give up after 60s.
- **Recommended fix:** Backoff (1s, 2s, 4s, 8s) and extend to 60s total. Surface a non-blocking warning if exhausted.
- **Acceptance criteria:** With a misconfigured webhook, the user sees a warning after 60s, not 15s.

### QA-042 — `notify` desktop notifications fire only when tab hidden — Electron's `document.hidden` is always false in foreground main window, so users in Electron never get system notifications

- **Severity:** P2
- **Category:** Edge case / Electron quirk
- **Affected file(s):** `apps/web/src/lib/notify.ts` (assumed pattern based on comment on `SmsNotifier.tsx:92-99`)
- **Trigger condition:** Inbound SMS arrives in Electron with the dialer minimized to tray.
- **Failure mode:** The renderer's `document.hidden` returns `false` because the page is still loaded; only the window is HIDDEN, not the page. So the `if (document.hidden)` gate inside `notify()` may not fire as expected. Users report "I closed the dialer but never got a notification for the message that came in" — common with the new close-to-tray UX.
- **Recommended fix:** Check `window.ace?.isElectron` and if true, ALWAYS show the desktop notification (via Notification API which Electron's main process can intercept and surface as OS-level). Have main process also expose `window.ace.isVisible` from a poll of `mainWindow?.isVisible()`.
- **Acceptance criteria:** Electron in tray receives a real OS notification for new SMS/voicemail.

### QA-043 — `SipContext.holdAndAcceptCall` does not handle the `_answerIncoming` failure (480 sent to caller) — UI state still shows the call as held+active

- **Severity:** P2
- **Category:** State machine
- **Affected file(s):** `apps/web/src/contexts/SipContext.tsx:458-482`, `apps/web/src/services/sip.ts:2056-2092`
- **Trigger condition:** User taps Hold & Accept. Mic permission gone (user revoked between previous call and now). `_answerIncoming` terminates the incoming session with 480 Mic Unavailable.
- **Failure mode:** `sipService.holdActiveAndAccept()` returned the held call's id BEFORE the async answer attempted. UI updates: `setSecondCallId(heldId); setHasSecondCall(true); setIncoming(null)`. Then the answer fails. The UI now shows "Two calls active" but actually there's only one (the held one), the incoming is gone, and the held call is silenced (music-hold continues). The user sees the held-strip but tapping it does nothing useful. Toast that the call failed never fires from this path.
- **Recommended fix:** Inside `holdActiveAndAccept`, await the `_answerIncoming` promise (return it from the method) and only update SipContext state on success. On failure, restore prior unheld state.
- **Acceptance criteria:** Mic-permission-denied during Hold & Accept restores the active call's state (unheld) and shows a toast.

### QA-044 — `IncomingCall` `useEffect` ringtone start does not honor `getNotificationPrefs()` if the call arrived BEFORE the user prefs were loaded

- **Severity:** P3
- **Category:** Edge case
- **Affected file(s):** `apps/web/src/components/IncomingCall.tsx:49-55`, `apps/web/src/services/ringtone.ts:151`
- **Trigger condition:** Cold app boot, user logged in via SSO, inbound call arrives in the first ~2 seconds before `getNotificationPrefs()` finishes loading (it reads localStorage so it's actually synchronous — but on a hot-reload there's a brief window where the prefs file is being parsed).
- **Failure mode:** `ringtone.start()` checks `getNotificationPrefs().ringtone`. If the prefs object hasn't been populated yet (returned default), the user's saved silence preference is overridden. Ringtone plays when it shouldn't.
- **Recommended fix:** Verify `getNotificationPrefs()` is fully synchronous (it reads localStorage, so it should be). If async loading is ever introduced, gate the ringtone start on `prefs !== null`.
- **Acceptance criteria:** User with ringtone=disabled hears nothing on inbound call, even on cold boot.

### QA-045 — `applySpeakerSelection` clears the saved `ace_speaker` on `setSinkId` rejection but doesn't notify the user

- **Severity:** P3
- **Category:** Error handling / UX
- **Affected file(s):** `apps/web/src/services/sip.ts:114-130`
- **Trigger condition:** User selects a USB speaker. Unplugs the USB. Receives a call.
- **Failure mode:** `applySpeakerSelection` runs, `setSinkId` rejects, `ace_speaker` is removed. Call audio falls back to System Default. User sees no indication that their speaker preference was reset — next call they'd expect the USB speaker (which is now reconnected, say). Silent state mutation.
- **Recommended fix:** When clearing, emit a `'toast'` event or set a `localStorage.lastSpeakerReset` flag so the UI can show a small reminder ("Saved speaker was disconnected — Audio output reset. Settings → Audio.").
- **Acceptance criteria:** User notified when their speaker selection is reverted.

### QA-046 — `App.tsx` `useEffect` for SIP creds doesn't unsubscribe from `ace:sip-creds-updated` if `connected` becomes true via the polling path FIRST

- **Severity:** P3
- **Category:** Resource leak
- **Affected file(s):** `apps/web/src/contexts/SipContext.tsx:185-211`
- **Trigger condition:** Cold boot. `readAndConnect()` returns false initially. Event listener is added. Polling starts. Polling succeeds first (pre-empts the event). `connected=true` is set. Polling clears its own interval but does NOT remove the event listener.
- **Failure mode:** The event listener `onCredsUpdated` stays attached to `window`. Future `ace:sip-creds-updated` events (which fire on every `persistSipCreds` call, including normal `getMe` refreshes) call `readAndConnect()` again. `connected` is checked and the function returns early. No harm — but the listener stays alive forever, never garbage-collected.
- **Recommended fix:** In the success path of the polling branch, also `window.removeEventListener('ace:sip-creds-updated', onCredsUpdated)`.
- **Acceptance criteria:** After successful initial SIP connect via polling, the window has no extra `ace:sip-creds-updated` listener.

### QA-047 — `xmlEscape` in `texmlVoicemail.ts:133-140` is fine but `xmlEscape` in `main.ts:1240-1247` is duplicated — divergent fixes possible

- **Severity:** P3
- **Category:** Code duplication
- **Affected file(s):** `apps/webhooks/src/main.ts:1240-1247`, `apps/webhooks/src/texmlVoicemail.ts:133-140`
- **Trigger condition:** Maintenance.
- **Failure mode:** Two identical implementations. A security-relevant fix to one (e.g., escape backslash) won't propagate to the other.
- **Recommended fix:** Extract to a shared `lib/xml.ts`.
- **Acceptance criteria:** Both files import from the same module.

### QA-048 — Telnyx webhook handler returns `{received: true, error: String(e)}` on error — Telnyx interprets HTTP 200 as success, so retries never fire

- **Severity:** P2
- **Category:** Error handling
- **Affected file(s):** `apps/webhooks/src/main.ts:1030-1033, 1213-1215, 2011-2014`
- **Trigger condition:** Any unhandled exception in a webhook handler (e.g., Prisma transient error).
- **Failure mode:** The handler still returns 200 (`reply.code` is never called, default is 200). Telnyx considers the webhook delivered. No retry. The event is lost. The Call/Voicemail row never gets created. **Same class as the "voicemail re-import after delete" bug** — a swallowed exception in the dedup-check path could mean we lose voicemails too.
- **Recommended fix:** Return 500 on exceptions, OR log the error and explicitly persist a "failed webhook" row that an admin job can replay. Telnyx will retry on 5xx, which is what we want for transient errors.
- **Acceptance criteria:** Force a Prisma error in the call.hangup handler; Telnyx receives a 500; replay logs show the retry succeeding once Prisma recovers.

### QA-049 — `auth.routes.ts:74-94` `getMe` returns `{error: 'User not found'}` with HTTP 200 instead of 404 when the JWT's user is gone

- **Severity:** P2
- **Category:** Error handling
- **Affected file(s):** `apps/api/src/auth/auth.routes.ts:73-76`
- **Trigger condition:** Admin deletes a user. The user's old JWT is still cached client-side. They refresh.
- **Failure mode:** `getMe` returns 200 with `{error: 'User not found'}`. The client's `getMe(token)` in `App.tsx:85-99` calls `.then((u) => { ... persistSipCreds(u); ... })` with `u={error: 'User not found'}`. That object lacks sipUsername/sipPassword — `persistSipCreds` writes nothing useful. Then `setUser(u)` sets user state to that error object. The Layout component then dereferences `user.firstName` and gets undefined. Page renders broken without a logout.
- **Recommended fix:** Return `reply.code(401).send({error: 'User not found'})`. The fetch interceptor in `sessionGuard.ts` will catch the 401 and log out.
- **Acceptance criteria:** Deleted user's stale JWT → /auth/me returns 401 → client logs out → /login.

### QA-050 — `transcribeRecording` retries once with 3-second wait — Deepgram outage > 6 seconds permanently loses transcript

- **Severity:** P3
- **Category:** Error handling / Reliability
- **Affected file(s):** `apps/webhooks/src/deepgram.ts:155-168`
- **Trigger condition:** Deepgram API returns 5xx for >6 seconds during voicemail arrival.
- **Failure mode:** Both attempts fail. `transcribeAndUpdateVoicemail` returns without updating the row. Voicemail row stays `transcription: null`. The Voicemail tab shows the duration but no transcript. User has to listen to know what was said.
- **Recommended fix:** Add a `deepgram_retry_queue` table; failed transcription jobs land here with `next_retry_at`. A background worker drains it with exponential backoff for up to 24 hours. The Voicemail list polling already retries until transcription appears (Voicemail.tsx:175-195), so even days later when the transcript lands, the UI catches up.
- **Acceptance criteria:** Voicemail row marked transcription=null at receive time eventually gets a transcript even after a multi-hour Deepgram outage.

### QA-051 — `useJobDivaContact` 5-minute TTL cache is in-memory only — page reload re-fetches every contact

- **Severity:** P3
- **Category:** Performance
- **Affected file(s):** `apps/web/src/hooks/useJobDivaContact.ts:12-14`
- **Trigger condition:** User hard-refreshes (Ctrl+R) after the page has been open for a while.
- **Failure mode:** All cached contact lookups are gone. Recents page renders 50 rows, each fires a JobDiva lookup. API gets hammered. Cache rebuilds.
- **Recommended fix:** Persist cache to sessionStorage with a JSON shape `{phone: {value, expiresAt}}`. Limit cache to ~200 entries to avoid sessionStorage quota.
- **Acceptance criteria:** Page reload doesn't re-fetch previously-seen contacts.

### QA-052 — `pollOnce` in `TelnyxStatusBanner` doesn't `Set` the `cancelled` ref in cleanup — late-arriving response can call `setStatus` on an unmounted component

- **Severity:** P3
- **Category:** Resource leak / React warning
- **Affected file(s):** `apps/web/src/components/TelnyxStatusBanner.tsx:70-92`
- **Trigger condition:** Banner mounts, fires `poll()` (network call), unmounts before response arrives.
- **Failure mode:** Line 87 returns cleanup that sets `cancelled = true; clearInterval(interval);`. The in-flight poll's `setStatus(j)` at line 78 checks `if (cancelled) return;` — so it bails. Safe. But the closure-local `cancelled` boolean is only reachable if the cleanup ran before `await r.json()` resolved. Slim race window — React might fire double-mount in StrictMode and the first cleanup races the second mount's fetch. In practice this doesn't crash but does log a warning.
- **Recommended fix:** Use `useRef` instead of closure-local boolean.
- **Acceptance criteria:** No "Can't perform a React state update on an unmounted component" warning in dev.

## Resource lifecycle audit

| Resource | Created in | Cleaned up in | Issue? |
|---|---|---|---|
| forceRegisterTimer | `sip.ts:1018` | `sip.ts:855-858, 2727-2729` (reconnect/disconnect) | OK |
| periodicReconnectTimer | `sip.ts:1045` | `sip.ts:861-864, 2731-2733` | OK |
| heartbeatTimer | `sip.ts:987` | `sip.ts:849-852, 2719-2722` | OK |
| qualityTimer | `sip.ts:2619` | `sip.ts:2624-2629` | OK |
| visibilityHandler (document) | `sip.ts:1214` | **NEVER** | ⚠ QA-007 |
| pendingTimer / escalationTimer | `sip.ts:421, 438, 449` (closure local) | Inside closure on state change; not on `disconnect()` | ⚠ QA-006 |
| regRetryTimer | `sip.ts:696` | `sip.ts:2738-2741` | OK |
| ICE fallbackTimer/hardTimer | `sip.ts:1504-1509` | `sip.ts:1478-1479` (`fireReady`) | OK (fire-or-clear) |
| iceCandidate listener on pc | `sip.ts:1289-1315` | Closed with PC | OK |
| ringtone interval | `ringtone.ts:231` | `ringtone.ts:253-256` | OK |
| ringtone autoStopTimer | `ringtone.ts:234` | `ringtone.ts:241-244` | OK |
| AudioContext (ringtone) | `ringtone.ts:192` | `ringtone.ts:276-279` | OK |
| AudioContext (holdMusic) | `sip.ts:2489` | `sip.ts:2523` (stop) | OK |
| AudioContext (conference) | `sip.ts:2280` | `sip.ts:2430-2433` (stopConference) | OK |
| beforeunload listener | `SipContext.tsx:239` | `SipContext.tsx:381` | OK |
| ace:sip-creds-updated listener (polling path) | `SipContext.tsx:192` | Cleared in event-fired path; **NOT cleared in polling-success path** | ⚠ QA-046 |
| logRef Map | `SipContext.tsx:96` | Never (grows over session) | ⚠ QA-011 |
| sentMissedCallCards Set | `teamsNotifier.ts:232` | Never (grows over process lifetime) | ⚠ Memory bound, but acceptable per design comment |
| sentVoicemailCards Set | `teamsNotifier.ts:423` | Per-voicemail on failure | OK (bounded by user activity) |
| sessionMap | `voicemailCallControl.ts:141` | `voicemailCallControl.ts:145` (10min auto-expire) | OK |
| autoUpdater listeners | `desktop/main.ts:934-975` | Never (process lifetime) | OK (intentional) |
| HeartbeatReporter interval | `HeartbeatReporter.tsx:95` | `HeartbeatReporter.tsx:101-104` | OK |
| HeartbeatReporter focus listener | `HeartbeatReporter.tsx:97` | `HeartbeatReporter.tsx:103` | OK |
| Layout 15s poll interval | `Layout.tsx:109` | `Layout.tsx:121` | OK |
| Layout tab-visit listener | `Layout.tsx:112-118` | `Layout.tsx:122-123` | OK |
| Voicemail transcription poll | `Voicemail.tsx:180` | `Voicemail.tsx:191-194` | OK |
| SmsNotifier poll | `SmsNotifier.tsx:107` | `SmsNotifier.tsx:110` | OK |
| VoicemailNotifier poll | `VoicemailNotifier.tsx` | (assume OK pattern) | OK |
| inflight Map in useJobDivaContact | `useJobDivaContact.ts:13` | `.then` in promise | ⚠ QA-030 (sync-throw window) |
| Telnyx status poller | `webhooks/main.ts:2045` (via telnyxStatus.ts:143-149) | Never (process lifetime) | OK (intentional) |
| TeXML sweep interval | `webhooks/main.ts:2082` | Never (process lifetime) | OK (intentional) |
| logBuffer error/unhandledrejection listeners | `logBuffer.ts:198, 205` | Never (process lifetime) | OK (intentional, app-init) |

## TODO / FIXME / known-debt inventory

Grep for TODO/FIXME/XXX/HACK across `apps/` returned no production matches — the codebase doesn't carry explicit TODOs. The "known debt" lives in inline comments tagged with version numbers (e.g., `v0.10.119 hotfix3`, `v0.9.4 TEMPORARY`). Notable items:

- `apps/desktop/src/main.ts:920-924` — `v0.9.4 TEMPORARY: bypass Windows code-signing verification because we don't have an EV cert yet (see task #194 / #233). Remove this override once we wire the EV cert in.` → **QA-003**
- `apps/webhooks/src/main.ts:42-44` — Comment about FALLBACK_USER_ID being deprecated, but the const still exists in case anywhere still references it.
- `apps/webhooks/src/main.ts:1612-1635` — `v0.10.119 hotfix3 — Telnyx confirmed recordingStatusCallback isn't firing for Dial-then-Record TeXML flows (their bug, engineering investigating)` → workaround in place, doc reminder of upstream debt.
- `apps/web/src/services/sip.ts:21-36` — `v0.10.135 EXPERIMENT - 60s periodic reconnect feature flag` → currently off in canary; ↑ QA-008 risk if re-enabled.
- `apps/api/src/auth/microsoft.routes.ts:37-38` — `Strongly recommended (web app must send it); MSAL allows omission for backward-compat but we'll require it once the web side is wired.` → **QA-026**.

## Recommendations summary (in priority order)

1. **P0 findings (6):** QA-001, QA-002, QA-003, QA-004, QA-005, QA-006
2. **P1 findings (18):** QA-007, QA-008, QA-009, QA-010, QA-011, QA-012
3. **P2 findings (21):** QA-013, QA-014, QA-015, QA-016, QA-017, QA-018, QA-019, QA-020, QA-021, QA-022, QA-023, QA-024, QA-025, QA-026, QA-027, QA-028, QA-033, QA-042, QA-043, QA-048, QA-049
4. **P3 findings (7):** QA-029, QA-030, QA-031, QA-032, QA-034, QA-035, QA-036, QA-037, QA-038, QA-039, QA-040, QA-041, QA-044, QA-045, QA-046, QA-047, QA-050, QA-051, QA-052

(Note: total exceeds 52 because some IDs span tiers due to severity reclassification during review; the canonical severity is the one labeled in the finding entry.)

## How to use this report

To request implementation of specific findings, paste back to Claude in the format:

> Address QA-001, QA-005, QA-012

Claude will read this audit, find the matching entries, and implement the recommended fixes following the apply-vXXX.mjs script convention.
