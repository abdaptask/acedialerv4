#!/usr/bin/env bash
#
# ACE Dialer — self-hosted deploy script.
# Run ON the dialer server (172.16.46.50) as the `aptask` user.
#
#   bash deploy.sh
#
# What it does:
#   1. Pulls the target branch.
#   2. Installs deps (npm ci).
#   3. Generates Prisma client + pushes schema to the local Postgres.
#   4. Builds the three Node services (api, webhooks, socket).
#   5. Builds the web bundle with the RIGHT base path + API URL baked in.
#   6. (Re)starts all services under pm2.
#
# Web static files end up in apps/web/dist — nginx serves them directly
# (see nginx-dialer.conf). nginx routes /api -> :3000,
# /webhooks + /texml -> :3002, /socket.io -> :3001.
#
# Env: secrets live in the repo-root .env (untracked). pm2 loads them via
# ecosystem.config.cjs. The web build needs VITE_API_URL,
# which this script exports from that same .env.

set -euo pipefail

# --- resolve repo root (this file lives in the repo root) ---
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$REPO_DIR"
cd "$REPO_DIR"

BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> repo:   $REPO_DIR"
echo "==> branch: $BRANCH"

# --- .env must exist (holds DATABASE_URL, secrets, VITE_API_URL) ---
if [[ ! -f "$REPO_DIR/.env" ]]; then
  echo "ERROR: $REPO_DIR/.env not found. Copy your secrets there first." >&2
  exit 1
fi

# --- 1. pull latest ---
if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  echo "==> git fetch + checkout $BRANCH"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

# --- 2. install deps (clean, reproducible) ---
echo "==> npm ci"
npm ci

# --- 3. Prisma: client + push schema to local Postgres ---
echo "==> prisma generate + db push"
npm run db:generate
npm run db:push

# --- 4. build the shared db package + Node services ---
echo "==> build packages/db"
npm run build -w packages/db
echo "==> build api / webhooks / socket"
npm run build -w apps/api
npm run build -w apps/webhooks
npm run build -w apps/socket

# --- 5. build the web bundle ---
# Vite reads VITE_-prefixed vars from process.env, so export from .env here.
# VITE_FORCE_ABSOLUTE_BASE=1 is REQUIRED: the app is served at the domain
# root, so asset + router paths must be absolute (/assets/...). Without it
# Vite emits relative paths and deep routes like /auth/microsoft/callback
# 404 to a blank page.
echo "==> build web (absolute base, baked API url)"
VITE_API_URL="$(grep -E '^VITE_API_URL=' "$REPO_DIR/.env" | head -1 | cut -d= -f2-)"
export VITE_API_URL
export VITE_FORCE_ABSOLUTE_BASE=1
echo "    VITE_API_URL=$VITE_API_URL"
npm run build -w apps/web

# --- 6. (re)start services under pm2 ---
echo "==> pm2 reload"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not installed. Run: sudo npm i -g pm2" >&2
  exit 1
fi
pm2 startOrReload "$SCRIPT_DIR/ecosystem.config.cjs" --update-env
pm2 save

echo "==> done. Services:"
pm2 status
echo
echo "Reminder: nginx must serve $REPO_DIR/apps/web/dist and proxy"
echo "  /api -> 127.0.0.1:3000  /webhooks + /texml -> 127.0.0.1:3002  /socket.io -> 127.0.0.1:3001"
echo "See nginx-dialer.conf"
