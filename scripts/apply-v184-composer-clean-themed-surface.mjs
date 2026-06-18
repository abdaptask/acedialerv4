#!/usr/bin/env node
// v0.10.184 - Composer visual cleanup: themed surface, no stark white.
//
// REPORTED ISSUE
//   v0.10.183 fixed the Send pill + popovers, but the composer area
//   still appears as a stark white card because:
//   (a) .compose-area has NO explicit background, so it inherits the
//       page bg (which is near-white in light mode).
//   (b) The Schedule clock button uses .icon-btn (transparent / low-
//       opacity text) which looks odd against light surfaces.
//   (c) The visual layers (page bg / composer panel / input pill /
//       action pills) have insufficient contrast in light mode.
//
// FIXES
//   1. .compose-area gets an explicit themed surface so the composer
//      reads as a coherent footer panel — slightly off-white in light
//      mode (#f5f6fa), subtle elevation in dark mode. NO stark white.
//   2. .compose-icon-btn (the schedule clock) is restyled to match the
//      action pill aesthetic: rounded, themed background, no transparent
//      .icon-btn fallback.
//   3. .compose-input + .compose-action-pill get slightly more contrast
//      vs the new composer-area surface so the input/pills read as
//      distinct cards on the panel.
//
// VERSION BUMP: 0.10.183 -> 0.10.184

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v184] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v184] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v184] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v184] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. styles.css - composer surface, clock-button restyle, contrast pass
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1a: .compose-area gets explicit themed surface (no more stark white inheritance from page bg)',
    find: `/* v0.10.182 — Two-row composer container. Row 1 (.compose-row-input)
   holds the textarea + schedule clock + Send pill. Row 2
   (.compose-row-actions) holds the labeled action pills (MMS /
   Quick reply / emoji / Templates). */
.compose-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .compose-area {
  border-top-color: rgba(0, 0, 0, 0.06);
}`,
    replace: `/* v0.10.182 — Two-row composer container.
   v0.10.184 — Now has an explicit themed surface (slightly off-white in
   light mode, slight elevation in dark mode) so the composer reads as a
   coherent footer panel instead of a stark white card inherited from
   the page bg. */
.compose-area {
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
  },
  {
    label: '1b: .compose-input contrast bump vs the new composer-area surface (input now reads as a distinct card)',
    find: `[data-theme="light"] .compose-input {
  border-color: rgba(0, 0, 0, 0.08);
  background: #f1f3f7;
  color: #111827;
}
[data-theme="light"] .compose-input::placeholder {
  color: #9ca3af;
  opacity: 1;
}
[data-theme="light"] .compose-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: #eaecf2;
}`,
    replace: `[data-theme="light"] .compose-input {
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
  },
  {
    label: '1c: .compose-action-pill contrast bump in light mode (pill now slightly darker than composer-area for elevation)',
    find: `[data-theme="light"] .compose-action-pill {
  background: #f1f3f7;
  color: #374151;
}
[data-theme="light"] .compose-action-pill:hover {
  background: #e5e7ee;
}
[data-theme="light"] .compose-action-pill.is-active {
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
}`,
    replace: `[data-theme="light"] .compose-action-pill {
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
  },
  {
    label: '1d: .compose-icon-btn (schedule clock) restyled to match the action pill aesthetic, not the transparent .icon-btn',
    find: `.compose-row .send-btn .send-btn-label { line-height: 1; }

/* v0.10.182 — Two-row composer container.`,
    replace: `.compose-row .send-btn .send-btn-label { line-height: 1; }

/* v0.10.184 — Schedule-send clock button styled to match the action
   pill aesthetic instead of the transparent .icon-btn it inherited
   from. Same height as the Send pill (40px) so the input row reads
   as a balanced trio: input | clock | Send. */
.compose-row .compose-icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.compose-row .compose-icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.compose-row .compose-icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
[data-theme="light"] .compose-row .compose-icon-btn {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.05);
  color: #374151;
}
[data-theme="light"] .compose-row .compose-icon-btn:hover:not(:disabled) {
  background: #f7f8fb;
}

/* v0.10.182 — Two-row composer container.`,
  },
]);

// =====================================================================
// 2. Version bumps 0.10.183 -> 0.10.184
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
  c = c.replace(/"version":\s*"0\.10\.183"/, '"version": "0.10.184"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.183 -> 0.10.184`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.183 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v184] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.183';`,
    replace: `const APP_VERSION = '0.10.184';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.184 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.183',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.184',
    date: 'June 18, 2026',
    highlight: 'Composer: cleaner themed surface; clock matches the pill style.',
    changes: [
      { type: 'improved', text: 'The message composer footer panel now has a subtle themed background — slightly off-white in light mode, soft elevation in dark mode. No more stark white card on the page.' },
      { type: 'improved', text: 'The Schedule-send clock button matches the action pill aesthetic (rounded, themed surface) instead of the previous transparent icon button that popped oddly.' },
      { type: 'improved', text: 'Text input and action pills now use white-on-grey-panel contrast in light mode (cards on a panel) instead of grey-on-grey which blended together.' },
    ],
  },
  {
    version: '0.10.183',`,
  },
]);

console.log('\n[apply-v184] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.184: Composer themed surface + clock matches pill style"');
console.log('  git tag v0.10.184');
console.log('  git push origin main');
console.log('  git push origin v0.10.184');
