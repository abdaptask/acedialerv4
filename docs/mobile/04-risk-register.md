# AceDialer Mobile — Risk Register

Severity/Probability: H/M/L. Owner: iOS = ace-ios-mobile-agent, AND = ace-android-mobile-agent, BE = backend, ApT = ApTask leadership. Checkpoint letters map to `03-master-implementation-plan.md`.

| # | Risk | Sev | Prob | Mitigation | Owner | Checkpoint |
|---|---|---|---|---|---|---|
| 1 | Apple rejection — VoIP/CallKit misuse | H | M | Report to CallKit on every VoIP push; use background `voip` mode only for calls; follow HIG | iOS | D/E |
| 2 | Google rejection — restricted permissions | H | M | Never request SMS/Call-Log; keep history server-side; complete declaration form | AND | E |
| 3 | Push notification failure (no wake) | H | M | Build device/push registration + fan-out first; VoIP push (iOS) / high-prio FCM (AND); end-to-end test on real devices | BE/iOS/AND | C/D |
| 4 | Incoming calls don't wake app | H | M | iOS PushKit→CallKit; AND FCM + full-screen-intent + foreground service; Doze/OEM handling | iOS/AND | D |
| 5 | Telnyx mobile SDK integration issues | M | M | Spike Telnyx iOS/Android SDK in Phase 1; validate push creds before MVP | iOS/AND | B/C |
| 6 | Poor audio quality / echo | M | M | Mirror desktop AEC-on/NS-off; tune AVAudioSession/AudioManager; device matrix test | iOS/AND | D |
| 7 | Background call drops | H | M | Foreground service (AND); background audio mode (iOS); reconnect logic; network-switch test | iOS/AND | D |
| 8 | Secrets exposed in app | H | M | No hardcoded secrets; Keychain/Keystore; short-lived Telnyx token; **rotate committed repo secrets** | BE/iOS/AND | C |
| 9 | Reviewer cannot log in | H | M | Demo account no VPN/IP gating; seed demo data; written reviewer steps | iOS/AND | E |
| 10 | Privacy disclosures incomplete | H | M | Complete Apple labels + Play Data Safety from a data-flow inventory; legal review | iOS/AND/ApT | E |
| 11 | Account deletion missing | H | H | Build in-app deletion + public URL before submission (store requirement) | BE/iOS/AND | C/E |
| 12 | Backend not mobile-ready | H | H | Phase 1 backend prerequisites (refresh, device reg, push, dispositions, search, signed media) before code | BE | C |
| 13 | JobDiva sync/writeback failures | M | M | Writeback is new + CRM-writing; approval + sandbox testing; lookup stays read-only fallback | BE/ApT | B/C |
| 14 | Production/test environment mix-up | H | M | dev/staging/prod schemes/flavors; no prod secrets in test builds; CI guards | BE/iOS/AND | C/D |
| 15 | Signing key loss | H | L | Play App Signing; Apple certs in ApTask account; keys backed up + access-controlled | ApT | E |
| 16 | Firebase misconfiguration | M | M | ApTask-owned Firebase; verify FCM server key↔Telnyx push cred; staging project | AND/BE | C/D |
| 17 | Crashes on old devices | M | M | minSdk26 / iOS16 floor; low-end device QA; crash SDK from day 1 | iOS/AND | D |
| 18 | Android battery-optimization kills calls | H | M | Foreground service + high-prio FCM; OEM-killer guidance; Doze test on Samsung/Xiaomi | AND | D |
| 19 | Store metadata mismatch | M | M | Screenshots from real builds; description matches features; checklist gate | iOS/AND | E |
| 20 | Compliance — calling/SMS (TCPA/consent/recording) | H | M | Add TCPA, SMS-consent, STOP/HELP, DNC, recording-consent language; legal review | ApT/iOS/AND | E |
| 21 | Developer codes before requirements clear | H | M | Hard rule: discovery+architecture before code; this plan enforces it | iOS/AND | A/B |
| 22 | Developer codes before 95% confidence | H | M | Written gate statement required; both currently ~70% → no code | iOS/AND | C |
| 23 | Code committed without approval | M | M | PR review + approval required; no merge without sign-off | iOS/AND/ApT | C–F |
| 24 | Production deployment without approval | H | L | Submit/release only at checkpoints F/G with explicit ApTask approval | ApT | F/G |

**Top blockers to start coding:** #11, #12, #22 (and #8 secrets remediation). All map to checkpoint C.
