# ACE Dialer 2.0

The new ACE Dialer backend for ApTask. Replaces the dialer-relevant parts of Pulse.

## Architecture

Three small Node.js (TypeScript) services in this monorepo:

| Service | What it does |
| --- | --- |
| `apps/api` | HTTP API — login, chat, voicemail, JobDiva, AI suggestions, uploads |
| `apps/socket` | Real-time WebSocket — chat events, call-state fan-out |
| `apps/webhooks` | Telnyx webhook receiver — call.* and message.* events |

All three deploy to Render. The database is Supabase Postgres; the cache is Upstash Redis.

## Local Development

Requires Node.js 20+.

```bash
npm install
npm run dev -w apps/api       # API on http://localhost:3000
npm run dev -w apps/socket    # Socket on http://localhost:3001
npm run dev -w apps/webhooks  # Webhooks on http://localhost:3002
```

A `GET /health` on any service returns `{"status":"ok", ...}` once running.

## Deployment

Auto-deployed to Render on every push to `main`. See `render.yaml` — Render reads it and provisions three web services.

## Environment Variables

See `.env.example` for the full list. Set them in the Render dashboard under each service's "Environment" tab (never commit them to the repo).

## Project Status

This is **Phase 0** — the foundation. Subsequent phases add real features (see the Project Workbook in the project folder).
