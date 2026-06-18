#!/usr/bin/env node
// v0.10.187 - Composer card-row design (approved from preview).
//
// USER-APPROVED PREVIEW
//   - Outer panel = soft gray card (#eef0f5), 16px rounded corners,
//     hair-thin border, margin from screen edges so it floats as a
//     distinct card on the page.
//   - Inner controls = pure white pills inside the gray card:
//       Text input pill, Clock round button, action pills (MMS / Quick
//       reply / emoji / Templates). Each with a 0.5px border for
//       definition.
//   - Send pill = indigo (#4f46e5) — only non-gray/white element.
//
// PRIOR PASS (v0.10.186) FORCED EVERYTHING GRAY in light mode. This
// release overrides that pass to put the controls back to white INSIDE
// the gray card. The contrast direction is now correct: panel is the
// darker element, controls are the lighter cards inside.
//
// VERSION BUMP: 0.10.186 -> 0.10.187

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v187] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v187] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v187] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v187] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — replace the v186 force-gray block with the v187 card-row
// styling. Anchored on the unique v186 block-header comment so the
// entire force-gray block gets replaced atomically.
// =====================================================================
const CARD_ROW_BLOCK = `
/* ====================================================================
   v0.10.187 — Composer card-row. Approved preview design.
   ==================================================================== */

/* Outer card panel — soft gray, rounded corners, thin border, margin
   from screen edges so the composer reads as a discrete card sitting
   on the thread page. */
.compose-area {
  margin: 8px 12px;
  padding: 12px;
  border-radius: 16px;
  border: 0.5px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.04);
}
[data-theme="light"] .compose-area {
  background: #eef0f5 !important;
  border: 0.5px solid rgba(0, 0, 0, 0.05) !important;
  border-radius: 16px !important;
  margin: 8px 12px !important;
}

/* Inner controls — pure WHITE pills inside the gray card. Hair-thin
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
}

/* Dark-mode equivalent — slight elevation card with slightly-more-
   elevated controls inside. */
.compose-area .compose-input,
.compose-area textarea.compose-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.compose-area .compose-row .compose-icon-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.compose-area .compose-action-pill {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Send pill stays indigo accent — the only non-gray/white surface. */
[data-theme="light"] .compose-area .compose-row .send-btn {
  background: #4f46e5 !important;
  color: #ffffff !important;
}
[data-theme="light"] .compose-area .compose-row .send-btn:disabled {
  background: #c7c5f0 !important;
  color: #ffffff !important;
}
`;

applyEdits('apps/web/src/styles.css', [
  {
    label: '1: replace the v0.10.186 force-gray block with the v0.10.187 card-row block',
    find: `/* ====================================================================
   v0.10.186 — Composer FORCE-GRAY rules. High specificity + !important
   to ensure these win regardless of any other CSS in the file. Earlier
   v0.10.182-185 passes left white surfaces visible in light mode either
   due to anchor mismatches or browser cache; this block eliminates
   that risk by being the last word on every composer surface.
   ==================================================================== */
[data-theme="light"] .compose-area {
  background: #eef0f5 !important;
  border-top: 1px solid rgba(0, 0, 0, 0.06) !important;
}
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
  border-color: rgba(79, 70, 229, 0.4) !important;
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
  background: rgba(79, 70, 229, 0.16) !important;
  color: #4f46e5 !important;
}
/* Send pill stays indigo accent — the ONLY non-gray surface. */
[data-theme="light"] .compose-area .compose-row .send-btn {
  background: #4f46e5 !important;
  color: #ffffff !important;
}
[data-theme="light"] .compose-area .compose-row .send-btn:disabled {
  background: #c7c5f0 !important;
  color: #ffffff !important;
}`,
    replace: CARD_ROW_BLOCK.trim(),
  },
]);

// =====================================================================
// Version bumps 0.10.186 -> 0.10.187
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
  c = c.replace(/"version":\s*"0\.10\.186"/, '"version": "0.10.187"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.186 -> 0.10.187`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v187] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.186';`,
    replace: `const APP_VERSION = '0.10.187';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.187 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.186',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.187',
    date: 'June 18, 2026',
    highlight: 'Message composer is now a clean card-row with rounded corners.',
    changes: [
      { type: 'improved', text: 'Message composer redesigned as a discrete rounded card sitting at the bottom of the thread. Soft gray panel with the text input, schedule clock, action pills (MMS / Quick reply / Emoji / Templates) as white pills inside. The indigo Send pill stays as the only accent color.' },
    ],
  },
  {
    version: '0.10.186',`,
  },
]);

console.log('\n[apply-v187] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.187: Composer card-row (approved preview)"');
console.log('  git tag v0.10.187');
console.log('  git push origin main');
console.log('  git push origin v0.10.187');
console.log('');
console.log('AFTER DEPLOY: hard-refresh (Ctrl+Shift+R or View > Force Reload in Electron).');
