# ACE Dialer — Admin Runbook

Day-to-day operational tasks for the dialer admin (currently abdulla@aptask.com).

## Adding new users

There are two paths depending on whether the user already has a Pulse / Telnyx
setup or you're starting from scratch.

### Path A — fresh user (no existing SIP creds)

Use this for net-new users — the system creates a fresh Telnyx Credential
Connection, buys a DID, sets up routing, and emails the user a welcome message
with the desktop installer link.

1. **Settings → Admin → Users → Invite new user**
2. Fill in:
   - Email (must match the user's Entra ID / Microsoft work account)
   - First + last name
   - Choose **"Create new Telnyx connection"** (auto-provisions everything)
   - Optionally pick a DID area code (default `732`)
3. Click **Invite**. The provisioning flow runs server-side — you'll see a
   step-by-step result. Each step shows ✓ or ✗:
   - Clone Telnyx connection from template
   - Assign or purchase DID
   - Set Caller ID Override (ani_override) to the new DID
   - Create User row in DB
   - Link UserDid row + mark as default
   - Send welcome email via SendGrid
4. Confirm all steps ✓. If any failed, expand the row to see the error.

The user receives an email with a link to dialer.aptask.com. On first
sign-in they hit MS SSO, get auto-provisioned in the DB (since their email is
in PendingUser), and land in the dialer.

### Path B — existing user (Pulse migration / CSV import)

For migrating Pulse users where the SIP credentials already exist in Telnyx:

1. Settings → Admin → **Pending Users → Import CSV**
2. Upload a CSV with columns: `email, firstName, lastName, pulseVoipExt,
   pulseExtPassword, pulseVoipNumber`
3. Each row creates a PendingUser entry. Users sign in via MS SSO; on first
   login the backend reuses their existing Telnyx SIP credentials and assigns
   the existing DID.

CSV file should NEVER be committed to git — it has plaintext SIP passwords. Add
to .gitignore and store outside the repo.

## Adding a second DID to an existing user

1. Settings → Admin → **Users**
2. Click the **⋯** menu on the user's row → **Manage lines**
3. The Manage Lines modal opens showing existing DIDs
4. Click **Add line**
5. Pick:
   - **Use an existing unassigned number** — dropdown shows DIDs in your
     Telnyx account that aren't tied to a user
   - **Buy a new number** — enter area code, Telnyx returns available
     numbers, pick one, it gets purchased + assigned
6. Optional: set label (e.g. "Sales"), color, mark as default
7. Click **Add line**

The new DID is bound to the user's existing Telnyx Credential Connection (same
SIP credentials handle both lines). Inbound calls/SMS to either DID ring the
same user. Outbound caller ID is set per-call by the user's DidSwitcher choice.

## Removing a DID from a user

1. Manage Lines modal → click the trash icon next to a non-default DID
2. Confirm in the dialog

The DID stays in Telnyx (it's not released — you can re-assign it to another
user later). The local UserDid row is deleted; if it was the active line the
user's active DID falls back to the default.

## Changing a user's default outbound line

1. Manage Lines modal → click **★ Default** next to a non-default DID
2. The new default takes effect immediately; old default no longer marked

This also runs `setConnectionCallerIdOverride` on Telnyx so outbound calls use
the new default's ani_override.

## Editing a line label or color

1. Manage Lines modal → click the pencil icon next to a line's label
2. Inline input appears — type the new label, hit Enter (or click outside)
3. Click the colored circle on the left of any line to open the color palette
4. Pick a new color

Changes propagate to all line badges (Recents, Messages, Voicemail) on next
list refresh.

## Disabling a user

1. Settings → Admin → Users → click the **⋯** menu on a user → **Deactivate**
2. The User row's `isActive` flag flips to false
3. The user's JWT is invalidated on next API call (401 → bounced to /login)
4. Future MS SSO attempts return "Your dialer account has been deactivated"
5. Inbound calls/SMS to their DID still arrive in Telnyx but are dropped at
   the API layer (no row created, no notification fired)

To **reactivate**, click ⋯ again → **Reactivate**. The user can sign in again
immediately.

