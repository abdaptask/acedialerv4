#!/usr/bin/env node
// v0.10.159 - Rollback v0.10.158 + bump version label.
//
// CONTEXT: v0.10.158 introduced TWO regressions:
//   1. Voicemail.tsx switched <audio src> from raw recordingUrl to
//      blob URL from /voicemails/:id/audio proxy. The proxy failed
//      (still 403'ing despite refresh attempts) AND, since switching,
//      even brand-new voicemails (whose stored URL is still fresh)
//      stopped playing - users see 0:00 / 0:00 across the board.
//   2. The Users admin table CSS fixes were a regression to revisit
//      with a proper plan (sticky-right Actions column with horizontal
//      scroll), not the half-baked max-width override that was shipped.
//
// USER DECISION: hard rollback to v0.10.157 behavior. Audio refresh
// logic from v0.10.157 STAYS (it's harmless even if it doesn't catch
// the S3 URL pattern - new voicemails just play directly from the
// fresh stored URL). v0.10.158's changes get reverted.
//
// EXPECTED FLOW BEFORE RUNNING THIS SCRIPT:
//   1. git log --oneline -5    # find v0.10.158 commit hash
//   2. git revert <hash> --no-commit
//      (this puts working tree back to v0.10.157 state)
//   3. node scripts/apply-v159-rollback-version-bump.mjs
//      (this script - bumps version labels 0.10.157 -> 0.10.159)
//   4. git add -A; git commit -m "..."; git tag v0.10.159; push
//
// WHAT THIS SCRIPT DOES:
//   - Updates the 7 package.json files: 0.10.157 -> 0.10.159
//   - Updates DiagnosticsSection.tsx APP_VERSION constant
//   - Adds a v0.10.159 entry at the top of whatsNew.ts explaining
//     the rollback in user-friendly terms
//
// AFTER PUSH:
//   - Render + Vercel auto-deploy v0.10.159 (== code-equivalent to .157
//     with a higher version label)
//   - User on installed v0.10.158 dialer auto-updates to .159 silently
//   - Older voicemails still 403 (we knew this; same as pre-.158)
//   - Newer voicemails play again (the regression is gone)
//   - The proper proxy fix will be a future release with verbose logs
//     and better DevTools-driven diagnosis before code goes out

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v159-rollback] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v159-rollback] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v159-rollback] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  Did you forget to run \`git revert <v0.10.158 hash> --no-commit\` first?`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v159-rollback] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// Version bumps 0.10.157 -> 0.10.159
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumpedAny = false;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.157"/, '"version": "0.10.159"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.157 -> 0.10.159`);
    bumpedAny = true;
  } else {
    // Maybe revert didn't run; try direct 0.10.158 -> 0.10.159 as a safety net
    c = readFileSync(fp, 'utf8');
    const before2 = c;
    c = c.replace(/"version":\s*"0\.10\.158"/, '"version": "0.10.159"');
    if (c !== before2) {
      writeFileSync(fp, c, 'utf8');
      console.log(`  ! ${rp}: was on 0.10.158, bumped to 0.10.159 (revert may have skipped this file)`);
      bumpedAny = true;
    }
  }
}
if (!bumpedAny) {
  console.error(`[apply-v159-rollback] FATAL: no package.json had version 0.10.157 or 0.10.158.`);
  console.error(`  Did you forget to run \`git revert <v0.10.158 hash> --no-commit\` first?`);
  process.exit(1);
}

// DiagnosticsSection APP_VERSION
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.157';`,
    replace: `const APP_VERSION = '0.10.159';`,
  },
]);

// whatsNew - new entry at top. After git revert, the v0.10.158 entry
// has been removed; the topmost entry should be v0.10.157's.
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.159 entry above v0.10.157',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.157',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.159',
    date: 'June 15, 2026',
    highlight: 'Voicemail playback restored after a regression.',
    changes: [
      { type: 'fixed', text: 'A previous release introduced a regression where voicemail audio would not play at all - even brand-new messages showed 0:00 / 0:00 in the in-app player. This release rolls back that change so voicemails play again. Older voicemails (where the original audio link from Telnyx has expired) may still have playback issues; a proper fix for that is planned for an upcoming release.' },
    ],
  },
  {
    version: '0.10.157',`,
  },
]);

console.log('\n[apply-v159-rollback] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status      # should show revert + version-bump changes');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.159: rollback v0.10.158 regression (voicemail proxy + Settings CSS) + version bump"');
console.log('  git tag v0.10.159');
console.log('  git push origin main');
console.log('  git push origin v0.10.159');
