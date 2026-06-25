**To:** support@telnyx.com
**Cc:** [senior technician name — add manually]
**From:** abdulla@aptask.com
**Subject:** ESCALATION — ApTask account `a8c26837-...` — two compounding platform-level voice failures (~72% inbound failure account-wide + new per-DID media-routing failure)

---

Looping in [name] for senior engineering visibility. The open ticket has been queued for L2 / engineering review for ~4 days without an internal reference number or ETA. Below is a consolidated summary with all evidence; happy to get on a call today/tomorrow.

# TL;DR

Two distinct, compounding platform failures on our Telnyx account are making the ACE Dialer effectively unusable for inbound voice across our 40+ user base:

1. **Phantom-contact INVITE forking** — Telnyx forks inbound INVITEs to multiple dead SIP contacts per credential (avg 3-5 legs/call). Returns SIP 404/503 on most legs. Account-wide ~72% inbound failure rate over 22 days.

2. **Per-DID media routing failure (new — 2026-06-24)** — Even when calls DO connect at the SIP layer, the media path is broken for specific DIDs. Same user, same machine, same network: DID `+14706168494` produces zero audio either direction; DID `+13216410795` works cleanly. Variable that changes between working and failing calls is which DID is used, not anything client-side.

We have client-side logs, full-account CDR analysis, and per-call traces to back both. Files attached.

---

# Account context

- **Account ID:** `a8c26837-89be-4bfc-a562-48b07022f7cf` (ApTask)
- **Primary point of contact:** abdulla@aptask.com (Abdulla Sheikh)
- **Dialer architecture:** WebRTC client (JsSIP/@telnyx/webrtc) over Credential Connections, ~59 active credentials, two affected DIDs cited below
- **Time window of failures documented:** 2026-06-05 through 2026-06-24 (CDR pull)
- **Open ticket reference:** L1 acknowledged 2026-06-20; no internal ticket # provided despite repeated requests

---

# Issue 1 — Phantom-contact INVITE forking (account-wide)

## What we observe

Inbound INVITEs to a credential username (e.g., `acesaifali1b0npa`, `aceroshniy8aru5`, etc.) fork into 3-5 simultaneous routing attempts. Most legs return SIP 404 (UNALLOCATED_NUMBER) or 503 (NORMAL_TEMPORARY_FAILURE). Calls either time out (caller cancels after 10-30s of ring) or — on lucky calls — one of the forks lands on the live registration.

## Specific evidence

CDR session `8d363ed4-6e72-11f1-a61f-02420a210420` (2026-06-22 19:42:50 UTC, inbound from +17144687639):

| Leg | Terminating | Cause | SIP code |
|---|---|---|---|
| 1 | acesaifali1b0npa | UNALLOCATED_NUMBER | 404 |
| 2 | acesaifali1b0npa | UNALLOCATED_NUMBER | 404 |
| 3 | acesaifali1b0npa | UNALLOCATED_NUMBER | 404 |
| 4 | acesaifali1b0npa | UNALLOCATED_NUMBER | 404 |
| 5 | +17325320337 | ORIGINATOR_CANCEL | — |

Same pattern reproduces on 124 of 153 credentials in the 22-day CDR pull.

## Account-wide numbers (ACE Dialer users only, 2026-06-01 → 2026-06-23)

- 4,725 inbound call sessions
- 1,331 answered (28.2%)
- **71.8% failure rate**
- 74.2% of inbound calls had >1 leg (forked)
- Average 3.48 SIP-leg attempts per inbound call
- **58 of 59 dialer users (98.3%) match the pattern**

Per-user CSV attached as `per_dialer_user_summary.csv`.

## Critical mismatch

Our REGISTER 200 responses consistently report **1 contact** per credential. Yet CDR shows Telnyx forking inbound to multiple endpoints. There is a disagreement between the registrar's view (1 contact) and the routing layer's view (3-5 contacts) for the same credential.

## Client-side mitigations already in production

These have NOT resolved the issue:

1. Wildcard unregister (`Contact: *; expires=0`) before each fresh REGISTER. Gated on REGISTER reporting >1 contact — which is moot when Telnyx reports 1 but forks to many.
2. WebSocket keep-alive tightened to 15 seconds.
3. Full UA tear-down + re-registration every 60 seconds to force a fresh contact entry.

---

# Issue 2 — Per-DID media routing failure (new evidence, 2026-06-24)

## What we observe

