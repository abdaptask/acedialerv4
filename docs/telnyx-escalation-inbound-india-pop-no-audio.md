# Telnyx escalation — inbound calls anchored on India POP (103.115.244.x) deliver no audio

**Account:** ApTask (ACE Dialer)
**Contact:** brijeshb@aptask.com
**Date raised:** 2026-07-01
**Severity:** High — affects inbound call audio for India-based agents

## Summary

Inbound calls whose media is anchored on your **India POP (`103.115.244.x`)**
complete ICE and DTLS on our WebRTC client but deliver **no audio** to the
agent. The **same agent's outbound calls**, which anchor on your US FreeSWITCH
nodes (`50.114.x`), work perfectly. This is reproducible across multiple
India-based agents and correlates only with the inbound media node, not with
the client, its network, or its TURN configuration.

We use JsSIP over `wss://sip.telnyx.com:7443` (Credential Connections, one per
user), with Cloudflare TURN layered on top of your STUN/TURN. The client-side
WebRTC negotiation looks fully healthy on the failing calls (relay candidate
present, ICE `connected`, DTLS `connected`, remote audio track attached).

## Reproduction (one affected agent)

- **Agent SIP username (Credential Connection):** `aceroshniy8aru5`
- **Agent DID (called number):** `+14706168494`
- **Agent network:** India — public IPv4 `103.197.75.2`, IPv6 `2402:e280:3e8f:1d7::/64`
- **Client:** ACE Dialer desktop (Electron/Chromium 126), WebRTC + JsSIP

### Failing inbound calls (no audio) — 2026-07-01

| # | Time (UTC) | Telnyx media node (from your SDP `c=`/`o=`) | Telnyx SDP o-line | Telnyx ice-ufrag |
|---|---|---|---|---|
| 1 | ~18:49:11 – 18:49:33 | `103.115.244.172` | `o=Telnyx 1782900427 1782900428` | `TikEtfIYsypxCI5a` |
| 2 | ~18:49:39 – 18:49:59 | `103.115.244.175` | `o=Telnyx 1782909255 1782909256` | `3M1om1NSa21alWZE` |

On both, our client:
- Gathered a **TURN relay** candidate (Cloudflare, e.g. `104.30.136.130`) plus srflx (`103.197.75.2`) and host.
- Reached `iceConnectionState: connected` and `connectionState: connected` (so **DTLS-SRTP completed**).
- Attached the remote audio track.
- **Agent heard nothing.**

Your inbound offer on these legs used profile `RTP/SAVPF` with `a=setup:actpass`
and only host candidates on `103.115.244.x`; we answered `a=setup:active`.

### Working outbound call (audio fine) — same agent, moments later

- ~18:50:04 UTC, agent dialed `+13218483300`.
- Media anchored on **US FreeSWITCH `50.114.144.11`**.
- Same client, same relay, same network → **audio worked normally.**

The only variable that changed between "no audio" and "works" is the **Telnyx
media node** (India `103.115.244.x` inbound vs US `50.114.x` outbound).

## Secondary symptom (same inbound legs)

On these inbound legs our client never receives a `call_control_id` — i.e. the
inbound leg does not appear to generate Call Control webhook events, even though
**outbound** legs on the same Credential Connection resolve their
`call_control_id` normally. This suggests inbound calls on this path may be
handled/anchored differently.

## What we've ruled out

- **TURN / NAT:** the failing calls have a working relay candidate and reach ICE
  `connected`; a prior wave of no-audio reports (before we added Cloudflare TURN)
  is now resolved for outbound and for many users — but inbound on the India POP
  still fails.
- **Client media wiring:** the remote track attaches and playback starts; the
  identical client + code path works for outbound.
- **DTLS:** `connectionState: connected` confirms the DTLS-SRTP handshake
  completed bidirectionally.

## Questions / requests for Telnyx

1. For the two inbound legs above, please provide your **RTP send/receive
   counters** (packets/bytes each direction) at the `103.115.244.x` media node.
   Did your side send RTP toward our relay, and did it receive ours?
2. Why would an inbound leg anchored on `103.115.244.x` complete ICE+DTLS but not
   exchange RTP media, when the same client's outbound via `50.114.x` works?
3. Is inbound media for our Credential Connections being **mis-anchored or
   blackholed** at the India POP? Can inbound be anchored on a known-good
   (e.g. US) media node instead?
4. Why do **inbound** legs on this connection not generate Call Control events
   (`call_control_id`) while outbound legs do?
5. Is there a known issue with the `103.115.244.x` POP and WebRTC/`RTP/SAVPF`
   inbound media?

## How to correlate on your side

Look up by the agent DID `+14706168494` and SIP user `aceroshniy8aru5` around
2026-07-01 18:49 UTC, or by the Telnyx SDP session ids in the table above. We
can provide full client-side SDP + ICE logs on request.
