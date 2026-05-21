# ACE Dialer — Working Checklist

**Last updated:** 2026-05-21
**Owner:** Abdulla (abdulla@aptask.com)
**Pilot target:** 150 total users, ~30–40 concurrent peak

Check items off as we complete them. New items get appended at the bottom. Items in *italics* are blocked on a decision or external dependency.

---

## Decisions needed today (before code starts)

- [ ] **Postgres provider** — Neon ($19/mo Scale, autoscaling, branching) **or** Render Postgres ($19/mo, same datacenter)?
- [ ] **Auto-provision on first SSO** — when an `@aptask.com` employee signs in for the first time, auto-create their dialer account **or** require admin invite first?
  - *Recommended:* require invite (controls DID cost)
- [ ] **Break-glass local-password accounts** — keep yours + one backup admin with password login as a fallback when Entra ID is down? (yes/no)
  - *Recommended:* yes
- [ ] **Installer code-signing** — purchase Windows + Mac certs (~$200/yr each) **or** accept SmartScreen warning for pilot, revisit at GA?
  - *Recommended:* defer for pilot

---

## Phase 1 — Entra ID setup (you, ~30 min)

- [ ] Sign in to https://portal.azure.com as ApTask admin
- [ ] Navigate: Entra ID → App Registrations → New registration
- [ ] Name the app: `ACE Dialer`
- [ ] Supported account types: **Accounts in this organizational directory only (Single tenant)**
- [ ] Redirect URI #1 (Web): `https://ace-dialer.vercel.app/auth/microsoft/callback`
- [ ] Redirect URI #2 (Public client/native): `ace-dialer://auth/callback`
- [ ] Register the app
- [ ] Copy and save: **Application (client) ID**
- [ ] Copy and save: **Directory (tenant) ID**
- [ ] Certificates & secrets → New client secret → 24 months → copy and save the **Value** (not the ID)
- [ ] API permissions → ensure these are granted: `openid`, `profile`, `email`, `User.Read`
- [ ] Add these three values to Render's `ace-dialer-api` env vars: `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`

---

## Phase 2 — Schema + SSO backend ✅ DONE

- [x] Prisma migration: nullable passwordHash, azureOid, provider, AuditLog table
- [x] @azure/msal-node integration + `/auth/microsoft/exchange` + `/auth/microsoft/config`
- [x] `MS_CLIENT_ID` / `MS_TENANT_ID` / `MS_CLIENT_SECRET` set on Render
- [x] Deployed; `/auth/microsoft/config` returns `enabled:true`

## Phase 3 — Login UI (web) ✅ DONE

- [x] PKCE helpers in `lib/oauth.ts`
- [x] Rewritten `Login.tsx` with "Sign in with Microsoft" + break-glass password disclosure
- [x] `MicrosoftCallback.tsx` callback page handling state + code exchange
- [x] App.tsx route registered
- [x] Verified end-to-end: signed in via Microsoft, landed on /keypad, AuditLog entry written

## Phase 4 — Polish Login UI + Electron deep-link (Claude, ~2 hr)

- [ ] **#188** Polish Login page: dark Microsoft CTA, demote password button to text link, hero block, gradient backdrop, theme support
- [ ] **#177** Electron `app.setAsDefaultProtocolClient('ace-dialer')` + `open-url` + second-instance argv handler for SSO callback

## Phase 5 — Bulk import existing 150 users (Claude, ~2 hr)

- [ ] **#189** CSV ingest endpoint `POST /admin/users/bulk-import` (admin-only)
- [ ] **#189** CLI fallback: `node scripts/bulk-import-users.mjs --file=users.csv`
- [ ] You: pull existing user list from Telnyx Portal (SIP Connection → Credentials tab → export) + add emails column from Entra ID
- [ ] Run import → confirm all 150 User rows created → spot-check a few

## Phase 6 — Admin Users panel + per-user provisioning (Claude + you, ~4 hr)

- [ ] **#178** Backend: `PATCH /admin/users/:id` with last-admin safeguard + AuditLog
- [ ] **#167** Backend: `POST /admin/users` provisioning orchestration (Telnyx + DB + audit)
- [ ] **#168 + #179** Frontend: `Settings → Users` panel with table, Invite, promote/demote, deactivate
- [ ] **#180** Frontend: `Settings → Audit Log` viewer
- [ ] **#169** CLI fallback: `scripts/provision-user.mjs`

## Phase 7 — Smoke test (you, ~30 min)

- [ ] Sign out → sign back in via Microsoft → confirm avatar + name in header
- [ ] Sign in as a bulk-imported 2nd user from a different machine/browser
- [ ] Exchange a chat message + a phone call between the two
- [ ] As admin: promote 2nd user to admin → confirm AuditLog entry
- [ ] Try to demote self → confirm last-admin safeguard

## Tomorrow (May 22) — Full provisioning + installers

- [ ] **Task #166** Investigate Telnyx API: sub-credentials, DID purchase + assign, voicemail config endpoint
- [ ] **Task #167** `POST /admin/users` orchestration: create User row + Telnyx SIP creds + assign DID + enable voicemail + send invite email (or display credentials)
- [ ] **Task #168** Wire "Invite User" button to real provisioning endpoint
- [ ] **Task #169** CLI fallback: `node scripts/provision-user.mjs --email=... --first=... --last=...`
- [ ] **Task #170** Add Windows `.exe` build to GitHub Actions (electron-builder `--win`)
- [ ] **Task #171** Write new-user one-pager (PDF): Install → Open → Sign in with Microsoft → Done
- [ ] **Task #180** Audit Log viewer page in Settings (read-only)
- [ ] **Task #172** Full pilot smoke test with a real 2nd ApTask user end-to-end

---

## Pre-scale infrastructure (when we cross ~30 concurrent or get a compliance ask)

- [ ] **Task #181** Bump Render: Hobby → Pro workspace + Standard compute for socket service
- [ ] **Task #183** Provision Render Key Value (Redis) + wire Socket.IO Redis adapter
- [ ] **Task #184** Telnyx webhook hardening: HMAC verify + BullMQ queue + idempotency keys
- [ ] **Task #186** Upgrade Vercel Hobby → Pro
- [ ] **Task #187** Verify Telnyx WebRTC vs SIP pricing model (does it stack?)
- [ ] **Task #185** Replace 15s polling with real-time push (Postgres LISTEN/NOTIFY or Realtime equivalent on new Postgres provider)
- [ ] **Task #140** Wire socket.io for instant chat push (kill 6s polling)

---

## Open follow-ups (no specific timeline)

- [ ] **Task #158** Custom busy greeting (blocked on Telnyx engineering escalation)
- [ ] **Task #151** Update DATABASE_URL on Render webhooks service (after Postgres provider switch)
- [ ] "Block this number" buttons on Recents rows + Messages thread headers (from #159 follow-up)
- [ ] Migrate voicemail/MMS storage from Supabase Storage to Cloudflare R2 (after Postgres provider switch)
- [ ] Settings → Profile picture upload (currently just initials gradient)
- [ ] Per-user call recording opt-in (compliance / consent)

---

## How to use this file

1. As we finish each item, mark it `[x]`.
2. If a task gets descoped or replaced, strike it through `~~like this~~` and add the replacement below.
3. When all of today's phases are checked, ping me with "ready for tomorrow" and we'll pull the next phase forward.
4. New items I create during the day get appended at the bottom — review them and reorder if needed.