## Watching logs

For ANY troubleshooting, the pm2 process logs on the `dialer.aptask.com` host
are your first stop (`pm2 logs <name>`, or `pm2 logs` for all):

| pm2 process | When to watch |
| --- | --- |
| ace-api | Login issues, admin endpoint errors, /me endpoints, voicemail audio proxy 502s |
| ace-webhooks | Inbound call / SMS / voicemail event routing, Teams card delivery (`[teams] missed-call sent`, `[teams] sms sent`, `[teams] voicemail sent`) |
| ace-socket | Real-time chat issues, presence state |

Filter logs by user by searching for `userId: <N>` or the user's email.
(pm2 also writes to `~/.pm2/logs/<name>-out.log` and `-error.log`.)

For desktop crashes:
- Windows: `%APPDATA%\ACE Dialer\logs\main.log`
- macOS: `~/Library/Logs/ACE Dialer/main.log`

For SIP / call quality issues, ask the user to take a screenshot of the call
quality meter (RTT + jitter shown in the call header).

## Microsoft Teams notifications — operational notes

### Power Automate flow
- Owner: abdulla@aptask.com
- Flow name: "ACE Dialer Tenant Webhook"
- URL: stored in `TEAMS_TENANT_WEBHOOK_URL` in the repo-root `.env` on the host (used by api + webhooks)
- View at: https://make.powerautomate.com → My flows → ACE Dialer Tenant Webhook
- Run history: 28-day rolling window. Click into any run to see the per-step
  inputs/outputs.

### Common Teams card issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| No card arrives | TEAMS_TENANT_WEBHOOK_URL not set | Check the repo-root `.env` on the host, then `pm2 restart ace-webhooks` |
| No card arrives, but webhook logs say `[teams] missed-call sent` | Flow failed at the action step | Open Power Automate run history → red step → fix |
| `GraphUserDetailNotFound` in run history | Recipient email doesn't match a Teams user in your tenant | Verify user has a Teams account; check user.email in DB |
| `InvalidBotRequestMessageBody` | Adaptive Card payload malformed | Check that card has `type: "AdaptiveCard"`, valid `body`, version `1.4` |
| Card arrives twice | Telnyx webhook retry firing same event | Should be deduped by v0.10.4 fix — if it recurs, check `[teams] missed-call already sent` log |
| User opted out — wants to re-enable | User: Settings → Personal → Teams notifications → check the toggles |

### Power Automate quota
- Default Microsoft 365 license: 1,000 runs / 24h / user (flow owner)
- 100 users × ~10 events/day = 1,000 runs/day — within limit
- If you start hitting the wall, the flow shows "throttled" in run history
- Increase quota by upgrading the owner's license OR splitting the flow across
  multiple owners (round-robin)

## Microsoft SSO — operational notes

### Entra ID app registration
- Owner: ApTask Microsoft 365 admin
- App name: ACE Dialer
- Redirect URI: `https://dialer.aptask.com/auth/microsoft/callback`
- Supported account types: Single tenant (ApTask only)
- API permissions: `User.Read` (delegated) — that's it
- Client secret: stored as `MICROSOFT_CLIENT_SECRET` in the repo-root `.env` on the host

### Common SSO issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| "SSO not configured on the server" on login screen | MICROSOFT_TENANT_ID or MICROSOFT_CLIENT_ID missing | Check the repo-root `.env` on the host, then `pm2 restart ace-api` |
| Microsoft redirect goes to wrong URL → 404 | Redirect URI in Entra doesn't match the app URL | Update redirect URI in Entra app registration to `https://dialer.aptask.com/auth/microsoft/callback` |
| "Your ApTask account hasn't been invited" | User's email is not in PendingUser table | Admin needs to add them via Invite new user OR CSV import |
| Microsoft hangs at "Stay signed in?" prompt | Conditional Access policy or MFA — normal | User completes the prompts |
| SSO callback page shows blank | nginx SPA rewrite eating JS chunks OR vite base path wrong | Web is built with `VITE_FORCE_ABSOLUTE_BASE=1` for absolute `/assets/*` paths — if it recurs, check the nginx SPA fallback + vite.config.ts base |

