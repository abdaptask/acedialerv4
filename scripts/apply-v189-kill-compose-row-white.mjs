#!/usr/bin/env node
// v0.10.189 - Kill the white background on the .compose-row top row.
//
// ROOT CAUSE (finally found)
//   styles.css line 4847-4850 has a pre-existing rule:
//     [data-theme="light"] .thread-header,
//     [data-theme="light"] .compose-row {
//       background: var(--bg-elevated);
//     }
//   `--bg-elevated` is white in light mode. The TOP composer row
//   has the `.compose-row` class, so it gets this white background
//   — which is why there was a visible white strip between the
//   text input, schedule clock, and Send pill across v0.10.182-188.
//   The BOTTOM row (action pills) has class `.compose-row-actions`
//   instead, so it was unaffected. That's why the user saw white
//   ONLY between input/clock/send, never between the pills below.
//
// FIX
//   Append a higher-specificity, !important override at the v0.10.188
//   block: force `.compose-area .compose-row` to be transparent in
//   light mode so the gray card panel shows through between input,
//   clock, and Send.
//
// VERSION BUMP: 0.10.188 -> 0.10.189

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v189] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v189] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v189] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v189] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — override the legacy compose-row white background
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: force .compose-area .compose-row transparent in light mode (overrides legacy --bg-elevated white from line 4847)',
    find: `[data-theme="light"] .compose-area .compose-action-pill.is-active {
  background: rgba(79, 70, 229, 0.14) !important;
  color: #4f46e5 !important;
}`,
    replace: `[data-theme="light"] .compose-area .compose-action-pill.is-active {
  background: rgba(79, 70, 229, 0.14) !important;
  color: #4f46e5 !important;
}

/* v0.10.189 — kill the legacy [data-theme="light"] .compose-row
   { background: var(--bg-elevated) } rule from line ~4847 that was
   adding a WHITE background to the top composer row (between the
   text input, clock, and Send pill). Force transparent so the gray
   card panel shows through. The bottom row uses .compose-row-actions
   (no .compose-row class) so it was already transparent. */
[data-theme="light"] .compose-area .compose-row,
[data-theme="light"] .compose-area .compose-row-input {
  background: transparent !important;
  border-color: transparent !important;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.188 -> 0.10.189
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
  c = c.replace(/"version":\s*"0\.10\.188"/, '"version": "0.10.189"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.188 -> 0.10.189`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v189] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.188';`,
    replace: `const APP_VERSION = '0.10.189';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.189 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.188',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.189',
    date: 'June 18, 2026',
    highlight: 'Composer: removed the legacy white background between input/clock/send.',
    changes: [
      { type: 'fixed', text: 'A pre-existing legacy CSS rule was setting a white background on the top composer row (between the text input, schedule clock, and Send pill). That rule is now overridden — the gray card panel shows through cleanly between every control.' },
    ],
  },
  {
    version: '0.10.188',`,
  },
]);

console.log('\n[apply-v189] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.189: Kill legacy white background on .compose-row top row"');
console.log('  git tag v0.10.189');
console.log('  git push origin main');
console.log('  git push origin v0.10.189');
console.log('');
console.log('AFTER DEPLOY: hard-refresh (Ctrl+Shift+R or View > Force Reload).');
