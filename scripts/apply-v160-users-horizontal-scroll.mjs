#!/usr/bin/env node
// v0.10.160 - Users admin table: horizontal scroll.
//
// PROBLEM: Users admin table renders 8 columns
// (User/Email/Role/Status/DID/Version/Last Login/Actions) but only the
// first 5 fit in the 560px settings pane. The right 3 columns - most
// importantly the Call/Text/More icons - are clipped off-screen with
// no way to reach them.
//
// FIX (smallest possible change, lowest risk):
//   - Wrap the table in a <div className="users-admin-table-wrap"> with
//     overflow-x: auto.
//   - Users with narrow viewports can scroll the table horizontally.
//   - No pane-width changes. No CSS-pane :has() rules. No JSX changes
//     other than the wrapper.
//
// SCOPE: 2 edits in apps/web/src/pages/Settings.tsx (table open + close)
//        + 1 edit in apps/web/src/styles.css (new .users-admin-table-wrap rule)
//        + version bumps.
//
// TEST LOCALLY BEFORE PUSH: open Settings -> Users, drag the right side
// of the table - the Actions column with Call/Text/Menu icons should
// be reachable via horizontal scroll inside the pane.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v160] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v160] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v160] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v160] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// Settings.tsx - wrap the main Users table (NOT the sample-failures
// table at line 6216, which has identical class but different context).
// ---------------------------------------------------------------------
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'open-tag: insert .users-admin-table-wrap div before main Users table',
    find: `      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <table className="users-admin-table">
        <thead>
          <tr>`,
    replace: `      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* v0.10.160 - horizontal-scroll wrapper around the Users table.
          The table has 8 columns (User/Email/Role/Status/DID/Version/
          LastLogin/Actions) that exceed the 560px settings pane width.
          Without this wrapper the Actions column (Call/Text/Menu) is
          clipped off-screen and unreachable. */}
      <div className="users-admin-table-wrap">
      <table className="users-admin-table">
        <thead>
          <tr>`,
  },
  {
    label: 'close-tag: close .users-admin-table-wrap after main Users table',
    find: `          {filtered.length === 0 && (
            <tr><td colSpan={7} className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>No users match.</td></tr>
          )}
        </tbody>
      </table>

      {showInvite && (`,
    replace: `          {filtered.length === 0 && (
            <tr><td colSpan={7} className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>No users match.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {showInvite && (`,
  },
]);

// ---------------------------------------------------------------------
// styles.css - add the wrapper rule.
// ---------------------------------------------------------------------
applyEdits('apps/web/src/styles.css', [
  {
    label: 'add .users-admin-table-wrap CSS',
    find: `.users-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}`,
    replace: `/* v0.10.160 - horizontal-scroll wrapper for the Users admin table.
   Lets the user scroll right to reach the Version, Last Login, and
   Actions columns that overflow the settings pane. */
.users-admin-table-wrap {
  width: 100%;
  overflow-x: auto;
  /* Smoothing on touch devices + iOS-style scroll. */
  -webkit-overflow-scrolling: touch;
}

.users-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.159 -> 0.10.160
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
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.159"/, '"version": "0.10.160"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.159 -> 0.10.160`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.159';`,
    replace: `const APP_VERSION = '0.10.160';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.160 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.159',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.160',
    date: 'June 15, 2026',
    highlight: 'Admin > Users: all columns and action icons now reachable.',
    changes: [
      { type: 'fixed', text: 'The Users admin table had 8 columns but only the first 5 fit in the settings pane, hiding Version, Last Login, and the Call/Text/More icons. The table now scrolls horizontally inside the pane so every column is reachable at any window width.' },
    ],
  },
  {
    version: '0.10.159',`,
  },
]);

console.log('\n[apply-v160] DONE');
console.log('');
console.log('TEST LOCALLY before pushing:');
console.log('  cd apps/web && npm run dev');
console.log('  Open Settings -> Users, drag-scroll the table right.');
console.log('  All 8 columns + Call/Text/Menu icons should be reachable.');
console.log('');
console.log('Then:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.160: Users admin table horizontal scroll"');
console.log('  git tag v0.10.160');
console.log('  git push origin main');
console.log('  git push origin v0.10.160');
