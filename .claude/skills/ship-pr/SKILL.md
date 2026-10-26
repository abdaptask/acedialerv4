---
name: ship-pr
description: Commit the current ACE Dialer change on a branch, push it as abdaptask, and hand the user a ready PR link and description. Use when the user asks to commit, push, open a PR, or ship a change for review.
argument-hint: "[branch-name]"
---

# Commit, push, hand off the PR

## 1. Branch

```bash
cd /home/aptask/app/acedialerv4
git fetch -q origin
git branch --show-current
git status --porcelain
```

- On `main` (or a branch already merged): create a fresh branch from
  `origin/main` — `git checkout -b <type>/<short-name> origin/main` — the
  working-tree changes come along. Types: `fix/`, `feat/`, `docs/`, `chore/`.
- Never commit straight to `main`.

## 2. Stage only what belongs

Stage files by name, never `git add .` / `-A`. This repo dir holds
`.env.bak-*` files with production secrets and unrelated drafts. Leave
`package-lock.json` out unless the change touched dependencies.

Before committing:
```bash
node scripts/strip-null-bytes.mjs
npx tsc --noEmit -p apps/<each touched app>/tsconfig.json
git diff --cached --stat
```

If the change shipped a feature or moved its status, the matching
`CLAUDE.md` module block must be updated in this commit (`/update-blueprint`).

## 3. Commit message

Conventional subject (`fix(auth): …`, `feat(reports): …`), body explaining the
WHY and the failure mode — match recent `git log`. End with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## 4. Push

```bash
git remote get-url origin        # must be git@github.com-abd:abdaptask/acedialerv4.git
git push -u origin <branch>
```

`github.com-abd` pushes as **abdaptask**. Never repoint the remote to another
alias — GitHub attributes pushes (and the Actions runs/desktop releases they
trigger) to the SSH key's owner, not the commit author.

## 5. Hand off the PR

`gh` in Claude's shell is NOT authenticated (the user's `! gh auth login`
doesn't carry over). Give the user:

- Link: `https://github.com/abdaptask/acedialerv4/compare/main...<branch>?expand=1`
- Title: the commit subject
- Description: 2–4 lines (what was broken, cause, fix, how it was verified),
  ending with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

## 6. Remind about deploy

Merging deploys nothing for web/api/webhooks/socket. If the change touches
those, say so and point to `/deploy`. If it touches `apps/web`, `apps/desktop`
or any `package.json`, merging to `main` also builds a desktop **draft**
release.
