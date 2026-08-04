# ACE Dialer — Project State

**Last updated:** August 4, 2026 (SMS composer: personal templates + voice-to-text + AI rewrite — v0.10.216, UNCOMMITTED)
**Maintained by:** Claude (update at end of every working session)

This file is a living snapshot of where the project stands. New Claude
sessions should read it first to absorb context before reading any other
file. Update the sections below as state changes — keep entries short
and dated.

---

## 0. Quick start for a new session

If you're a fresh Claude session opening this project:

1. Read this file top to bottom (takes 30 seconds).
2. Then read `CLAUDE.md` for the locked UI standards + project rules.
3. Check current versions in the workspace by reading the root `package.json`.
4. Skim the **Open tasks** section below for what's pending.
5. Skim **Recent learnings** for any architectural insights that affect new work.

---

## 1. Current state (latest releases)

| Stream | Version | Status | Where |
|---|---|---|---|
| Latest committed | v0.10.215 | Pushed to `origin/release/0.10.215` — PR to main + `./deploy.sh` + desktop publish PENDING | branch `release/0.10.215` |
| Latest committed (prior) | v0.10.204 | Pushed to origin/main, .exe built | GitHub release `v0.10.204` |
| Stable published (auto-update) | v0.10.132 | **Published** to all 40+ ApTask users | GitHub release `v0.10.132` |
| Backend (api/webhooks/socket) | up through v0.10.204 deployed | Self-hosted on dialer.aptask.com (pm2) | `pm2 list` / `./deploy.sh` |
| Auto-update status | LOCKED (EV cert procurement window) | v0.10.143 enforces signing | docs/ev-cert-procurement.md |

**August 4, 2026 — v0.10.216 staged (UNCOMMITTED, NOT DEPLOYED): SMS composer — personal templates, voice-to-text, AI rewrite**

