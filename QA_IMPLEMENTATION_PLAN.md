# ACE Dialer — QA Implementation Plan (post-v0.10.138)

**Created:** 2026-06-12
**Author:** Claude (senior backend / full-stack agent)
**Source audit:** `QA_AUDIT.md` (52 findings)
**Companion script:** `scripts/apply-v138-qa-safe-batch.mjs` (already applies 10 low-risk fixes)

---

## What this document is

The `apply-v138-qa-safe-batch.mjs` script auto-applies 10 deterministic,
low-risk fixes from the QA audit. **Everything else lives here.** This
file contains step-by-step plans for the 35+ findings that touch
security, API contracts, database schema, environment variables, or
async behavior with subtle side effects — none of which should be
shipped via a one-shot apply script.

Items are grouped into "batches" you can ship together. Each batch
identifies the QA-NNN ids it addresses, the rationale, file paths,
acceptance criteria, and risk + effort.

## Snapshot

| Status | Count | Notes |
|---|---|---|
| Auto-applied in v0.10.138 | 10 | QA-007, QA-011, QA-012, QA-017, QA-022, QA-029, QA-030, QA-035, QA-036, QA-049 |
| Already done (no work) | 1 | QA-046 (SipContext.tsx already removes the listener in the polling-success path at lines 203, 206) |
| Deferred to this plan | 41 | Everything below |
| **Total** | **52** | matches QA_AUDIT.md |

---

# BATCH 1 — Security hardening (CRITICAL, P0+P2)

**Why batched together:** All three of these are pre-production security
holes that must be closed before the dialer's user base grows beyond the
40-person trial. They share the same review surface (auth wiring,
secrets handling) and rolling them in one PR gives the security
reviewer one window to look at all of it.

## QA-001 — Socket service has zero authentication (P0)

**Risk if auto-fixed:** Any mistake locks all 40 users out of socket events.
**Why human review:** Token verification crosses two services (api mints,
socket verifies). The JWT_SECRET env-var has to be present on BOTH
Render services with matching values, or every legitimate connection
will be rejected.

### Steps

1. In `apps/socket/src/main.ts`, add a JWT-verification middleware:
   ```ts
   import { createVerifier } from 'fast-jwt'; // or @fastify/jwt's verifier
   const verify = createVerifier({ key: process.env.JWT_SECRET! });
   io.use(async (socket, next) => {
     const token = socket.handshake.auth?.token;
     if (!token) return next(new Error('auth_missing'));
     try {
       const payload = await verify(token);
       socket.data.user = payload; // { sub, email, isAdmin }
       next();
     } catch {
       next(new Error('auth_invalid'));
     }
   });
   ```
2. Replace `cors.origin: true` (line 17-22) with an explicit allowlist:
   ```ts
   const allowed = (process.env.SOCKET_CORS_ORIGINS ?? '')
     .split(',').map((s) => s.trim()).filter(Boolean);
   const corsOrigin = allowed.length > 0 ? allowed : false;
   ```
3. Do the same for the Fastify `origin: true` at line 23.
4. On the web client side (`apps/web/src/services/socket.ts` if it
   exists, otherwise wherever the socket is created): pass
   `auth: { token: sessionStorage.getItem('ace_token') }` in the
   io() options.
5. **Env vars needed on Render:**
   - `ace-dialer-socket`: add `JWT_SECRET` (copy from `ace-dialer-api`),
     `SOCKET_CORS_ORIGINS` (e.g. `https://dialer.ap-task.com,https://localhost:5173`)
   - `ace-dialer-api`: `WEBHOOKS_PUBLIC_URL` is already wired; verify
     no socket-specific creds needed there.

### Acceptance criteria

- Opening a Socket.IO client without `auth.token` returns `auth_invalid`
  and the connection closes immediately.
- An expired JWT also rejects.
- All 40 testers' sessions still connect after rollout (smoke test
  before flipping CORS to the production allowlist).

### Risk + effort

**Risk:** M (a misconfigured env-var on Render means broken sockets for all users — but the failure mode is fail-closed, not silent).
**Effort:** S (2-3 hours including env-var coordination).

---

## QA-002 — `sipPassword` returned over the wire + stored in sessionStorage (P0)

