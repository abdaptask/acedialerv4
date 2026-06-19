# AceDialer Mobile — Master Implementation Plan

**Prepared by:** ace-ios-mobile-agent + ace-android-mobile-agent (coordinated)
**Rule:** No mobile code until the per-platform **95% confidence gate** is cleared **and** ApTask approves at checkpoint C. Both platforms are currently **~70%**.

---

## Phased plan

### Phase 0 — Discovery ✅ (complete)
Live read-only audit done; see `00-discovery-report.md`. Key conclusion: **backend is not yet mobile-ready** (no refresh tokens, no device/push registration, no push fan-out, SIP secret on client, no dispositions/notes, no contact search, no JobDiva writeback, no account deletion, public media URLs, committed secrets).

### Phase 1 — Architecture & backend readiness (no app code yet)
Decisions (need sign-off): mobile framework (native vs. RN — **must be the same choice on both platforms**); SIP credentialing (short-lived Telnyx token vs. Keystore/Keychain-stored static password); V1 scope (outbound-first vs. inbound-at-launch); iPhone-only / phone-first.
Backend work (with backend team) — prerequisites to coding:
1. **Refresh-token flow** (`/auth/refresh`, rotation, revocation).
2. **Device + push-token registration** API; populate the existing `UserDevice` table.
3. **Push fan-out** on inbound call → VoIP push (iOS) / high-priority FCM (Android), with **no sensitive content in payloads**.
4. **Short-lived SIP/Telnyx credential** issuance (stop shipping the static SIP password).
5. **Dispositions + notes** model/endpoints; **contact search**; **JobDiva writeback** (CRM-write — needs explicit approval).
6. **Self-service account/data deletion** endpoint + flow.
7. **Signed/RLS media URLs** for MMS + greetings.
8. **Environment separation**: dev / staging / production configs; no prod secrets in test builds.
9. **Secrets remediation** (rotate the committed keys; scrub history) — security prerequisite.

### Phase 2 — MVP build (ONLY after checkpoint C approval)
Login (ApTask auth + SSO) → secure session (refresh) → dialer/keypad/DTMF → outbound + inbound call flow → call history/recents → SMS/MMS (view/download) → voicemail list+playback → dispositions + notes → settings (Privacy/Terms/Support/version/logout/account deletion). Build per platform behind the chosen framework.

### Phase 3 — Platform integration
iOS: CallKit + PushKit + VoIP push (report-to-CallKit on every wake) + Telnyx push creds + Keychain. Android: FCM data messages + full-screen-intent/Telecom + foreground service + Telnyx push creds + Keystore. Both: backend device registration wired end-to-end.

### Phase 4 — QA
Functional, network, device, security, and store-compliance QA per `01`/`02` checklists. Verify no regression to existing desktop/web backend behavior.

### Phase 5 — Store preparation
Listings, screenshots, app icon/splash, Privacy Policy + Terms + Support URLs live, reviewer login + instructions + demo data, **Apple privacy labels**, **Google Data Safety**, restricted-permission review, age rating, category, release notes.

### Phase 6 — Beta
TestFlight (internal → external) and Play internal → closed testing. Fix issues. Re-run compliance QA.

### Phase 7 — Production release
Final leadership approval → submit (only after explicit approval) → respond to review → **iOS manual release**, **Android staged rollout**.

### Phase 8 — Post-launch
Monitor crashes, call quality, login failures, push-delivery failures, store reviews; plan Phase 2 features (transfer/conference/monitoring/AI summaries/transcription/templates/analytics/recording mgmt/JobDiva writeback expansion) per the original Phase-2 list — architected-for but not in V1.

---

## Store account & ownership prerequisites (ApTask must own)
Apple Developer Org account; Google Play Console Org account; Firebase project; Telnyx account/creds; GitHub repo; **app signing keys backed up by ApTask**; store listings controlled by ApTask. Developers added as limited users; **no personal/vendor account owns the app**.

## Backend dependency summary (coordinate with backend team)
Mobile auth + refresh + logout/revocation; device + push-token registration; user↔Telnyx-number/extension mapping; Telnyx session-token generation; inbound routing + outbound initiation; call/SMS/MMS/voicemail APIs (+ signed media); disposition + notes; JobDiva writeback; contact search; DNC/reassigned-number status (if available); roles/permissions enforced **server-side**; audit + error logging; remote/lost-device logout; dev/staging/prod separation; rate limiting; monitoring; backup verification.

## Cross-platform coordination matrix
Shared and kept identical across iOS/Android: app name & branding; UX patterns; **API contracts**; auth + session model; Telnyx flow where possible; error messages; compliance language (TCPA, SMS consent, STOP/HELP, DNC, recording consent); Privacy Policy; support process; release notes; QA test cases; the single reviewer/demo user; production-readiness checklist (`05-final-pre-submission-checklist.md`).

## App identity & store listing (shared)
- Bundle/package: `com.aptask.acedialer`
- Name: **AceDialer by ApTask** (alt: AceDialer Mobile)
- Subtitle/short: *Secure mobile softphone for ApTask business communication.*
- Reviewer account: `appreview@aptask.com` (Demo Recruiter, test Telnyx number) — **must work with no VPN/IP restriction**; load demo call/SMS/voicemail data.

## Versioning & release engineering (shared)
SemVer marketing version shared across platforms; iOS build number monotonic per upload; Android `versionCode` monotonic. CI: Fastlane/Xcode Cloud (iOS), Gradle + Play Publisher (Android). Rollback: iOS = expedited review of prior-good build / phased-release halt; Android = halt staged rollout + roll back to last good track. Monitoring: crash SDK + backend dashboards for login/push/call-quality failures.

## Approval checkpoints (both agents)
A Discovery → B Architecture → **C 95% gate before any code** → D Pre-beta build → E Pre-submission checklist → F Submit approval → G Release approval. **We are between A and B.**
