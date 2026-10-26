---
name: update-blueprint
description: Bring CLAUDE.md, the Settings → Help entries, the Reports guide and PROJECT_STATE.md in line with the change on the current branch before it merges. Use before opening or merging a PR that ships, changes, or moves the status of a feature, or that changes any user-visible message.
---

# Update the blueprint before merge

CLAUDE.md's rule: "When a feature ships, lands, or moves status, edit its
block here *before* you merge. The block is the contract." Nothing enforces
it; this skill does.

## 1. What changed

```bash
cd /home/aptask/app/acedialerv4
git fetch -q origin
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- . ':!package-lock.json'
```

Include uncommitted work if the change isn't committed yet (`git diff HEAD`).

## 2. CLAUDE.md module blocks

Map each changed path to its module (§1–§32; the module index table at the
top lists them, and each block's "Current State & Truth" table names its
files). For each affected block check all four tiers:

- **Capabilities & Scope** — does it describe what the code now does?
- **Current State & Truth** — status (`Shipped` / `In-Progress` / `Planned`),
  file paths, endpoints, env vars. A renamed file or new route must appear.
- **Execution Context** — SDK calls, schemas, the client→server seam.
- **Architectural Guardrails** — if the change fixed a bug whose cause is a
  rule someone could break again, add the guardrail with its failure mode
  (what broke, how it looked to the user). Comments and guardrails explain
  WHY, never WHAT.

Update the module index table if a status changed. Keep the existing voice:
dense, specific, measured numbers where we have them. Don't rewrite sections
the change didn't touch.

## 3. Help center — strings are search keys

Users find a help entry by retyping what they saw on screen, so a reworded
message orphans its entry (CLAUDE.md §5.4).

```bash
git diff origin/main...HEAD -- apps/web/src | grep -E "^[-+].*['\"\`][A-Z][^'\"\`]{12,}['\"\`]"
```

For every user-visible message added, removed or reworded, find it in
`apps/web/src/data/helpCenter.ts` and update the entry (what it means, what to
do) in the same commit. New error messages need a new entry.

## 4. Other docs that must move together

- Reports tab, measure, end reason or entitlement changed →
  `docs/reports-guide.md`.
- Phone-type behaviour or spend → `docs/phone-type-detection.md`.
- Web module mirrored in the extension (`apps/extension/src/phoneType.ts`,
  panel lists ↔ `Recents.tsx`) → confirm both sides changed.
- Release-worthy → `PROJECT_STATE.md` §1, open tasks §2, and a §5 "Recent
  learnings" entry for any real debugging discovery; bump "Last updated".

## 5. Report

List each doc touched with a one-line summary of the edit, and anything you
deliberately left alone and why. Commit the doc edits in the same commit/PR
as the code, not a follow-up.
