# ACE Dialer — Working Checklist

**Last updated:** 2026-05-21 (end of day)
**Owner:** Abdulla (abdulla@aptask.com)
**Pilot target:** 150 total users, ~30–40 concurrent peak

Check items off as we complete them. New items get appended at the bottom. Items in *italics* are blocked on a decision or external dependency.

---

## Decisions made

- [ ] **Postgres provider** — Neon ($19/mo Scale) **or** Render Postgres ($19/mo)? *Still pending — user is sourcing cheaper Postgres elsewhere.*
- [x] **Auto-provision on first SSO** — **invite-only** (admin invite required, controls DID cost)
- [x] **Break-glass local-password accounts** — **yes**, abdulla@aptask.com retains password fallback alongside SSO
- [x] **Installer code-signing** — **Mac done** (Developer ID + notarization in CI). **Windows deferred** to GA (pilot accepts SmartScreen warning)

---

## Phase 1 — Entra ID setup ✅ DONE

- [x] Sign in to https://portal.azure.com as ApTask admin
- [x] Entra ID → App Registrations → New registration
- [x] App name: `ACE Dialer`
- [x] Supported account types: Single tenant (ApTask only)
- [x] Redirect URI #1 (Web): `https://acedialerv4-web.vercel.app/auth/microsoft/callback`
- [x] Redirect URI #2 (Public client/native): `ace-dialer://auth/callback`
- [x] Register the app + copy **Application (client) ID**
- [x] Copy **Directory (tenant) ID**
- [x] Client secret (24 months) — copy the **Value** (not the ID)
- [x] API permissions: `openid`, `profile`, `email`, `User.Read`
- [x] Add `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET` to Render `ace-dialer-api` env

---

## Phase 2 — Schema + SSO backend ✅ DONE

- [x] Prisma migration: nullable `passwordHash`, `azureOid` unique, `provider`, `AuditLog` table
- [x] `@azure/msal-node` integration (`ConfidentialClientApplication` for web, `PublicClientApplication` for Electron PKCE)
- [x] `POST /auth/microsoft/exchange` + `GET /auth/microsoft/config`
- [x] `MS_CLIENT_ID` / `MS_TENANT_ID` / `MS_CLIENT_SECRET` set on Render
- [x] Deployed; `/auth/microsoft/config` returns `enabled:true`
- [x] Local-login guard against null `passwordHash` for SSO-only users

---

## Phase 3 — Login UI (web) ✅ DONE

- [x] PKCE helpers in `lib/oauth.ts` (codeVerifier/codeChallenge, state)
- [x] Rewritten `Login.tsx` with "Sign in with Microsoft" + break-glass password disclosure
- [x] `MicrosoftCallback.tsx` callback page handling state + code exchange
- [x] `App.tsx` route registered (`/auth/microsoft/callback`)
- [x] Verified end-to-end on browser: signed in via Microsoft, landed on `/keypad`, AuditLog entry written

---

## Phase 4 — Polish Login UI + Electron deep-link + Installers ✅ DONE

- [x] **#188** Polished Login: gradient backdrop, glass card, dark Microsoft CTA, demoted password to disclosure, hero block, dark theme
- [x] **#177** Electron `app.setAsDefaultProtocolClient('ace-dialer')` + `open-url` (mac) + second-instance argv handler (win) for SSO callback
- [x] Single-instance lock + `ace:open-external` + `ace:sso-callback` IPC channels
- [x] Preload bridge: `openExternal`, `onSsoCallback`, `notifyReadyForSso`
- [x] `isElectron()` branch in Login.tsx → `shell.openExternal` + `onSsoCallback` subscription
- [x] Focus/visibility reset so cancelled SSO doesn't leave UI stuck in "Redirecting…"
- [x] Vite `base: './'` for file:// asset paths
- [x] `HashRouter` for file:// (Electron), `BrowserRouter` for http(s):// (web)
- [x] **#170** Windows `.exe` build via GitHub Actions (electron-builder `--win`, NSIS installer)
- [x] **Mac `.dmg` build via GitHub Actions** (electron-builder `--mac`, both arm64 + x64)
- [x] **Apple Developer Program enrolled** + Developer ID Application cert generated via CSR
- [x] Cert + private key combined into `Certificates.p12`, base64-encoded, added to GitHub secrets
- [x] App-specific password generated for notarization, Team ID copied
- [x] 5 GitHub secrets configured: `APPLE_CSC_LINK`, `APPLE_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- [x] `entitlements.mac.plist` at `apps/desktop/` root (not in gitignored `build/`)
- [x] Hardened Runtime entitlements: JIT, unsigned-executable-memory, library-validation disabled, mic, network client+server
- [x] `mac.notarize: true` + `extendInfo` with `CFBundleURLTypes` + `NSMicrophoneUsageDescription`
- [x] **Signed + notarized `.dmg` installs cleanly on Mac with zero Gatekeeper warnings**
- [x] **Windows `.exe` installs cleanly via NSIS one-click installer**
- [x] SSO works end-to-end on Mac Electron app (browser → `ace-dialer://` → app)
- [x] SSO works end-to-end on Windows Electron app
- [x] Microphone permission prompt fires on first call (Mac System Settings shows ACE Dialer)
- [x] SIP password populated in DB → JsSIP connects to `wss://sip.telnyx.com:7443` → registered
- [x] Verified live call works on Mac signed build