## Desktop releases

### Publishing a new desktop installer

The build workflow runs automatically on every push to main (when apps/web,
apps/desktop, or package.json paths change). It uses the version in
apps/desktop/package.json to tag the GitHub Release.

To force a fresh release with a higher version:

```powershell
# 1. Bump version in all 7 package.json files (root + workspaces)
# 2. Commit + push to main
# 3. The workflow publishes the release automatically
# 4. Optionally: git tag vX.Y.Z + git push origin vX.Y.Z to trigger
#    the workflow's tag-based path explicitly (redundant if step 2 already
#    triggered it)
```

### Auto-update flow on users' machines
- electron-updater checks GitHub Releases on app launch + every 60 min while
  running
- If a higher version exists, downloads the .exe / .dmg silently in background
- When download completes, sends `ace:update-downloaded` IPC to renderer
- UpdateBanner component shows "Restart to install" button
- User clicks → `app.quitAndInstall()` → installer runs → app relaunches

### Failed updates
- If electron-updater errors (download fail, signature mismatch, Windows
  installer rejected), UpdateBanner shows the error message
- User can manually download the installer from GitHub Releases and run it
- Update logs are in the user's app log folder (see "Watching logs" above)

## Cost / quota monitoring

Things worth eyeballing once a week:

- **Telnyx usage** — voice minutes + SMS volume + Hosted Voicemail seats + DIDs
  active. Telnyx portal → Reports → Usage.
- **Deepgram quota** — Nova-3 transcription is ~$0.0043/min. Voicemail volume is
  low so cost is minimal but worth knowing.
- **Host resources** — all services run under pm2 on the single dialer.aptask.com
  host; no idle hibernation. Watch CPU/RAM with `pm2 monit` and disk with `df -h`.
- **Power Automate run count** — see above.
- **PostgreSQL disk** — Calls and Messages tables grow continuously; monitor
  the local Postgres data directory (`df -h`) and plan retention/pruning as it grows.
- **Object storage** — uploaded media (MMS/greetings/hold music) is in Supabase
  `ace-media` today, being migrated off; watch that migration's target for capacity.

## Disaster recovery

### A service (pm2 process) down
- `pm2 list` on the host — look for a process not `online`
- The dialer's web app works (read-only) even when the API is down — users see
  cached data but new calls/SMS don't go through
- pm2 auto-restarts a crashed process; if it's stuck, `pm2 restart <name>`
  (or `./deploy.sh --no-pull` to rebuild + reload). Check `pm2 logs <name>` for the crash cause.

### Database down
- Check the local PostgreSQL service on the host (`systemctl status postgresql`)
- All API/webhooks/socket processes error out (DB connection failure)
- Restart Postgres if needed; the pm2 services reconnect once it's back

### Telnyx connection broken (user can't place/receive calls)
- Verify the user's SIP credential is still active in Telnyx portal
- Verify the DID is still assigned to the right Credential Connection
- Verify outbound voice profile is set on the connection
- Check the user's Cloudflare TURN connection if they're in India

### Mass user inability to log in
- Most likely cause: MS SSO config issue (client secret expired, Entra app
  disabled, redirect URI changed)
- Check `pm2 logs ace-api` for `[auth/microsoft/exchange]` errors
- Fallback: tell users to use the "Sign in with password (admin only)" link
  if they have a local password — but most don't, so this isn't a real
  recovery option for the whole team

### Lost main admin (abdulla@aptask.com locked out)
- A secondary admin user with isAdmin=true should exist as backup
- If no backup: direct SQL on the host (`psql "$DATABASE_URL"`) to flip another user to isAdmin=true:

```sql
UPDATE users SET is_admin = true WHERE email = 'someone-else@aptask.com';
```

## Emergency contacts

(Fill in as needed)

- Telnyx support: (insert ticket portal URL)
- Microsoft 365 admin: (ApTask IT)
- Host / infra: ApTask IT (self-hosted on dialer.aptask.com)
