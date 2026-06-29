# Telnyx Call Control setup — Phase 5.4 rebuild

This is the one-time portal config that makes server-side **Transfer**, **Add
Call**, **Merge**, and **Record** work in ACE Dialer 2.0.

The architecture: the WebRTC SDK still handles Leg A's audio (between the
user's browser and Telnyx). Everything else — dialing Leg B, transferring,
bridging legs, starting recordings — happens server-side via Telnyx Call
Control. For that to work, every leg the user originates needs to fire
`call.initiated` / `call.answered` webhooks so we can capture its
`call_control_id`.

## What to configure

### 1. Create (or reuse) a Call Control Application

Telnyx Portal → **Voice → Programmable Voice → Call Control Apps → +**

- **Name**: `ACE Dialer` (anything)
- **Webhook URL**: `https://ace-dialer-webhooks.onrender.com/webhooks/telnyx/calls`
- **HTTP method**: POST
- **Failover URL**: blank is fine
- **Webhook API version**: **API v2** (default)
- **Outbound**: pick the same Outbound Voice Profile your DID uses
  (`+1 732 200 1305`)

Save. Copy the **App ID / Connection ID** from the app's detail page —
you'll paste it into `TELNYX_CC_CONNECTION_ID` (next section).

### 2. Link your SIP Connection to the Call Control App

This is the toggle that makes webhooks fire for **WebRTC SDK calls** (without
it, only server-originated calls get `call_control_id`).

Telnyx Portal → **Voice → SIP Trunking → My SIP Connections →
\<your dialer connection\>**

- Open the connection
- Under **Voice Settings → API/Integration**: set **Webhook Setting** to
  point at the same `/webhooks/telnyx/calls` URL above
- Under **Voice Settings → Voice Settings**: set the **Inbound** and
  **Outbound** webhook setting to **API v2 (Call Control)**

Save. From now on, every call this connection originates or receives — SDK
or otherwise — will fire `call.initiated` and `call.answered` webhooks.

### 3. Render env vars (apps/api + apps/webhooks)

Set these on both services and redeploy:

| Var | Where to find it | Used by |
|---|---|---|
| `TELNYX_API_KEY` | Portal → API Keys → V2 | api, webhooks |
| `TELNYX_CC_CONNECTION_ID` | The App ID from step 1 | api (for `/calls/add-leg`) |

### 4. Verify

After the next call:

1. Render `ace-dialer-webhooks` logs should show
   `[telnyx] call event { eventType: 'call.initiated', ... }` followed by
   `call.answered`.
2. In the browser DevTools console: `[sip] resolved callControlId <...>` —
   means the frontend successfully picked the id off the API.
3. Tap **Transfer** mid-call → another phone — that leg should hang up and
   the third party should ring through to the transfer target.
4. Tap **Add Call** mid-call → dial a third number → when they answer, all
   three parties should hear each other (auto-bridge fires from the webhook).

## How the new flow works (architecture)

```
Browser  ───WebRTC───►  Telnyx SIP Conn  ◄── Call Control API ──  apps/api
   │                      │                        │
   │                      │  call.initiated        │
   │                      └─────►  webhooks  ──────┘
   │                                  │
   │                                  │  POST /v2/calls (Add Call)
   │                                  ▼
   │                            Leg B (PSTN dial)
   │                                  │
   │                                  │  call.answered + client_state
   │                                  ▼
   │                          webhooks reads client_state,
   │                          auto-issues bridge action
   │                                  │
   └◄──── mixed audio (3-way) ────────┘
```

- **Transfer**: `InCall.tsx` calls `transferCall(to)` → SipContext hits
  `POST /calls/<telnyxCallId>/transfer { to }` → API looks up
  `callControlId` and calls `POST /v2/calls/<cc_id>/actions/transfer`.
- **Add Call**: `Dialpad.tsx` (addCall mode) calls `addCall(number)` →
  SipContext hits `POST /calls/add-leg { legATelnyxCallId, destination }` →
  API originates Leg B via `POST /v2/calls` with a base64 `client_state`
  containing `{ bridgeTo: <legA_cc_id>, autoBridge: true }`.
- **Auto-bridge**: when Leg B's `call.answered` webhook arrives, the
  webhooks service decodes `client_state`, sees `bridgeTo`, and issues
  `POST /v2/calls/<legA>/actions/bridge { call_control_id: <legB> }`.
- **Merge** button: now informational — the bridge already fired. We still
  call `/calls/conference` as belt-and-suspenders; Telnyx returns 409
  ("already bridged") which we treat as success.

## Troubleshooting

**Frontend logs `callControlId never arrived — webhook not firing?`**
→ Step 2 isn't done. The SIP Connection is still in plain
"Credentials/Trunking" mode without API v2. Re-check the Voice Settings
toggle.

**`/calls/add-leg` returns `TELNYX_CC_CONNECTION_ID not set`**
→ Set the env var on `ace-dialer-api` (Render → ace-dialer-api → Environment).

**Transfer succeeds but the user stays on the call**
→ This is expected for `blind transfer` — Telnyx drops the WebRTC leg and
connects the original third party directly to the transfer target. The
user's `call.hangup` should fire shortly after.

**Recording returns 409 "No callControlId"**
→ Same as the first one. Webhook hasn't populated the field; the SIP
Connection isn't CC-linked.
