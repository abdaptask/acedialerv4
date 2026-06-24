# Telnyx Support Ticket — Persistent inbound routing failures on Credential Connection (phantom SIP contacts)

**Account ID:** `a8c26837-89be-4bfc-a562-48b07022f7cf` (ApTask)
**Connection name:** `saifali-ace-b0npa`
**SIP credential username:** `acesaifali1b0npa`
**Affected DID:** `+17325320337`
**Affected user:** saifali@aptask.com

---

## Subject

Inbound calls to `+17325320337` are being forked to multiple SIP contacts under `acesaifali1b0npa`. Most legs return SIP 404 (UNALLOCATED_NUMBER) or 503 (NORMAL_TEMPORARY_FAILURE) — the caller usually hangs up before a live leg picks up. Our `REGISTER` responses indicate only 1 contact is currently registered, yet the CDR shows Telnyx attempting 3–5 routes per inbound call. We've shipped three client-side mitigations targeting this; the failure rate is still about 65% inbound.

---

## Symptom

Inbound calls to `+17325320337` ring on the caller's side but frequently never deliver to saifali's WebRTC client. Telnyx's CDR for the affected period shows each inbound `call_uuid` producing multiple CDR rows — Telnyx is forking the INVITE to multiple SIP contacts for credential username `acesaifali1b0npa`, and most legs return errors. After 10–30 seconds of ringing, the originator gives up.

Out of **104 inbound CDR rows** in the period 2026-06-05 through 2026-06-29:

| Outcome | Count |
|---|---|
| NORMAL_CLEARING (call delivered + answered) | 16 |
| UNALLOCATED_NUMBER (SIP 404) | 34 |
| NORMAL_TEMPORARY_FAILURE (SIP 503) | 11 |
| ORIGINATOR_CANCEL (caller gave up while ringing) | 21 |
| PROGRESS_TIMEOUT / ALLOTTED_TIMEOUT | 22 |

When call_uuids are grouped (multiple CDR rows per actual call), the per-call failure rate is roughly **65%**.

---

## Evidence — two representative inbound calls on 2026-06-22

These are taken from the same day as the user's most recent client-side diagnostic log (see "Logs available" below). Times in UTC.

### Call A — `8d363ed4-6e72-11f1-a61f-02420a210420` — 19:42:50 — from `+17144687639` — ZERO successful legs

| # | Terminating | Start UTC | End UTC | Cause | SIP code |
|---|---|---|---|---|---|
| 1 | `acesaifali1b0npa` | 19:42:50 | 19:42:50 | UNALLOCATED_NUMBER | 404 |
| 2 | `acesaifali1b0npa` | 19:42:50 | 19:42:51 | UNALLOCATED_NUMBER | 404 |
| 3 | `acesaifali1b0npa` | 19:42:51 | 19:42:51 | UNALLOCATED_NUMBER | 404 |
| 4 | `acesaifali1b0npa` | 19:42:51 | 19:42:52 | UNALLOCATED_NUMBER | 404 |
| 5 | `+17325320337` | 19:42:52 | 19:43:02 | ORIGINATOR_CANCEL | — |

All four routing attempts to `acesaifali1b0npa` returned 404. The caller heard ring tone for 12 seconds and then hung up. The user's client was registered and online throughout (per his diagnostic log from the same period).

### Call B — `4b7dc1ee-6e7f-11f1-8634-02420a210420` — 21:14:03 — from `+14072798518` — lucky success on the 4th fork

| # | Terminating | Start UTC | End UTC | Cause | SIP code |
|---|---|---|---|---|---|
| 1 | `acesaifali1b0npa` | 21:14:03 | 21:14:03 | UNALLOCATED_NUMBER | 404 |
| 2 | `acesaifali1b0npa` | 21:14:03 | 21:14:04 | UNALLOCATED_NUMBER | 404 |
| 3 | `acesaifali1b0npa` | 21:14:04 | 21:14:04 | UNALLOCATED_NUMBER | 404 |
| 4 | `acesaifali1b0npa` | 21:14:04 | 21:14:36 | NORMAL_CLEARING | — |

