#!/usr/bin/env node
// v0.10.179 - Window resize flexibility + dialpad call-button position fix.
//
// REPORTED ISSUES
//   * Exit-fullscreen sometimes hides the bottom nav.
//   * Resizing the window can push the green Call button off-screen.
//   * Hard minimum window size of 900x800 prevents using the dialer as a
//     small floater alongside other apps.
//   * On wide windows, the Call button sits at the very bottom of the
//     viewport, far from the keypad keys (the v0.10.176-deferred fix).
//
// FIXES
//   1. Electron main window minWidth/minHeight dropped 900x800 -> 360x500.
//      Phone-portrait-ish minimums so users can shrink the window for
//      multi-window workflows.
//   2. .app-shell now uses both `height: 100vh` AND `height: 100dvh`.
//      Dynamic viewport height (dvh) responds correctly during fullscreen
//      transitions where stale 100vh can briefly push the bottom row out
//      of the visible area. Browsers that don't support dvh fall back to
//      vh. Belt-and-suspenders.
//   3. .tab-bar gets `position: sticky; bottom: 0; z-index: 100`. Even if
//      the grid math wobbles during a resize/fullscreen transition, the
//      bottom nav stays anchored to the visible bottom edge.
//   4. .dialpad-actions loses `margin-top: auto`. The action row (Call
//      button + contacts + backspace) now sits directly below the keypad
//      with only its natural padding-top gap, instead of being pushed
//      to the bottom of the dialpad container. On wide / tall windows,
//      this puts the Call button visually next to the keypad keys
//      (matches the screenshot Abd shared in the v0.10.176 review).
//
// LOCKED BEHAVIORS PRESERVED
//   * .dialpad keeps `min-height: 100%` + `overflow-y: auto` so content
//     still scrolls if it overflows on very short viewports (the v0.10.73
//     fix for Roshni's 480px clipping).
//   * .keypad-btn / .call-btn / .number-display still use the
//     clamp()-based scaling from v0.10.154 - that handles narrow
//     viewports automatically as the window shrinks.
//
// VERSION BUMP: 0.10.178 -> 0.10.179

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v179] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v179] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v179] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v179] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Electron main window - drop minWidth / minHeight
// =====================================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: '1: lower minWidth/minHeight so the dialer can shrink for multi-window use',
    find: `    // v0.10.73 — Bumped minWidth/minHeight to ensure the dialpad fits at
    // common Windows DPI scalings. At 125% scaling (very common on
    // 1920×1080 laptops), the previous minHeight=600 gave CSS only ~480px
    // of vertical space — not enough for the full keypad. The top row
    // (1-2-3 + number input) was clipping off the visible area in
    // Roshni's case. New values give ~640 CSS pixels at 125% which fits
    // the keypad comfortably; the new in-app overflow:auto on .dialpad
    // is the belt-and-suspenders fallback when the user still drags the
    // window smaller than this.
    minWidth: 900,
    minHeight: 800,`,
    replace: `    // v0.10.179 — Dropped from 900x800 to 360x500 so the dialer can be
    // shrunk to a small floater alongside other apps (multi-window day-
    // to-day use). The v0.10.154 clamp()-based responsive sizing on
    // .keypad-btn / .call-btn / .number-display handles the narrow
    // viewport gracefully, and .dialpad still has overflow-y:auto as
    // a belt-and-suspenders fallback if content exceeds the visible
    // area at unusual DPI scalings.
    // Original v0.10.73 rationale (DPI-scaled keypad clipping in
    // Roshni's case) is now handled by the clamp()-based sizing rather
    // than by a hard window-size minimum.
    minWidth: 360,
    minHeight: 500,`,
  },
]);

