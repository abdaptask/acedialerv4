# AceDialer Mobile — Phase 0 Discovery Report

**Status:** Discovery complete (live, read-only codebase audit). No code changed.
**Date:** 2026-06-18 · **Repo audited:** `acedialerv4` (v0.10.192)
**Owners:** ace-ios-mobile-agent + ace-android-mobile-agent (shared)

> This report grounds the architecture plan and the 95% confidence gate. Every "gap" below is something that must be resolved (built, decided, or approved) before mobile coding begins.

---

## 1. Existing tech stack (confirmed from source)

| Layer | Technology | Version |
|---|---|---|
| Monorepo | npm workspaces, Node `>=20`, TypeScript ^5.4.5 | — |
| Backend API | Fastify | ^4.27.0 |
| Auth | `@fastify/jwt` ^8.0.1, `bcryptjs`, `@azure/msal-node` ^2.16.2 (MS SSO) | — |
| SIP (web) | **JsSIP** ^3.10.1 over WSS to `wss://sip.telnyx.com:7443` | — |
| Media SDK | `@telnyx/webrtc` ^2.22.0 (present alongside JsSIP) | — |
| Web UI | React ^18.3.1, Vite ^5.4.21 | — |
| Desktop | Electron 31.7.7 | — |
| Realtime | `socket.io` ^4.7.5 + Redis adapter (**stub only**) | — |
| DB/ORM | Prisma ^5.18.0 → Supabase Postgres | — |
| Media storage | Supabase Storage bucket `ace-media` | — |

**Apps:** `api`, `webhooks`, `socket`, `web`, `desktop`; package `db`.

## 2. Telnyx usage
- **Voice (web):** JsSIP UA registers per-user against Telnyx SIP over WSS; 120s register expiry with aggressive 10–15s refresh and 60s reconnect cycles. ICE via Telnyx TURN (`turn.telnyx.com:3478`, authed with SIP creds) + Google STUN + optional Cloudflare TURN.
- **Server orchestration:** `apps/api/src/telnyx/callControl.ts` wraps Call Control v2 (`dial`, `bridge`, `conferenceCreate/Join`, `transfer`, `recordStart/Stop`) using `TELNYX_API_KEY` (server-side only — good).
- **Webhooks:** `apps/webhooks/src/main.ts` routes events to users via `sipUsername`/`didNumber`, persists calls/messages/voicemails, fires Teams/email notifications.
- **Messaging:** `apps/api/src/messages/sendMessage.ts` → Telnyx Messaging API; MMS `media_urls` must be **public** URLs.
- **Voicemail:** Telnyx Hosted Voicemail; recordings are **Telnyx-signed (Bearer)** and proxied through the API.

**Mobile implication:** the web stack registers SIP directly from the client using per-user SIP credentials. On mobile we should adopt the **Telnyx mobile WebRTC SDKs** (iOS/Android) + **Telnyx push credentials** for VoIP push, rather than porting JsSIP. This is an architecture decision requiring sign-off.

## 3. JobDiva integration
- `apps/api/src/jobdiva/client.ts` authenticates to JobDiva V2 (Basic auth + clientid, token cached 12h, refresh on 401).
- Only capability: **lookup contact by phone** (`GET /jobdiva/contact?phone=`), trying multiple phone-field variants.
- **Gap:** no writeback. Mobile spec wants candidate/disposition writeback → **must be built** (new backend capability + approval, since it writes to the CRM).

## 4. Backend API surface (mobile-relevant)
Auth (`/auth/login`, `/auth/me`, `PATCH /auth/me`), MS SSO, `calls`, `messages` (+scheduled), `voicemails` (+greeting), `favorites`, `blocked`, `callForwarding`, `jobdiva`, `internalChat`, `contacts` (history timeline by phone), `turnCredentials`, plus admin/tips/ringtones/praises. All non-login routes require JWT.

