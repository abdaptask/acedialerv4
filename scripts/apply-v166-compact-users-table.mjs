#!/usr/bin/env node
// v0.10.166 - Compact the Users admin table by collapsing 3 columns
// into the User column.
//
// USER-REQUESTED LAYOUT (no horizontal scroll required):
//   [Avatar]  ● Name  [Admin pill]
//             Microsoft SSO
//             email@aptask.com
//
// Status becomes a colored dot next to the name:
//   green  = active + signed in within last 30 days
//   orange = active but stale (last sign-in >30 days ago, OR never signed in)
//   red    = inactive
//
// Removes the standalone Email, Role, Status columns. Table goes from
// 8 columns (User/Email/Role/Status/DID/Version/LastSignIn/Actions)
// down to 5 (User/DID/Version/LastSignIn/Actions). At common laptop
// widths the whole thing fits without horizontal scroll, and the
// action icons stay 1-click (no kebab consolidation needed).
//
// FILE CHANGES:
//   apps/web/src/pages/Settings.tsx - 3 edits:
//     1. ths array - remove email/role/status entries
//     2. Single big replacement: combine 4 cells (User+Email+Role+Status)
//        into 1 redesigned User cell. Adds status-dot computation
//        before the return.
//     3. Update colSpan in "No users match" empty state (7 -> 5)
//   apps/web/src/styles.css - 2 edits:
//     1. Remove the v0.10.162 min-width:920px (no longer needed)
//     2. Add status-dot + name-line CSS
//
// SAFETY:
//   - Email/role/status data isn't lost; just displayed differently.
//   - SortKey type unchanged so sortRows() still handles email/role/status
//     programmatically. Only the click-to-sort header UI for those is gone.
//
// VERSION BUMP: 0.10.165 -> 0.10.166

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v166] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v166] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v166] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v166] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// Settings.tsx - 3 edits
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'thead: remove Email/Role/Status from ths array',
    find: `              const ths: Array<{ key: SortKey; label: string }> = [
                { key: 'name', label: 'User' },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role' },
                { key: 'status', label: 'Status' },
                { key: 'did', label: 'DID' },
                { key: 'version', label: 'Version' },
                { key: 'lastLogin', label: 'Last sign-in' },
              ];`,
    replace: `              // v0.10.166 - Email/Role/Status removed from the header bar.
              // Their data is now shown inside the User cell (status as a
              // colored dot, role as an inline pill, email under the SSO
              // badge). SortKey type is unchanged so sortRows() can still
              // handle those keys if exposed via a future UI surface.
              const ths: Array<{ key: SortKey; label: string }> = [
                { key: 'name', label: 'User' },
                { key: 'did', label: 'DID' },
                { key: 'version', label: 'Version' },
                { key: 'lastLogin', label: 'Last sign-in' },
              ];`,
  },
  {
    label: 'collapse 4 cells (User+Email+Role+Status) into 1 redesigned User cell',
    find: `            return (
              <tr key={r.id} className={r.isActive ? '' : 'inactive'}>
                <td>
                  <div className="users-admin-name">
                    <span className="users-admin-avatar" aria-hidden="true">
                      {(r.firstName?.[0] ?? r.email[0] ?? '?').toUpperCase()}
                    </span>
                    <div>
                      <div>{rowName(r)}</div>
                      <div className="muted small">{r.provider === 'local' ? 'Local password' : 'Microsoft SSO'}</div>
                    </div>
                  </div>
                </td>
                <td className="users-admin-email">{r.email}</td>
                <td>
                  <span className={\`role-pill \${r.isAdmin ? 'admin' : 'user'}\`}>
                    {r.isAdmin ? 'Admin' : 'User'}
                  </span>
                </td>
                <td>
                  <span className={\`status-pill \${r.isActive ? 'active' : 'inactive'}\`}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>`,
    replace: `            // v0.10.166 - compute status-dot color from isActive + lastLoginAt:
            //   red    = inactive
            //   orange = active but stale (last sign-in >30 days ago OR never)
            //   green  = active + recent (within 30 days)
            const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
            let statusDotClass: 'active' | 'stale' | 'inactive';
            let statusDotTitle: string;
            if (!r.isActive) {
              statusDotClass = 'inactive';
              statusDotTitle = 'Inactive';
            } else if (!r.lastLoginAt) {
              statusDotClass = 'stale';
              statusDotTitle = 'Active, never signed in';
            } else {
              const ageMs = Date.now() - new Date(r.lastLoginAt).getTime();
              if (ageMs > STALE_THRESHOLD_MS) {
                statusDotClass = 'stale';
                const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
                statusDotTitle = \`Active, last signed in \${days} days ago\`;
              } else {
                statusDotClass = 'active';
                statusDotTitle = 'Active';
              }
            }
            return (
              <tr key={r.id} className={r.isActive ? '' : 'inactive'}>
                {/* v0.10.166 - User cell is now self-contained: avatar + name
                    with status dot and role pill on the first line, SSO badge
                    + email stacked underneath. Replaces 4 separate cells
                    (User/Email/Role/Status) and saves ~400px of table width. */}
                <td>
                  <div className="users-admin-name">
                    <span className="users-admin-avatar" aria-hidden="true">
                      {(r.firstName?.[0] ?? r.email[0] ?? '?').toUpperCase()}
                    </span>
                    <div>
                      <div className="users-admin-name-line">
                        <span
                          className={\`users-admin-status-dot \${statusDotClass}\`}
                          title={statusDotTitle}
                          aria-label={statusDotTitle}
                        />
                        <span>{rowName(r)}</span>
                        <span className={\`role-pill \${r.isAdmin ? 'admin' : 'user'}\`}>
                          {r.isAdmin ? 'Admin' : 'User'}
                        </span>
                      </div>
                      <div className="muted small">{r.provider === 'local' ? 'Local password' : 'Microsoft SSO'}</div>
                      <div className="muted small">{r.email}</div>
                    </div>
                  </div>
                </td>`,
  },
  {
    label: 'empty state: colSpan 7 -> 5 (table now has 5 columns)',
    find: `            <tr><td colSpan={7} className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>No users match.</td></tr>`,
    replace: `            <tr><td colSpan={5} className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>No users match.</td></tr>`,
  },
]);

