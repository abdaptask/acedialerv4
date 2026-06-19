# AceDialer Mobile — Final Pre-Submission Checklist

Every item must be signed off **before** any store submission. Submit only after explicit ApTask approval (checkpoint F).

## Ownership & keys
- [ ] ApTask owns Apple Developer account
- [ ] ApTask owns Google Play Console
- [ ] ApTask owns Firebase project
- [ ] ApTask owns Telnyx credentials
- [ ] ApTask owns source repo
- [ ] Signing keys backed up securely (Play App Signing enabled; Apple certs in ApTask account)

## Device & functional testing (real devices)
- [ ] iOS CallKit tested
- [ ] iOS VoIP push tested (foreground, background, terminated)
- [ ] Android FCM tested
- [ ] Android background call tested (incl. Doze + an OEM-killer device)
- [ ] Login / Logout tested (incl. token expiry + refresh)
- [ ] Outbound call / Inbound call tested
- [ ] SMS / MMS tested (view + download)
- [ ] Voicemail list + playback tested
- [ ] Call disposition + notes tested
- [ ] JobDiva lookup (and writeback, if shipped) tested
- [ ] Bluetooth / wired / speaker / earpiece routing tested

## Security & privacy
- [ ] No hardcoded secrets in either app
- [ ] No debug logs / no PII in crash logs
- [ ] Tokens in Keychain (iOS) / Keystore (Android); logout clears + revokes
- [ ] Media (MMS/voicemail/recording) URLs protected (signed/proxied)
- [ ] Push payloads contain no sensitive content
- [ ] Committed repo secrets rotated & history remediated

## Listings & compliance
- [ ] Privacy Policy live · Terms live · Support URL live
- [ ] Account/data-deletion path live (in-app + public URL)
- [ ] Store screenshots match the actual app · no placeholder content
- [ ] Apple privacy labels completed
- [ ] Google Data Safety completed
- [ ] Restricted permissions reviewed (Android: none from SMS/Call-Log groups)
- [ ] TCPA / SMS-consent / STOP-HELP / DNC / recording-consent language present
- [ ] Reviewer login works (no VPN/IP gating) · demo data available · instructions written
- [ ] Release notes approved

## Governance gates
- [ ] 95% coding confidence gate cleared (per platform, in writing)
- [ ] Leadership approval received
- [ ] Submit only after explicit approval (iOS manual release / Android staged rollout)
