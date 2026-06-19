#!/usr/bin/env node
// v0.10.197 - Two reactions fixes in one release:
//
// 1. POSITION FIX (the "no bubbles appear" symptom Abd hit after v196).
//    `.msg-stream .bubble.in` did NOT have `position: relative`, so the
//    hover-revealed add-reaction button (position: absolute; top: 4px;
//    right: 6px) anchored to the viewport instead of the bubble. The
//    button still rendered, just at the top-right of the screen.
//    .bubble.out got position: relative back in v0.10.191 (for the
//    delivery tick), but inbound never did.
//    Fix: add `position: relative` to the BASE `.msg-stream .bubble`
//    rule so both directions are anchored.
//
// 2. MORE REACTIONS (Abd: "add all 24 emoticons to the reactions..
//    not just 6"). Expand the quick-reaction set from the iMessage
//    Tapback six (❤️ 👍 👎 😂 ‼️ ❓) to all 24 emojis that the
//    composer's emoji picker uses (apps/web/src/pages/Messages.tsx:104).
//    Reuses the exact same set so reactions and composer-insert
//    surface the same catalog.
//    Picker layout changes from a single horizontal row to a 4×6 grid
//    so all 24 fit without horizontal scroll.
//
// FILES TOUCHED
//   apps/web/src/lib/messageReactions.ts — QUICK_REACTIONS expanded
//   apps/web/src/styles.css               — position: relative on bubble
//                                          base; reaction picker grid
//
// VERSION BUMP: 0.10.196 -> 0.10.197

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v197] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v197] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v197] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v197] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// messageReactions.ts — expand QUICK_REACTIONS from 6 → 24.
// Mirrors the composer's EMOJI_OPTIONS exactly so users see the same
// set in both places.
// =====================================================================
applyEdits('apps/web/src/lib/messageReactions.ts', [
  {
    label: '1: QUICK_REACTIONS expanded from 6 (Tapback) to 24 (composer parity)',
    find: `/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover. Matches the iMessage Tapback set. The full
 *  emoji picker integration is deferred to v0.10.196+. */
export const QUICK_REACTIONS: readonly string[] = ['❤️', '👍', '👎', '😂', '‼️', '❓'];`,
    replace: `/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover.
 *  v0.10.197 — Expanded from the original 6 iMessage Tapback to the
 *  full 24 the composer's emoji picker uses (apps/web/src/pages/
 *  Messages.tsx:104 EMOJI_OPTIONS). Keep this list in sync if the
 *  composer set ever changes. */
export const QUICK_REACTIONS: readonly string[] = [
  '😀', '😂', '🙂', '😉', '😎', '🥲', '😊', '🤔', '😴', '🙄', '😅', '😭',
  '👍', '👎', '👌', '🙏', '👏', '🙌', '✌️', '🤝', '🔥', '🎉', '✅', '❌',
];`,
  },
]);

// =====================================================================
// styles.css
//   Edit 2: add position: relative to the BASE .msg-stream .bubble rule
//   Edit 3: change .bubble-reaction-picker-row to a 4×6 grid layout
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '2: position: relative on base .msg-stream .bubble (fixes inbound anchor)',
    find: `/* --- Bubble look (override existing .bubble.out / .bubble.in) ------ */
.msg-stream .bubble {
  margin: 0;
  padding: 8px 12px;
  max-width: 100%;
  border-radius: 18px;
  word-break: break-word;
  line-height: 1.35;
}`,
    replace: `/* --- Bubble look (override existing .bubble.out / .bubble.in) ------ */
.msg-stream .bubble {
  margin: 0;
  padding: 8px 12px;
  max-width: 100%;
  border-radius: 18px;
  word-break: break-word;
  line-height: 1.35;
  /* v0.10.197 — Required so v0.10.195 reaction children (add-button
     and picker popover, both position:absolute) anchor to the bubble
     box instead of the viewport. v0.10.191 set this on .bubble.out
     for the delivery tick; this base rule now covers .bubble.in too. */
  position: relative;
}`,
  },
  {
    label: '3: reaction picker row -> 4x6 grid for the expanded 24-emoji set',
    find: `.bubble-reaction-picker-row {
  display: flex;
  gap: 4px;
  justify-content: space-between;
}`,
    replace: `.bubble-reaction-picker-row {
  /* v0.10.197 — 4 rows × 6 columns to accommodate the 24-emoji set
     (was a single row of 6 in v0.10.195). gap stays at 4px; fixed
     6-column track keeps each emoji button at a predictable size. */
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  justify-items: stretch;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.196 -> 0.10.197
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
  c = c.replace(/"version":\s*"0\.10\.196"/, '"version": "0.10.197"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.196 -> 0.10.197`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v197] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.196';`,
    replace: `const APP_VERSION = '0.10.197';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.197 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.196',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.197',
    date: 'June 19, 2026',
    highlight: 'Reactions: fixed inbound bubbles + 24 emojis instead of 6.',
    changes: [
      { type: 'fixed', text: 'On inbound message bubbles, the hover-reveal reaction button was rendering off-screen due to a missing position-relative anchor. Now appears correctly at the bubble corner.' },
      { type: 'improved', text: 'Reaction picker now shows all 24 emojis in a 4×6 grid (same set as the composer picker), not just 6.' },
    ],
  },
  {
    version: '0.10.196',`,
  },
]);

console.log('\n[apply-v197] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.197: Bubble position-relative + 24-emoji reaction picker"');
console.log('  git tag v0.10.197');
console.log('  git push origin main');
console.log('  git push origin v0.10.197');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover an inbound bubble. The smile-face button now appears at');
console.log('     the top-right CORNER of THE BUBBLE (not the screen).');
console.log('  2. Click it. Picker opens with a 4×6 grid of 24 emojis.');
console.log('  3. Click any emoji. Appears as a chip below the bubble.');
console.log('  4. Outbound bubbles still have no reaction button (v0.10.196 gate).');
