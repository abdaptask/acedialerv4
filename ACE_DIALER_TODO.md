# ACE Dialer — Working Checklist

**Last updated:** 2026-05-21 (late evening)
**Current version (working tree):** v0.7.2
**Owner:** Abdulla (abdulla@aptask.com)
**Pilot target:** 150 total users, ~30–40 concurrent peak

---

## ▶ START HERE TOMORROW (May 22)

### Morning — clear the queue (~30 min)
1. **Push v0.7.2** (sitting in working tree):
   ```powershell
   cd C:\Users\asheikh\Documents\Claude\Projects\Dialer\acedialerv4
   Remove-Item .git\index.lock -ErrorAction SilentlyContinue
   git add ACE_DIALER_TODO.md apps package.json
   git commit -m "v0.7.2: rebuild decline-with-message + reporting roadmap"
   git push origin main
   ```
2. **Wait ~10 min** for CI → first test of silent auto-update. If the desktop apps show "Update ready — Restart to install" within 15 min and the click works, the whole update infrastructure is validated.
3. **Smoke-test decline-with-message v2** — call your DID, three-button row, tap Reply, sheet slides up, send SMS.
4. **Telnyx Portal — flip voicemail transcription on** (#203). 5-min freebie.

### Bring with you tomorrow
1. Telnyx Portal CSV: SIP Connection → Credentials tab → export (for bulk import)
2. Entra ID user list with emails
3. **Decision:** auto-promote `@aptask.com` emails to admin on bulk import, or manually promote after?
4. **Decision:** send email notifications on user invite? If yes, pick a provider (Resend / Postmark / SES)

### Recommended build order for the day
- **A) Phase 5 bulk-import 150 users (#189)** — unblocks the actual pilot. ~2-3 hrs.
- **B) Live Ops Dashboard P0 (#204)** — first reporting slice. ~6 hrs. Gives admins visibility once users are in.
- **C) Telnyx API investigation (#166)** — unblocks #167, #202, cost reporting. ~2-3 hrs. Schedule for later in the week.

### What I'll have ready for you
- `POST /admin/users/bulk-import` endpoint + CSV upload UI in Users panel (Phase 5)
- Pre-import dry-run preview so we don't half-create 150 rows on a bad CSV
- Error report for failed rows

---


## Decisions made

- [ ] **Postgres provider** — Neon or Render Postgres? *User sourcing cheaper elsewhere.*
- [x] **Auto-provision on first SSO** — invite-only
- [x] **Break-glass local-password accounts** — yes
- [x] **Installer code-signing** — Mac done. Windows deferred to GA.
- [x] **Admin panel surface** — keep visible on web AND desktop (security is server-side anyway)

---

## Phases 1–4 ✅ DONE
Entra ID setup · Schema + SSO backend · Login UI · Polished Login + Electron deep-link + Signed-notarized .dmg + Windows .exe in CI

## Phase 4.5 — Daily polish ✅ DONE
Block buttons · Favorite name everywhere (incl. Dialpad quick-pick) · Universal server-side favorite sync · Version bump 0.4.0 → 0.6.0 → 0.6.1

## Phase 5 (postponed)
- [ ] **#189** CSV bulk-import existing 150 Telnyx-assigned users

## Phase 6 — Admin Users panel ✅ DONE
- [x] **#168 / #178 / #179** GET/POST/PATCH /admin/users + frontend table + safeguards
- [x] **#180** GET /admin/audit-logs + viewer in Settings
- [x] **#200** Invite modal with optional Advanced (paste Telnyx creds + local password)
- [ ] **#166** Telnyx API investigation (sub-credential create, DID purchase, voicemail config)
- [ ] **#167** Telnyx orchestration inside POST /admin/users with rollback (blocked on #166)
- [ ] **#169** CLI fallback `scripts/provision-user.mjs`
- [ ] **#171** New-user onboarding one-pager PDF

## Phase 7 — Update infrastructure ✅ DONE
- [x] **#197** In-app "Update available" banner (polls every 15 min)
- [x] **#198** GitHub Actions publishes versioned releases (electron-builder + GH Release)
- [x] **#199** `electron-updater` silent download + restart-to-install
- [x] CI uses `electron-builder --publish always` → uploads latest.yml + blockmap + installers

## Phase 7.5 — User-requested QoL ✅ DONE (this push)
- [x] **#201** Decline incoming call with quick-reply SMS — **rebuilt as proper 3rd button + post-decline sheet**, with cleaner UI and proper decoupling (decline + send happen reliably, sheet survives IncomingCall unmount)
- [ ] **#202** Local presence (pick "calling from" DID) — schema change + UI dropdown. Defer until #166 lands.
- [ ] **#203** Voicemail transcription — code already in webhook; flip "Transcription" on in Telnyx Portal under Hosted Voicemail Profile. ~$0.05/min cost.

---

## Phase 8 — Admin reporting (new — pulled from user brainstorm)

Comprehensive analytics + visibility for admins running the dialer. Designed to roll out in priority slices so we ship value quickly:

### P0 — Live ops dashboard (#204) ← ship first
At-a-glance cards on the Settings → Reports → Live page (admin-only). Auto-refresh every 15s. Powered by a single `GET /admin/reports/live` endpoint that does the aggregations.
- **Currently online** (count of users with `sipState=registered` right now)
- **Active calls right now** (concurrent count from open Call rows)
- **Today's calls** (in / out / missed breakdown)
- **Today's SMS** (sent / received)
- **Top 5 callers today** by call count
- **Recent missed calls** feed (last 10, with caller + when + how-long-ago)
- **SIP registration heartbeat** — alert if >5% of users haven't registered in the last hour

### P1 — Usage & volume reports (#205)
Historical leaderboards + drill-down. Powered by `GET /admin/reports/usage?range=7d|30d|90d&groupBy=user|day|hour`.
- **Calls per user per day/week/month** — sortable table
- **Volume line chart** — daily call count over 30/60/90 days (Chart.js)
- **Inbound vs outbound donut** — split by direction
- **Average call duration** per user
- **Total talk time** per user
- **Voicemails received vs returned** — response rate (% replied via callback within 24h)
- **Per-user drill-down page**: full call history + SMS volume + voicemail stats + last sign-in + install/device info

### P1 — Quality & health (#206)
Signals that surface problems before users complain.
- **Missed/abandoned call rate** per user
- **Calls under 10s** (likely dropped or wrong number) — per-user count + rate
- **Failed call attempts** (registration fails, network errors from `hangupCause`)
- **Hangup-cause breakdown pie** — see what's failing
- **Average call quality score** per user (persist the in-call quality indicator to a new `Call.qualityScore` column)
- **Peak-hours heatmap** (day-of-week × hour) — when are most calls happening?

### P1 — Telnyx cost reporting (#207)
Money visibility — who's burning the budget.
- **Per-DID minutes used** — surface unused / underused numbers
- **Per-user minute spend** (call_duration × rate from env config)
- **SMS segments sent** per user (each segment ≈ $0.0085)
- **Estimated monthly cost projection** based on rolling 7-day average
- **Recording storage usage** in GB

### P2 — Recruiter metrics (ApTask-specific, #208)
Metrics that map to recruiter workflow specifically.
- **Candidate reach** — unique outbound numbers dialed per user per day
- **Conversation rate** — % of calls that connected > 30s
- **JobDiva contact coverage** — % of recent calls that matched to a JobDiva contact (shows the gap where reps are calling un-tracked leads)
- **Comparison to team average** for each metric
- **Weekly recruiter scorecard** digest (plugs into #209)

### P2 — Export + scheduled digests (#209)
- **CSV / Excel export** of any report (SheetJS or plain CSV download)
- **Scheduled weekly email digest** to admins (Render cron + email provider — Resend / Postmark / SES)
- **Daily Slack / Teams webhook** for the team that wants real-time updates
- **Subscribe per-report** checkbox on each report card

### P3 — Health alerts (proactive, #210)
Server-side cron that checks for anomalies + nudges admins.
- **"User has 0 calls in 7 days"** — idle account candidate
- **"User offline > 2h during business hours"** — likely a problem
- **"Spike in missed calls today vs 7-day avg"** — potential carrier issue
- **"DID with no recent calls"** — reassignment candidate
- Surfaces in Audit log + optional email/Slack alert

### Suggested build order
1. Ship **P0 Live dashboard** (1 day) — gives admins something useful immediately
2. **P1 Quality & health** (1.5 days) — most actionable; finds problems
3. **P1 Usage & volume** (2 days) — leaderboards and per-user drill-down
4. **P1 Cost reporting** (1 day) — needs Telnyx pricing config first
5. **P2 Recruiter metrics** (1 day) — ApTask differentiator
6. **P2 Export + digests** (2 days) — needs email provider decision
7. **P3 Health alerts** (1.5 days) — needs cron infrastructure

---

## Smoke-test checklist for v0.7.2 (after CI builds + reinstall)

### Header + version
- [ ] Header shows **v0.7.2 · Desktop** (Mac, Win) and **v0.7.2 · Web**

### Auto-update (#199)
- [ ] Push a no-op v0.7.3 → wait ~10 min → installed v0.7.2 shows "Update available — downloading…" pill within ~15 min
- [ ] "Update ready — Restart to install" appears when download completes
- [ ] Click Restart → installer runs → app relaunches as v0.7.3

### Favorites sync (#195)
- [ ] Star a contact on Mac → sign in on Windows → starred there with the same name
- [ ] Rename on Windows → reflects on Mac after refresh
- [ ] Unstar on Mac → gone on Windows

### Block buttons (#159 follow-up)
- [ ] Ban icon on Recents row → confirm → blocked toast → row's Block button hides for the session
- [ ] Ban icon on Messages thread header → confirm → red "Blocked" badge replaces button
- [ ] Settings → Blocked numbers shows the entry

### Favorite name everywhere (#161)
- [ ] Recents, IncomingCall, InCall, Messages list+detail, Voicemail row+filter banner, **Dialpad contacts quick-pick** — all show favorite name when set

### Admin Users panel (#168, #178, #179, #180, #200)
- [ ] Settings → Users loads the table (after Prisma Studio promoted you to admin)
- [ ] Invite new user → row appears
- [ ] Kebab → Promote to admin → role flips
- [ ] Try to demote yourself → disabled with explanation
- [ ] Try to demote the last remaining admin → server error message shown
- [ ] Reset local password works
- [ ] Settings → Audit log shows every action with before/after diff

### Decline-with-message (#201 rebuild) ← test this carefully on v0.7.2
- [ ] Have someone call your DID
- [ ] Full-screen IncomingCall shows 3 buttons: red Decline · amber **Reply** · green Accept
- [ ] Tap **Reply** → call hangs up immediately (caller stops ringing) → bottom sheet slides up with quick replies + custom text input
- [ ] Tap a quick reply → "Message sent" success card → sheet auto-closes after ~1.4s → caller gets SMS from your DID
- [ ] Or type custom text + Send → same flow
- [ ] Or tap "Skip — don't send anything" → sheet closes, call stays declined
- [ ] When you're already on a call and a 2nd one rings → Reply button is hidden (3 buttons already showing: Decline / Hold & Accept / Accept)
- [ ] Internal SIP-URI inbound (e.g. user-to-user) → Reply button is hidden (no SMS target)

### Voicemail transcription (#203) — after Telnyx Portal flip
- [ ] Telnyx Portal → Voice → Programmable Voice → Hosted Voicemail Profile → enable Transcription
- [ ] Get a voicemail → expand row in Voicemail tab → transcript appears under audio player

---

## Pre-scale infrastructure (when we cross ~30 concurrent or get a compliance ask)

- [ ] **#181** Render: Hobby → Pro workspace + Standard compute
- [ ] **#183** Render Key Value (Redis) + Socket.IO Redis adapter
- [ ] **#184** Telnyx webhook hardening (HMAC verify + BullMQ + idempotency)
- [ ] **#186** Vercel Hobby → Pro
- [ ] **#187** Verify Telnyx WebRTC vs SIP pricing model
- [ ] **#185** Replace 15s polling with real-time push
- [ ] **#140** socket.io for instant chat push
- [ ] **#194** Windows code-signing (EV/OV cert ~$200/yr)

---

## Open follow-ups (no specific timeline)

- [ ] **#158** Custom busy greeting (blocked on Telnyx engineering)
- [ ] **#151** DATABASE_URL on Render webhooks service
- [ ] Migrate voicemail/MMS storage from Supabase Storage to Cloudflare R2
- [ ] Settings → Profile picture upload
- [ ] Per-user call recording opt-in (consent)
- [ ] Floating ringer window (Electron): add Reply button too — currently it only has Accept/Decline

---

## Versioning convention

- **PATCH** (0.7.0 → 0.7.1): bug fixes, small additive UI
- **MINOR** (0.7.x → 0.8.0): new user-facing features
- **MAJOR** (0.x → 1.0): GA launch
- Bump in `apps/web/package.json`, `apps/desktop/package.json`, root `package.json`, AND `apps/api/src/main.ts` on every push.

## How to use this file

1. Mark `[x]` as items finish.
2. Strike through descoped items `~~like this~~`.
3. "Ready for tomorrow" pings me to pull the next phase forward.
4. New items get appended at the bottom — review and reorder if needed.
