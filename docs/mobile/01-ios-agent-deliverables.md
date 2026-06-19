# ace-ios-mobile-agent — Deliverables (Discovery → Plan → Risks → Questions)

**Confidence statement up front:** iOS confidence is **~70% — BELOW the 95% gate. No iOS code will be written.** Blocking unknowns and required approvals are listed in §6–§7.

---

## 1. iOS discovery checklist (findings)
- Existing voice path is browser JsSIP; **no native iOS calling exists**. Telnyx ships a native iOS WebRTC SDK — recommended over porting JsSIP.
- **No VoIP push, no APNs, no device registration** in the backend today (`socket` is a stub; `UserDevice` table unused). Inbound calls cannot wake a backgrounded iOS app until this is built.
- **No refresh token** — a 15-min JWT will not survive a backgrounded phone; must be fixed server-side first.
- **SIP password is sent to the client** — acceptable-ish on desktop, but on iOS it must live in **Keychain**, and ideally be replaced by a **short-lived Telnyx token**.
- **No in-app account deletion** — hard Apple requirement (5.1.1(v)).
- MMS/greeting media are **public URLs** — must be signed before shipping.
- Privacy Policy / Terms / Support URLs do not exist — must be live before submission.

## 2. iOS architecture summary + framework recommendation
- **Recommended:** **Native Swift + SwiftUI** (UIKit interop where needed) — best CallKit/PushKit/AVAudioSession fidelity and lowest App-Review risk. **Alternative:** React Native with native Swift modules for CallKit/PushKit/Telnyx (faster code-share with Android, more moving parts). Decision needs ApTask sign-off (checkpoint B).
- **Calling:** Telnyx iOS WebRTC SDK + **CallKit** (system UI) + **PushKit** (VoIP push). On every VoIP push the app **must** report a new incoming call to CallKit immediately (iOS 13+ rule) or iOS kills the app and revokes push.
- **Audio:** `AVAudioSession` category `.playAndRecord`, mode `.voiceChat`; route to earpiece/speaker/Bluetooth; mirror the desktop's echo-cancellation-on / noise-suppression-off intent.
- **iPad:** **iPhone-only V1** (do not enable "Designed for iPad") to shrink review/test surface; revisit in Phase 2.
- **Deployment target:** **iOS 16.0+** (covers ~95%+ of active devices, gives modern PushKit/CallKit/SwiftUI).

## 3. Required SDKs / certs / accounts
Telnyx iOS WebRTC SDK; Apple Developer **Organization** account owned by ApTask; App Store Connect app record; Bundle ID `com.aptask.acedialer`; Apple Distribution certificate + provisioning profiles; **APNs VoIP push key (.p8)** registered with Telnyx; crash SDK (Sentry or Crashlytics).

## 4. Permission list + justification (request ONLY these for V1)
| Permission | Needed? | Justification |
|---|---|---|
| Microphone (`NSMicrophoneUsageDescription`) | **Yes** | Core: voice calls. |
| Notifications (incl. VoIP push) | **Yes** | Incoming-call alerts; VoIP push wakes app. |
| Bluetooth | Only if routing requires it | Headset audio routing (often works without explicit perm via AVAudioSession). |
| Contacts | **No (V1)** | App uses server-side contacts/JobDiva; do not request device contacts. |
| Camera / Photos | **No (V1)** | MMS is **view/download** in V1, not capture/upload. Add only if outbound MMS attach ships. |

## 5. iOS-specific compliance + security checklist
Account Deletion in-app (5.1.1(v)); accurate privacy nutrition labels (Contact Info, User Content, Identifiers, Usage Data as applicable); no private APIs; no hidden/placeholder features; reviewer login works with **no VPN/IP gating**; tokens in **Keychain**; logout clears Keychain + revokes server session; HTTPS only (consider cert pinning); push payloads carry **no** caller name/number/message body; jailbreak-risk consideration; crash logs scrubbed of phone numbers, names, SMS bodies, tokens, SIP creds.

## 6. iOS open questions (must be answered before coding)
1. Native Swift vs. React Native — final call? (affects whole repo structure)
2. Will ApTask create/own the Apple Developer **Organization** account (DUNS) before Phase 1? Timeline?
3. Can backend issue **short-lived Telnyx tokens / per-device SIP credentials**, or must V1 ship the existing static SIP password (Keychain-stored)?
4. Is **inbound calling in V1** required at launch, or can V1 ship outbound-first while VoIP push is hardened? (Big scope lever.)
5. Confirm iPhone-only V1 (no iPad) is acceptable.
6. Account-deletion semantics: hard delete vs. deactivate + data-retention window? (Legal input needed.)
7. Who provides Privacy Policy / Terms / Support URLs and hosting?

## 7. iOS 95% confidence gate — NOT cleared
**Current: ~70%.** Cannot reach 95% until: refresh tokens + device/push registration + VoIP push fan-out exist server-side; framework decided; Apple Org account owned by ApTask; SIP-credentialing approach decided; account-deletion + legal URLs confirmed. **Until then, no iOS code.** When these are resolved, the agent will re-issue a written gate statement for checkpoint C approval.