**Risk if auto-fixed:** Breaking this changes the dialer's bootstrap
contract. Every client expects to read `ace_sip_password` from
sessionStorage on App mount.
**Why human review:** Fixing this RIGHT requires Telnyx Credential
Connection short-TTL token minting via `/v2/credential_connections/refresh`
on the backend. We need a Telnyx API key with the right scope, a refresh
job on a worker, and a new auth route. This is several days of work.

### Phase A (interim hardening — ~1 day)

1. Encrypt SIP passwords AT REST in the DB. Add a `SIP_ENCRYPTION_KEY`
   env var (32-byte hex). Encrypt on User.sipPassword writes; decrypt
   only inside the API process.
   - File: `apps/api/src/lib/sipCrypto.ts` (new). AES-256-GCM with the
     env-var key.
   - Migration: convert existing rows in a one-time script before
     deploying the code that decrypts.
2. Move the `sipPassword` field out of `/auth/login` and `/auth/me`
   response bodies. Add a NEW endpoint `GET /auth/sip-credentials` that
   returns `{username, password}` ONCE per JWT lifetime. Track the
   `sipCredentialsIssuedAt` field on the User row to detect re-issuance.
3. Client side: replace `persistSipCreds` (App.tsx:30-33) with a
   one-shot fetch of `/auth/sip-credentials` AFTER login/refresh.
   Stop writing to sessionStorage; pass the creds directly into
   SipContext via a ref.

### Phase B (full fix — ~1 week)

4. Mint Telnyx Credential Connection refresh tokens server-side, per
   active session. Return only the short-TTL token to the client.
   - File: `apps/api/src/lib/telnyxAuth.ts` (new). Background scheduler
     refreshes tokens before TTL.
5. Drop SIP_ENCRYPTION_KEY usage (passwords no longer travel).

### Acceptance criteria

- `sessionStorage.getItem('ace_sip_password')` returns null after
  Phase A.
- `/auth/login` and `/auth/me` response bodies do NOT include
  `sipPassword` field.
- Admin can rotate one user's Telnyx creds without invalidating other
  users' dialer sessions.

### Risk + effort

**Risk:** L (changes auth contract, every client must be updated; in-flight calls during the migration are at risk).
**Effort:** L (1 week minimum including Telnyx coordination + testing).

---

## QA-003 — `verifyUpdateCodeSignature` no-op stub (P0, supply chain)

**Risk if auto-fixed:** Removing the override without an EV cert means
NO updates can install (every binary fails the publisher check),
which strands all 40 users on v0.10.137 forever.
**Why human review:** This is fundamentally a procurement task (buy an
EV cert), not a code task.

### Steps

1. **Procurement (1-2 weeks)**: Buy an EV code-signing certificate from
   Sectigo or DigiCert ($300-500/yr). Process requires a hardware token
   shipped to the company address + identity verification.
2. **Build pipeline**: Update `.github/workflows/build-desktop.yml` to
   sign the .exe via electron-builder's `signtoolOptions`. Store the
   cert + password as GitHub Actions secrets.
3. **Interim safety net** (do this FIRST, before procurement completes):
   In `apps/desktop/src/main.ts:925-932`, gate the no-op override behind
   an explicit env-var:
   ```ts
   if (process.env.ACE_BYPASS_CODE_SIGNING === 'allowed-during-procurement') {
     // existing no-op
   } else {
     // delete the override entirely; electron-updater falls back to
     // default verification, which will FAIL for unsigned binaries
     // until the cert lands.
   }
   ```
   Then explicitly DO NOT set that env var on the user-facing build —
   only on the canary tester's machine during the gap.
4. **Once cert is live**: remove the override stub entirely.

### Acceptance criteria

- Production .exe is EV-signed; auto-update of an unsigned/wrong-publisher
  binary fails with "Could not verify the signature."

### Risk + effort

**Risk:** L (no fix without cert; cert procurement is slow).
**Effort:** L (procurement-bound; ~30 min of code work once cert is in hand).

---

# BATCH 2 — Webhook concurrency + correctness (P0+P2)

**Why batched together:** All of these are in the webhooks service and
all depend on the multi-replica dedup decision. If you ship QA-005 first
(Postgres-backed dedup), several of the others become structurally
easier.

