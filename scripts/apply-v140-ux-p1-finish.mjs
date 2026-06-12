#!/usr/bin/env node
// v0.10.140 - UX P1 finish: closes the remaining 5 P1 findings from UI_UX_AUDIT.md.
//
// UX-002: prefers-reduced-motion handling for all looping animations
// UX-006: mid-range responsive breakpoint (800-1100px) + QHD expansion (>= 1800px)
// UX-009: --text-muted alpha 0.55 → 0.68 (WCAG AA compliance on .surface backgrounds)
// UX-010: bump touch targets <=32px for accessibility (multiple selectors)
// UX-014: max-height + overflow-y on .user-menu so it stays reachable on short viewports

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v140] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v140] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v140] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v140] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// styles.css - UX-009 (text-muted alpha), UX-010 (touch targets),
// UX-014 (user-menu scroll). UX-002 + UX-006 appended at end.
// ===========================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-009: bump --text-muted alpha 0.55 → 0.68 for WCAG AA contrast on .surface',
    find: `  --text-muted: rgba(235, 235, 245, 0.55);`,
    replace: `  /* v0.10.140 - UX-009 - bumped from 0.55 to 0.68 alpha. Previous
     value yielded ~4.3:1 contrast on .surface backgrounds (below WCAG
     AA threshold for normal text). New value gives ~5.3:1 on surface
     and ~6.2:1 on plain dark background. Light-mode #545458 unchanged. */
  --text-muted: rgba(235, 235, 245, 0.68);`,
  },
  {
    label: 'UX-010: bump .quick-reply-action 26×26 → 32×32',
    find: `.quick-reply-action {
  background: rgba(235, 235, 245, 0.16);
  border: none;
  color: #fff;
  width: 26px;
  height: 26px;`,
    replace: `.quick-reply-action {
  background: rgba(235, 235, 245, 0.16);
  border: none;
  color: #fff;
  /* v0.10.140 - UX-010 - bumped from 26x26 to 32x32 for touch target a11y. */
  width: 32px;
  height: 32px;`,
  },
  {
    label: 'UX-010: bump .update-banner-dismiss 24×24 → 32×32',
    find: `.update-banner-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;`,
    replace: `.update-banner-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* v0.10.140 - UX-010 - bumped from 24x24 to 32x32 for touch target a11y. */
  width: 32px;
  height: 32px;`,
  },
  {
    label: 'UX-010: bump .vm-action 30×30 → 36×36',
    find: `.vm-action {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  width: 30px;
  height: 30px;`,
    replace: `.vm-action {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  /* v0.10.140 - UX-010 - bumped from 30x30 to 36x36 for touch target a11y. */
  width: 36px;
  height: 36px;`,
  },
  {
    label: 'UX-010: bump .pending-action-icon 28×28 → 32×32',
    find: `.pending-action-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;`,
    replace: `.pending-action-icon {
  display: inline-flex; align-items: center; justify-content: center;
  /* v0.10.140 - UX-010 - bumped from 28x28 to 32x32 for touch target a11y. */
  width: 32px; height: 32px; border-radius: 6px;`,
  },
  {
    label: 'UX-010: bump .incoming-btn.small 40×40 → 56×56 (critical Accept/Decline)',
    find: `.incoming-btn.small {
  width: 40px;
  height: 40px;`,
    replace: `.incoming-btn.small {
  /* v0.10.140 - UX-010 - bumped from 40x40 to 56x56. This is the
     Accept/Decline button on the non-fullscreen incoming-call banner -
     the most time-critical action of the entire app. The smaller
     40x40 size was below ergonomic threshold at 1366x768 / 125% DPI
     (~27 device pixels). 56x56 matches the visual hierarchy of the
     full-screen variants (Accept primary, Hold & Accept, Decline). */
  width: 56px;
  height: 56px;`,
  },
  {
    label: 'UX-014: add max-height + overflow-y to .user-menu for short viewports',
    find: `.user-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 240px;
  background: #1c1c1e;
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  z-index: 50;
  animation: dropdown-in 0.12s ease-out;
}`,
    replace: `.user-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 240px;
  background: #1c1c1e;
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  z-index: 50;
  animation: dropdown-in 0.12s ease-out;
  /* v0.10.140 - UX-014 - defensive scroll for short viewports / future
     items being added. Combined with the global hide-scrollbars rule
     this is invisible-but-functional vertical scroll. */
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}`,
  },
  {
    label: 'UX-002 + UX-006: append accessibility + responsive media queries at end of file',
    find: `.teams-settings-help ol {
  margin: 10px 0 0;
  padding-left: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: rgba(255, 255, 255, 0.78)`,
    replace: `.teams-settings-help ol {
  margin: 10px 0 0;
  padding-left: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: rgba(255, 255, 255, 0.78);
}

/* ============================================================
   v0.10.140 — UX-002 — prefers-reduced-motion handling.
   ============================================================
   The dialer has 11+ continuous animations (incoming-pulse,
   rtc-pulse, status-pulse, presence-pulse, did-spin, etc.).
   Users with vestibular sensitivity or who've disabled animations
   in their OS preferences shouldn't see any motion. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* Keep the REC dot solid white instead of pulsing to low opacity. */
  .rec-dot { opacity: 1 !important; }
}

/* ============================================================
   v0.10.140 — UX-006 — mid-range responsive breakpoints.
   ============================================================
   Existing breakpoints all sit at <= 900px (mobile/tablet). Nothing
   between 901px and infinity. Below adds (a) a tighter Settings
   layout for 800-1100px range (common business laptop viewport at
   125% DPI), and (b) wider content cap for QHD+ displays so tables
   and lists breathe instead of sitting in 50% gutters. */
@media (max-width: 1100px) and (min-width: 801px) {
  .settings.settings-split { grid-template-columns: 220px 1fr; }
  .settings-pane { padding: 1.2rem 1.3rem 2rem; }
}
@media (min-width: 1800px) {
  .app-content { max-width: 1480px; }
  .settings.settings-split { max-width: 1300px; }
}`,
  },
]);

