#!/usr/bin/env node
// v0.10.204 - No-code-change version bump for a fresh CI build.
//
// WHY THIS EXISTS
//   You asked for "a new build to test" after v0.10.203 shipped. There
//   are no code changes between v0.10.203 and v0.10.204 — this script
//   only bumps version strings and adds a WhatsNew entry so the new
//   .exe carries a different version number. Use this when something
//   appears wrong with the published v0.10.203 installer itself
//   (corrupted upload, signing issue, missed asset) and you want a
//   fresh artifact under a new tag.
//
//   If you instead want to ship the apply-v203-provisioning-retry-on-not-
//   ready.mjs fix (already authored, never shipped due to the numbering
//   conflict noted in apply-v203-electron-autoplay-policy.mjs), do
//   THAT instead of this — renumber that script to v204 and run it.
//
// VERSION BUMP: 0.10.203 -> 0.10.204
// CODE CHANGES: none

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v204] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v204] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v204] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v204] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// Version bumps 0.10.203 -> 0.10.204
// =====================================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.203"/, '"version": "0.10.204"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.203 -> 0.10.204`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v204] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}
if (bumped !== PKGS.length) {
  console.warn(`[apply-v204] WARN: only ${bumped}/${PKGS.length} package.json files bumped (expected all 7)`);
}

// =====================================================================
// DiagnosticsSection APP_VERSION
// =====================================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.203';`,
    replace: `const APP_VERSION = '0.10.204';`,
  },
]);

// =====================================================================
// WhatsNew entry — explicit rebuild note so users seeing the in-app
// "What's new" panel aren't confused by a version with no visible delta
// =====================================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.204 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.203',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.204',
    date: 'June 25, 2026',
    highlight: 'Maintenance build — same code as v0.10.203, fresh installer.',
    changes: [
      { type: 'improved', text: 'Re-packaged installer for v0.10.203. No feature or behavior changes — install only if you were having trouble with the previous installer.' },
    ],
  },
  {
    version: '0.10.203',`,
  },
]);

console.log('');
console.log('[apply-v204] DONE');
console.log('');
console.log('NEXT (run from the repo root in PowerShell):');
console.log('  node scripts/strip-null-bytes.mjs');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.204: Maintenance rebuild of v0.10.203 (no code changes)"');
console.log('  git tag v0.10.204');
console.log('  git push origin main');
console.log('  git push origin v0.10.204');
console.log('');
console.log('Pushing the tag will trigger build-desktop.yml on GitHub Actions,');
console.log('which produces the .exe and attaches it to the v0.10.204 release.');
