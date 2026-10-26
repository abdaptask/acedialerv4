---
name: deploy
description: Deploy ACE Dialer to production on this host — builds only the services that changed from main, reloads them under pm2, and verifies they're live. Use when the user asks to deploy, ship to prod, make a fix live, or reload a service.
argument-hint: "[web|api|webhooks|socket|all]"
disable-model-invocation: true
---

# Deploy ACE Dialer

This machine IS production (`dialer.aptask.com`, pm2). There is no CI for
api/web/webhooks/socket: merging a PR deploys nothing, and building deploys
immediately. Every step below exists because skipping it has bitten us.

## 1. Preflight — stop on any failure

Run and show the output:

```bash
cd /home/aptask/app/acedialerv4
git fetch -q origin
git branch --show-current
git status --porcelain
git rev-parse HEAD origin/main
```

- **Branch must be `main`.** If not: stop. Production must run what's on
  `main`; a branch deploy leaves the live app running code that may never
  merge. Offer `git checkout main && git pull --ff-only` (only if the tree is
  clean and the branch's work is merged or pushed).
- **HEAD must equal `origin/main`.** If behind, `git pull --ff-only`. If ahead,
  stop — unpushed commits mean production would diverge from GitHub.
- **Tracked files must be clean.** Untracked noise (`.env.bak-*`, docs drafts)
  is fine; a modified tracked file is not — it would ship without review.
  `package-lock.json` drift from a local `npm install` is the usual exception:
  show `git diff --stat package-lock.json` and ask.

## 2. Decide what to build

If the user named a target, use it. Otherwise diff against what's running:

```bash
git diff --stat <last-deployed-sha> HEAD   # if known, else ask the user
```

Map paths → targets:

| Changed path | Build | Reload |
|---|---|---|
| `apps/web/**` | `VITE_FORCE_ABSOLUTE_BASE=1 npm run build:web` | none — `ace-web` serves `apps/web/dist` off disk |
| `apps/api/**` | `npm run build -w packages/db && npm run build -w apps/api` | `pm2 reload ace-api` |
| `apps/webhooks/**` | `npm run build -w packages/db && npm run build -w apps/webhooks` | `pm2 reload ace-webhooks` |
| `apps/socket/**` | `npm run build -w apps/socket` | `pm2 reload ace-socket` |
| `packages/db/**` | `npm run db:generate` + db build, then api AND webhooks | reload both |
| `package.json` / lockfile deps | `npm install --no-audit --no-fund` first | as above |
| `apps/desktop/**`, `apps/extension/**` | not deployed here — desktop ships via GitHub Actions on push to main; extension via the Chrome Web Store | — |

`all` = `./deploy.sh --no-pull` (preflight already pulled). It rebuilds web
too, which republishes the SPA to every web user — fine, just know it.

### Never

- **Never `npm run build:api`.** It runs `prisma db push --accept-data-loss`
  against the shared database as a side effect of "building". A schema change
  is its own step (below), reviewed first.
- **Never a bare `pm2 reload` without the build.** pm2 runs `apps/*/dist`; a
  reload alone re-runs stale compiled JS. `tsc --noEmit` doesn't produce dist.
- **Never build web without `VITE_FORCE_ABSOLUTE_BASE=1`.** Relative asset
  paths blank every nested route (`/settings/:section`, the SSO callback).
- **Never boot `apps/api/src/main.ts` to "test" it** — its scheduled-message
  worker sends real texts.

### Schema changes

If `packages/db/prisma/schema.prisma` changed: show the diff, confirm it is
additive only (new tables/nullable columns/indexes). A removed or retyped
column needs coordinated downtime — stop and say so. Then, with explicit
user approval:

```bash
cd packages/db && npx prisma db push --skip-generate   # NOT --accept-data-loss
```

Env: these commands need `.env`; prefix with
`set -a && . ../../.env && set +a &&` or use `node --env-file`.

## 3. Confirm, then run

List the exact commands you're about to run, one line each with what it does,
and wait for a go-ahead. Then run them in order, stopping at the first failure.

## 4. Verify — don't report success without this

**Web:**
```bash
grep -o 'src="[^"]*"' apps/web/dist/index.html          # must be /assets/…, not ./assets/…
f=$(grep -o '/assets/index-[^"]*\.js' apps/web/dist/index.html | head -1)
curl -s -D- -o /dev/null http://127.0.0.1:3010$f | grep -i content-type   # application/javascript
```
Do NOT test `/settings/assets/<x>.js` — it returns text/html even on a
correct build (see CLAUDE.md §1.4).

**Each reloaded service:**
```bash
pm2 ls                                   # online, uptime seconds, restart count not climbing
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/   # 3000 api, 3001 socket, 3002 webhooks
```
Then prove the new code is what's running: grep the built `dist/` for a
string unique to the change. Wait ~10s and re-check `pm2 ls` — a crash loop
shows as a rising ↺ count.

If a reload crash-loops: `pm2 logs <name> --lines 50 --nostream` (the
error log is small; never grep the whole `ace-api-out.log`, it's tens of GB —
use `tail -c 200000000`).

## 5. Report

One short block: commit deployed, what was rebuilt/reloaded, the verification
results, and anything the user must do (hard-refresh, sign in again,
publish the desktop draft).