// ===========================================================
// Version bumps to 0.10.140
// ===========================================================
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
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.139"/, '"version": "0.10.140"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.139 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.139 → 0.10.140`);
  }
}

// ===========================================================
// DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.140',
    find: `const APP_VERSION = '0.10.139';`,
    replace: `const APP_VERSION = '0.10.140';`,
  },
]);

// ===========================================================
// whatsNew.ts - v0.10.140 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.140 entry above v0.10.139',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.139',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.140',\n    date: 'June 12, 2026',\n    highlight: 'Accessibility + responsive layout polish — closes the last 5 P1 UX findings',\n    changes: [\n      { type: 'improved', text: 'Reduced-motion support. If you have animations disabled in your OS preferences (Windows Settings > Accessibility > Visual effects > Animation effects OFF, or macOS Reduce Motion ON), the dialer now respects that across all 11+ continuous animations - the incoming-call pulse, the in-call return banner, status dots, presence indicators, spinners, and modal entries are all stilled.' },\n      { type: 'improved', text: 'Responsive layout now adapts to mid-range viewports. The dialer used to be designed for either small mobile or wide desktop with nothing in between - on a 1366x768 Windows laptop at 125 percent DPI scaling (very common), the Settings nav rail would crowd the content pane awkwardly. New breakpoints tighten the Settings layout in the 800-1100px range and expand the content cap on QHD+ monitors so wide tables breathe instead of sitting in 50 percent gutters.' },\n      { type: 'improved', text: 'Muted secondary text contrast bumped from 0.55 to 0.68 alpha. Previously secondary text like timestamps, sublabels, and email addresses sat just below WCAG AA contrast threshold when shown on the dialers slightly-tinted card backgrounds. Now they all clear the AA bar by a comfortable margin.' },\n      { type: 'improved', text: 'Touch targets enlarged on multiple secondary icons. Quick-reply action buttons (26x26 → 32x32), update-banner dismiss (24 → 32), voicemail action icons (30 → 36), pending-user action icons (28 → 32) all easier to hit. Most notably the non-fullscreen incoming-call Accept/Decline buttons went from 40x40 to 56x56 - those are the time-critical buttons for answering a call, no reason to make them small.' },\n      { type: 'improved', text: 'User dropdown menu can now scroll on short viewports. Previously if the menu had enough items to exceed the viewport height it would clip without warning; now it gracefully scrolls (invisible scrollbar, native gesture).' },\n    ],\n  },\n  {\n    version: '0.10.139',`,
  },
]);

console.log('\n[apply-v140] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.140: UX P1 finish (UX-002, UX-006, UX-009, UX-010, UX-014)"');
console.log('  5. git push');