- **Scope:** four asks — user-created SMS templates (previously admin-only), voice dictation, "Rewrite with AI", plus accurate character/segment counts and audit coverage.
- **Templates now have two scopes** on one table via a new nullable `SmsTemplate.ownerUserId`: `NULL` = company-wide (admin CRUD, unchanged), non-null = personal (owner CRUD via new `/me/sms-templates` POST/PATCH/DELETE). The read filter in `GET /me/sms-templates` (`OR: [{ownerUserId: null}, {ownerUserId: me}]`) is the security boundary; all writes use compound `updateMany` on `(id, ownerUserId)`. Admin handlers are symmetrically scoped `ownerUserId: null` so the admin pane cannot see or touch anyone's personal templates (deliberate privacy call — approved).
- **Placeholder registry is new** (`apps/api/src/lib/smsPlaceholders.ts`). Placeholders were previously free-form text with only `{firstName}` / `{recruiter}` resolved by two hardcoded regexes in `Messages.tsx`; nothing validated them, so a typo shipped silently to a candidate. Now: canonical `{camelCase}` keys, case-insensitive matching (`{FirstName}` works), malformed-syntax detection, did-you-mean suggestions, and validation on save. `{lastName}`, `{jobTitle}`, `{companyName}`, `{recruiterName}` added and auto-fill from JobDiva/`/me`; legacy `{recruiter}` + `{currentCompany}` stay valid but hidden from the picker.
- **Verified against production before enabling strict validation:** the live `sms_templates` table holds exactly the 20 seeded rows using exactly 16 placeholder keys — no admin ever created a custom template, so no existing template can fail validation. A test asserts all 20 seed bodies validate clean and normalize to themselves.
- **Voice-to-text** reuses the existing Deepgram account (`nova-3`, `language=multi`) — no new vendor. `apps/api/src/lib/deepgram.ts` is a deliberate ~40-line copy of the webhooks helper (CLAUDE.md §1.4 forbids cross-app TS sharing); both files now cross-reference each other. Audio is request-scoped only: never written to disk/Postgres/Supabase, never sent as MMS. Recording is **blocked while a call is live** (mic contention would risk the call's audio) and all teardown runs through the new shared `useMicRecorder` hook, which `Settings.tsx`'s voicemail-greeting recorder was refactored onto.
- **AI rewrite runs on our own DGX — no new vendor, no per-token cost, and no draft text leaves the network.** Provider layer `apps/api/src/lib/llm.ts`; default `LLM_PROVIDER=ollama` against `http://172.16.219.222:11434` with `qwen3.5:9b`. Anthropic is retained as a dormant fallback that only runs on an explicit `LLM_PROVIDER=anthropic`, so a stray key can never start billing. Kill switch is `LLM_PROVIDER=off`.
- **Verified live end-to-end (2026-08-04):** DGX reachable from the app host in 13ms (internal IP, no tunnel/VPN needed). The production `rewriteSmsDraft()` delivered **6/6** realistic recruiting drafts at **~1.0–1.15s** each, with the two invented `$` symbols correctly surfaced as warnings rather than blocked.
- **Three corrections to the internal QWEN-MIGRATION-GUIDE.md** (worth sending upstream — the guide is dated 2026-03-31 and will mislead the next team):
  1. Its recommended default `qwen3:32b` **does not exist** on the box (`qwen3:8b` does). Live inventory is 21 models incl. a whole `qwen3.5` family and `-nothink` variants — check `curl http://172.16.219.222:11434/api/tags`.
  2. The headline "drop-in OpenAI-compatible" claim **breaks on Qwen3**, a hybrid reasoning model. `/v1` cannot disable thinking (`chat_template_kwargs.enable_thinking: false` is silently ignored — verified): 16,031ms vs 772ms, ~640 vs 24 output tokens, 5/7 vs 7/7 guard pass. The two `/v1` failures returned HTTP 200 with **empty content** because reasoning consumed all of `max_tokens`, with the reasoning hidden in a separate `reasoning` field. Must use native `/api/chat` + `think: false`.
  3. Cold start measured at **~47s**, not the documented 10–30s. Mitigated by `prewarmLlm()` on boot + `LLM_KEEP_ALIVE=30m`.
- **Guards recalibrated after the first live run.** `qwen3.5:9b` rewrote "last 2 paystubs" → "last two payslips" — a good edit the original digit guard rejected. Numeral↔word equivalence (0–12) now passes; a changed value or a vanished number still fails closed. Added-fact detection (invented `$`/`%`) warns instead of blocking. New `factsToVerify()` feeds a "Verify: 65/hr · Friday · meet.example.com" line into the review sheet, so the human review the feature depends on is directed at specific tokens rather than a general proofread. Request carries the draft text ONLY — no thread history, contact, user id, or metadata; nothing logged or persisted. Model output is mechanically validated before display (placeholder multiset, digit runs, URLs/emails, length ratio) and **fails closed** to the user's original. Mandatory review sheet: Use / Edit / Keep original / Regenerate (capped at 3). No code path reaches the send path.
- **Character/segment counter** added (`apps/web/src/lib/smsSegments.ts`) — there was none before, so requirement 4's "counts remain accurate" was really "build them". GSM-7 160/153 vs UCS-2 70/67, extended chars count double, emoji count as 1 char / 2 units.
- **Kill switches:** voice is gated on `DEEPGRAM_API_KEY` (already set on the host); rewrite on `LLM_PROVIDER` (`off` disables). Either + `pm2 restart ace-api` removes the feature in seconds with no deploy and no effect on ordinary SMS. `ANTHROPIC_API_KEY` is deliberately **unset** and unnecessary — the DGX path needs no key.
- **Tests:** 84 api (76 new) + 26 web (all new) passing. `apps/web` gained a `test` script + tsconfig test exclusion, mirroring `apps/api`. `tsc` clean for api + web; web production build clean.
- **NOT DONE — needs approval:** `npm run db:push` (migration is exactly one nullable `ADD COLUMN` + one `CREATE INDEX`, verified via `prisma migrate diff`; nothing else pending), commit, PR, deploy, version bump across the 7 `package.json` + `APP_VERSION`.
- **Cannot be verified headlessly:** Electron microphone behaviour during a live call (the recording-blocked-while-on-a-call path) needs an on-device pass. Everything else — including the full rewrite path against the live DGX — has been exercised.

**July 29, 2026 — v0.10.215 released: short-code SMS threads open empty / show wrong messages**

- **Root cause:** `GET /messages/threads/:number` ran the conversation key through `toE164()` before matching. The threads-list groups by the EXACT stored `thread_key`, so normalizing prepended `+` to short-code / alphanumeric sender IDs and hit the wrong bucket. Confirmed against live DB: `thread_key` `72524` (3 msgs) was queried as `+72524` → 0 rows → **empty thread** (Bug 1); `83356` (1 msg, the preview) was queried as `+83356` → loaded a *different* 6-msg June bucket → **preview ≠ thread** (Bug 2). Short codes split into drifted buckets (`83356` vs `+83356`) still exist in data — each now opens faithfully; auto-merging them was deliberately left out of scope (destructive data call).
- **Fix:** new `apps/api/src/messages/threadKey.ts` — `threadKeyCandidates()` matches the stored key VERBATIM (guaranteeing preview == thread latest), adding an E.164 alias ONLY for real ≥10-digit numbers (deep links). Detail + `/read` + `/unread` now match `threadKey IN (candidates)`; this also lets short-code threads be marked read (old `length===10` gate 400'd them, so their unread dot never cleared).
- **UI:** `Messages.tsx` gained an explicit empty-state ("No messages yet") + a distinct load-error state with Retry, so a failed load can't masquerade as a valid empty thread.
- **Tests:** first tests in the repo — `apps/api/src/messages/threadKey.test.ts` via `node:test` + `tsx` (`npm run test -w apps/api`, 8/8). Covers both bugs as regressions + a list/thread preview-consistency model. Test files excluded from the api `tsc` build.
- **Ships with:** the previously-staged 0.10.212–0.10.214 work (in-call keypad + diag logging), consolidated into this release. Version 0.10.214 → 0.10.215 across all 7 `package.json` + `APP_VERSION`; What's New entry added. `tsc` (api + web) clean.
- **Note:** the reported bugs are fixed by the backend deploy alone (server-side matching); the desktop publish only carries the empty/error-state UI.

**July 22, 2026 — v0.10.213 staged: In-call DTMF UX + non-blocking Electron inbound**

- **Non-blocking inbound (Electron):** `IncomingCall.tsx` no longer forces the full-window green ringer on the desktop shell. Electron now always renders the compact top banner so the nav rail + bottom tabs (Favorites/Messages/Recents/Keypad/Voicemail) stay visible and usable while a call rings; the native floating ringer popup (main process) still surfaces the call. Web build keeps the full-screen ringer on idle surfaces (`/keypad`, `/`, `/login`) + when there's an active call to hold. Change: `fullScreen` gated on `!isElectron`.
- **In-call DTMF visual input bar:** new `.ick-display` bar above the keypad grid (`InCall.tsx`) echoes every digit sent this call (monospace, most-recent-visible, 32-char cap) with a backspace button (double-click = clear all, disabled when empty). Light/dark themed.
- **Physical-keyboard DTMF:** while `callState === 'connected'`, a `keydown` listener sends `0-9 * #` (Numpad + top row) through the EXISTING `sendDTMF`, appends to the display bar, and auto-opens the keypad. Ignores keystrokes while an input/textarea is focused (Transfer field) or a modifier is held. Bound on connect, torn down on hangup/unmount.
- **Status:** production build + full `tsc -b` typecheck clean. NOT yet committed/tagged. On-device pass pending (live-call DTMF into an IVR + Electron banner behavior can't be driven headlessly). Open question for the reviewer: physical-key digits auto-open the keypad panel — drop `setShowKeypad(true)` if silent send is preferred.
- Files: `apps/web/src/components/IncomingCall.tsx`, `apps/web/src/pages/InCall.tsx`, `apps/web/src/styles.css`. Version bumped 0.10.212 → 0.10.213 across root + web + desktop `package.json`.

**June 25, 2026 — v0.10.205 staged: Admin "Force Update" feature**

- New Settings → Force update admin pane (admin-only, Zap icon, sits above Users in the Admin category). Lists every active user with their latest device/version/lastSeen.
- "Force update ALL users" red button + "Force update selected" + per-row checkboxes. Confirmation modal before any push.
- Blocking ForceUpdateModal mounted at app root. When the server signals a pending force-update for this device on the next heartbeat, HeartbeatReporter dispatches `ace:force-update-required`; the modal takes over: kicks off ace.checkForUpdates(), shows full-viewport block with download progress, defers install while sipService.calls.size > 0, auto-installs ~10s after download completes (or sooner on click).
- Re-uses the existing v0.10.101 UserDevice schema; no migration required. Three new admin endpoints (`GET /admin/devices/overview`, `POST /admin/force-update/all`, `POST /admin/force-update/users`). All write AuditLog entries (`admin.force_update_all`, `admin.force_update_users`).
- Behavior preserved: the existing per-device Users → Devices "Force update" button (v0.10.101) still works for one-off pushes.

**June 12, 2026 shipping summary — 22 releases in one day:**
- v0.10.128 (baseline) → v0.10.149 (webm transcode)
- All 14 P1 UX findings closed (UI_UX_AUDIT.md)
- 3 P0 QA findings closed: QA-001 socket auth, QA-003 EV cert gate, QA-005 webhook_dedup
- 10 P2/P3 UX findings shipped across v0.10.144-148
- 1 production bug fixed: voicemail greeting application error (webm→mp3 transcode)
- 1 stability fix: React error #310 in Reply with Text (v0.10.130)
- 1 major-architectural: connection-id-based canonical toNumber (v0.10.133/134)

**What v0.10.132 includes for users:**

- React error #310 fix (Reply with Text floater crash on inbound call)
- Unified incoming-call UI: stacked-call mode shows 3 buttons (Decline / Reply with Text / Hold & Accept), plain Accept removed (audio-merge bug)
- Reply with Text now works in both no-call AND stacked-call modes
- Orange pause badge on Hold & Accept button (visually distinct from plain Accept)
- Floater row top-aligned so multi-line labels don't push buttons up

**What v0.10.133/v0.10.134 fixed (server-only, no client install needed):**

- Inbound calls missing from Recents tab for TeXML voicemail trial users. Root cause: SIP-delivery-leg webhooks store toNumber as SIP credential username (e.g. `userabdulla74993`) not the phone number, and the Recents query had a v0.10.108 filter excluding any sipUsername match. Fix: `canonicalInboundToNumber` helper in `apps/webhooks/src/main.ts` looks up `UserDid.didNumber` via the matched userDidId (Pass 0) OR userId fallback (Pass 1/2). Call rows now always store real phone numbers.
- Historical 4905 rows backfilled via two scripts: `backfill-sip-username-tonumbers.ts` (v2, userDidId-gated) for 159 non-trial users' rows; same script logic in v3 form for the 4746 TeXML-trial rows including Abdulla's 4646.

**What v0.10.135 experiments with (canary):**

- The v0.10.113 "60s periodic full SIP UA reconnect" is feature-flagged OFF (`ENABLE_60S_PERIODIC_RECONNECT = false` in `apps/web/src/services/sip.ts`).
- 15s force-register continues normally (keeps SIP registration alive via gentle REGISTER refresh).
- Hypothesis: the Telnyx server-side INVITE-routing-staleness bug that v0.10.113 was solving is fixed, and the 600ms gap every minute is causing ~1% inbound failure baseline + the "Disconnected" UI state after SSO.
- **Validation procedure:** Abdulla installs v0.10.135 .exe on his own machine, runs for 24h, monitors via Settings → Diagnostics → Download logs. If clean: publish v0.10.135 to all testers. If routing stale: install v0.10.132 .exe back over the canary, then ship v0.10.136 with the flag flipped back to true.

---

## 2. Open tasks (prioritized)

| # | Priority | Title | Where to start |
|---|---|---|---|
| **UI/UX Audit** | high | **55 UX findings in `UI_UX_AUDIT.md`** (18 P1, 24 P2, 13 P3). Each finding has stable ID (UX-001..UX-055). User selects items to implement by pasting "Address UX-NNN, UX-NNN" back. Top P1s: UX-001 (no focus-visible), UX-003 (TelnyxStatusBanner Rules-of-Hooks - latent crash same as v0.10.122/.125/.127/.129), UX-004 (22 alert/confirm sites broken in Electron), UX-007 (Dialpad call button clipped at 1366×768 / 125% DPI), UX-012 (modal backdrops below CLAUDE.md locked spec) | `UI_UX_AUDIT.md` |
| **#1** | high (next major) | **v0.11.0 MAJOR — Voicemail Retention + Global Presence + DND**. Three feature areas combined into one major release. (1) Soft-delete voicemails + Trash tab + 30-day hard cap + 7-day trash retention. (2) Global Presence: user-controlled status (Available/Busy/Meeting/Away/Custom) with auto-on-call + idle detection, visible across the app. (3) Do Not Disturb: mute incoming calls (server-side INVITE → voicemail short-circuit) with timer auto-disable + optional schedule. Full design in task #1's TaskUpdate description. | `apps/web/src/pages/Voicemail.tsx`, `apps/webhooks/src/main.ts`, `apps/api/src/me/me.routes.ts`, `apps/socket`, Prisma schema |
| **#18** | medium (in-flight) | **v0.10.135 canary validation 24h** — install on abdulla's machine, monitor, decide promote vs revert | GitHub Releases Draft v0.10.135 |
| **#19** | low | First-launch UX polish — dialer shows blank → black → SSO sequence at launch. BrowserWindow `show: false` until `did-finish-load`, set `backgroundColor: '#0f1116'` to avoid white flash | `apps/desktop/src/main.ts` |
| **#1 (orig)** | n/a | Voicemail duplicate notification — superseded by v0.11.0 retention design (#1) | n/a |
| TeXML trial monitoring | ongoing | 5-7 day observation window on the 8 testers (himank, Rahul S, Stefan, mansi, eela, rajat, Ravindra, nilesh). Watch their voicemail/Recents behavior, gather feedback | server logs + ask testers directly |

---

## 3. Architecture cheat sheet

**Monorepo layout (npm workspaces):**

- `apps/api` — Fastify API server (port 3000). Self-hosted under pm2 as `ace-api`.
- `apps/socket` — Socket.IO server for real-time events. pm2 `ace-socket` (:3001).
- `apps/webhooks` — Telnyx webhook receiver. pm2 `ace-webhooks` (:3002).
- `apps/web` — Vite + React dialer UI. Served static by pm2 `ace-web` (:3010) AND packaged into Electron via `apps/desktop`.
- `apps/desktop` — Electron main process. Builds the .exe via `electron-builder`.
- `packages/db` — Prisma schema + scripts (diagnose, backfill, seed, etc.).

**Hosting:** fully self-hosted on the `dialer.aptask.com` host (pm2 via `ecosystem.config.cjs`, behind an nginx reverse proxy; `/api/*`→:3000, `/webhooks/*`→:3002). Deploy with `./deploy.sh`. Env from repo-root `.env`. No Render/Vercel.

**Database:** self-hosted PostgreSQL on the app host. `DATABASE_URL=postgresql://…@127.0.0.1:5432/acedialer`. Schema in `packages/db/prisma/schema.prisma`.

**SIP backend:** Telnyx. Each user has a SIP credential (`sipUsername` like `userabdulla74993`) registered against `sip.telnyx.com:7443` over WSS. JsSIP library handles the WebRTC + SIP plumbing.

**Voicemail flows (two variants):**

1. **Hosted Voicemail** (default for most users): Telnyx hosts a recording app. Webhooks fire `call.recording.saved`.
2. **TeXML Voicemail trial** (8 testers + abdulla, gated by `TEXML_TRIAL_DIDS` env var): we host the TeXML XML response and the recording flows through Telnyx differently. Per-call recording-status polling is a workaround for a Telnyx bug where recordingStatusCallback doesn't fire for Dial-then-Record flows.

**Attribution chain (resolveUserAndDid in webhooks/main.ts):**

1. **Pass 0** — connection_id from webhook payload matches `UserDid.connectionId` or `UserDid.preMigrationConnectionId`. Sets userId AND userDidId. Skipped if connection_id is the shared `TELNYX_VOICEMAIL_CC_APP_ID` because that ID is shared across all TeXML trial users.
2. **Pass 1** — `payload.sip_username` field matches `User.sipUsername`. Sets userId only.
3. **Pass 2** — `payload.toNumber` (when it looks like a sipUsername — no `+`, no digits, no `@`) matches `User.sipUsername`. Sets userId only.
4. **Pass 3** — last 10 digits of toNumber match `UserDid.didNumber`. For inbound, this is authoritative.

If none match: row is dropped (v0.10.108 guard). Pre-v0.10.108 the fallback was userId=1 which contaminated abdulla's call history with thousands of unrelated calls.

**Canonical toNumber (v0.10.133/134):** at write time, if rawToNumber isn't a phone number (e.g. it's a SIP credential username), look up the matched UserDid's didNumber OR the user's primary UserDid via userId fallback. So Call rows always store dialed phone numbers, not SIP usernames.

---

## 4. Critical conventions when modifying this codebase

### The workspace-sync corruption pattern

The Cowork workspace bridge has a recurring bug that corrupts files during round-trips. Symptoms: null-byte padding at EOF, truncated tails, content drift in unrelated files.

**Mitigations in place:**

- `scripts/strip-null-bytes.mjs` runs as `prebuild` hook on every build (added v0.10.128).
- All multi-step source changes go through a single `scripts/apply-vXXX-*.mjs` local Node script that does ALL edits in one execution (no Cowork tool round-trips). Pattern established v0.10.129+.
- The apply-script reads files once, applies a list of `find` → `replace` edits using exact-anchor matching, fails loudly with `FATAL` if any anchor isn't found, and writes once at the end. Handles LF/CRLF automatically.

**When making changes:** ALWAYS write an apply-vXXX-name.mjs script. Don't use the Edit/Write tools directly across multiple files — corruption WILL happen. The user runs the script locally on Windows via `node scripts/apply-vXXX-name.mjs` which bypasses the bridge entirely.

### Release-script template (`scripts/apply-vXXX-*.mjs`)

Every release should follow this shape (see `scripts/apply-v131-icon.mjs`, `apply-v132-unify.mjs`, etc. as canonical examples):

```js
function applyEdits(relPath, edits) {
  // Read file
  // Detect LF/CRLF
  // Normalize each anchor's line endings to match file
  // includes() check, fail loudly if not found
  // String.replace + uniqueness check
  // Write once at end
}

// 1. Source code edits (sip.ts, IncomingCall.tsx, etc.)
applyEdits('apps/...', [{ find: '...', replace: '...', label: '...' }]);

// 2. Version bumps in all 7 package.json files
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json',
              'apps/desktop/package.json', 'apps/socket/package.json',
              'apps/webhooks/package.json', 'packages/db/package.json'];
// Replace "0.10.XYZ" → "0.10.XYZ+1"

// 3. DiagnosticsSection APP_VERSION bump

// 4. WhatsNew entry at top of WHATS_NEW array

console.log('ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps: strip-null-bytes, tsc, diff, commit, push');
```

### CI/CD setup

- **Backend + web:** no CI. Self-hosted — deploy by running `./deploy.sh` on the `dialer.aptask.com` host (git pull + install + prisma generate + build + `pm2 startOrReload ecosystem.config.cjs`).
- **Desktop:** `build-desktop.yml` — builds the Electron installer via electron-builder and publishes a Draft GitHub release (clients auto-update). This is the only GitHub Actions workflow. (The old `render-deploy.yml` was removed when we left Render.)

### User constraints (don't violate these)

From `CLAUDE.md`:

- **95% confidence rule**: don't make changes until 95% sure of what's needed. Ask follow-up questions if not sure.
- **No mistakes**: critical-path code MUST be correct first try.
- **Confirmation before run**: don't tell user to run multi-step shell commands without first describing what each step will do.
- **Don't invent names**: stop using random names when you don't know who/what someone is.
- **No new modal CSS class without inheriting overlay behavior**: see CLAUDE.md UI Standards section 5.

From session history:

- Always present a small visual mockup before changing icon/visual design (user prefers to see proposed UI before code lands).
- For risky behavioral changes (like v0.10.135 60s reconnect disabled), ship as **Draft canary**, validate on abdulla's machine 24h, THEN promote.
- For UI-only changes, ship to all users directly via Published release.

---

## 5. Recent learnings (debugging discoveries)

**June 12, 2026 — React error #310 in Reply with Text (v0.10.122/.125/.127/.129 all crashed):**
Three prior attempts to add Reply with Text to the Electron floater crashed the renderer when an incoming call arrived. Root cause finally caught via DevTools console capture in v0.10.129: the new useEffect was placed AFTER the `if (!incoming) return null` early-return guard in IncomingCall.tsx, making it a conditional hook. On first render (no call) only 3 hooks ran; on second render (call arrives) the 4th hook tried to run, React detected the mismatch and threw error #310. Fix in v0.10.130: move the useEffect to BEFORE the early-return, compute callerLabel inside the handler instead of depending on it. Always place hooks at top of component, NEVER after early-returns.

**June 12, 2026 — Pre-v0.10.108 attribution contamination:**
For months before v0.10.108, calls that couldn't be attributed via any signal fell back to `userId=1` (admin). This means abdulla's user record contains thousands of calls that were never actually his — they were Rahul's, Stefan's, etc., but Telnyx didn't send identifiable signals. When designing any "for each user, show their data" UI or backfill, account for this contamination by also checking `userDidId IS NOT NULL` or other consistency markers.

**June 12, 2026 — Telnyx TeXML voicemail uses shared connection_id:**
Migrated TeXML voicemail trial users have `UserDid.connectionId = TELNYX_VOICEMAIL_CC_APP_ID` (a single shared ID across all migrated users). The Edge Case A guard in `resolveUserAndDid` skips Pass 0 lookup for this shared ID, so attribution falls through to Pass 1/2 (sipUsername match). When designing code that depends on `userDidId` being set, account for the fact that Pass 1/2 don't populate it — add a userId fallback path. See `canonicalInboundToNumber` for the pattern.

**June 12, 2026 — Voicemail re-import after delete:**
When a user deletes a voicemail row, the per-call recording-poll safety sweep runs ~60s later, finds no matching DB row for the Telnyx recording, treats it as new, creates the row again with a fresh Teams notification. The v0.11.0 retention design (soft-delete) naturally fixes this because the row stays in the DB just with `deletedAt` set, and the sweep's existence check will find it.

**June 12, 2026 — 60s SIP UA reconnect causes ~1% inbound failure:**
The v0.10.113 fix tears down + rebuilds the JsSIP UA every 60 seconds to combat Telnyx INVITE routing staleness. Confirmed via diagnostic log: ~600ms gap each cycle where SIP is fully torn down. Calls arriving in that window go to TeXML voicemail. May no longer be needed (Telnyx server-side fix?) — testing via v0.10.135 canary with the periodic reconnect feature-flagged OFF.

---

## 6. Quick reference

**Common commands:**

```powershell
cd C:\Users\asheikh\Documents\Claude\Projects\Dialer\acedialerv4

# Diagnose missing inbound calls in Recents
npx tsx --env-file=.env packages/db/scripts/diagnose-missing-call.ts

# Diagnose duplicate voicemails
npx tsx --env-file=.env packages/db/scripts/diagnose-duplicate-voicemail.ts

# Check workspace-sync corruption (strips null bytes)
node scripts/strip-null-bytes.mjs

# TypeScript check (per workspace)
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/webhooks/tsconfig.json

# Pre-flight before commit
node scripts/strip-null-bytes.mjs && npx tsc --noEmit -p apps/web/tsconfig.json && git diff --stat
```

**Env vars (production, in repo-root `.env` on the host):**

- `DATABASE_URL` — self-hosted PostgreSQL, `postgresql://…@127.0.0.1:5432/acedialer`
- `TELNYX_API_KEY` — Telnyx API key
- `TELNYX_VOICEMAIL_CC_APP_ID` — shared TeXML voicemail App ID (treated as "shared" by Pass 0)
- `TEXML_TRIAL_DIDS` — comma-separated list of phone numbers on the TeXML trial
- `DEEPGRAM_API_KEY` — voicemail transcription

**Telnyx connection:**

- Display name: `abdulla-aptask-com` (renamed today from `ace-dialer`)
- The connection_id didn't change with the rename — display only

**ApTask testers on TeXML trial (8 people + abdulla):**

himank, Rahul S, Stefan, mansi, eela, rajat, Ravindra, nilesh
Emails: nileshd@aptask.com, ravindra@aptask.co, stefan@aptask.com, himankj@aptask.com, mansiv@aptask.com, eelak@aptask.com, rahuls@aptask.com, rajatp@aptask.com

---

## 7. Session checkpoint protocol

**At the END of every Claude session, update this file:**

1. Bump the "Last updated" date at the top.
2. Update Current state section if versions shipped.
3. Update Open tasks if any opened/closed.
4. Add a Recent learnings entry if a meaningful discovery was made.
5. Commit this file along with whatever release work was done.

**At the START of every Claude session:**

1. Read this file first.
2. Then read `CLAUDE.md` for the locked rules.
3. Then engage with the user's request.

This pattern keeps context absorbed in 30 seconds even after compaction.