## QA-005 — In-memory dedup Sets break under multi-replica (P0)

**Risk if auto-fixed:** Requires a schema migration. A bad rollout
could corrupt the dedup table and either double-notify users or drop
notifications entirely.
**Why human review:** This is a database schema change with
implications for every downstream notifier.

### Steps

1. **Schema migration** (`packages/db/prisma/schema.prisma`):
   ```prisma
   model WebhookDedup {
     key       String   @id
     sentAt    DateTime @default(now()) @map("sent_at")
     @@map("webhook_dedup")
   }
   ```
   Plus an index on `sentAt` for the TTL sweep.
2. **TTL job**: add to `apps/webhooks/src/main.ts` startup:
   ```ts
   setInterval(async () => {
     await prisma.webhookDedup.deleteMany({
       where: { sentAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
     });
   }, 60 * 60 * 1000);
   ```
3. **Replace `sentMissedCallCards` / `sentVoicemailCards` Sets**
   in `teamsNotifier.ts:232, 423` and emailNotifier.ts:125 with:
   ```ts
   async function claimSend(key: string): Promise<boolean> {
     try {
       await prisma.webhookDedup.create({ data: { key } });
       return true;
     } catch (e: any) {
       if (e?.code === 'P2002') return false; // unique violation = already sent
       throw e;
     }
   }
   ```
   Each send-card path calls `if (!(await claimSend('teams:missedCall:' + callDbId))) return;`
4. **Replace `sessionMap`** in `voicemailCallControl.ts:141-146` with a
   new `VoicemailCallSession` Prisma model keyed by `callSessionId`.
   The 10-minute auto-expire becomes a SELECT with a `createdAt > now()-10min`
   filter.
5. **Render deployment**: After this lands, scale `ace-dialer-webhooks`
   from 1 → 2 replicas and verify dedup holds under replay test.

### Acceptance criteria

- Two webhook replicas running concurrently with the same retried event
  produce exactly one Teams card / Voicemail row.
- The webhook_dedup table stays under 1MB given 7-day TTL.

### Risk + effort

**Risk:** L (DB migration, downstream notifiers, multi-replica deploy).
**Effort:** L (2-3 days including replay testing).

---

## QA-004 — `voicemailCallControl.call.recording.saved` bypasses dedup + blocked-user gate (P0)

**Risk if auto-fixed:** Refactoring this path requires changing the
shape of `processVoicemail` and threading it through a second file.
A mistake means we silently start writing voicemail rows for
blocked numbers OR start losing voicemails entirely.
**Why human review:** Cross-file refactor with no test coverage today.

### Steps

1. Export `processVoicemail` from `apps/webhooks/src/main.ts` (or
   extract into `apps/webhooks/src/lib/processVoicemail.ts`).
2. In `voicemailCallControl.ts:416-486`, replace the direct
   `prisma.voicemail.create(...)` call with `processVoicemail(payload, 'cc-recording-saved')`.
3. Map the existing payload shape onto `NormalizedVmPayload`.
   Verify the `telnyxCallId` we pass dedups against existing Hosted-VM
   and TeXML-VM rows.
4. Add a regression test in `apps/webhooks/__tests__/voicemailCallControl.test.ts`
   that fires `call.recording.saved` twice and asserts a single row.

### Acceptance criteria

- Replaying `call.recording.saved` twice for the same call produces
  exactly one Voicemail row.
- A blocked caller's Call-Control voicemail is silently dropped.

### Risk + effort

**Risk:** M (silent data divergence if mapping is wrong).
**Effort:** M (~4 hours including the new test).

---

## QA-006 — `_doConnect` `pendingTimer` / `escalationTimer` not cleared on disconnect (P0)

**Risk if auto-fixed:** These timers live in a CLOSURE created inside
`_doConnect`. To clear them from `disconnect()` requires moving them
to class fields, which means every reference inside `_doConnect`
(scheduleEmit, clearAllTimers, the 'registered' handler, etc.) has
to be updated. One missed reference and the state machine breaks.
**Why human review:** Refactor of 80 lines of state-machine code in
a hot path; needs careful diffing.