// =====================================================================
// 2. CSS - .app-shell uses 100dvh fallback + .tab-bar sticky + dialpad
//    actions no longer pinned to bottom.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '2: .app-shell uses dvh fallback so exit-fullscreen transitions do not push the bottom row offscreen',
    find: `.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;`,
    replace: `.app-shell {
  /* v0.10.179 — dvh (dynamic viewport height) updates correctly during
     fullscreen <-> windowed transitions on Electron / modern browsers.
     vh stays as a fallback for older engines. Without this, the stale
     100vh value during an exit-fullscreen transition briefly made the
     grid taller than the actual viewport, pushing the bottom nav (row
     3 of the grid) out of view. */
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;`,
  },
  {
    label: '3: .tab-bar gets sticky bottom positioning so it stays visible during resize',
    find: `/* ============ TAB BAR ============ */
.tab-bar {
  display: flex;
  background: rgba(0, 0, 0, 0.92);
  border-top: 0.5px solid rgba(255, 255, 255, 0.12);
  padding: 0.4rem 0 0.6rem;
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}`,
    replace: `/* ============ TAB BAR ============ */
.tab-bar {
  display: flex;
  background: rgba(0, 0, 0, 0.92);
  border-top: 0.5px solid rgba(255, 255, 255, 0.12);
  padding: 0.4rem 0 0.6rem;
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  /* v0.10.179 — sticky positioning so the bottom nav stays anchored to
     the visible bottom of the window even if the .app-shell grid math
     briefly mis-allocates during a resize or fullscreen transition.
     Bottom:0 pins it to the viewport's bottom edge; z-index keeps it
     above any page content that might overflow into the bottom row. */
  position: sticky;
  bottom: 0;
  z-index: 100;
}`,
  },
  {
    label: '4: .dialpad-actions drops margin-top:auto so the Call button sits next to the keypad keys',
    find: `.dialpad-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  justify-items: center;
  /* v0.10.154 - scales with viewport so the call button isn't pushed
     under the bottom nav on 720p screens. */
  padding-top: clamp(0.5rem, 1.6vh, 1.5rem);
  align-items: center;
  /* v0.10.73 — Push to the bottom of the dialpad container when there's
     extra room (so the dial button visually anchors at the bottom on
     tall viewports — matches the look that the old justify-content:flex-end
     on .dialpad gave us). When the dialpad is SHORTER than its content,
     this stops being effective and the actions naturally follow the
     content stack, with the user able to scroll. Best of both. */
  margin-top: auto;
}`,
    replace: `.dialpad-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  justify-items: center;
  /* v0.10.154 - scales with viewport so the call button isn't pushed
     under the bottom nav on 720p screens. */
  padding-top: clamp(0.5rem, 1.6vh, 1.5rem);
  align-items: center;
  /* v0.10.179 — REMOVED margin-top:auto. The v0.10.73 anchoring made the
     Call button hug the viewport bottom on tall/wide windows, leaving a
     visual gap between the keypad keys and the green button — flagged
     during the v0.10.176 review. Now the action row sits directly below
     the keypad with the natural padding-top gap. Empty space below the
     dialpad on tall windows is acceptable (better than the disconnected
     button), and the .dialpad container still has overflow-y:auto for
     short viewports. */
}`,
  },
]);

// =====================================================================
// 3. Version bumps 0.10.178 -> 0.10.179
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
  c = c.replace(/"version":\s*"0\.10\.178"/, '"version": "0.10.179"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.178 -> 0.10.179`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.178 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v179] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.178';`,
    replace: `const APP_VERSION = '0.10.179';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.179 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.178',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.179',
    date: 'June 18, 2026',
    highlight: 'Resize the dialer freely + Call button sits next to the keypad.',
    changes: [
      { type: 'improved', text: 'The dialer window can now be resized down to a small floater (360 × 500 px) instead of being locked at 900 × 800. Use it alongside your other apps without dedicating half your screen.' },
      { type: 'fixed', text: 'Bottom navigation (Favorites / Messages / Recents / Keypad / Voicemail) no longer disappears after exiting fullscreen or while you are dragging the window edges around.' },
      { type: 'fixed', text: 'The green Call button on the keypad now sits directly below the number keys instead of being anchored to the bottom of the window. On wide screens, no more giant gap between the keypad and the Call button.' },
    ],
  },
  {
    version: '0.10.178',`,
  },
]);

console.log('\n[apply-v179] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.179: Resize flexibility + Call button next to keypad"');
console.log('  git tag v0.10.179');
console.log('  git push origin main');
console.log('  git push origin v0.10.179');
