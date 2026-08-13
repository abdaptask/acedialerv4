# ACE Dialer 2.0

ApTask's in-house softphone replacing the dialer features of Pulse. WebRTC-based,
runs in a browser tab or a packaged Electron desktop app. Calls + SMS via Telnyx,
voicemail transcription and SMS dictation via Deepgram, Microsoft Teams
notifications via Microsoft Graph, Microsoft SSO via Entra ID.

**Current release:** v0.10.221 (August 13, 2026)

## Quick links

- **[Project state](PROJECT_STATE.md)** — living snapshot: what's deployed, open tasks, recent learnings. Read this first.
- **[Architecture blueprint](CLAUDE.md)** — per-module contract for every part of the system (29 modules, capabilities → guardrails)
- **[Features](docs/features.md)** — capability list (last refreshed at v0.10.192)
- **[User onboarding](docs/user-onboarding.md)** — share with new users on day one
- **[Admin runbook](docs/admin-runbook.md)** — add users, manage DIDs, watch logs, troubleshoot
- **[Changelog](docs/changelog.md)** — per-release notes through v0.10.23. Newer releases are recorded in `PROJECT_STATE.md`, and user-facing notes in `apps/web/src/data/whatsNew.ts`.
- **[Welcome email template](docs/email-template.md)** — what new users receive when invited
- **[Multi-user setup notes](docs/multi-user-setup.md)** — legacy doc from Phase 5.7, kept for historical context
- **[Telnyx setup notes](docs/telnyx-call-control-setup.md)** — initial Telnyx connection wiring

## Architecture

Monorepo with three Node.js (TypeScript) services, a React SPA, an Electron
desktop app, and a browser extension:

| Workspace | What it does | Hosted |
| --- | --- | --- |
| `apps/api` | HTTP API — auth (MS SSO + password), users, calls, messages, voicemails, favorites, blocking, forwarding, internal chat, JobDiva, admin, /me endpoints | self-hosted (pm2 `ace-api`, :3000) |
| `apps/socket` | Socket.IO service — stub today (ping/pong); real-time fan-out is planned, everything still polls | self-hosted (pm2 `ace-socket`, :3001) |
| `apps/webhooks` | Telnyx webhook receiver — call.*, message.*, voicemail.* events; multi-user routing, blocked-caller reject, Teams notifications | self-hosted (pm2 `ace-webhooks`, :3002) |
| `apps/web` | React + Vite SPA — the dialer UI | self-hosted (pm2 `ace-web` static SPA, :3010) |
| `apps/desktop` | Electron wrapper around the web app — auto-update, tray, floating ringer, `ace-dialer://` protocol handler, click-to-dial | GitHub Releases |
| `apps/extension` | MV3 browser extension — finds phone numbers on ATS/CRM pages and hands them to the desktop app. Per-domain permissions only, granted on its options page | side-loaded (not store-published) |
| `packages/db` | Prisma schema + generated client, shared by `api` and `webhooks` | shared |

All server apps run **self-hosted** on the `dialer.aptask.com` host under pm2
(`ecosystem.config.cjs`), behind an nginx reverse proxy (`/api/*` → :3000,
`/webhooks/*` → :3002, everything else → the SPA). Database: **self-hosted
PostgreSQL** (local to the app host). Voice/SMS: Telnyx (Credential Connections
per user, single Messaging Profile, Hosted Voicemail for inbound). SIP: JsSIP
over `wss://sip.telnyx.com:7443` — one `RTCSession` per call, which is what makes
multi-call, swap, and 3-way conference possible. Auth: Microsoft Entra ID
(PKCE) + break-glass local password for admin. TURN: Cloudflare (symmetric-NAT
failover) + Telnyx default. AI: Deepgram for transcription, self-hosted Qwen via
Ollama for SMS rewrite. Object storage for uploaded media currently uses Supabase
`ace-media` (being migrated off).

## Local development

Requires Node.js 20+.

```bash
npm install

# regenerate Prisma client + DB types (run after schema changes)
npm run db:generate

# everything at once (api + socket + webhooks + web + desktop)
npm run dev:all

# …or one service per terminal
npm run dev:api        # HTTP API       on http://localhost:3001
npm run dev:webhooks   # Telnyx sink    on http://localhost:3002
npm run dev:socket     # Socket.IO      on http://localhost:3003
npm run dev:web        # Vite dev server on http://localhost:5173
npm run dev:desktop    # Electron, VITE_DEV_SERVER_URL=http://localhost:5173
```

