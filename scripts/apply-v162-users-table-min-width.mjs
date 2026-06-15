#!/usr/bin/env node
// v0.10.162 - Users admin table: min-width so the scroll wrapper actually scrolls.
//
// PROBLEM: v0.10.160 added overflow-x:auto wrapper around the table,
// but the table itself has width:100% which makes it fit the wrapper
// exactly - never overflowing, never scrolling. All 8 columns get
// compressed to invisible widths in narrow panes. User sees 5 visible
// + 3 compressed-to-nothing.
//
// FIX: Add min-width: 920px to .users-admin-table. The table now
// REFUSES to compress below 920px (enough for 8 reasonably-sized
// columns). When the wrapper is narrower than 920px, the wrapper's
// overflow-x:auto kicks in and the user can scroll right to see all
// columns including Version, Last sign-in, and Actions.
//
// CALC OF 920px:
//   User col   ~150px (avatar + name + SSO subtitle)
//   Email col  ~180px (long email addresses)
//   Role col   ~70px  (User / Admin pill)
//   Status col ~70px  (Active / Inactive pill)
//   DID col    ~130px (phone number, can have +N badge)
//   Version    ~80px  (v0.10.xxx)
//   LastSignIn ~130px (6/15 11:42 AM)
//   Actions    ~110px (Call + Text + Menu icons)
//   --------
//   Total      ~920px - one min-width number, no per-column work needed.
//
// SCOPE: one CSS rule change. No JSX edits. No API edits.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v162] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v162] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v162] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v162] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// styles.css - add min-width to the Users admin table
// ---------------------------------------------------------------------
applyEdits('apps/web/src/styles.css', [
  {
    label: 'add min-width: 920px to .users-admin-table',
    find: `.users-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}`,
    replace: `.users-admin-table {
  width: 100%;
  /* v0.10.162 - min-width forces the table to stay wide enough for
     all 8 columns even when the .users-admin-table-wrap (v0.10.160)
     is narrower. The wrapper's overflow-x:auto then kicks in and the
     user can horizontally scroll to reach Version / Last sign-in /
     Actions columns. Without min-width, width:100% compressed those
     columns into invisible widths. */
  min-width: 920px;
  border-collapse: collapse;
  font-size: 13px;
}`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.161 -> 0.10.162
// (assumes v0.10.161 verbose-logs script ran first; if you skipped it,
// the bump-from-160 fallback below handles that.)
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
let bumpedFrom = null;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.161"/, '"version": "0.10.162"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.161 -> 0.10.162`);
    bumpedFrom = '0.10.161';
  } else {
    // Fallback: maybe v0.10.161 wasn't run; bump from .160 directly.
    c = readFileSync(fp, 'utf8');
    const before2 = c;
    c = c.replace(/"version":\s*"0\.10\.160"/, '"version": "0.10.162"');
    if (c !== before2) {
      writeFileSync(fp, c, 'utf8');
      console.log(`  ! ${rp}: was on 0.10.160 (v0.10.161 not yet applied), bumped to 0.10.162`);
      bumpedFrom = '0.10.160';
    }
  }
}
if (!bumpedFrom) {
  console.error(`[apply-v162] FATAL: no package.json had version 0.10.161 or 0.10.160.`);
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: bumpedFrom === '0.10.161' ? `const APP_VERSION = '0.10.161';` : `const APP_VERSION = '0.10.160';`,
    replace: `const APP_VERSION = '0.10.162';`,
  },
]);

// Adapt whatsNew entry insertion to whichever version came before
const previousVersion = bumpedFrom;
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: `add v0.10.162 entry above v${previousVersion}`,
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '${previousVersion}',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.162',
    date: 'June 15, 2026',
    highlight: 'Admin > Users: all 8 columns now reachable via horizontal scroll.',
    changes: [
      { type: 'fixed', text: 'The Users admin table was hiding the Version, Last sign-in, and Action (Call/Text/Menu) columns at common window widths. Added a minimum width to the table so when the settings pane is narrower than the full table, you can scroll horizontally to reach the hidden columns instead of having them compressed to nothing.' },
    ],
  },
  {
    version: '${previousVersion}',`,
  },
]);

console.log('\n[apply-v162] DONE');
console.log('');
console.log('TEST LOCALLY:');
console.log('  cd apps/web && npm run dev');
console.log('  Settings -> Users -> drag-scroll the table right.');
console.log('  You should see ALL 8 columns: User, Email, Role, Status,');
console.log('  DID, Version, Last sign-in, and the Call/Text/Menu icons.');
console.log('  A horizontal scrollbar appears at the bottom of the table');
console.log('  area when the pane is narrower than the table.');
console.log('');
console.log('Then:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.162: Users admin table min-width so wrapper actually scrolls"');
console.log('  git tag v0.10.162');
console.log('  git push origin main');
console.log('  git push origin v0.10.162');
