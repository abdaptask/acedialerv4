**To:** support@telnyx.com
**From:** abdulla@aptask.com
**Subject:** Persistent inbound routing failures on Credential Connection `saifali-ace-b0npa` — REGISTER reports 1 contact but CDR shows fork to multiple dead legs

---

Hi Telnyx team,

We're seeing a persistent inbound-routing issue on one of our user's Credential Connections that we'd like engineering's eyes on. We've already shipped three client-side mitigations targeting this class of bug and the failure rate is still around 65% on inbound — which makes me think there's a server-side routing detail we can't see from our side.

**Account context**

- Account ID: `a8c26837-89be-4bfc-a562-48b07022f7cf` (ApTask)
- Connection name: `saifali-ace-b0npa`
- SIP credential username: `acesaifali1b0npa`
- Affected DID: `+17325320337`
- Affected user: saifali@aptask.com

**The symptom**

Inbound calls to `+17325320337` ring on the caller's side but frequently never deliver to saifali's WebRTC client, even when his client is registered and online. Looking at the CDR for this connection from 2026-06-05 through 2026-06-29, each inbound `call_uuid` produces 3–5 CDR rows — Telnyx is forking each INVITE to multiple SIP contacts under `acesaifali1b0npa`, most of which return SIP 404 (UNALLOCATED_NUMBER) or 503 (NORMAL_TEMPORARY_FAILURE). After 10–30 seconds of ringing, the caller hangs up.

Out of 104 inbound CDR rows in that window:

- 16 NORMAL_CLEARING (delivered + answered)
- 34 UNALLOCATED_NUMBER (SIP 404)
- 11 NORMAL_TEMPORARY_FAILURE (SIP 503)
- 21 ORIGINATOR_CANCEL (caller gave up while still ringing)
- 22 PROGRESS_TIMEOUT / ALLOTTED_TIMEOUT

Grouped by call_uuid, the per-call failure rate is roughly 65%.

**Two specific calls on 2026-06-22 — same day as the user's most recent client log**

Call UUID `8d363ed4-6e72-11f1-a61f-02420a210420`, 2026-06-22 19:42:50 UTC, from `+17144687639`:

- Leg 1 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 2 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 3 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 4 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Caller cancelled after 12 seconds (ORIGINATOR_CANCEL)
- ZERO successful legs; saifali's client never rang

Call UUID `4b7dc1ee-6e7f-11f1-8634-02420a210420`, 2026-06-22 21:14:03 UTC, from `+14072798518`:

- Leg 1 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 2 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 3 → `acesaifali1b0npa` → SIP 404 UNALLOCATED_NUMBER
- Leg 4 → `acesaifali1b0npa` → answered, 29s talk, NORMAL_CLEARING

So three phantom legs failed first; the fourth happened to land on the real registration. This is the dominant pattern — when inbound "works" for saifali, it's because Telnyx eventually forked to the live leg after exhausting the dead ones.

More call_uuids exhibiting the same pattern, available on request: `5ffadf4a-...`, `59e45316-...`, `9200c1de-...`, `786f9c4e-...`, `b0ee5c1c-...`, `01e98740-...`, `09648632-...`.

**What we've already tried on our side**

Our WebRTC client (JsSIP, registers as `acesaifali1b0npa@sip.telnyx.com:7443/wss`) has three measures specifically targeting stale-contact issues:

1. Wildcard unregister before fresh REGISTER (we send `REGISTER` with `Contact: *; expires=0`), conditionally fired when the prior REGISTER 200 response indicates more than 1 contact registered. This logic skips when Telnyx reports a single contact — which is what it reports for saifali.
2. WebSocket keep-alive interval tightened to 15 seconds (from the JsSIP default of 25s) to prevent silent eviction during inactivity.
3. Periodic full re-registration every 60 seconds — we tear down the SIP UA entirely, send `REGISTER ... Contact: *; expires=0` (unregister-all), then connect a new UA and register fresh.

The user's diagnostic log from 2026-06-22 confirms all three measures are active and the REGISTER 200 consistently reports `1 contact at Telnyx`. Yet the CDR rows above are from the same day, on the same credential, showing Telnyx forking to multiple destinations anyway.

**Our questions for engineering**

1. Why does the CDR show Telnyx forking inbound INVITEs to multiple legs for `acesaifali1b0npa` when the REGISTER 200 indicates only 1 contact is registered? Is there a routing-layer contact cache separate from the registrar's view that our wildcard unregister doesn't reach?

2. Is there a way to inspect the routing-layer contacts for a credential username so we can verify what Telnyx is actually forking to — an admin-side view or an API endpoint that returns the live contact list used for inbound routing?

3. Is there a REST API or admin operation that forcibly purges all contacts (including any cached routing entries) for a credential username? A "hard reset" we could call programmatically.

4. Can engineering manually purge the phantom contacts for `acesaifali1b0npa` now while we figure out the long-term fix? That would give saifali working inbound while we coordinate next steps.

5. For users persistently in this state, would you recommend migrating to Call Control routing instead of Credential Connection? Call Control routes inbound via webhook to our server, bypassing the SIP-contact-table entirely. We use Credential Connection today because of WebRTC client simplicity, but we'd consider Call Control if it permanently resolves this class of issue.

**Logs and CDR available**

I can attach two files:

- The full client-side diagnostic log from saifali on 2026-06-22 (covers about 10 minutes of register/keepalive cycles + one outbound call): `ace-dialer-logs-saifalin@aptask.com-v0.10.192-2026-06-22T13-24-36.txt`
- The Telnyx CDR CSV for `saifali-ace-b0npa` covering 2026-06-05 through 2026-06-29: `cdr_customer_request-9dba6d23-9747-40a1-a7c7-9c6bca791f00.csv`

Let me know how you'd like them sent — attached to this thread or via your portal.

**Severity**

Saifali is one of 40+ users on this account; he's the most extreme case but the pattern shows up on other credentials at lower frequency. If the routing-layer cache is account-wide, every credential we provision is at risk. For saifali himself, roughly 1 in 3 inbound calls reaches him — effectively unusable for our outbound-recruiting business where missed inbounds equal lost candidate touchpoints. Question 1 above is the load-bearing one — please prioritize that.

Happy to get on a call with engineering if it'd help unblock this faster.

Thanks,
Abdulla Sheikh
ApTask
abdulla@aptask.com
