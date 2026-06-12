# ACE Dialer — Project State

**Last updated:** June 12, 2026 (end of day)
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
| Stable client release | v0.10.132 | **Published** to all 40+ ApTask users | GitHub release `v0.10.132` |
| Canary client release | v0.10.135 | **Draft only**, abdulla's machine | GitHub Releases page (Draft badge) |
| Backend (api/webhooks/socket) | v0.10.134 deployed | Live on Render | Render dashboard |

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
| Render auto-deploy | low | Set 3 GitHub repository secrets (`RENDER_HOOK_API`, `RENDER_HOOK_SOCKET`, `RENDER_HOOK_WEBHOOKS`) so the `.github/workflows/render-deploy.yml` actually fires on every push. Right now it skips because secrets aren't configured | Render dashboard → each service → Settings → Deploy Hook |
| TeXML trial monitoring | ongoing | 5-7 day observation window on the 8 testers (himank, Rahul S, Stefan, mansi, eela, rajat, Ravindra, nilesh). Watch their voicemail/Recents behavior, gather feedback | server logs + ask testers directly |

---

## 3. Architecture cheat sheet

**Monorepo layout (npm workspaces):**

- `apps/api` — Fastify API server (port 3000). Deploys to Render service `ace-dialer-api`.
- `apps/socket` — Socket.IO server for real-time events. Deploys to Render service `ace-dialer-socket`.
- `apps/webhooks` — Telnyx webhook receiver. Deploys to Render service `ace-dialer-webhooks`.
- `apps/web` — Vite + React dialer UI. Packaged into Electron via `apps/desktop`.
- `apps/desktop` — Electron main process. Builds the .exe via `electron-builder`.
- `packages/db` — Prisma schema + scripts (diagnose, backfill, seed, etc.).

**Database:** Supabase Postgres (Pro plan, $25/mo). DATABASE_URL is the Transaction Pooler on port 6543. Schema in `packages/db/prisma/schema.prisma`.

**SIP backend:** Telnyx. Each user has a SIP credential (`sipUsername` like `userabdulla74993`) registered against `sip.telnyx.com:7443` over WSS. JsSIP library handles the WebRTC + SIP plumbing.

**Voicemail flows (two variants):**

1. **Hosted Voicemail** (default for most users): Telnyx hosts a recording app. Webhooks fire `call.recording.saved`.
2. **TeXML Voicemail trial** (8 testers + abdulla, gated by `TEXML_TRIAL_DIDS` env var): we host the TeXML XML response and the recording flows through Telnyx differently. Per-call recording-status polling is a workaround for a Telnyx bug where recordingStatusCallback doesn't fire for Dial-then-Record flows.

**Attribution chain (resolveUserAndDid in webhooks/main.ts):**

1. **Pass 0** — connection_id from webhook payload matches `UserDid.connectionId` or `UserDid.preMigrationConnectionId`. Sets userId AND userDidId. Skipped if connection_id is in the SHARED list (`TELNYX_VOICEMAIL_CC_APP_ID`, `PILOT_SIP_CONNECTION_ID`) because that ID is shared across all TeXML trial users.
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

Two GitHub Actions workflows fire on every push to main:

1. `build-desktop.yml` — builds the Electron .exe via electron-builder, auto-publishes a Draft GitHub release.
2. `render-deploy.yml` — POSTs to Render service deploy hooks. **Currently skips** because the 3 secrets aren't set up. Set them when you want auto-deploys.

Render also has its own auto-deploy enabled, but it's unreliable for monorepo path filtering. The render-deploy.yml workflow is the belt-and-suspenders. Use `[skip-render]` in commit message to opt out.

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

**Env vars (production, on Render):**

- `DATABASE_URL` — Supabase Pooler URL, port 6543
- `TELNYX_API_KEY` — Telnyx API key
- `TELNYX_VOICEMAIL_CC_APP_ID` — shared TeXML voicemail App ID (treated as "shared" by Pass 0)
- `TEXML_TRIAL_DIDS` — comma-separated list of phone numbers on the TeXML trial
- `DEEPGRAM_API_KEY` — voicemail transcription
- `PILOT_USER_ID` — legacy fallback userId (deprecated post-v0.10.108)

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