### Steps

1. Promote `pendingTimer` and `escalationTimer` from closure-local to
   class fields:
   ```ts
   private pendingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
   private escalationTimer: ReturnType<typeof setTimeout> | null = null;
   private pendingState: SipState | null = null;
   ```
2. Update `clearAllTimers`, `scheduleEmit`, `emitImmediate`, and the
   'registered'/'unregistered'/'disconnected' handlers to use the
   class fields.
3. In `disconnect()` (around line 2730), add cleanup:
   ```ts
   if (this.pendingDebounceTimer) { clearTimeout(this.pendingDebounceTimer); this.pendingDebounceTimer = null; }
   if (this.escalationTimer) { clearTimeout(this.escalationTimer); this.escalationTimer = null; }
   ```
4. Manual test: attach a listener that throws on `state` event,
   disconnect during an in-flight debounce, verify no throw.

### Acceptance criteria

- After `sipService.disconnect()`, no further 'state' events fire.

### Risk + effort

**Risk:** M (hot path, regressions could re-introduce the v0.10.88
Shreya incident).
**Effort:** M (~3 hours).

---

# BATCH 3 — Voicemail + Recents data integrity (P1+P2)

**Why batched:** All touch the inbound-call / voicemail attribution
path. Shipping them together gives one regression window for the
TeXML trial users.

## QA-019 — Behavioral dedup window 30s drops legitimate distinct voicemails (P2)

### Steps

1. In `apps/webhooks/src/main.ts:1844-1868`, tighten the window from
   30s to 10s.
2. Add a duration check:
   ```ts
   const behavioralDup = await prisma.voicemail.findFirst({
     where: {
       userId: ownerUserId,
       fromNumber: payload.fromNumber,
       receivedAt: { gte: new Date(payload.receivedAt.getTime() - 10_000), lte: new Date(payload.receivedAt.getTime() + 10_000) },
       durationSeconds: payload.durationSeconds, // NEW
     },
   });
   ```
3. Test: two voicemails 20s apart with different durations both land.

### Risk + effort

**Risk:** S (small behavioral change).
**Effort:** S (~1 hour).

---

## QA-020 — `canonicalInboundToNumber` falls back to `activeUserDidId` for TeXML-trial users with multiple DIDs (P2)

### Steps

1. Plumb the dialed DID through the TeXML callback. `buildDialTeXML` and
   `buildVoicemailTeXML` already include `?did=...` in their action URLs;
   confirm the inbound voicemail-recording handler reads that query
   param.
2. In `canonicalInboundToNumber` (main.ts:131-175), accept an optional
   `dialedDid` parameter and prefer it over `activeUserDidId` when
   the user has > 1 UserDid.
3. Add a Pass-3-style last-10 lookup against `UserDid.didNumber`.
4. **Do NOT auto-backfill historical rows** — they're already wrong but
   fixing them requires a separate script with admin sign-off.

### Risk + effort

