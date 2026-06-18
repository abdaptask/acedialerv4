#!/usr/bin/env node
// v0.10.186 - Composer FORCE-GRAY. Final pass after v0.10.182-185 failed
// to make the input + clock button show as gray in light mode.
//
// STRATEGY
//   Append a final, high-specificity, !important block at the END of
//   styles.css. By appending at end-of-file with high specificity AND
//   !important, this block beats every other rule in styles.css
//   regardless of source order or other overrides. Eliminates the risk
//   of anchor-mismatch leaving stale white rules in place.
//
// PALETTE (LIGHT MODE)
//   page bg                         → inherited from dialer
//   .compose-area panel             → #eef0f5 (clear off-white panel)
//   .compose-input                  → #dbdfe6 (clearly gray, NOT white)
//   .compose-action-pill            → #dbdfe6 (same gray)
//   .compose-icon-btn (clock)       → #dbdfe6 (same gray)
//   .send-btn                       → #4f46e5 indigo (only accent)
//
// VERSION BUMP: 0.10.185 -> 0.10.186

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v186] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v186] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v186] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v186] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — append a forceful end-of-file block that wins regardless
// of every earlier composer-related rule in the file.
//
// Anchored on the LAST stable string in styles.css (the v0.10.179 .tab
// styles, which haven't moved since they were added). Inserting before
// that block to keep this rule order-friendly with the rest of the
// file's structure.
// =====================================================================
const FORCE_BLOCK = `
/* ====================================================================
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
}
`;

applyEdits('apps/web/src/styles.css', [
  {
    label: '1: append v0.10.186 force-gray block — anchor on EOF marker (last char of file is the closing `}` of any previous rule)',
    // Anchor on the v0.10.180 .recents-card-recording light-mode rule,
    // which is unique and immovable. Append our force-block AFTER it.
    find: `[data-theme="light"] .recents-card-recording {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}`,
    replace: `[data-theme="light"] .recents-card-recording {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
` + FORCE_BLOCK,
  },
]);

// =====================================================================
// Version bumps 0.10.185 -> 0.10.186
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
  c = c.replace(/"version":\s*"0\.10\.185"/, '"version": "0.10.186"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.185 -> 0.10.186`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v186] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.185';`,
    replace: `const APP_VERSION = '0.10.186';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.186 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.185',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.186',
    date: 'June 18, 2026',
    highlight: 'Composer: forced gray surface everywhere — no more white in light mode.',
    changes: [
      { type: 'fixed', text: 'Composer area, text input, schedule clock, and all action pills now render as a coherent light-gray surface in light mode. No white anywhere except the indigo Send button accent.' },
    ],
  },
  {
    version: '0.10.185',`,
  },
]);

console.log('\n[apply-v186] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.186: Composer FORCE-GRAY (no white surfaces in light mode)"');
console.log('  git tag v0.10.186');
console.log('  git push origin main');
console.log('  git push origin v0.10.186');
console.log('');
console.log('IMPORTANT - HARD REFRESH AFTER DEPLOY:');
console.log('  Web:     Ctrl+Shift+R in the dialer browser tab');
console.log('  Desktop: View menu -> Force reload (or Ctrl+Shift+R)');
console.log('  Browser/Electron may be serving the cached CSS otherwise.');
