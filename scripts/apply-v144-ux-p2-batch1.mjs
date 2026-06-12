#!/usr/bin/env node
// v0.10.144 — UX P2 batch 1 from UI_UX_AUDIT.md.
//
// Six small CSS-only polish items, all under 5 lines each:
//   UX-015 — Settings nav title/blurb overflow handling
//   UX-016 — .app-content max-width 1280 → 1480 + QHD listing widths
//   UX-017 + UX-022 — Anchor .tab-badge to .tab-icon-wrap (was overlapping at narrow widths or 99+ counts)
//   UX-027 — .praise-modal-close 32px → 40px + opacity 1 (a11y)
//   UX-034 — .copy-toast z-index 5000 → 100 (no longer overlays modals)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v144] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v144] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v144] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v144] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once (use a more specific anchor)`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/styles.css', [
  // ===========================================================
  // UX-015 — Settings nav text overflow
  // ===========================================================
  {
    label: 'UX-015: ellipsis-clamp settings-nav title (1 line) + blurb (2 lines)',
    find: `.settings-nav-label { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.settings-nav-title { font-size: 0.92rem; font-weight: 500; }
.settings-nav-blurb { font-size: 0.72rem; color: rgba(255, 255, 255, 0.45); margin-top: 1px; }`,
    replace: `.settings-nav-label { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
/* v0.10.144 - UX-015 - clamp long titles to single-line ellipsis
   and blurbs to a 2-line vertical clamp so the chevron column never
   gets squeezed off the right edge at narrow nav widths. */
.settings-nav-title {
  font-size: 0.92rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-nav-blurb {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}`,
  },

  // ===========================================================
  // UX-016 — wider content cap + QHD listing widths
  // ===========================================================
  {
    label: 'UX-016: .app-content max-width 1280 → 1480 + @media listing widths on QHD',
    find: `.app-content {
  max-width: 1280px;
  margin: 0 auto;
  width: 100%;
}
@media (max-width: 900px) {
  .app-content {
    max-width: 100%;
  }`,
    replace: `.app-content {
  /* v0.10.144 - UX-016 - widened from 1280 to 1480 so QHD+ displays
     don't waste 50% of their width on gutters. Settings tables and
     content actually breathe now. Anything <= 900px is still 100%
     wide (the existing mobile media query below kicks in). */
  max-width: 1480px;
  margin: 0 auto;
  width: 100%;
}
/* v0.10.144 - UX-016 - on QHD+ monitors, give the listing-style pages
   (Recents, Voicemail, Messages) a slightly wider column so contact
   names don't truncate as aggressively. */
@media (min-width: 1800px) {
  .recents, .voicemail, .messages { max-width: 640px; }
}
@media (max-width: 900px) {
  .app-content {
    max-width: 100%;
  }`,
  },

  // ===========================================================
  // UX-017 + UX-022 — anchor .tab-badge to .tab-icon-wrap
  // ===========================================================
  // The file has TWO .tab-badge definitions due to historical drift.
  // The line ~4020 version is the active one (because CSS source order).
  // We update it to anchor on .tab-icon-wrap.
  {
    label: 'UX-017+022: anchor .tab-badge to .tab-icon-wrap (no more 50% center math)',
    find: `.tab-badge {
  position: absolute;
  top: 0;
  right: calc(50% - 16px);
  background: #ff3b30;
  color: #fff;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  font-size: 0.6rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.tab { position: relative; }`,
    replace: `.tab-badge {
  /* v0.10.144 - UX-017+022 - anchor the badge on .tab-icon-wrap
     (added in v0.10.138) instead of the whole .tab. Removes the
     fragile right:calc(50% - 16px) center-math that caused badges
     to drift onto adjacent tabs at narrow viewports and to overlap
     the icon itself at 99+ counts. */
  position: absolute;
  top: -4px;
  right: -10px;
  background: #ff3b30;
  color: #fff;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  font-size: 0.6rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.tab { position: relative; }`,
  },

  // ===========================================================
  // UX-027 — Praise modal close button a11y
  // ===========================================================
  {
    label: 'UX-027: bump .praise-modal-close 32px → 40px + opacity 0.7 → 1',
    find: `.praise-modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: inherit;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
}
.praise-modal-close:hover { opacity: 1; }`,
    replace: `.praise-modal-close {
  /* v0.10.144 - UX-027 - 32px → 40px (closer to WCAG AAA 44px ideal)
     and opacity 0.7 → 1 so users don't have to hunt for the dismiss
     button on this celebratory modal. */
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  color: inherit;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
}
.praise-modal-close:hover { background: rgba(255, 255, 255, 0.2); }`,
  },

  // ===========================================================
  // UX-034 — copy-toast z-index sanity
  // ===========================================================
  {
    label: 'UX-034: .copy-toast z-index 5000 → 100 (no more overlay above modals)',
    find: `  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  z-index: 5000;
  pointer-events: none;
  animation: copyToastIn 0.18s ease-out;
}`,
    replace: `  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  /* v0.10.144 - UX-034 - dropped from 5000 to 100. Modal backdrops
     sit at z-index 800-1300; the toast was illegally on top. 100 is
     above page content but safely below any modal. */
  z-index: 100;
  pointer-events: none;
  animation: copyToastIn 0.18s ease-out;
}`,
  },
]);

// ===========================================================
// Version bumps to 0.10.144
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
  c = c.replace(/"version":\s*"0\.10\.143"/, '"version": "0.10.144"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.143 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.143 → 0.10.144`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.144',
    find: `const APP_VERSION = '0.10.143';`,
    replace: `const APP_VERSION = '0.10.144';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.144 entry above v0.10.143',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.143',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.144',\n    date: 'June 12, 2026',\n    highlight: 'UX P2 polish batch 1 — six small layout fixes',\n    changes: [\n      { type: 'improved', text: 'Settings navigation now handles long titles and blurbs cleanly. The chevron arrow no longer gets squeezed off the right edge of the nav rail when entry text is long; titles ellipsis at one line, blurbs clamp at two.' },\n      { type: 'improved', text: 'On QHD (2560×1440) and larger displays, the dialer content area now extends to 1480px wide (was 1280px) so Settings tables and lists fill more of the available screen instead of sitting in 50 percent gutters. Recents, Voicemail, and Messages also widen slightly on very large displays for less aggressive name truncation.' },\n      { type: 'fixed', text: 'Bottom-nav unread badge no longer drifts onto adjacent tabs at narrow widths and no longer overlaps the icon when the count reaches 99+. The badge is now anchored to the individual tab icon wrapper instead of relying on fragile percentage-based positioning.' },\n      { type: 'improved', text: 'Praise modal close button is now 40px (was 32px) and full opacity instead of 70 percent. Easier to find and easier to click.' },\n      { type: 'fixed', text: 'Copy-toast notification no longer renders on top of open modals. The z-index was set to 5000 (the highest in the codebase) which incorrectly placed it above modal backdrops at 800-1300. Dropped to 100 so it sits above page content but below any modal.' },\n    ],\n  },\n  {\n    version: '0.10.143',`,
  },
]);

console.log('\n[apply-v144] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat (should show ~10 files modified, all small)');
console.log('  4. git add -A && git commit -m "v0.10.144: UX P2 batch 1 (UX-015, UX-016, UX-017+022, UX-027, UX-034)"');
console.log('  5. git push');
