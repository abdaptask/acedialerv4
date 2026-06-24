**To:** support@telnyx.com
**From:** abdulla@aptask.com
**Subject:** URGENT — Re: phantom contact issue is account-wide, not user-specific. ~72% inbound failure across our entire dialer user base.

---

Hi team,

Following up on the ticket I opened for saifali's inbound routing failures on `saifali-ace-b0npa`. After your support engineer confirmed the CDR pattern, we pulled CDR for the FULL account over the last 22 days and ran the same analysis across every credential. **This is not a saifali-specific problem. The phantom-contact routing failure is affecting essentially every credential we provision.** Numbers below.

**Account:** ApTask — `a8c26837-89be-4bfc-a562-48b07022f7cf`
**Window:** 2026-06-01 → 2026-06-23 (22 days, UTC)
**Filter applied:** inbound only, ACE Dialer credentials only (Pulse-legacy connections and shared mainlines excluded)

**Headline numbers for the ACE Dialer user base:**

- 59 ACE Dialer users received inbound traffic
- **4,725 inbound call sessions** across those users
- **Only 1,331 answered (28.2%) — 71.8% failure rate**
- **74.2% of inbound calls were forked** (Telnyx attempted >1 leg)
- **Average 3.48 SIP-leg attempts per inbound call** — Telnyx is fanning out every INVITE to multiple endpoints, most returning SIP 404 / 503
- **58 of 59 users (98.3%) match the phantom-contact pattern**

The 1 "clean" user (`deepaliv-aptask-com`) had only 1 inbound call in the window — sample too small to mean anything. Effectively zero unaffected users.

**Examples — high-volume affected users:**

| Credential connection | Inbound calls | Answered | Fail % | Avg legs |
|---|---|---|---|---|
| `sagar-ace-1z2ck` | 277 | 6 | 97.8% | 4.98 |
| `sweta-ace-imq7u` | 230 | 38 | 83.5% | 3.95 |
| `ankit-ace-b076a` | 212 | 39 | 81.6% | 3.72 |
| `sohailc-aptask-com` | 183 | 4 | 97.8% | 4.54 |
| `soheb-ace-497ph` | 163 | 29 | 82.2% | 3.17 |
| `arati-ace-a046h` | 254 | 66 | 74.0% | 3.38 |
| `eela-ace-venqr` | 118 | 30 | 74.6% | 4.21 |
| `zuhaibm-aptask-com` (was saifali's ticket pattern) | similar volumes | similar | similar | 4.5–5 |

Several connections have ZERO answered calls in 22 days despite receiving 5-200 inbound INVITEs:

- `stefan-ace-d4v9l` — 15 inbound, 0 answered (avg 4.33 legs)
- `rajendram-aptask-com` — 7 inbound, 0 answered (avg 5.0 legs)
- `atharvaj-aptask-com` — 1 inbound, 0 answered (avg 5.0 legs)
- `brijesh-ace-40o9o` — 1 inbound, 0 answered (avg 5.0 legs)

**The pattern is identical across all of them**, matching what your support engineer confirmed for saifali's ticket:

- Telnyx forks the INVITE to 3-5 SIP contacts under each user's credential
- Most return SIP 404 (UNALLOCATED_NUMBER) or 503 (NORMAL_TEMPORARY_FAILURE)
- A few lucky calls land on the live registration (the "answered" ones)
- The rest expire as caller-cancel or progress-timeout

For each of these credentials our client (JsSIP/WebRTC) has been registering normally — `REGISTER` 200 responses consistently show **1 contact** registered. Yet Telnyx's CDR shows the routing layer forking to 3-5 endpoints. The disagreement between the registrar's view and the routing layer's view is the same as we described in saifali's ticket — except it isn't isolated to one user.

**This changes the severity of the original ticket.** It's not a one-user oddity — it's an account-wide routing failure that has made inbound voice effectively unusable for our entire 40+ user base. Outbound is unaffected (success rate >95% on the same window), so the issue is specifically on Telnyx's inbound INVITE fork-out to credential contacts.

**Requests for engineering, in priority order:**

1. **Account-level purge of phantom contacts** across every credential connection under `a8c26837-89be-4bfc-a562-48b07022f7cf`. We need this regardless of the root cause investigation — even a one-time manual purge would restore inbound for the user base while engineering figures out the longer-term fix.

2. **Confirmation on the routing-layer cache.** Is there a routing-layer table separate from the registrar's contact list? If yes, what populates it and what clears it? If no, why is Telnyx forking to multiple endpoints when our REGISTER responses indicate 1 contact?

3. **A REST API or admin operation to inspect the actual contacts being used for inbound forking** — separate from the registrar's REGISTER response. We need a way to see what Telnyx is forking to so we can detect and clean it on our side.

4. **Internal ticket reference number** so we can quote it in escalations or board-level updates. This is now a business-critical outage for us.

5. **Recommendation on Call Control migration** for the dialer. If the credential-connection routing model has a known issue with phantom contacts and there's no fix in flight, we'd rather migrate now than wait. Please advise.

**Attached:**

- Full per-user CSV: `per_dialer_user_summary.csv` (59 dialer-user rows with inbound count, answered count, fail %, avg legs, fork %)
- Markdown summary: `phantom_contacts_dialer_only.md`
- Raw 22-day inbound CDR (the same CSV your portal generated for me on request ID `7b348436-1244-46ad-b8f0-cfccb6661975`)

This is now a SEV1 from our side. ~30% of incoming candidate touchpoints — recruiter return-calls, follow-ups, scheduled calls — are being lost. Every day it persists, we lose business. Happy to get on a call with engineering today or tomorrow if it would help unblock this.

Thanks,
Abdulla Sheikh
ApTask
abdulla@aptask.com
