#!/usr/bin/env node
// v0.10.185 - Composer: NO white surfaces anywhere. Per Abd's repeated
// feedback after v0.10.182/183/184. Earlier passes kept introducing
// white in light mode (#ffffff input, #ffffff pills, gray panel that
// just emphasized the white interior). This release reverts to a
// single coherent gray treatment for ALL composer surfaces — input,
// action pills, schedule clock — with the indigo Send pill as the
// only accent color. The outer .compose-area becomes transparent
// so it inherits the dialer's page bg (no separate white card).
//
// LIGHT MODE PALETTE
//   page bg                 — inherited (whatever the dialer uses)
//   .compose-area           — transparent (no separate panel)
//   .compose-input          — #eaecf2 (clear light gray, NOT white)
//   .compose-action-pill    — #eaecf2 (same gray)
//   .compose-icon-btn       — #eaecf2 (same gray, matches pills)
//   .send-btn               — #4f46e5 indigo (only accent)
//
// DARK MODE
//   Unchanged from v0.10.183 — was already correct (no white surfaces).
//
// VERSION BUMP: 0.10.184 -> 0.10.185

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v185] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v185] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v185] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v185] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — kill the white. Everything goes gray.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: .compose-area becomes transparent in light mode (no white card)',
    find: `.compose-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .compose-area {
  background: #f5f6fa;
  border-top-color: rgba(0, 0, 0, 0.06);
}`,
    replace: `.compose-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  /* v0.10.185 — transparent in BOTH modes. The composer is no longer
     a separate panel; it inherits the dialer's page bg, so there's
     no white card sitting on the page in light mode. The input + pills
     below are the only colored surfaces. */
  background: transparent;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .compose-area {
  background: transparent;
  border-top-color: rgba(0, 0, 0, 0.06);
}`,
  },
  {
    label: '2: .compose-input light-mode bg from white back to clear gray',
    find: `[data-theme="light"] .compose-input {
  /* v0.10.184 — slightly lighter than the .compose-area (#f5f6fa) so
     the input reads as a card on the panel, not the same shade. */
  border-color: rgba(0, 0, 0, 0.06);
  background: #ffffff;
  color: #111827;
}
[data-theme="light"] .compose-input::placeholder {
  color: #9ca3af;
  opacity: 1;
}
[data-theme="light"] .compose-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: #ffffff;
}`,
    replace: `[data-theme="light"] .compose-input {
  /* v0.10.185 — clear light gray (NOT white). All composer controls
     share this shade so there are no jarring white surfaces. */
  border-color: rgba(0, 0, 0, 0.04);
  background: #eaecf2;
  color: #111827;
}
[data-theme="light"] .compose-input::placeholder {
  color: #9ca3af;
  opacity: 1;
}
[data-theme="light"] .compose-input:focus {
  border-color: rgba(99, 102, 241, 0.4);
  background: #eaecf2;
}`,
  },
  {
    label: '3: .compose-action-pill light-mode bg from white back to the same gray (no contrast border, no white)',
    find: `[data-theme="light"] .compose-action-pill {
  /* v0.10.184 — pure white pills on the slight-gray composer-area
     (#f5f6fa). Reads as cards on a panel, not the same shade. */
  background: #ffffff;
  color: #374151;
  border: 1px solid rgba(0, 0, 0, 0.05);
}
[data-theme="light"] .compose-action-pill:hover {
  background: #f7f8fb;
}
[data-theme="light"] .compose-action-pill.is-active {
  background: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
  border-color: rgba(99, 102, 241, 0.20);
}`,
    replace: `[data-theme="light"] .compose-action-pill {
  /* v0.10.185 — clear light gray, same as the input and clock so all
     composer surfaces share one shade. No white. No borders. */
  background: #eaecf2;
  color: #374151;
  border: none;
}
[data-theme="light"] .compose-action-pill:hover {
  background: #dfe2ea;
}
[data-theme="light"] .compose-action-pill.is-active {
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
}`,
  },
  {
    label: '4: .compose-icon-btn (schedule clock) matches the pill gray in light mode (not white)',
    find: `[data-theme="light"] .compose-row .compose-icon-btn {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.05);
  color: #374151;
}
[data-theme="light"] .compose-row .compose-icon-btn:hover:not(:disabled) {
  background: #f7f8fb;
}`,
    replace: `[data-theme="light"] .compose-row .compose-icon-btn {
  /* v0.10.185 — same gray as input + pills. No white square button. */
  background: #eaecf2;
  border-color: transparent;
  color: #374151;
}
[data-theme="light"] .compose-row .compose-icon-btn:hover:not(:disabled) {
  background: #dfe2ea;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.184 -> 0.10.185
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
  c = c.replace(/"version":\s*"0\.10\.184"/, '"version": "0.10.185"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.184 -> 0.10.185`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v185] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.184';`,
    replace: `const APP_VERSION = '0.10.185';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.185 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.184',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.185',
    date: 'June 18, 2026',
    highlight: 'Composer: no white anywhere — one coherent gray treatment.',
    changes: [
      { type: 'improved', text: 'Message composer no longer has any white surfaces. The outer panel is transparent (inherits the dialer\\'s page background); the text input, action pills (MMS / Quick reply / Emoji / Templates), and Schedule-send clock all share a single clear gray surface. The indigo Send pill is the only accent color.' },
    ],
  },
  {
    version: '0.10.184',`,
  },
]);

console.log('\n[apply-v185] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.185: Composer - no white surfaces, single coherent gray"');
console.log('  git tag v0.10.185');
console.log('  git push origin main');
console.log('  git push origin v0.10.185');