**Risk:** M (attribution change for a fragile user population).
**Effort:** M (~half a day including testing on Abdulla's account).

---

## QA-021 — `/calls` 200-row cap (P2)

### Steps

1. Add cursor-based pagination to `apps/api/src/calls/calls.routes.ts:215`:
   `?before=<callId>&limit=50` (default 50, max 100).
2. Update `apps/web/src/pages/Recents.tsx` to infinite-scroll: when the
   user scrolls past 80% of the list, fetch the next page.
3. Drop the implicit 200 cap; replace with cursor.

### Risk + effort

**Risk:** S.
**Effort:** M (~half a day, UI + API).

---

## QA-013 + QA-014 — `purgeExpired` runs inside user requests (P2)

### Steps

1. Move `purgeExpired` out of the route handler into a cron worker
   (`apps/api/src/voicemails/purgeWorker.ts` new).
2. Use the existing `scheduledMessageWorker` setInterval pattern.
3. In `voicemails.routes.ts`, only call `purgeExpired` if a SystemConfig
   row indicates the last purge was > 24h ago.
4. Alternative (simpler): change the listing query to `where: { receivedAt: { gte: cutoff } }`
   so expired rows don't appear, and let a nightly cron do the actual
   DELETE.

### Risk + effort

**Risk:** S.
**Effort:** S (~3 hours).

---

## QA-015 — `/calls` loads all SIP usernames every request (P2)

### Steps

1. In `apps/api/src/calls/calls.routes.ts:207-226`, add a module-level
   cache:
   ```ts
   let sipUsernameCache: { values: string[]; expiresAt: number } | null = null;
   async function getSipUsernames(): Promise<string[]> {
     if (sipUsernameCache && sipUsernameCache.expiresAt > Date.now()) return sipUsernameCache.values;
     const rows = await prisma.user.findMany({ where: { sipUsername: { not: null } }, select: { sipUsername: true } });
     const values = rows.map((r) => r.sipUsername!).filter(Boolean);
     sipUsernameCache = { values, expiresAt: Date.now() + 60_000 };
     return values;
   }
   ```

### Risk + effort

**Risk:** S.
**Effort:** S.

---

## QA-016 — Proximity merge 60s collapses legitimate redials (P2)

### Steps

1. Tighten `PROXIMITY_MS` to 5_000 (5s).
2. Add a `mergedFromCount` field returned to the UI for display.
3. Update Recents.tsx to show `(N attempts)` when count > 1.

### Risk + effort

**Risk:** S.
**Effort:** S.

---

## QA-018 — `pollAndImportPerCall` setTimeouts die with the process (P2)

### Steps

1. Add a `PendingRecordingPoll` Prisma model.
2. On voicemail-record start, write a row instead of scheduling a
   setTimeout.
3. Worker drains the table every 10s with backoff.
4. On webhook process boot, run the worker once immediately.

### Risk + effort

**Risk:** M (DB schema + new worker).
**Effort:** M.

---

## QA-023 — `sweepRecentRecordings` 10min lookback misses long downtimes (P2)

### Steps

1. On webhook service boot, run ONE 1-hour-lookback sweep before the
   regular 10-min sweep loop starts.
2. File: `apps/webhooks/src/main.ts:2076-2100`.

### Risk + effort

**Risk:** S.
**Effort:** S (~1 hour).

---

## QA-024 — `resolveCalledConnection` lazy backfill doesn't verify ownership (P2)

### Steps

1. Before persisting `connection_id` in `apps/webhooks/src/main.ts:1274-1365`,
   make a second Telnyx call to verify the connection belongs to the
   expected user.
2. If verification fails, log a warning and skip the persist.

### Risk + effort

**Risk:** M (extra Telnyx call per first-time-DID; rate-limit-sensitive).
**Effort:** S.

---

# BATCH 4 — SIP / call state machine (P1+P2)

## QA-008 — Periodic reconnect timer races inbound INVITE (P1)

**Note:** Currently feature-flagged OFF in v0.10.135. Only urgent if the
flag is re-enabled.

### Steps

1. In `apps/web/src/services/sip.ts:1043-1059`, add a re-check after
   the microtask gap:
   ```ts
   const callsBefore = this.calls.size;
   const incomingBefore = this.incomingCallId;
   await Promise.resolve();
   if (this.calls.size !== callsBefore || this.incomingCallId !== incomingBefore) {
     console.warn('[sip] active call appeared between guard check and teardown — abandoning periodic reconnect');
     return;
   }
   this.reconnect();
   ```

### Risk + effort

**Risk:** L (only relevant if the flag is on; off in production).
**Effort:** S.

---

## QA-009 — `acceptCall` race: caller cancels during mic preflight (P1)

### Steps

1. In `apps/web/src/services/sip.ts:1953-2028`, before
   `entry.session.answer(...)`, check `(entry.session as any)?._status`.
   If status is 9 (ENDED) or session isn't in `this.calls` anymore,
   abort and stop tracks.

### Risk + effort

**Risk:** M (JsSIP internals).
**Effort:** S.

---

## QA-010 — `startConference()` returns true synchronously (P1)

### Steps

1. Change `startConference` to return `Promise<boolean>` (resolves
   AFTER mic + replaceTrack succeeds).
2. Update `SipContext.mergeCalls` to `await startConference()`.
3. On failure, restore the prior held/active split state via
   `swapCalls` or `holdCallWithMusicIfConfigured`.

### Risk + effort

**Risk:** M (UI state machine).
**Effort:** M.

---

## QA-043 — `holdAndAcceptCall` failure leaves UI in inconsistent state (P2)

### Steps

1. In `apps/web/src/contexts/SipContext.tsx:458-482`, await the result of
   `sipService.holdActiveAndAccept()` and only flip UI state on success.
2. On failure, restore the active call's prior state.

### Risk + effort

**Risk:** M.
**Effort:** S.

---

# BATCH 5 — Auth flow + error handling (P2)

## QA-025 — JWT 24h expiry kills long-running calls (P2)

### Steps

1. Implement refresh tokens. New endpoint `/auth/refresh` taking the
   current JWT, returning a fresh one. Track refresh count in a
   `RefreshTokenAudit` table to limit chains.
2. Client side: in the fetch interceptor, decode JWT `exp` client-side;
   if within 60s of expiry, fire `/auth/refresh` before the actual call.

### Risk + effort

**Risk:** M.
**Effort:** M (~half a day).

---

## QA-026 — Microsoft SSO `codeVerifier` optional (P2 security)

### Steps

1. In `apps/api/src/auth/microsoft.routes.ts:28-39`, change
   `codeVerifier: z.string().optional()` to `codeVerifier: z.string().min(43)`.
2. Verify the web client always sends it (it should — `consumeOAuthState()`
   in Login.tsx).
3. Test: POST without `codeVerifier` returns 400.

### Risk + effort

**Risk:** S.
**Effort:** S.

---

## QA-027 — Microsoft routes mutate before JWT sign (P2)

### Steps

1. In `apps/api/src/auth/microsoft.routes.ts:153-212`, move the
   `prisma.user.update` and audit-log insert AFTER `reply.jwtSign`
   succeeds.
2. Wrap in a transaction if you want atomicity guarantees.

### Risk + effort

**Risk:** S.
**Effort:** S.

---

## QA-028 — `sendMessageImmediate` not idempotent (P2)

### Steps

1. In `apps/api/src/messages/sendMessage.ts`, write the Message row
   FIRST with `status: 'queued'` and a client-generated idempotency
   UUID.
2. Call Telnyx with the idempotency key in the request headers.
3. On Telnyx success, UPDATE the row to `status: 'sent'` with the
   returned `telnyxMessageId`.
4. The scheduledMessageWorker sweep (now hardened by QA-029 from v0.10.138)
   handles stuck rows.

### Risk + effort

**Risk:** M.
**Effort:** M.

---

## QA-048 — Telnyx webhook handlers return 200 on error (P2)

### Steps

1. In `apps/webhooks/src/main.ts:1030-1033, 1213-1215, 2011-2014`,
   update the handler signatures to accept `(request, reply)` and
   on catch:
   ```ts
   } catch (e) {
     app.log.error({ err: e }, '[telnyx] handler error');
     return reply.code(500).send({ received: false, error: String(e) });
   }
   ```
2. **Warning:** Telnyx will retry on 5xx. Combined with QA-005's
   Postgres-backed dedup, this is safe. Without QA-005, this could
   amplify the multi-replica dedup problem. **Sequence: ship QA-005
   first.**

### Risk + effort

**Risk:** M (depends on QA-005 ordering).
**Effort:** S.

---

# BATCH 6 — UX polish + minor leaks (P3)

These are P3 code-smells; ship opportunistically.

| QA-ID | Title | File | Effort |
|---|---|---|---|
| QA-031 | Ringtone AudioContext exhaustion | `apps/web/src/services/ringtone.ts:158-181` | S |
| QA-032 | `ringtone.start('upload:<id>')` cache-miss state | `apps/web/src/services/ringtone.ts:158-181` | S |
| QA-033 | `autoInstallOnAppQuit` during active call | `apps/desktop/src/main.ts:914-915` | S |
| QA-034 | `window-all-closed` no-op resource leak | `apps/desktop/src/main.ts:1066-1069` | S |
| QA-037 | `PostDeclineReply` no retry button | `apps/web/src/components/PostDeclineReply.tsx:51-73` | S |
| QA-038 | `prisma.call.findUnique + updateMany` race | `apps/webhooks/src/main.ts:757-771` | M (preserves blocked status while making atomic) |
| QA-039 | ICE candidate trickle timer | `apps/web/src/services/sip.ts:1468-1510` | S (defensive only — audit says current code is fine) |
| QA-040 | `pollAndImportPerCall.tryOnce` unbounded recursion | `apps/webhooks/src/texmlVoicemail.ts:446-495` | S |
| QA-041 | `activeCallControlIdRef` 15s give-up window | `apps/web/src/contexts/SipContext.tsx:391-445` | S (backoff + 60s) |
| QA-042 | Electron `document.hidden` always false | `apps/web/src/lib/notify.ts` + main process IPC | M (cross-process plumbing) |
| QA-044 | Ringtone pref race | `apps/web/src/components/IncomingCall.tsx:49-55` | S (defensive only) |
| QA-045 | Speaker reset not surfaced to user | `apps/web/src/services/sip.ts:114-130` | S (subscribe to `ace:audio-output-revert` from v0.10.138 + show toast) |
| QA-047 | `xmlEscape` duplicated | `apps/webhooks/src/main.ts:1240` + `texmlVoicemail.ts:133` | S (extract to `apps/webhooks/src/lib/xml.ts`) |
| QA-050 | Deepgram retry queue | `apps/webhooks/src/deepgram.ts:155-168` | M (new DB table + worker) |
| QA-051 | `useJobDivaContact` cache lost on reload | `apps/web/src/hooks/useJobDivaContact.ts:12-14` | S (sessionStorage layer) |
| QA-052 | `TelnyxStatusBanner` `cancelled` closure-local | `apps/web/src/components/TelnyxStatusBanner.tsx:70-92` | S (useRef refactor) |

## Notes on the BATCH 6 set

- **QA-038**: Even though it's "theoretical, not seen in production,"
  the audit's recommended fix (`status: { not: 'blocked' }` in
  updateMany) requires careful handling because the existing code ALWAYS
  updates bookkeeping fields but conditionally updates status. The
  safe refactor is a two-call sequence inside a Prisma transaction:
  ```ts
  await prisma.$transaction([
    prisma.call.updateMany({
      where: { telnyxCallId: callId, status: { not: 'blocked' } },
      data: { status, endedAt, durationSeconds: duration, hangupCause, hangupSource: payload.hangup_source ?? null },
    }),
    prisma.call.updateMany({
      where: { telnyxCallId: callId, status: 'blocked' },
      data: { endedAt, durationSeconds: duration, hangupCause, hangupSource: payload.hangup_source ?? null },
    }),
  ]);
  ```
  This preserves equivalent behavior while removing the read-then-write
  race.

