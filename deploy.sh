#!/usr/bin/env bash
# ============================================================
# ACE Dialer — one-shot deployment script
#
# Pulls latest code, installs deps, builds all services + web,
# and reloads everything under pm2.
#
# Usage:
#   ./deploy.sh             # full deploy (pull + install + build + reload)
#   ./deploy.sh --no-pull   # skip git pull (deploy local changes)
#
# Services (pm2):
#   ace-api      :3000   apps/api
#   ace-socket   :3001   apps/socket
#   ace-webhooks :3002   apps/webhooks
#   ace-web      :3010   apps/web/dist (static, SPA)
#
# Reverse proxy: dialer.aptask.com on 192.168.1.95 → this host.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_PULL=false
[[ "${1:-}" == "--no-pull" ]] && NO_PULL=true

log()  { echo -e "\033[1;32m==>\033[0m $*"; }
fail() { echo -e "\033[1;31mFAILED:\033[0m $*" >&2; exit 1; }

# --- Node via nvm -------------------------------------------------
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node >/dev/null || fail "node not found (nvm missing?)"
log "node $(node --version) / npm $(npm --version)"

cd "$APP_DIR"

# --- 1. Pull latest code ------------------------------------------
if ! $NO_PULL; then
  BRANCH="$(git branch --show-current)"
  log "git pull (branch: $BRANCH)"
  git pull --ff-only || fail "git pull failed — resolve manually"
else
  log "skipping git pull (--no-pull)"
fi

# --- 2. Install dependencies --------------------------------------
log "npm install"
npm install --no-audit --no-fund 2>&1 | tail -1

# --- 3. Prisma client ----------------------------------------------
log "prisma generate"
npm run db:generate >/dev/null

# --- 4. Build -------------------------------------------------------
log "building packages/db"
npm run build -w packages/db
log "building apps/api"
npm run build -w apps/api
log "building apps/socket"
npm run build -w apps/socket
log "building apps/webhooks"
npm run build -w apps/webhooks
log "building apps/web (production bundle)"
# Self-hosted web (pm2 static SPA on :3010, behind dialer.aptask.com) is served
# over https at nested URLs like /auth/microsoft/callback. Vite's default base
# here is './' (relative) — correct for Electron's file:// load, but on a nested
# route the browser resolves ./assets/*.js against /auth/microsoft/, 404s, and
# the SPA fallback hands back index.html (text/html) → "Failed to load module
# script" + blank page. Force absolute '/assets/...' paths for the web deploy.
VITE_FORCE_ABSOLUTE_BASE=1 npm run build:web | tail -2

# --- 5. Reload services under pm2 ----------------------------------
log "reloading pm2 services"
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
pm2 save >/dev/null

# --- 6. Health checks -----------------------------------------------
log "health checks"
sleep 2
ok=true
for svc in "api:3000" "socket:3001" "webhooks:3002" "web:3010"; do
  name="${svc%%:*}"; port="${svc##*:}"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/" || true)"
  if [[ "$code" == "200" ]]; then
    echo "    ace-${name} :${port} → ${code} ✓"
  else
    echo "    ace-${name} :${port} → ${code} ✗"
    ok=false
  fi
done
$ok || fail "one or more services unhealthy — check: pm2 logs"

log "deployed $(git rev-parse --short HEAD 2>/dev/null || echo '(no git)') — all services healthy"