Three phantom legs failed first; the fourth happened to land on the real registration and delivered. This is the dominant pattern — inbound calls that "work" are the ones where Telnyx happens to fork to the live leg, eventually.

Additional call_uuids exhibiting the same pattern across the same dataset, available on request: `5ffadf4a-...420`, `59e45316-...420`, `9200c1de-...170`, `786f9c4e-...170`, `b0ee5c1c-...170`, `01e98740-...170`, `09648632-...420`.

---

## What we've done on the client side

Our WebRTC client (using JsSIP, registers as `acesaifali1b0npa@sip.telnyx.com:7443/wss`) has three measures specifically targeting stale-contact issues:

1. **Wildcard unregister on conditional path** (v0.10.80, shipped early 2026-06). Before each fresh REGISTER we send `REGISTER` with `Contact: *; expires=0` to wipe any previous contacts, *but only when the prior REGISTER response indicates more than 1 contact registered for our user*. This logic skips when Telnyx reports a single contact (which it does for saifali).
2. **Keep-alive interval tightened to 15s** (v0.10.110). WebSocket-level keep-alive sent every 15 seconds rather than the JsSIP default 25s, to prevent silent eviction during inactivity.
3. **Periodic full re-registration every 60s** (v0.10.113). Every 60 seconds the client tears down the SIP UA, sends a fresh `REGISTER ... Contact: *; expires=0` (unregister-all), then connects a new UA and registers. The intent is to force Telnyx to refresh the routing table with the current contact.

The user's diagnostic log from 2026-06-22 confirms all three measures are active and the REGISTER 200 response consistently reports `1 contact at Telnyx`. Yet the CDR rows above are from the same day, on the same credential.

---

## What we're asking engineering

1. **Why does the CDR show Telnyx forking inbound INVITEs to multiple legs for `acesaifali1b0npa` when the REGISTER 200 response indicates only 1 contact is registered?** Is there a routing-layer contact cache separate from the registrar's view that our wildcard unregister doesn't reach?

2. **Is there a way to inspect the routing-layer contacts** for a credential username so we can verify what Telnyx is forking to? An admin-side view or an API endpoint that returns the actual list of contacts being used for inbound routing (not just whatever REGISTER returned)?

3. **Is there a REST API or admin operation that forcibly purges all contacts** for a credential username, including any cached routing entries? A "hard reset" we could call programmatically once a day, or once per user session.

4. **Can engineering manually purge the phantom contacts for `acesaifali1b0npa` now**, while we figure out the long-term fix? That would at least give saifali working inbound while we coordinate the next steps.

5. **For users persistently in this state, is Call Control routing recommended over Credential Connection?** Call Control routes inbound via webhook to our server (where we can answer the call ourselves), bypassing the SIP-contact-table issue entirely. We've used Credential Connection because of WebRTC client simplicity, but we'd consider Call Control if it permanently resolves this class of issue.

---

## Logs available on request

- Full client-side diagnostic log from saifali on 2026-06-22 (covers ~10 minutes of register/keepalive cycles, one outbound call). Filename: `ace-dialer-logs-saifalin@aptask.com-v0.10.192-2026-06-22T13-24-36.txt`.
- Telnyx CDR CSV for `saifali-ace-b0npa` covering 2026-06-05 through 2026-06-29 (the CDR you generated for this account on request, file `cdr_customer_request-9dba6d23-9747-40a1-a7c7-9c6bca791f00.csv`).

Both can be attached to this ticket.

---

## Severity

Saifali is one of 40+ users on this account. He's the most extreme case but the same pattern has been observed (lower frequency) on other credentials. If the routing-layer cache is account-wide, this affects every credential we provision. The success rate for saifali specifically is roughly 1 in 3 inbound calls — that's effectively unusable for an outbound-recruiting business where missed inbounds = lost candidate touchpoints.

Please advise on the routing-layer question (item 1 above) as the first priority — that determines whether this is a fixable client-side bug or a server-side issue we need engineering to address.

**Contact for follow-up:** abdulla@aptask.com