- **QA-045**: v0.10.138 already broadcasts `ace:audio-output-revert`
  from `setAudioOutput`. To finish QA-045, add a listener in
  `App.tsx` or `Layout.tsx` that pushes a toast.

- **QA-051**: sessionStorage quota is 5MB; cap the cache at 200 entries
  to stay well under.

---

# DO NOT IMPLEMENT YET

These items in the audit are not actionable from the current state:

- **QA-039** — Audit explicitly says "current code passes; consider adding `session.on('failed', clearIceTimers)` defensively." Defer until a real bug surfaces.
- **QA-044** — Audit says "current code is fully synchronous." Defensive only.

---

# Ordering recommendations

If shipping one batch per week, the recommended order:

1. **Week 1:** BATCH 1 (security) — gate everything behind this. Start
   the QA-003 EV cert procurement immediately; it has the longest
   lead time.
2. **Week 2:** BATCH 2 (webhook concurrency) — unblocks scaling to 2
   replicas.
3. **Week 3:** BATCH 3 (voicemail + Recents) — visible user wins.
4. **Week 4:** BATCH 4 (SIP state machine) — quality-of-life for callers.
5. **Week 5:** BATCH 5 (auth + error handling) — robustness.
6. **As-time-permits:** BATCH 6 (P3 polish).

---

## How to use this document

Pick a finding, scroll to its section, follow the steps. Update the
"Status" column in the snapshot table as you ship.

If a step doesn't make sense or the file structure has drifted, re-read
the corresponding QA-NNN entry in `QA_AUDIT.md` for the original context.