// =====================================================================
// styles.css - 2 edits
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'remove v0.10.162 min-width:920px (no longer needed)',
    find: `.users-admin-table {
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
    replace: `.users-admin-table {
  width: 100%;
  /* v0.10.166 - removed min-width:920px. With v0.10.166 collapsing 3
     columns into the User cell (status dot + role pill + email-under-SSO),
     the table only has 5 columns and fits in any reasonable pane width
     without needing horizontal scroll. */
  border-collapse: collapse;
  font-size: 13px;
}`,
  },
  {
    label: 'add status-dot + name-line CSS after the wrap class',
    find: `/* v0.10.160 - horizontal-scroll wrapper for the Users admin table.
   Lets the user scroll right to reach the Version, Last Login, and
   Actions columns that overflow the settings pane. */
.users-admin-table-wrap {
  width: 100%;
  overflow-x: auto;
  /* Smoothing on touch devices + iOS-style scroll. */
  -webkit-overflow-scrolling: touch;
}`,
    replace: `/* v0.10.160 - horizontal-scroll wrapper for the Users admin table.
   v0.10.166 - overflow-x is essentially a no-op now since v0.10.166
   compacted the table to 5 columns. Keeping the wrapper as a safety
   net in case future columns are added back. */
.users-admin-table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* v0.10.166 - Users admin row: status dot + name + role pill inline
   on the first line inside the User cell. Replaces the previous
   standalone Email/Role/Status columns. */
.users-admin-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.users-admin-status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  vertical-align: middle;
}
.users-admin-status-dot.active {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}
.users-admin-status-dot.stale {
  background: #f97316;
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
}
.users-admin-status-dot.inactive {
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.165 -> 0.10.166
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
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.165"/, '"version": "0.10.166"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.165 -> 0.10.166`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.165';`,
    replace: `const APP_VERSION = '0.10.166';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.166 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.165',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.166',
    date: 'June 16, 2026',
    highlight: 'Users admin table redesigned to fit without horizontal scroll.',
    changes: [
      { type: 'improved', text: 'The Users admin table no longer requires horizontal scrolling. Status is now a colored dot next to each users name (green active, orange stale, red inactive). Role is shown as a small pill right beside the name. Email is tucked under the Microsoft SSO badge in the same cell. All the same information is visible at a glance and the table fits comfortably on a 1366x768 laptop.' },
    ],
  },
  {
    version: '0.10.165',`,
  },
]);

console.log('\n[apply-v166] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status / diff to verify changes');
console.log('  git add -A');
console.log('  git commit -m "v0.10.166: compact Users admin table - status dot + inline role pill + email under SSO"');
console.log('  git tag v0.10.166');
console.log('  git push origin main');
console.log('  git push origin v0.10.166');
console.log('');
console.log('AFTER DEPLOY: Settings -> Users.');
console.log('  Each row shows:');
console.log('    [Avatar]  <colored dot> Name  [role pill]');
console.log('              Microsoft SSO');
console.log('              email@aptask.com');
console.log('  Table fits without horizontal scroll.');
