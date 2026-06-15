#!/usr/bin/env node
// v0.10.154 - Responsive dialpad: smooth scaling across all resolutions.
//
// PROBLEM:
//   At 1366x768 (common corporate laptop resolution) the maximized
//   Electron window has ~738px of viewport height. Existing v0.10.136
//   media query only kicks in at max-height: 720px - i.e. 18px below
//   what the user actually has - so buttons stay at 75px and the Call
//   button gets pushed under the bottom nav, partially clipped.
//
// FIX:
//   Replace fixed 75px sizes + 720px-only media query with CSS clamp()
//   based on viewport-height units. The keypad smoothly scales between
//   48px (chromebook-style 600px viewport) and 75px (1080p+) without
//   abrupt breakpoint jumps. Same goes for gaps, paddings, and the
//   digit font size.
//
// MATH AT KEY RESOLUTIONS:
//   600px viewport: button = 51px (clamp min holds at 48px - 51px)
//   720px viewport: button = 61px  (1280x720 target, clean fit)
//   738px viewport: button = 63px  (your 1366x768 case, was broken)
//   800px viewport: button = 68px
//   900px+ viewport: button = 75px (clamp max holds, same as today)
//
// SCOPE:
//   Only touches apps/web/src/styles.css. No JS/TSX changes.
//   The existing v0.10.136 media query is REMOVED (clamp covers it).
//
// VERSION BUMP: 0.10.153 -> 0.10.154

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v154] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v154] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v154] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v154] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// styles.css edits
// ---------------------------------------------------------------------
applyEdits('apps/web/src/styles.css', [
  // 1. .dialpad padding -> clamp
  {
    label: '.dialpad padding clamp',
    find: `/* ============ DIALPAD ============ */
.dialpad {
  width: 100%;
  max-width: 420px;
  padding: 1rem 1.5rem 2rem;`,
    replace: `/* ============ DIALPAD ============ */
/* v0.10.154 - all sizing here is viewport-height-responsive via clamp().
   No more abrupt media-query jumps; the dialpad scales smoothly from
   600px viewports (chromebook) up to 1080p+ desktops. Min is sized so a
   1280x720 window remains touch-comfortable; max preserves the original
   v0.10.x look on tall screens. */
.dialpad {
  width: 100%;
  max-width: 420px;
  padding: clamp(0.5rem, 1.5vh, 1rem) 1.5rem clamp(0.8rem, 2.5vh, 2rem);`,
  },

  // 2. Replace the entire v0.10.136 media query with a tombstone comment
  {
    label: 'remove v0.10.136 max-height:720 media query (clamp covers it)',
    find: `/* v0.10.136 - UX-007 - shrink the dialpad on short viewports.
   1366x768 with Windows 125% DPI scaling = ~480 device-pixel height for
   the dialpad after tab bar + header + (sometimes) update-banner +
   return-to-call-banner. The pre-fix keypad needed ~525px. The buttons
   below get reduced from 72px to 60px which saves enough vertical space
   for the green call button to sit fully on screen without scrolling.
   No effect on taller viewports (the media query bails out above 720px). */
@media (max-height: 720px) {
  .keypad-btn,
  .call-btn,
  .backspace-btn,
  .contacts-btn { width: 60px; height: 60px; }
  .keypad-btn .digit { font-size: 1.7rem; }
  .keypad { gap: 0.7rem 0; }
  .dialpad-actions { padding-top: 0.8rem; }
  .number-display { padding: 0.7rem 0.5rem; min-height: 3.4rem; }
}`,
    replace: `/* v0.10.154 - REMOVED the v0.10.136 max-height:720 media query.
   It was the wrong abstraction: 1366x768 maximized Electron windows give
   ~738px of viewport - JUST above the 720px threshold - so the query
   never fired and the keypad overflowed. Replaced with clamp()-based
   sizing on the individual rules below, which scales smoothly with
   viewport height across ALL resolutions (no abrupt boundary).
   See .keypad-btn / .keypad / .call-btn / .number-display below. */`,
  },

  // 3. .number-display padding/min-height -> clamp
  {
    label: '.number-display clamp padding + min-height',
    find: `.number-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.2rem 0.5rem;
  min-height: 4.5rem;
  width: 100%;
  max-width: 440px;`,
    replace: `.number-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  /* v0.10.154 - scale with viewport. At 720px ~ 65px tall; at 1080px ~ 72px. */
  padding: clamp(0.5rem, 1.6vh, 1.2rem) 0.5rem;
  min-height: clamp(2.8rem, 7vh, 4.5rem);
  width: 100%;
  max-width: 440px;`,
  },

  // 4. .keypad gap -> clamp
  {
    label: '.keypad gap clamp',
    find: `.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.1rem 0;
  justify-items: center;
  margin-bottom: 0.5rem;
}`,
    replace: `.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  /* v0.10.154 - row gap scales with viewport so the 4 keypad rows + the
     action row all fit on shorter screens. */
  gap: clamp(0.4rem, 1.3vh, 1.1rem) 0;
  justify-items: center;
  margin-bottom: 0.5rem;
}`,
  },

  // 5. .keypad-btn width/height -> clamp
  {
    label: '.keypad-btn width/height clamp',
    find: `.keypad-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  width: 75px;
  height: 75px;
  border-radius: 50%;`,
    replace: `.keypad-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  /* v0.10.154 - viewport-responsive sizing. 8.5vh hits the sweet spot
     for both 1280x720 (~61px) and full HD (75px max). 48px floor keeps
     the touch target usable even on tiny laptops. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);
  border-radius: 50%;`,
  },

  // 6. .keypad-btn .digit font-size -> clamp
  {
    label: '.keypad-btn .digit font-size clamp',
    find: `.keypad-btn .digit {
  font-size: 2.1rem;
  font-weight: 400;
  line-height: 1;
}`,
    replace: `.keypad-btn .digit {
  /* v0.10.154 - scale digit size with button size. At 720px viewport
     ~1.55rem; at 1080px ~2.1rem (max). */
  font-size: clamp(1.3rem, 3vh, 2.1rem);
  font-weight: 400;
  line-height: 1;
}`,
  },

  // 7. .dialpad-actions padding-top -> clamp
  {
    label: '.dialpad-actions padding-top clamp',
    find: `.dialpad-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  justify-items: center;
  padding-top: 1.5rem;
  align-items: center;`,
    replace: `.dialpad-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  justify-items: center;
  /* v0.10.154 - scales with viewport so the call button isn't pushed
     under the bottom nav on 720p screens. */
  padding-top: clamp(0.5rem, 1.6vh, 1.5rem);
  align-items: center;`,
  },

  // 8. .call-btn width/height -> clamp
  {
    label: '.call-btn width/height clamp',
    find: `.call-btn {
  background: #34c759;
  border: none;
  color: #fff;
  width: 75px;
  height: 75px;
  border-radius: 50%;`,
    replace: `.call-btn {
  background: #34c759;
  border: none;
  color: #fff;
  /* v0.10.154 - match .keypad-btn scaling so the action row aligns
     visually with the keypad above. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);
  border-radius: 50%;`,
  },

  // 9. .backspace-btn width/height -> clamp
  {
    label: '.backspace-btn width/height clamp',
    find: `.backspace-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  width: 75px;
  height: 75px;
  display: flex;`,
    replace: `.backspace-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  /* v0.10.154 - match .keypad-btn scaling. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);
  display: flex;`,
  },

  // 10. .contacts-btn width/height -> clamp
  {
    label: '.contacts-btn width/height clamp',
    find: `.contacts-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  width: 75px;
  height: 75px;
  border-radius: 50%;`,
    replace: `.contacts-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  /* v0.10.154 - match .keypad-btn scaling. */
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);
  border-radius: 50%;`,
  },

  // 11. .contacts-btn svg + .contacts-btn-spacer -> clamp
  {
    label: '.contacts-btn svg + .contacts-btn-spacer clamp',
    find: `.contacts-btn svg { width: 28px; height: 28px; }
.contacts-btn-spacer { display: block; width: 75px; height: 75px; }`,
    replace: `/* v0.10.154 - SVG and spacer scale with their parents. */
.contacts-btn svg {
  width: clamp(20px, 3.5vh, 28px);
  height: clamp(20px, 3.5vh, 28px);
}
.contacts-btn-spacer {
  display: block;
  width: clamp(48px, 8.5vh, 75px);
  height: clamp(48px, 8.5vh, 75px);
}`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.153 -> 0.10.154
// ---------------------------------------------------------------------
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) {
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.153"/, '"version": "0.10.154"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.153 -> 0.10.154`);
  } else {
    console.log(`  - ${rp}: no 0.10.153 found (run apply-v153-* first?)`);
  }
}

// DiagnosticsSection
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.153';`,
    replace: `const APP_VERSION = '0.10.154';`,
  },
]);

