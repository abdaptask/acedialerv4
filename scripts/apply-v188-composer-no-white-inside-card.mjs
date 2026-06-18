#!/usr/bin/env node
// v0.10.188 - Fix v0.10.187's white pills inside the gray card.
//
// v0.10.187 shipped the card-row structure (gray card, rounded, margin
// from edges) but put WHITE pills inside (input, clock, action pills).
// User approved the preview but the rendered result has visible white
// surfaces inside the card — exactly the "white" the user has been
// flagging across v0.10.182-186.
//
// THIS RELEASE
//   - Keeps the card structure from v0.10.187 (gray panel, 16px
//     rounded corners, hair-thin border, margin from screen edges).
//   - Changes inner controls from WHITE (#ffffff) to GRAY (#dbdfe6) —
//     same gray family as the card panel, just darker for elevation.
//   - Removes borders on the inner controls so they blend cleanly with
//     the panel (no card-on-card outline).
//   - Send pill stays indigo (#4f46e5) — only non-gray accent.
//
// LIGHT MODE PALETTE
//   page bg                       inherited
//   .compose-area (card)          #eef0f5  (panel)
//   .compose-input                #dbdfe6  (darker gray, no border)
//   .compose-icon-btn (clock)     #dbdfe6  (same gray)
//   .compose-action-pill          #dbdfe6  (same gray)
//   .send-btn                     #4f46e5  (indigo accent)
//
// VERSION BUMP: 0.10.187 -> 0.10.188

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v188] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v188] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v188] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v188] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — replace v0.10.187's white-pills-inside-card block with
// the v0.10.188 all-gray version. Keep the card structure intact.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: input + clock + pills go from white to gray INSIDE the card',
    find: `/* Inner controls — pure WHITE pills inside the gray card. Hair-thin
   border for definition. */
[data-theme="light"] .compose-area .compose-input,
[data-theme="light"] .compose-area textarea.compose-input {
  background: #ffffff !important;
  border: 0.5px solid rgba(0, 0, 0, 0.05) !important;
  color: #111827 !important;
}
[data-theme="light"] .compose-area .compose-input::placeholder {
  color: #9ca3af !important;
  opacity: 1 !important;
}
[data-theme="light"] .compose-area .compose-input:focus {
  background: #ffffff !important;
  border-color: rgba(79, 70, 229, 0.45) !important;
}

[data-theme="light"] .compose-area .compose-row .compose-icon-btn {
  background: #ffffff !important;
  border: 0.5px solid rgba(0, 0, 0, 0.05) !important;
  color: #374151 !important;
}
[data-theme="light"] .compose-area .compose-row .compose-icon-btn:hover:not(:disabled) {
  background: #f7f8fb !important;
}

[data-theme="light"] .compose-area .compose-action-pill {
  background: #ffffff !important;
  border: 0.5px solid rgba(0, 0, 0, 0.05) !important;
  color: #1f2937 !important;
}
[data-theme="light"] .compose-area .compose-action-pill:hover:not(:disabled) {
  background: #f7f8fb !important;
}
[data-theme="light"] .compose-area .compose-action-pill.is-active {
  background: rgba(79, 70, 229, 0.10) !important;
  color: #4f46e5 !important;
  border-color: rgba(79, 70, 229, 0.20) !important;
}`,
    replace: `/* v0.10.188 — Inner controls are GRAY, not white. Same gray family
   as the card panel, just darker so they read as a subtle elevation
   step. No borders — they'd add visual noise; the color shift alone
   is enough to define the controls. */
[data-theme="light"] .compose-area .compose-input,
[data-theme="light"] .compose-area textarea.compose-input {
  background: #dbdfe6 !important;
  border: 1px solid transparent !important;
  color: #1f2937 !important;
}
[data-theme="light"] .compose-area .compose-input::placeholder {
  color: #6b7280 !important;
  opacity: 1 !important;
}
[data-theme="light"] .compose-area .compose-input:focus {
  background: #d3d8e0 !important;
  border-color: rgba(79, 70, 229, 0.35) !important;
}

[data-theme="light"] .compose-area .compose-row .compose-icon-btn {
  background: #dbdfe6 !important;
  border: 1px solid transparent !important;
  color: #374151 !important;
}
[data-theme="light"] .compose-area .compose-row .compose-icon-btn:hover:not(:disabled) {
  background: #cdd2db !important;
}

[data-theme="light"] .compose-area .compose-action-pill {
  background: #dbdfe6 !important;
  border: none !important;
  color: #1f2937 !important;
}
[data-theme="light"] .compose-area .compose-action-pill:hover:not(:disabled) {
  background: #cdd2db !important;
}
[data-theme="light"] .compose-area .compose-action-pill.is-active {
  background: rgba(79, 70, 229, 0.14) !important;
  color: #4f46e5 !important;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.187 -> 0.10.188
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
  c = c.replace(/"version":\s*"0\.10\.187"/, '"version": "0.10.188"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.187 -> 0.10.188`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v188] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.187';`,
    replace: `const APP_VERSION = '0.10.188';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.188 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.187',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.188',
    date: 'June 18, 2026',
    highlight: 'Composer: card layout with all-gray controls inside.',
    changes: [
      { type: 'fixed', text: 'Inner controls of the composer card (text input, schedule clock, action pills) are now gray, not white. Card panel + all controls share the gray family; only the Send pill remains indigo. No white surfaces anywhere in the composer.' },
    ],
  },
  {
    version: '0.10.187',`,
  },
]);

console.log('\n[apply-v188] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.188: Composer - gray controls inside the card (no white)"');
console.log('  git tag v0.10.188');
console.log('  git push origin main');
console.log('  git push origin v0.10.188');
console.log('');
console.log('AFTER DEPLOY: hard-refresh (Ctrl+Shift+R or View > Force Reload).');
