# ace-android-mobile-agent — Deliverables (Discovery → Plan → Risks → Questions)

**Confidence statement up front:** Android confidence is **~70% — BELOW the 95% gate. No Android code will be written.** Blocking unknowns and required approvals are listed in §6–§7.

---

## 1. Android discovery checklist (findings)
- Existing voice path is browser JsSIP; **no native Android calling exists**. Telnyx ships a native Android WebRTC SDK — recommended over porting JsSIP.
- **No FCM, no device registration, no push fan-out** today (`socket` is a stub; `UserDevice` table unused). Inbound calls cannot wake a backgrounded/Dozing Android app until built.
- **No refresh token** — 15-min JWT is unworkable for a mobile app; fix server-side first.
- **SIP password is sent to the client** — must live in **Android Keystore / EncryptedSharedPreferences**, ideally replaced by short-lived Telnyx token.
- **No account/data deletion** — Play requires an in-app path **and** a public deletion URL.
- MMS/greeting media are **public URLs** — sign or RLS-gate before shipping.
- AceDialer keeps call/SMS/MMS history **server-side**, so we can and must **avoid restricted SMS/Call-Log permissions** entirely.

## 2. Android architecture summary + framework recommendation
- **Recommended:** **Native Kotlin + Jetpack Compose**. **Alternative:** React Native with native Kotlin modules (shared with iOS RN). Must match the iOS framework decision for true code-share — joint sign-off at checkpoint B.
- **Calling:** Telnyx Android WebRTC SDK + **high-priority FCM data messages** to signal inbound calls + a **full-screen-intent notification** (or `ConnectionService`/Telecom for system call UI). On Android 14+, `USE_FULL_SCREEN_INTENT` is restricted — phone/VoIP apps qualify, but it must be declared and justified.
- **In-call service:** foreground service of type `phoneCall`/`microphone` with the matching `FOREGROUND_SERVICE_*` permission (Android 14+ requires the typed declaration).
- **Audio:** `AudioManager` for earpiece/speaker/Bluetooth routing; mirror desktop AEC-on / NS-off intent.
- **Background reliability:** handle Doze + OEM battery-killers (Samsung/Xiaomi/OnePlus); high-priority FCM + foreground service; guide users to disable battery optimization where allowed.
- **Tablet:** phone-first V1.
- **min/target SDK:** **minSdk 26 (Android 8.0)**, **targetSdk = latest required by Play** (currently 34/35 — confirm at build time).

## 3. Required SDKs / accounts
Telnyx Android WebRTC SDK; Firebase project **owned by ApTask** + FCM; Google Play Console **Organization** account owned by ApTask; package name `com.aptask.acedialer`; **upload key + Play App Signing**; crash SDK (Crashlytics or Sentry).

## 4. Permission list + justification (request ONLY these for V1)
| Permission | Needed? | Justification |
|---|---|---|
| `RECORD_AUDIO` | **Yes** | Core: voice calls. |
| `POST_NOTIFICATIONS` (Android 13+) | **Yes** | Incoming-call + message notifications. |
| `INTERNET` / `ACCESS_NETWORK_STATE` | **Yes** | API + WebRTC. |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_PHONE_CALL`/`_MICROPHONE` | **Yes** | Keep call audio alive in background. |
| `USE_FULL_SCREEN_INTENT` | **Yes (justify)** | Full-screen incoming-call UI; declare for VoIP. |
| `BLUETOOTH_CONNECT` | Only if routing requires | Bluetooth headset audio. |
| `READ_SMS`/`SEND_SMS`/`READ_CALL_LOG`/`WRITE_CALL_LOG`/`PROCESS_OUTGOING_CALLS` | **NEVER** | Restricted; auto-reject for VoIP. History is server-side. |
| `READ_PHONE_STATE` | **Avoid** | Only if Telecom integration strictly needs it; document if so. |
| Contacts / Camera / Photos | **No (V1)** | Server-side contacts; MMS is view/download only in V1. |

## 5. Android-specific compliance + security checklist
Data Safety form matching real behavior (data collected/shared, encryption in transit, deletion); restricted-permission declaration form (avoid triggering it by not requesting SMS/Call-Log); account-deletion URL + in-app path; app-access instructions for review (no VPN/IP gating); tokens in **Keystore/EncryptedSharedPreferences**; logout clears local creds + revokes server session; HTTPS only (consider pinning); FCM payloads carry **no** caller name/number/message body; crash logs scrubbed of PII/tokens/SIP creds; rooted-device risk consideration.

## 6. Android open questions (must be answered before coding)
1. Native Kotlin vs. React Native — must match iOS decision.
2. Will ApTask own the Play Console **Organization** account and the **Firebase** project before Phase 1?
3. Short-lived Telnyx token vs. static SIP password (Keystore-stored) for V1?
4. Inbound calling required at V1 launch, or outbound-first?
5. `ConnectionService`/Telecom system call UI vs. custom full-screen-intent notification — preferred UX?
6. Account-deletion semantics + retention window (legal input).
7. Who provides/hosts Privacy Policy / Terms / Support / deletion URLs?

## 7. Android 95% confidence gate — NOT cleared
**Current: ~70%.** Cannot reach 95% until: refresh tokens + device/push registration + FCM fan-out exist server-side; framework decided (matching iOS); Play Console + Firebase owned by ApTask; SIP-credentialing approach decided; account-deletion + legal URLs confirmed; full-screen-intent/foreground-service approach confirmed against current Play policy. **Until then, no Android code.** A written gate statement will be re-issued for checkpoint C approval once resolved.