// whatsNew
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.154 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.153',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.154',
    date: 'June 15, 2026',
    highlight: 'Dialpad now scales properly on lower-resolution screens.',
    changes: [
      { type: 'fixed', text: 'On 1366x768 laptops and other lower-resolution screens, the call button sometimes got pushed off-screen by the keypad. The dialpad now scales smoothly with your window size, so the call button stays fully visible at any resolution from 1280x720 up.' },
    ],
  },
  {
    version: '0.10.153',`,
  },
]);

console.log('\n[apply-v154] DONE');
console.log('');
console.log('TEST PLAN:');
console.log('  1. npm run dev (or build + install) the web bundle');
console.log('  2. Test at MULTIPLE window sizes by dragging the Electron window:');
console.log('     - Maximized at 1366x768 -> Call button visible, all elements fit');
console.log('     - Dragged to ~800px tall -> proportionally smaller keypad');
console.log('     - Dragged to ~1000px tall -> back to original 75px buttons');
console.log('  3. Visual smoke check: the dialpad shouldnt look CRAMPED or too');
console.log('     SPARSE - the proportions should feel natural at every size.');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.154: responsive dialpad - scales smoothly across resolutions"');
console.log('  git tag v0.10.154');
console.log('  git push origin main');
console.log('  git push origin v0.10.154');
