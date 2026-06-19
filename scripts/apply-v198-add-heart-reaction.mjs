#!/usr/bin/env node
// v0.10.198 - Add ❤️ to the reaction picker.
//
// v0.10.197 set QUICK_REACTIONS to mirror the composer's EMOJI_OPTIONS
// (24 emojis), but that set is composer-typing-oriented — it doesn't
// include ❤️, the most-used reaction emoji in any messaging app.
//
// Fix: add ❤️ as the FIRST item in QUICK_REACTIONS (it's the
// highest-frequency reaction, so it should be the easiest to hit).
// Total reactions: 25. Picker grid switches from 4×6 → 5×5 to stay
// balanced (no orphan emoji on the last row).
//
// The composer's EMOJI_OPTIONS is UNCHANGED — keep that set focused on
// typing-friendly faces. Reactions and composer-insert sets are
// allowed to diverge from this point forward.
//
// FILES TOUCHED
//   apps/web/src/lib/messageReactions.ts — QUICK_REACTIONS expanded to 25
//   apps/web/src/styles.css               — grid 6 cols → 5 cols
//
// VERSION BUMP: 0.10.197 -> 0.10.198

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v198] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v198] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v198] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v198] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// messageReactions.ts — add ❤️ as first item, total = 25
// =====================================================================
applyEdits('apps/web/src/lib/messageReactions.ts', [
  {
    label: '1: add ❤️ as first reaction, expand to 25',
    find: `/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover.
 *  v0.10.197 — Expanded from the original 6 iMessage Tapback to the
 *  full 24 the composer's emoji picker uses (apps/web/src/pages/
 *  Messages.tsx:104 EMOJI_OPTIONS). Keep this list in sync if the
 *  composer set ever changes. */
export const QUICK_REACTIONS: readonly string[] = [
  '😀', '😂', '🙂', '😉', '😎', '🥲', '😊', '🤔', '😴', '🙄', '😅', '😭',
  '👍', '👎', '👌', '🙏', '👏', '🙌', '✌️', '🤝', '🔥', '🎉', '✅', '❌',
];`,
    replace: `/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover.
 *  v0.10.197 — Expanded from the original 6 iMessage Tapback to the
 *  composer's 24-emoji catalog.
 *  v0.10.198 — Reactions diverge from the composer set: ❤️ added as the
 *  first item (highest-frequency reaction in any messaging app; the
 *  composer set was missing it). Total: 25, rendered as a 5×5 grid. */
export const QUICK_REACTIONS: readonly string[] = [
  '❤️', '😀', '😂', '🙂', '😉',
  '😎', '🥲', '😊', '🤔', '😴',
  '🙄', '😅', '😭', '👍', '👎',
  '👌', '🙏', '👏', '🙌', '✌️',
  '🤝', '🔥', '🎉', '✅', '❌',
];`,
  },
]);

// =====================================================================
// styles.css — grid 6 cols → 5 cols for the 25-emoji layout
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '2: reaction picker grid 6 cols → 5 cols (5×5 for 25 emojis)',
    find: `.bubble-reaction-picker-row {
  /* v0.10.197 — 4 rows × 6 columns to accommodate the 24-emoji set
     (was a single row of 6 in v0.10.195). gap stays at 4px; fixed
     6-column track keeps each emoji button at a predictable size. */
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  justify-items: stretch;
}`,
    replace: `.bubble-reaction-picker-row {
  /* v0.10.197 → v0.10.198 — 5 rows × 5 columns for 25 emojis
     (24 from the composer catalog + ❤️). 5-wide gives slightly larger
     emoji buttons than 6-wide, which is nicer to tap. */
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  justify-items: stretch;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.197 -> 0.10.198
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
  c = c.replace(/"version":\s*"0\.10\.197"/, '"version": "0.10.198"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.197 -> 0.10.198`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v198] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.197';`,
    replace: `const APP_VERSION = '0.10.198';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.198 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.197',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.198',
    date: 'June 19, 2026',
    highlight: 'Reactions: ❤️ added (the most-used reaction).',
    changes: [
      { type: 'improved', text: 'The reaction picker now includes ❤️ as the first emoji — the most-used reaction in any messaging app. Total reactions: 25, rendered as a balanced 5×5 grid.' },
    ],
  },
  {
    version: '0.10.197',`,
  },
]);

console.log('\n[apply-v198] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.198: Add heart reaction; reactions grid 5x5 (25 emojis)"');
console.log('  git tag v0.10.198');
console.log('  git push origin main');
console.log('  git push origin v0.10.198');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover an inbound bubble, click the smile-face button.');
console.log('  2. Picker opens as a 5×5 grid with ❤️ as the FIRST emoji (top-left).');
console.log('  3. Click ❤️. It appears as a chip under the bubble.');
