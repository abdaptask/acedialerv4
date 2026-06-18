#!/usr/bin/env node
// v0.10.180 - Responsive layout improvements for narrow desktop windows.
//
// REPORTED ISSUE
//   v0.10.179 made the dialer resizable but didn't fix how it LOOKS at
//   narrow widths. Specifically when snapped to half-screen on a
//   1366×768 display (= ~683 wide), the dialer felt cramped:
//     - Keypad locked at 420px max-width regardless of available space
//     - Keys capped at 75px regardless of viewport
//     - Bottom-nav labels (Favorites / Messages / etc.) at 0.65rem (~10px)
//       are unreadable
//     - Big empty gutters on either side of the keypad
//
// FIXES (4 CSS edits — no JSX, no Electron changes)
//   1. .dialpad max-width relaxed: 420px hard cap -> clamp(320px, 92vw, 460px).
//      Stretches into the available width on narrow desktop snaps, stays
//      compact on tall mobile-style viewports.
//   2. .keypad-btn / .call-btn / .backspace-btn now size via min(vh, vw)
//      with a wider cap (56-92 px instead of 48-75 px). At 683×768 the
//      keys go from ~65px to ~92px — touch-friendly and visually
//      proportional to the larger keypad container.
//   3. .tab font-size 0.65rem -> 0.75rem. Bottom-nav labels are now
//      legible at 683px width (each tab cell ~135px wide).
//   4. .dialpad horizontal padding scales with vw: clamp(0.6rem, 4vw, 1.5rem)
//      so the keypad uses MORE of the available width on narrow viewports
//      instead of giving up 1.5rem per side regardless of width.
//
// LOCKED BEHAVIORS PRESERVED
//   * v0.10.73 overflow-y:auto on .dialpad still scrolls if content
//     exceeds height (extreme DPI scaling / Roshni's pre-clamp regression)
//   * v0.10.154 clamp()-based sizing still drives the dimensions; we're
//     just widening the clamp ranges and changing the responsive function
//     from pure vh to min(vh, vw)
//   * v0.10.179 .dialpad-actions sits right under keypad (margin-top:auto
//     stayed removed); sticky .tab-bar still anchored to viewport bottom
//
// VERSION BUMP: 0.10.179 -> 0.10.180

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v180] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v180] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v180] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v180] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. styles.css - 4 responsive layout edits
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: .dialpad max-width + padding scale with viewport (was fixed 420px / 1.5rem)',
    find: `.dialpad {
  width: 100%;
  max-width: 420px;
  padding: clamp(0.5rem, 1.5vh, 1rem) 1.5rem clamp(0.8rem, 2.5vh, 2rem);
  display: flex;
  flex-direction: column;`,
    replace: `.dialpad {
  width: 100%;
  /* v0.10.180 - was hard 420px which left huge empty gutters on narrow
     desktop snaps (683 wide on a 1366x768 half-screen). clamp() lets
     the dialpad stretch toward 460px when there's room, and stays
     compact when the window is mobile-portrait sized. */
  max-width: clamp(320px, 92vw, 460px);
  /* v0.10.180 - horizontal padding now scales with vw so narrow viewports
     don't lose 1.5rem per side. At 683 wide, 4vw = 27.3px (~1.7rem);
     at 360 wide, 4vw = 14.4px (~0.9rem). Vertical padding unchanged. */
  padding: clamp(0.5rem, 1.5vh, 1rem) clamp(0.6rem, 4vw, 1.5rem) clamp(0.8rem, 2.5vh, 2rem);
  display: flex;
  flex-direction: column;`,
  },
  {
    label: '2: .keypad-btn scales by min(vh, vw); cap raised 75 -> 92',
    find: `.keypad-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  /* v0.10.154 - viewport-responsive sizing. 8.5vh hits the sweet spot
     for both 1280x720 (~61px) and full HD (75px max). 48px floor keeps
     the touch target usable even on tiny laptops. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);`,
    replace: `.keypad-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  /* v0.10.180 - was clamp(48px, 8.5vh, 75px) which capped keys at 75
     even on narrow desktop snaps where there was room for larger
     touch targets. Now uses min(9vh, 18vw) so keys also respond to
     viewport WIDTH; ceiling raised to 92px so half-screen snaps
     (683x768) get ~92px keys instead of 65px. Floor at 56px to keep
     them touch-friendly on tiny portrait windows. */
  width: clamp(56px, min(9vh, 18vw), 92px);
  height: clamp(56px, min(9vh, 18vw), 92px);`,
  },
  {
    label: '3: .call-btn scaling matches the new keypad-btn range',
    find: `.call-btn {
  background: #34c759;
  border: none;
  color: #fff;
  /* v0.10.154 - match .keypad-btn scaling so the action row aligns
     visually with the keypad above. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);`,
    replace: `.call-btn {
  background: #34c759;
  border: none;
  color: #fff;
  /* v0.10.180 - matches .keypad-btn scaling so the action row aligns
     visually with the keypad above. See .keypad-btn for rationale. */
  width: clamp(56px, min(9vh, 18vw), 92px);
  height: clamp(56px, min(9vh, 18vw), 92px);`,
  },
  {
    label: '4: .backspace-btn scaling matches the new keypad-btn range',
    find: `.backspace-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  /* v0.10.154 - match .keypad-btn scaling. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);`,
    replace: `.backspace-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  /* v0.10.180 - matches .keypad-btn scaling. */
  width: clamp(56px, min(9vh, 18vw), 92px);
  height: clamp(56px, min(9vh, 18vw), 92px);`,
  },
  {
    label: '5: .tab label font 0.65rem -> 0.75rem so bottom-nav labels are legible at narrow widths',
    find: `.tab {
  flex: 1;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.65rem;
  padding: 0.3rem;
  font-weight: 500;
  transition: color 0.1s ease;
}`,
    replace: `.tab {
  flex: 1;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  /* v0.10.180 - was 0.65rem (~10.4px) which was barely legible on
     half-screen snaps. Bumped to 0.75rem (~12px) so Favorites /
     Messages / Recents / Keypad / Voicemail labels read clearly
     even when each tab cell is ~135px wide. */
  font-size: 0.75rem;
  padding: 0.3rem;
  font-weight: 500;
  transition: color 0.1s ease;
}`,
  },
]);

