---
name: verify-web
description: Type-check and build the ACE Dialer web app WITHOUT publishing it, and optionally screenshot a page headlessly. Use when checking that a web change compiles or looks right before deploying — never run `npm run build -w apps/web` for this, it goes live.
argument-hint: "[route to screenshot, e.g. /reports/overview]"
---

# Verify a web change without deploying it

`apps/web/dist` is served live by pm2's `ace-web`. Building into it publishes
to every web user instantly. Everything here builds somewhere else.

Use the session scratchpad (`$SCRATCH` below) for all output.

## 1. Type-check and build to scratch

```bash
cd /home/aptask/app/acedialerv4
before=$(stat -c %Y apps/web/dist/index.html)
npx tsc --noEmit -p apps/web/tsconfig.json
cd apps/web && VITE_FORCE_ABSOLUTE_BASE=1 npx vite build --outDir "$SCRATCH/webcheck" --emptyOutDir 2>&1 | tail -3
cd ../.. && [ "$(stat -c %Y apps/web/dist/index.html)" = "$before" ] && echo "live dist untouched"
```

Report the tsc result and the build result. The chunk-size warning is
expected noise. Always confirm the live dist mtime didn't move.

Run the web unit tests that cover what changed:
`npx vitest run <path>` from `apps/web`.

## 2. Screenshot (only if a route was given or the change is visual)

Electron can't start on this host and there's no sudo. Headless Chrome works:

```bash
C="$SCRATCH/chrome"; L="$SCRATCH/libs"
[ -d "$C" ] || npx -y @puppeteer/browsers install chrome-headless-shell@stable --path "$C"
if [ ! -d "$L" ]; then
  mkdir -p "$L/deb" && cd "$L/deb"
  apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libatspi2.0-0t64 libwayland-server0 libxkbcommon0 libxrender1 libxi6
  for d in *.deb; do dpkg -x "$d" "$L"; done; cd -
fi
export LD_LIBRARY_PATH=$(find "$L" -name '*.so*' -printf '%h\n' | sort -u | tr '\n' ':')
BIN=$(find "$C" -name chrome-headless-shell -type f | head -1)
"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1440,900 \
  --virtual-time-budget=20000 --screenshot="$SCRATCH/shot.png" <URL>
```

Add `--enable-logging=stderr --v=0 --dump-dom` to see console errors.

Serve the scratch build to point it at: `npx serve -s "$SCRATCH/webcheck" -l 3999`
(run in background; kill by the port's PID afterwards, never with
`pkill -f <pattern>` from a shell whose own command line contains the pattern —
it kills itself).

Protected pages redirect to `/login` without a token. To render one with
real-looking data: a temporary Vite entry (html + tsx mounting the page in a
`MemoryRouter`) built with a temp config inside `apps/web`, plus a tiny
Fastify stub registering ONLY the route under test with a fake `authenticate`.
**Never boot `apps/api/src/main.ts`** — its scheduled-message worker sends
real texts. Delete every temp file afterwards and confirm `git status` is clean.

Read the PNG with the Read tool and describe what you see against what the
change intended. Check both themes if the change touches color
(`data-theme="light"` on `<html>`).

## 3. Report

tsc ✓/✗, build ✓/✗, tests, live dist untouched ✓, and the screenshot
findings. If all green, the next step is `/deploy web`.
