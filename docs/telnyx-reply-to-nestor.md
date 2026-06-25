**To:** Nestor L <support@telnyx.com>
**From:** abdulla@aptask.com
**Subject:** Re: ESCALATION — ApTask account `a8c26837-...` — confirmations + fresh test call window

---

Hi Nestor,

Thanks for the detailed framing and for engineering pulling on the multi-leg analysis. Your five confirmation points below, with evidence:

# Your five confirmation questions

## 1. The WebRTC/SIP client is actively registered and online

**Yes.** Saifali's most recent client log shows a continuous register cycle:

- WebSocket connects to `wss://sip.telnyx.com:7443` as `acesaifali1b0npa`
- `REGISTER` succeeds with status 200, header `contacts-at-telnyx=1`
- Force-register fires every 15s (our keep-alive to fight silent eviction)
- Full re-register every 60s (manual UA tear-down + reconnect to refresh the contact entry)

Sample log lines (from `ace-dialer-logs-saifalin@aptask.com-v0.10.192-2026-06-22T13-24-36.txt`):

```
2026-06-22T13:15:02.063Z [sip] registered (status=200, expires=(none), contacts-at-telnyx=1)
2026-06-22T13:15:02.063Z [sip] v0.10.80: only 1 contact at Telnyx — skipping wildcard wipe (nothing stale)
2026-06-22T13:15:15.350Z [sip] 30s force-register skipped — active call
2026-06-22T13:15:30.357Z [sip] 15s force-register fired
...
```

Same pattern across all 59 dialer users. None of them experience registration loss or extended offline periods.

## 2. The client is able to receive inbound SIP INVITEs

**Yes.** When the routing succeeds on the first leg, the client receives the INVITE and answers cleanly. Per the same CDR you reviewed, ~28% of inbound calls account-wide DO reach NORMAL_CLEARING with a delivered leg. The dialer is wired correctly to receive inbound — the problem is that the routing tries to deliver via legs that return errors before the successful leg fires.

## 3. The registered contact is current and reachable

**Yes per REGISTER 200 response.** Our REGISTER OK consistently reports `contacts-at-telnyx=1` — a single fresh contact. We do not see stale-contact warnings from JsSIP. We do not see any indication on our side that there are multiple contacts registered against `acesaifali1b0npa`.

This is where the picture gets unclear: REGISTER says 1 contact, CDR shows 3-5 routing attempts. That mismatch is what we'd like engineering to look at on the server side. We cannot inspect Telnyx's routing-layer contact view from the client.

## 4. The client/application is NOT rejecting inbound INVITEs with SIP 404/503

**This is the question I want engineering's interpretation on.** Possible scenarios on our side:

- **a)** JsSIP auto-accepts every INVITE whose Request-URI matches the registered AOR. INVITEs with a mismatched Request-URI form (slightly different SIP user-part, different domain, etc.) would be 404'd by JsSIP automatically. We don't currently log every received-and-rejected INVITE on the client side — JsSIP handles those at the transport layer silently.
- **b)** We do NOT have any application-level logic that returns 503 — that would have to come from the transport/JsSIP layer, indicating a network or resource issue.
- **c)** It is possible the multi-leg attempts in the CDR are Telnyx retrying the same INVITE with slightly different Request-URI forms (e.g., trying both `sip:acesaifali1b0npa@sip.telnyx.com` and a stored older form), and only the form matching our current registration succeeds. That would explain 4 × 404 + 1 × 200 per call.

**Can you confirm from your side**: when Telnyx attempts to route an INVITE for `acesaifali1b0npa`, what Request-URI(s) does the routing layer try? If multiple URIs are being tried per call attempt, that's the most likely explanation of the multi-leg CDR pattern — and we can verify on our side whether all the URI variants Telnyx is trying still match our active registration.

## 5. Fresh inbound test call timestamp

**Proposed window: tomorrow 2026-06-25 between 14:00 – 17:00 UTC.** I will:

1. Verify saifali's client is registered and online (will share his client log timestamp at test start).
2. Have a US PSTN caller place 3 inbound test calls to his DID `+17325320337`.
3. Send the exact call timestamps, expected vs actual outcome per call, and his client log immediately after the test window.

This gives you a clean test set you can correlate against the same call_uuids in the Telnyx CDR / SIP trace.

If you'd prefer a different window or want to instrument the test in a specific way (different caller numbers, different time spacing, etc.), let me know — I'd rather get the test design right on the first try than have to repeat it.

---

# New finding — per-DID media routing failure (worth engineering's eyes alongside the SIP forking review)

While we wait on the SIP investigation, we observed a second platform-level issue yesterday (2026-06-24) on a different user. Worth flagging because it's a distinct failure family — media path rather than SIP routing — that may share the same root cause family.

**User:** roshni (India endpoint). Two DIDs on her dialer:
- `+14706168494` (470 area)
- `+13216410795` (321 area)

**Three test calls within 12 minutes, same machine, same network:**

| # | Direction | Her DID | Outcome |
|---|---|---|---|
| 1 | Outbound to US PSTN | `+14706168494` | **Zero audio, both directions** |
| 2 | Outbound to US PSTN | `+13216410795` | **Clean audio** |
| 3 | Inbound from US PSTN | `+13216410795` | **5 seconds of audio, then silent both ways** |

Client logs show identical successful WebRTC wiring on all three calls — track event fires, srcObject attached, `iceConnectionState: connected`, `connectionState: connected`. The variable that determines whether audio actually flows is which DID is in use, not anything client-side.

**Questions for engineering on this (lower priority than the SIP routing, but related):**

- What anchor sites are `+14706168494` and `+13216410795` routed through? Are they different?
- For `+14706168494` specifically: is there a known media-path issue on whatever anchor / transcoder pool it lands on?
- Can engineering move `+14706168494` to the same anchor/route as `+13216410795` as an immediate workaround?

---

# Additional diagnostic options we can run

- **Add client-side INVITE-rejection logging.** We can deploy a debug build that logs every INVITE received-and-rejected by JsSIP including the Request-URI of each, so we can verify on our side whether Telnyx is sending us INVITEs we're rejecting due to URI mismatch. ~1 day to ship.
- **TCPDUMP / wireshark capture from saifali's endpoint** during the fresh test, if that would help engineering correlate the SIP traces. Just say the word and we can arrange.
- **Live call** with engineering. Happy to get on a Zoom/Google Meet for the fresh test if it would speed up the diagnosis loop.

# Asks before the test

- Internal ticket reference number for ongoing tracking
- Confirmation the test window 2026-06-25 14:00–17:00 UTC works for engineering to monitor on their side
- Any specific request URI / connection state you want us to inspect before the test

Looking forward to running the fresh test against the corrected routing state.

Thanks,
Abdulla Sheikh
ApTask
abdulla@aptask.com