Dev ports deliberately differ from production (`:3000/:3001/:3002`) so a local
run can't collide with the pm2 services if you're working on the host.

`apps/web/.env` controls which API URL the web client talks to in dev. The
example points at the production API (`https://dialer.aptask.com/api`); change to
`http://localhost:3001` if you're running the API locally.

Tests use Node's built-in runner:

```bash
npm test -w apps/web
npm test -w apps/extension
```

## Deployment

Server side is **self-hosted** on the `dialer.aptask.com` host — there is no
push-to-deploy CI for the backend/web. Deploy by running the one-shot script on
the host:

```bash
./deploy.sh            # git pull + npm install + prisma generate + build + pm2 startOrReload
./deploy.sh --no-pull  # build/reload local changes without pulling
```

This rebuilds the apps and reloads them under pm2 (`ace-api`, `ace-socket`,
`ace-webhooks`, `ace-web`) from `ecosystem.config.cjs`. Env comes from the
repo-root `.env` via Node `--env-file`.

> **On the host, building the web bundle IS a production deploy.** pm2's
> `ace-web` serves `apps/web/dist` straight off disk, so `npm run build -w
> apps/web` publishes to every web user the moment it finishes — even if you only
> meant to typecheck. To verify a build without shipping it, build to a scratch
> directory: `cd apps/web && npx vite build --outDir /tmp/webcheck --emptyOutDir`.
>
> Always build the real bundle with `VITE_FORCE_ABSOLUTE_BASE=1` (what
> `deploy.sh` does). Vite's default relative base is correct for Electron's
> `file://` load and wrong for the SPA — without it, nested routes like
> `/settings/:section` and the SSO callback resolve their assets against the
> wrong path and render blank.

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
| api | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | User-facing Microsoft SSO. `/auth/microsoft/exchange` returns 501 if any is missing |
| api, webhooks | `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_REDIRECT_URI` | Teams notifications — the `acebot@aptask.com` service account's Graph app |
| api | `JOBDIVA_*` | JobDiva contact lookup |
| api, webhooks | `TELNYX_API_KEY` | Voice/SMS calls + audio fetch |
| webhooks | `WEBHOOKS_PUBLIC_URL` | Public webhooks URL. Telnyx `voice_url` is re-patched from this on every boot — never hand-edit it in the Telnyx portal |
| webhooks | `WEB_BASE_URL` | Public app URL `https://dialer.aptask.com` (used in Teams card deep-links) |
| api, webhooks | `DEEPGRAM_API_KEY` | Voicemail transcription (webhooks) + SMS voice-to-text (api) |
| api | `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL` | SMS AI rewrite. Defaults to self-hosted Qwen via Ollama; unset ⇒ the endpoint 501s and the button hides |
| api | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET` | MMS attachments, voicemail greetings (migration off Supabase in progress) |
| api | `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | TURN relay — required for inbound audio on symmetric-NAT networks |

## Project Status

**Phase 0–6:** Foundation, multi-user, MS SSO, JobDiva, voicemail, blocking,
Pulse migration tooling — all complete.

**Phase 7 — Pillar 1 + 2 (v0.10.0–v0.10.8):** Multi-DID support, Teams
notifications, voicemail playback page, Electron deep-link handlers. **Shipped.**

**Since (v0.10.9–v0.10.221):** JsSIP migration (unlocking add-call, swap, hold &
accept, 3-way conference, blind transfer), server-synced favorites, internal
chat, call forwarding, 30-day Pulse backfill, Microsoft Graph Teams cards, SMS
composer assists (templates, dictation, AI rewrite, segment counter), compose
drafts, and click-to-dial across `tel:` links, a clipboard hotkey, and the
browser extension. **Shipped.**

**Next phases:**

- **Pillar 3 — Ring Groups** (multi-agent inbound routing)
- **Pillar 4 — IVR** (caller-selected DTMF routing)
- **Realtime socket** — `apps/socket` is still a stub; badges, chat, and the
  voicemail inbox all poll. Replace one feature at a time.
- **EV/OV code-signing cert** — Windows installer signing is bypassed today

See `PROJECT_STATE.md` for what's currently deployed and `CLAUDE.md` for the
per-module architecture.
