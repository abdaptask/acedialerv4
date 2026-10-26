---
name: release
description: Cut an ACE Dialer version bump — every package.json, the extension manifest, APP_VERSION, What's new, PROJECT_STATE — then hand off the desktop draft. Use when the user asks to bump the version, cut/prepare a release, or ship a new desktop build.
argument-hint: "[new-version, e.g. 0.10.244]"
disable-model-invocation: true
---

# Release bump

A version bump touches more files than anyone remembers. v0.10.243 shipped
as a draft without What's new, and the user saw Settings still ending at
0.10.242. This skill is the checklist.

## 1. Find the real current version

The repo lags reality. Desktop builds publish from GitHub Actions without
local tags, so check what abdulla (user id 1) is actually running:

```bash
cd /home/aptask/app/acedialerv4
DB=$(grep -E '^DIRECT_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
psql "$DB" -c "SELECT platform, app_version, last_seen_at FROM user_devices d JOIN users u ON u.id=d.user_id WHERE lower(u.email)='abdulla@aptask.com' ORDER BY last_seen_at DESC LIMIT 5;"
node -p "require('./package.json').version"
```

The new version must be higher than BOTH. Never re-publish a number any device
already runs with different contents — bump again instead. If the user didn't
give a version, propose the next patch and ask.

## 2. Bump every version string

Don't trust a file count (it's grown from 7 to 9). Find them:

```bash
OLD=<old>; grep -rl "\"$OLD\"" package.json apps/*/package.json packages/db/package.json apps/extension/manifest.json
grep -rn "$OLD" apps/web/src --include=*.ts --include=*.tsx
```

Update all of:
- root + `apps/{api,web,desktop,socket,webhooks,extension}` + `packages/db` `package.json`
- `apps/extension/manifest.json` — only if the extension is part of this
  release. The extension ships through the Chrome Web Store on its own
  4-part version (e.g. `0.10.243.3`); ask before touching it.
- `APP_VERSION` in `apps/web/src/components/DiagnosticsSection.tsx`

Run `npm install --package-lock-only --no-audit --no-fund` so the lockfile's
workspace versions follow.

## 3. What's new

Add an entry at the TOP of `WHATS_NEW` in `apps/web/src/data/whatsNew.ts`:
`version`, `date` ("October 26, 2026" form), optional `highlight`, and
`changes` typed `new | improved | fixed`. Plain English, one sentence each, no
jargon, no internal names. Build it from `git log <last-release-sha>..HEAD
--oneline`, dropping docs/chore/internal-only commits. Show the draft to the
user before writing — this is user-facing copy.

## 4. Help center

If any user-visible message changed this release, its entry in
`apps/web/src/data/helpCenter.ts` must change in the same commit (CLAUDE.md
§5.4). Grep the diff for changed string literals in `apps/web/src` and check.

## 5. Check and commit

```bash
node scripts/strip-null-bytes.mjs
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/desktop/tsconfig.json
grep -rn "$OLD" package.json apps/*/package.json packages/db/package.json apps/web/src/components/DiagnosticsSection.tsx   # expect nothing
```

Update `PROJECT_STATE.md` §1 (current state) and the "Last updated" date.
Commit on a branch as `chore(release): vX.Y.Z` and use `/ship-pr`.

## 6. After merge — tell the user, don't do it silently

- Merging to `main` triggers `.github/workflows/build-desktop.yml`, which
  builds Win + Mac installers and creates a **Draft** GitHub release.
  Desktop users get nothing until someone publishes the draft.
- Risky behaviour changes: leave as draft, have abdulla run it ~24h, then
  publish. UI-only changes can publish directly.
- Web/API don't deploy on merge — run `/deploy`.
- A tag (`git tag vX.Y.Z && git push origin vX.Y.Z`) also triggers the
  workflow; don't push one unless the user asks.

After publishing, re-run the step 1 query later to confirm abdulla's device
picked the version up.