---

## Phase 5 — Bulk import existing 150 users (Claude, ~2 hr) ← NEXT

- [ ] **#189** CSV ingest endpoint `POST /admin/users/bulk-import` (admin-only, idempotent on email)
- [ ] **#189** CLI fallback: `node scripts/bulk-import-users.mjs --file=users.csv`
- [ ] You: pull existing user list from Telnyx Portal (SIP Connection → Credentials tab → export) + add emails column from Entra ID
- [ ] Run import → confirm all 150 User rows created → spot-check a few

---

## Phase 6 — Admin Users panel + per-user provisioning (Claude + you, ~4 hr)

- [ ] **#178** Backend: `PATCH /admin/users/:id` with last-admin safeguard + AuditLog
- [ ] **#167** Backend: `POST /admin/users` provisioning orchestration (Telnyx sub-credential + DID purchase + assign + voicemail enable + DB row + audit)
- [ ] **#168 + #179** Frontend: `Settings → Users` panel with table, Invite, promote/demote, deactivate
- [ ] **#180** Frontend: `Settings → Audit Log` viewer (read-only)
- [ ] **#169** CLI fallback: `scripts/provision-user.mjs`
- [ ] **#166** Investigate Telnyx API: sub-credentials, DID purchase + assign, voicemail config endpoints
- [ ] **#171** Write new-user one-pager (PDF): Install → Open → Sign in with Microsoft → Done

---

## Phase 7 — Pilot smoke test (you, ~30 min)

- [ ] Sign out → sign back in via Microsoft → confirm avatar + name in header
- [ ] Sign in as a bulk-imported 2nd user from a different machine/browser
- [ ] Exchange a chat message + a phone call between the two
- [ ] As admin: promote 2nd user to admin → confirm AuditLog entry
- [ ] Try to demote self → confirm last-admin safeguard
- [ ] **#172** Full pilot smoke test with a real 2nd ApTask user end-to-end

---

## Pre-scale infrastructure (when we cross ~30 concurrent or get a compliance ask)

- [ ] **Task #181** Bump Render: Hobby → Pro workspace + Standard compute for socket service
- [ ] **Task #183** Provision Render Key Value (Redis) + wire Socket.IO Redis adapter
- [ ] **Task #184** Telnyx webhook hardening: HMAC verify + BullMQ queue + idempotency keys
- [ ] **Task #186** Upgrade Vercel Hobby → Pro
- [ ] **Task #187** Verify Telnyx WebRTC vs SIP pricing model (does it stack?)
- [ ] **Task #185** Replace 15s polling with real-time push (Postgres LISTEN/NOTIFY or Realtime equivalent on new Postgres provider)
- [ ] **Task #140** Wire socket.io for instant chat push (kill 6s polling)
- [ ] **Task #194** Windows code-signing (EV or OV cert, ~$200/yr) — defer to GA

---

## Open follow-ups (no specific timeline)

- [ ] **Task #158** Custom busy greeting (blocked on Telnyx engineering escalation)
- [ ] **Task #151** Update DATABASE_URL on Render webhooks service (after Postgres provider switch)
- [ ] "Block this number" buttons on Recents rows + Messages thread headers (from #159 follow-up)
- [ ] **#159** Number blocking — in progress
- [ ] **#161** Show favorite name in all surfaces — in progress
- [ ] Migrate voicemail/MMS storage from Supabase Storage to Cloudflare R2 (after Postgres provider switch)
- [ ] Settings → Profile picture upload (currently just initials gradient)
- [ ] Per-user call recording opt-in (compliance / consent)

---

## Bonus items completed today (not originally in plan)

- [x] **Recents dedupe** — added `STATUS_RANK` + `dedupeCallLegs()` helper in `calls.routes.ts`; one row per session, status-ranked
- [x] **Internal chat frontend** — `Chat.tsx` (418 lines) + 6th bottom-nav tab + unread badge; reuses Messages CSS
- [x] **CSS rescue** — fixed truncated `.audio-picker-label` that was killing all styles past line 3603
- [x] **CORS reflect-origin** — supports `file://` Electron pages (Origin: null) without dropping browser security
- [x] **Cross-platform native binaries** — `optionalDependencies` for rollup (linux/darwin/win32) + dmg-license (macOS only)
- [x] **Vercel build fix** — added all 4 rollup platform binaries so Linux build server works

---

## How to use this file

1. As we finish each item, mark it `[x]`.
2. If a task gets descoped or replaced, strike it through `~~like this~~` and add the replacement below.
3. When all of today's phases are checked, ping me with "ready for tomorrow" and we'll pull the next phase forward.
4. New items I create during the day get appended at the bottom — review them and reorder if needed.
