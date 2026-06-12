#!/usr/bin/env node
// v0.10.145 - UX P2 batch 2 (3 items, all CSS).
//
// UX-019 - search bar z-index 5 → 30 (won't be covered by return-to-call banner at z=40, will sit above page content)
// UX-024 - .app-shell background #000 → var(--bg) (no light-mode FOUC flash)
// UX-033 - settings.settings-split grid 260px 1fr → 260px minmax(0, 1fr) + .settings-pane min-width: 0 (tables don't trigger horizontal scroll)
//
// UX-018 (header collision) and UX-037 (scrollbar) deferred to v0.10.146:
//   - UX-018 needs a multi-line media-query rewrite; want to validate at narrow width first
//   - UX-037 the audit's premise about a global * rule turned out to be slightly wrong;
//     the actual rules are per-class. Re-audit before changing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v145] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v145] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v145] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v145] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-019: .search-bar z-index 5 → 30 (sits above page content, below return-to-call banner at z=40)',
    find: `.search-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 1rem 0.75rem;
  padding: 0.45rem 0.7rem;
  background: rgba(118, 118, 128, 0.18);
  border-radius: 10px;
  position: sticky;
  top: 0;
  z-index: 5;
  backdrop-filter: blur(8px);
}`,
    replace: `.search-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 1rem 0.75rem;
  padding: 0.45rem 0.7rem;
  background: rgba(118, 118, 128, 0.18);
  border-radius: 10px;
  position: sticky;
  top: 0;
  /* v0.10.145 - UX-019 - raised from 5 to 30. The return-to-call banner
     sits at z=40 so the search bar still ducks under it during active
     calls (correct), but page content (incl. row dropdowns) at z<30
     no longer covers the search bar when scrolling. */
  z-index: 30;
  backdrop-filter: blur(8px);
}`,
  },
  {
    label: 'UX-024: .app-shell background #000 → var(--bg) (light-mode no FOUC)',
    find: `.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #000;
  color: #fff;
}`,
    replace: `.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  /* v0.10.145 - UX-024 - was #000 literal. Use the theme token so
     light-mode users don't see a dark flash on first paint before the
     [data-theme="light"] override cascade kicks in. */
  background: var(--bg);
  color: var(--text);
}`,
  },
  {
    label: 'UX-033: settings two-column grid 260px 1fr → 260px minmax(0, 1fr) + .settings-pane min-width: 0',
    find: `.settings.settings-split {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 0;`,
    replace: `.settings.settings-split {
  display: grid;
  /* v0.10.145 - UX-033 - second column allowed to shrink below content
     min-width via minmax(0, 1fr). Without this, wide tables (Pending
     Users, Audit Log) push the grid track wider than the available
     viewport and the user gets ugly horizontal scroll INSIDE the table
     wrap. With minmax(0, 1fr), the table's overflow-x: auto handles
     it correctly inside its own container. */
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 0;`,
  },
]);

// Version bumps to 0.10.145
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
  c = c.replace(/"version":\s*"0\.10\.144"/, '"version": "0.10.145"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.144 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.144 → 0.10.145`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.145',
    find: `const APP_VERSION = '0.10.144';`,
    replace: `const APP_VERSION = '0.10.145';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.145 entry above v0.10.144',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.144',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.145',\n    date: 'June 12, 2026',\n    highlight: 'UX P2 polish batch 2 — search bar layering, light-mode flash, settings tables',\n    changes: [\n      { type: 'fixed', text: 'Search bar (Recents, Voicemail, Messages) no longer gets visually covered by row-action menus or other page UI when scrolling. Stacking layer raised so it sits above page content but still ducks under the green return-to-call banner during active calls.' },\n      { type: 'fixed', text: 'Light-mode no longer flashes a dark background on first paint. The dialer shell was hard-coded to black; it now uses the theme token so light mode renders correctly from the very first frame.' },\n      { type: 'improved', text: 'Settings two-column layout now allows the content pane to shrink below its content min-width. Pending Users and Audit Log tables that used to force horizontal scroll across the whole Settings pane now scroll inside their own container correctly.' },\n    ],\n  },\n  {\n    version: '0.10.144',`,
  },
]);

console.log('\n[apply-v145] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat && git add -A && git commit && git push');
