# Self-hosted deployment (dialer server)

Deploys ACE Dialer to the on-prem dialer server (`172.16.46.50`), fronted by
the proxy server (`192.168.1.95`) at `https://dialer.aptask.com`.

## Layout

| Service | Port | Served via |
|---|---|---|
| api | 3000 | nginx `/api/` (prefix stripped) |
| webhooks | 3002 | nginx `/webhooks/` + `/texml/` (prefix kept) |
| socket | 3001 | nginx `/socket.io/` (WebSocket) |
| web (static) | — | nginx `/` from `apps/web/dist` |

## One-time server setup

```bash
sudo apt update && sudo apt install -y nginx
# Node 20+ (nvm or NodeSource), then:
sudo npm i -g pm2

# clone repo (path used by nginx conf + ecosystem):
cd /home/aptask && git clone <repo-url> acedialerv4
cd acedialerv4

# put secrets in place (DATABASE_URL, JWT_SECRET, VITE_API_URL, etc.):
cp /path/to/your/.env .env

# nginx site:
sudo cp nginx-dialer.conf /etc/nginx/sites-available/dialer
sudo ln -sf /etc/nginx/sites-available/dialer /etc/nginx/sites-enabled/dialer
sudo nginx -t && sudo systemctl reload nginx

# make pm2 survive reboots:
pm2 startup   # run the command it prints
```

## Every deploy

```bash
cd /home/aptask/acedialerv4
bash deploy.sh
```

Pulls the branch, installs, runs `prisma db push`, builds all services + the
web bundle (absolute base + baked `VITE_API_URL`), then `pm2 reload`.

Override the branch: `DEPLOY_BRANCH=migrate/self-host-dialer-aptask bash deploy.sh`
Skip git (deploy local changes): `SKIP_GIT=1 bash deploy.sh`

## After deploy — external config

- **Telnyx**: point the webhook URL at `https://dialer.aptask.com/webhooks/telnyx/calls`.
- **MS Entra**: add redirect URI `https://dialer.aptask.com/auth/microsoft/callback`.
- **Proxy (192.168.1.95)**: forward `dialer.aptask.com` → dialer server :80,
  preserving `Host` and `X-Forwarded-Proto: https`.

## Notes

- Secrets are never committed. `.env` is git-ignored and read at runtime:
  pm2 injects it into the services (`ecosystem.config.cjs`), and the deploy
  script exports `VITE_API_URL` from it for the web build.
- `db push` is additive-safe but destructive on column removal — review schema
  changes before deploying (see CLAUDE.md §3.4).