For specific DIDs, calls reach the WebRTC client at the SIP layer (signaling completes, ICE reports `connectionState: connected`), but no RTP packets flow in either direction. **The variable that determines success is which DID is in use — same machine, same user, same network.**

## Specific evidence — same user (roshni in India), same session, three calls within 12 minutes

| # | Direction | DID used | Other party | Outcome |
|---|---|---|---|---|
| 1 | Outbound from her dialer | **+14706168494 (470)** | US PSTN cell (973-area) | **Zero audio, both directions** |
| 2 | Outbound from her dialer | **+13216410795 (321)** | US PSTN cell (973-area) | **Clean audio** |
| 3 | Inbound to her dialer | **+13216410795 (321)** | US PSTN cell (973-area) | **5 seconds of audio, then silent both directions** |

Client logs (attached as `ace-dialer-logs-roshnis@aptask.com-v0.10.203-2026-06-24T20-30-05.txt`) show identical successful WebRTC wiring on all three calls:
- `peerconnection event fired`
- `track event — kind: audio streams: 1`
- `remote stream attached to both audio elements`
- `iceConnectionState: connected`
- `connectionState: connected`

No client-side errors or warnings on any call. The wiring is correct on all three; only RTP delivery differs.

## What this implies

Different DIDs on the same account are routing media through different Telnyx anchor sites / transcoders. At least one route is degraded. Possible specific causes (engineering would know better):

- Anchor-site assignment differs per DID and one anchor is unhealthy
- Codec transcoder pool differs per DID
- Media-relay packet drops on a specific path
- DID provisioning artifact (e.g., 470 was migrated from a different connection earlier and inherited a stale media-routing config)

---

# Specific technical asks for engineering

In priority order:

1. **Provide an internal ticket reference number** so this case can be tracked across L1/L2/engineering handoffs. We've asked three times.

2. **Manual purge of phantom contacts** across all 59 credentials under account `a8c26837-...`. L1 confirmed this is possible from your side. We need this regardless of root cause; even a one-time purge would restore inbound reliability while engineering investigates.

3. **Investigate the routing-layer / registrar contact-table desync.** Why does Telnyx fork inbound INVITEs to 3-5 endpoints when REGISTER reports only 1 contact registered? Is there a separate routing-layer cache we cannot see or clear from the client side?

4. **Per-DID media-route inspection for `+14706168494` vs `+13216410795`.** Why does media work cleanly for the latter but not the former on the same user/network? What anchor site, transcoder, and connection bindings differ between them?

5. **Move `+14706168494` to the same media route as `+13216410795`** if engineering can identify the bad route. This unblocks roshni's outbound calls while broader investigation continues.

6. **Recommendation on Call Control routing migration.** If credential-connection routing has known issues with phantom contacts AND per-DID media degradation, we'd consider migrating to Call Control for inbound — please advise whether that architecture would resolve both issue families.

---

# Severity / business context

ApTask runs a staffing/recruiting operation. Inbound calls from candidates are critical touchpoints — missed inbound calls equal lost candidate engagement and lost placements. With ~72% inbound failure account-wide AND now per-DID media degradation on specific DIDs, the dialer is unreliable to the point where users are reverting to personal cell phones for business calls. That breaks our DID-based call tracking, SMS history, and recording capture.

We've been a Telnyx customer for [X months/years]. Open to switching architectures (Call Control) or working through a structured remediation, but we need engineering engagement, not L1 queueing. Happy to:

- Get on a Zoom/Google Meet today or tomorrow with engineering
- Provide additional CDR pulls, client logs, or live test calls
- Send a per-credential failure heatmap if useful

---

# Files attached / available

1. `per_dialer_user_summary.csv` — per-user inbound failure breakdown for the 59 dialer users (22-day window)
2. `cdr_customer_request-7b348436-...csv` — raw CDR pull (your own export from 2026-06-23)
3. `ace-dialer-logs-saifalin@aptask.com-v0.10.192-2026-06-22T13-24-36.txt` — saifali client log showing REGISTER 1-contact + concurrent CDR multi-leg forking
4. `ace-dialer-logs-roshnis@aptask.com-v0.10.203-2026-06-24T20-30-05.txt` — roshni client log showing identical wiring across DIDs with different audio outcomes
5. `phantom_contacts_dialer_only.md` — readable summary of phantom-contact analysis

Let me know which channel works best for engineering follow-up (email thread, ticket, Slack Connect if available).

Thanks for prioritizing this.

Abdulla Sheikh
ApTask
abdulla@aptask.com