## 5. Authentication & session (critical gaps)
- **JWT only, ~15m expiry, NO refresh-token endpoint.** `.env.example` mentions `JWT_REFRESH_EXPIRES_IN` but it is **not implemented**; the repo's own `QA_AUDIT.md` flags this. JWT payload = `{ sub, email, isAdmin }`.
- Web stores JWT in `sessionStorage`; SIP creds in `sessionStorage`.
- **SIP username + password are returned to the client in the `/auth/login` and `/auth/me` JSON responses** (over HTTPS) and used directly by the SIP UA. Stored plaintext in Postgres `sip_password`.
- Session guard is a `fetch` 401 interceptor + a 90s SIP-failure watchdog → logout.
- **Gaps for mobile:** (a) no refresh token → 15-min sessions are unworkable for a backgrounded phone app; (b) no device registration; (c) no push-token storage (the `UserDevice` table exists in the schema but is **never populated**); (d) SIP secret reaches the client.

## 6. Call/SMS/MMS/voicemail workflows
- **Calls:** `Call` model has direction/status/timestamps/duration/recordingUrl. Recents are deduped across Telnyx legs (`sessionId` group, then 60s proximity merge).
- **SMS/MMS:** threaded by other-party number; MMS uploaded base64 → Supabase, stored as **public** URLs.
- **Voicemail:** list auto-purges after 30 days; audio served via authenticated API proxy (`/voicemails/:id/audio`) — good access control; greetings uploaded to Supabase (public URL), WebM→WAV transcode.

## 7. Confirmed security gaps (pre-existing, not introduced here)
1. **Live secrets committed in repo `.env`** (Telnyx API key, JWT secret, SIP password, JobDiva/SendGrid/Microsoft secrets, DB URL). **Highest-priority remediation; do not copy this pattern to mobile.** Requires secret rotation + history scrub — ApTask decision.
2. SIP password delivered to client and stored in `sessionStorage` (XSS-exposed on web).
3. No refresh token; 15-min hard session.
4. MMS attachments and greeting audio are **public** Supabase URLs (no signing/RLS). Voicemail audio is correctly proxied.
5. `socket` service is a ping/pong stub — no realtime/push.

## 8. What can be reused vs. rebuilt for mobile

| Reuse (server-side, mobile-ready or near-ready) | Must build / change for mobile |
|---|---|
| Telnyx Call Control wrapper (server) | **Refresh-token endpoint** + rotation |
| Webhooks routing + persistence | **Device & push-token registration** API (+ use `UserDevice` table) |
| Calls/Messages/Voicemail/Favorites/Contacts read APIs | **Push fan-out** (VoIP push iOS / FCM Android) on inbound call |
| JobDiva lookup | **Telnyx mobile token / short-lived SIP credential** issuance (stop shipping static SIP password) |
| Voicemail audio proxy pattern | **Call disposition + notes** model + endpoints |
| MS SSO backend | **Contact search** endpoint (today only favorites + JobDiva lookup) |
| Supabase storage | **JobDiva writeback** API |
| | **Self-service account/data deletion** endpoint + flow (store requirement) |
| | **Signed/RLS media URLs** for MMS/greetings |
| | **Privacy Policy / Terms / Support** public URLs |
| | Native UI (CallKit/Telecom, native screens) — web React UI is not reusable as-is |

## 9. What Apple/Google may reject if unaddressed
- **Thin WebView wrapper** → both stores reject. Native shell required.
- **iOS:** missing in-app Account Deletion (Guideline 5.1.1(v)); VoIP push that doesn't report to CallKit on every wake; incomplete privacy nutrition labels; reviewer unable to log in.
- **Android:** any SMS/Call-Log restricted permission on a VoIP app → auto-reject; Data Safety form mismatch; missing account-deletion URL; `USE_FULL_SCREEN_INTENT` policy (Android 14+); foreground-service-type errors.
- **Both:** demo/reviewer account behind VPN/IP allowlist; placeholder content; screenshots not matching the app; TCPA/SMS-consent + recording-consent language absent.

## 10. Discovery conclusion
The backend is **not yet mobile-ready**. Before any mobile coding: build refresh tokens, device/push registration, push fan-out, short-lived SIP credentialing, dispositions/notes, contact search, account deletion, and signed media URLs — and remediate the committed-secrets issue. These are the backbone of the 95% confidence gate. See `03-master-implementation-plan.md` and `04-risk-register.md`.