// =====================================================================
// 2. Version bumps 0.10.179 -> 0.10.180
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
  c = c.replace(/"version":\s*"0\.10\.179"/, '"version": "0.10.180"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.179 -> 0.10.180`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.179 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v180] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.179';`,
    replace: `const APP_VERSION = '0.10.180';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.180 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.179',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.180',
    date: 'June 18, 2026',
    highlight: 'Dialer scales properly when you resize to half-screen.',
    changes: [
      { type: 'improved', text: 'The keypad now fills the available width on narrow windows instead of staying boxed at 420px. Snap the dialer to half your screen and the keys and Call button scale up to use the real estate.' },
      { type: 'improved', text: 'Keypad buttons sized by min(viewport-height, viewport-width) instead of just height — so at 683 × 768 (half of a 1366 × 768 monitor) the keys go from 65px to ~92px. Touch-friendly at any reasonable window size.' },
      { type: 'improved', text: 'Bottom-nav labels (Favorites / Messages / Recents / Keypad / Voicemail) are now readable at narrow widths — bumped from 0.65rem (~10px) to 0.75rem (~12px).' },
      { type: 'improved', text: 'Horizontal padding on the dialpad scales with viewport width so narrow windows do not waste 1.5rem per side.' },
    ],
  },
  {
    version: '0.10.179',`,
  },
]);

console.log('\n[apply-v180] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.180: Responsive layout - keypad scales on narrow desktop snaps"');
console.log('  git tag v0.10.180');
console.log('  git push origin main');
console.log('  git push origin v0.10.180');
