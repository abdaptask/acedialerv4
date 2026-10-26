---
name: investigate-user-issue
description: Diagnose an ACE Dialer problem a specific user reported — missing calls, stuck sign-in, one-way audio, texts not arriving, wrong version — from the database, Telnyx and pm2 logs, read-only. Use when the user says someone "can't", "isn't getting", "doesn't see", or pastes a user's complaint.
argument-hint: "<user email> <symptom>"
---

# Investigate a user's issue

Read-only until the cause is known. Gather evidence, state the cause with the
evidence behind it, then propose a fix and wait.

## 0. Setup

```bash
cd /home/aptask/app/acedialerv4
DB=$(grep -E '^DIRECT_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
q() { psql "$DB" -X -A -F ' | ' -c "$1"; }
```

Never print secrets from `.env` (Telnyx key, SIP passwords, JWT secret). Never
paste message bodies, transcripts, or SIP passwords into the chat — counts,
timestamps, statuses and last-4 digits are enough.

## 1. Who and what are they running

```sql
SELECT id, email, is_active, is_admin, sip_username, did_number, last_login_at FROM users WHERE lower(email)=lower('<email>');
SELECT platform, app_version, last_seen_at FROM user_devices WHERE user_id=<id> ORDER BY last_seen_at DESC LIMIT 5;
SELECT did_number, is_default, connection_id FROM user_dids WHERE user_id=<id>;
```

An old `app_version` explains a lot — compare to abdulla's (user id 1), which
is the live shipped version.

## 2. Pick the branch by symptom

**Calls missing from Recents / "missed call never showed"**
Inbound rows come ONLY from Telnyx webhooks. Check where their credential
connection sends events:
```bash
KEY=$(grep -E '^TELNYX_API_KEY=' .env | cut -d= -f2- | tr -d '"')
curl -sg -H "Authorization: Bearer $KEY" "https://api.telnyx.com/v2/credential_connections?filter[user_name]=<sip_username>" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const c of JSON.parse(s).data)console.log(c.id,c.user_name,c.webhook_event_url)})'
```
Must be `https://dialer.aptask.com/webhooks/telnyx/calls`. Anything on
`onrender.com` is the dead Render host — that's the cause. Never touch a
connection whose user isn't an active ACE user (those are Pulse users).
Then: `SELECT direction, status, started_at, session_id IS NOT NULL AS from_webhook FROM calls WHERE user_id=<id> ORDER BY started_at DESC LIMIT 20;`
— client-only rows (`from_webhook` false) with no webhook twins point the same way.

**Stuck on sign-in / logged out / "Signing you in…"**
API log is tens of GB — never grep the whole file:
```bash
tail -c 300000000 ~/.pm2/logs/ace-api-out.log | grep -E '/auth/(microsoft|login|me)' | tail -30
```
Pull the `reqId`s and find their `request completed` lines for status codes.
Exchanges returning 200 while the user is stuck = client-side (routing,
return-to). 401s = `not_invited` / `account_disabled` / Entra config.
`SELECT action, created_at, metadata FROM audit_logs WHERE actor_user_id=<id> OR target_user_id=<id> ORDER BY created_at DESC LIMIT 20;`

**One-way / no audio**
`SELECT started_at, direction, rx_packets, tx_packets, avg_loss_pct, hangup_cause, sip_hangup_cause FROM calls WHERE user_id=<id> AND answered_at IS NOT NULL ORDER BY started_at DESC LIMIT 20;`
`rx_packets = 0` on a connected call ≥5s = they heard nothing. Known causes:
no TURN relay on their network (Cloudflare TURN is configured — check the
client build has it), and Telnyx India-POP inbound media, which is
Telnyx-side. Null packet counts = build predates quality capture.

**Texts not arriving / not sending**
`SELECT direction, status, errors, created_at FROM messages WHERE user_id=<id> ORDER BY created_at DESC LIMIT 20;`
Map `errors` codes through `apps/api/src/reports/textReasons.ts`. Check the
sender isn't on their blocklist (`blocked_numbers`) and the other party hasn't
opted out (a STOP inbound).

**Teams card / email notification missing**
`tail -c 200000000 ~/.pm2/logs/ace-webhooks-out.log | grep -E '\[(teams|email)\]' | grep -i '<email or last-4>' | tail`
Check `users.teams_notify_on` / `email_notify_on` for that event.

**Anything else**: `pm2 logs <svc> --lines 100 --nostream` for recent errors;
`git log --since=<when it started> --oneline` for a change that lines up.

## 3. Report

- **Cause**, one or two sentences, with the evidence (query result, log line,
  timestamp).
- **Who else is affected** — run the same check across active users when the
  cause is systemic (webhook URL, app version, a code bug).
- **Fix**: code change, config change, or "user needs to update/sign in
  again". Changes to Telnyx config or user rows are outward-facing — propose
  them and wait for a yes.
- If it's a code bug, fix it, then `/verify-web` or tests, `/ship-pr`, `/deploy`.
