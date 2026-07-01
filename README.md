# ACE Dialer 2.0

ApTask's in-house softphone replacing the dialer features of Pulse. WebRTC-based,
runs in a browser tab or a packaged Electron desktop app. Calls + SMS via Telnyx,
voicemail transcription via Deepgram, Microsoft Teams notifications via Power
Automate, Microsoft SSO via Entra ID.

**Current release:** v0.10.8 (May 28, 2026)

## Quick links

- **[Features](docs/features.md)** — full list of what users get
- **[User onboarding](docs/user-onboarding.md)** — share with new users on day one
- **[Admin runbook](docs/admin-runbook.md)** — add users, manage DIDs, watch logs, troubleshoot
- **[Changelog](docs/changelog.md)** — per-release notes from v0.10.0 onward
- **[Welcome email template](docs/email-template.md)** — what new users receive when invited
- **[Multi-user setup notes](docs/multi-user-setup.md)** — legacy doc from Phase 5.7, kept for historical context
- **[Telnyx setup notes](docs/telnyx-call-control-setup.md)** — initial Telnyx connection wiring

## Architecture

Monorepo with four Node.js (TypeScript) services + one Electron desktop app:

| Workspace | What it does | Hosted |
| --- | --- | --- |
| `apps/api` | HTTP API — auth (MS SSO + password), users, calls, messages, voicemails, admin, /me endpoints | self-hosted (pm2 `ace-api`, :3000) |
| `apps/socket` | Real-time WebSocket — chat events, call-state fan-out | self-hosted (pm2 `ace-socket`, :3001) |
| `apps/webhooks` | Telnyx webhook receiver — call.*, message.*, voicemail.* events; fires Teams notifications | self-hosted (pm2 `ace-webhooks`, :3002) |
| `apps/web` | React + Vite SPA — the dialer UI | self-hosted (pm2 `ace-web` static SPA, :3010) |
| `apps/desktop` | Electron wrapper around the web app — auto-update + tray + custom protocol handler | GitHub Releases |
| `packages/db` | Prisma schema + migrations + generated client | shared |

All server apps run **self-hosted** on the `dialer.aptask.com` host under pm2
(`ecosystem.config.cjs`), behind an nginx reverse proxy. Database: **self-hosted
PostgreSQL** (local to the app host). Voice/SMS: Telnyx (Credential Connections
per user, single Messaging Profile, TexML for inbound voicemail). Auth: Microsoft
Entra ID (via MSAL + PKCE) + break-glass local password for admin. TURN:
Cloudflare (symmetric-NAT failover) + Telnyx default. Object storage for uploaded
media currently uses Supabase `ace-media` (being migrated off).

## Local development

Requires Node.js 20+.

```bash
npm install

# regenerate Prisma client + DB types (run after schema changes)
npm run db:generate

# four services, four terminals
npm run dev -w apps/api        # HTTP API on http://localhost:3001
npm run dev -w apps/socket     # WebSocket on http://localhost:3002
npm run dev -w apps/webhooks   # Telnyx webhooks on http://localhost:3003
npm run dev -w apps/web        # Vite dev server on http://localhost:5173

# Electron desktop pointed at local Vite
cd apps/desktop
npm run dev   # opens with VITE_DEV_SERVER_URL=http://localhost:5173
```

`apps/web/.env` controls which API URL the web client talks to in dev. The
example points at the production API (`https://dialer.aptask.com/api`); change to
`http://localhost:3001` if you're running the API locally.

## Deployment

Server side is **self-hosted** on the `dialer.aptask.com` host — there is no
push-to-deploy CI for the backend/web. Deploy by running the one-shot script on
the host:

```bash
./deploy.sh            # git pull + npm install + prisma generate + build + pm2 startOrReload
./deploy.sh --no-pull  # build/reload local changes without pulling
```

This rebuilds all four apps and reloads them under pm2 (`ace-api`, `ace-socket`,
`ace-webhooks`, `ace-web`) from `ecosystem.config.cjs`. Env comes from the
repo-root `.env` via Node `--env-file`.

Desktop is the only GitHub-Actions/Releases path:

| Trigger | What happens |
| --- | --- |
| `v*` tag / manual `package:*:publish` | GitHub Actions (`build-desktop.yml`) builds + publishes desktop installers to GitHub Releases; clients auto-update |

There is **no staging environment** — the host is production. Desktop releases
are gated behind the tag/publish step, so the desktop side can lag behind
web/API if you don't publish.

## Environment variables

All vars live in the **repo-root `.env`** on the host (loaded via Node
`--env-file`; see `ecosystem.config.cjs`). `.env.example` is the canonical list
of supported vars. Critical ones:

| Service | Var | Purpose |
| --- | --- | --- |
| api, webhooks | `DATABASE_URL` | Self-hosted PostgreSQL connection string (`…@127.0.0.1:5432/acedialer`) |
| api | `JWT_SECRET` | Signs the user JWT tokens |
| api | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID` | MS SSO |
| api | `MICROSOFT_CLIENT_SECRET` | MS SSO confidential client secret |
| api | `JOBDIVA_*` | JobDiva contact lookup |
| api, webhooks | `TELNYX_API_KEY` | Voice/SMS calls + audio fetch |
| api, webhooks | `TEAMS_TENANT_WEBHOOK_URL` | Tenant-wide Power Automate flow URL |
| api, webhooks | `WEB_BASE_URL` | Public app URL `https://dialer.aptask.com` (used in Teams card deep-links) |
| webhooks | `DEEPGRAM_API_KEY` | Voicemail transcription |
| webhooks | `PILOT_TELNYX_NUMBER` | Fallback DID when webhook event can't be routed |
| webhooks | `PILOT_USER_ID` | Fallback userId for unroutable events |

## Project Status

**Phase 0–6:** Foundation, multi-user, MS SSO, JobDiva, voicemail, blocking,
Pulse migration tooling — all complete.

**Phase 7 — Pillar 1 + 2 (v0.10.0–v0.10.8):** Multi-DID support, Teams
notifications, voicemail playback page, Electron deep-link handlers. **Shipped.**

**Next phases:**

- **Pillar 3 — Ring Groups** (multi-agent inbound routing)
- **Pillar 4 — IVR** (caller-selected DTMF routing)

See `docs/features.md` for the full capability list.
