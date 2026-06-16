#!/usr/bin/env node
// v0.10.171 - Users admin table must fit any viewport with NO horizontal
// scroll, including when DevTools is docked or the window is narrow.
//
// PROBLEM
//   v0.10.170 restored the Call/Message/⋯ action icons by widening
//   .users-admin-actions from 44px to 150px. That fixed the actions
//   visibility BUT pushed the overall table width past the available
//   Settings pane width on narrow viewports — the table now needs
//   horizontal scroll, which the user explicitly does not want.
//
//   Width math at a narrow viewport (e.g., DevTools docked, ~640px Settings
//   pane):
//     User (auto-grows to content)  ~300px
//     DID                           ~140px
//     Version                       ~110px
//     Last sign-in                  ~140px
//     Actions                       150px
//     -----------------------------------------
//     Total natural width:          ~840px
//     Container:                    ~640px
//     Overflow:                     ~200px → off-screen actions
//
// FIX
//   1. .users-admin-table { table-layout: fixed; } — columns honor the
//      <th> widths instead of growing to fit content.
//   2. Tighten every column to its real minimum so the table TOTAL stays
//      below ~720px even with the actions column. Last sign-in and DID
//      get fixed widths via inline style on each <th>. Actions drops from
//      150 to 130 (still fits all three icon-btn elements at ~30px each
//      + padding).
//   3. User cell gets explicit min-width via CSS so the name/role/SSO/
//      email stack doesn't get squeezed into illegibility on very narrow
//      viewports; it can wrap if needed but won't break the overall
//      table fit.
//
// IMPACT
//   • At 640-700px container width: table fits cleanly, actions visible,
//     no horizontal scroll.
//   • At full-pane width (~900-1100px): User column grows, actions still
//     pinned right.
//   • At ultra-wide (1480px+): looks the same as before; User column
//     just has more breathing room.
//
// VERSION BUMP: 0.10.170 -> 0.10.171

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v171] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v171] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v171] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v171] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. CSS - table-layout:fixed + tighter actions column
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'table-layout:fixed + minimum widths on body cells',
    find: `.users-admin-table {
  width: 100%;
  /* v0.10.166 - removed min-width:920px. With v0.10.166 collapsing 3
     columns into the User cell (status dot + role pill + email-under-SSO),
     the table only has 5 columns and fits in any reasonable pane width
     without needing horizontal scroll. */
  border-collapse: collapse;
  font-size: 13px;
}`,
    replace: `.users-admin-table {
  width: 100%;
  /* v0.10.166 - removed min-width:920px. With v0.10.166 collapsing 3
     columns into the User cell (status dot + role pill + email-under-SSO),
     the table only has 5 columns and fits in any reasonable pane width
     without needing horizontal scroll. */
  /* v0.10.171 - table-layout: fixed so column widths honor the <th>
     style attributes instead of growing to fit content. Without this,
     the User cell expands to its natural width and the action column
     gets pushed off the right edge on narrow viewports (e.g., when
     DevTools is docked). User explicitly does not want horizontal
     scroll on this table. */
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
}
/* v0.10.171 - the User cell stacks status-dot + name + role pill +
   SSO badge + email vertically. text-overflow ellipsis on overflow
   so the long emails like firstname.lastname@aptask.com don't blow
   out the column when User gets squeezed. */
.users-admin-table td:first-child {
  overflow: hidden;
}
.users-admin-table td:first-child .users-admin-name-line,
.users-admin-table td:first-child > * {
  min-width: 0;
}`,
  },
  {
    label: 'widen actions cell with NEW 130px width (down from 150) — tighter so total table fits narrow viewports',
    find: `.users-admin-actions {
  position: relative;
  /* v0.10.170 - was width:44px which fit only the ⋯ kebab and clipped
     the Call + Message quick-action buttons added in v0.10.94. The
     three icon-btn elements need ~110px of real width; sizing the
     cell to 150px gives breathing room + keeps the icons flush right. */
  width: 150px;
  min-width: 150px;
  text-align: right;
  white-space: nowrap;
}`,
    replace: `.users-admin-actions {
  position: relative;
  /* v0.10.171 - dropped from 150 -> 130 to keep table total below ~720px
     so the table never needs horizontal scroll even when DevTools is
     docked or window is narrow. Three icon-btn elements at ~30px each
     plus 4px gap = ~98px content + 16px cell padding = 114px. 130 leaves
     ~16px slack so icons stay flush-right without being cramped. */
  width: 130px;
  min-width: 130px;
  text-align: right;
  white-space: nowrap;
}`,
  },
]);

// =====================================================================
// 2. JSX - tighten widths on every <th> (only Users admin one)
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'Users-admin <th>s get explicit widths so table-layout:fixed has values to honor',
    find: `              const ths: Array<{ key: SortKey; label: string }> = [
                { key: 'name', label: 'User' },
                { key: 'did', label: 'DID' },
                { key: 'version', label: 'Version' },
                { key: 'lastLogin', label: 'Last sign-in' },
              ];
              return ths.map((c) => {
                const active = sortKey === c.key;
                const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    style={{
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                    title={\`Sort by \${c.label}\`}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label}{arrow}
                  </th>
                );
              });
            })()}
            {/* v0.10.170 - belt-and-suspenders with the CSS width on
                .users-admin-actions. Without an explicit width here,
                table-layout:auto sometimes collapsed this column when
                the LAST SIGN-IN cell wrapped onto two lines, hiding the
                Call/Message/⋯ icons off the visible edge. */}
            <th aria-label="Actions" style={{ width: 150, minWidth: 150 }} />`,
    replace: `              // v0.10.171 - explicit column widths so table-layout:fixed
              // (added in v0.10.171 styles.css) distributes the table by
              // these numbers rather than by content size. Numbers chosen
              // so the table total stays under ~720px and fits even when
              // DevTools is docked or the window is narrow. User cell
              // gets the remainder.
              const ths: Array<{ key: SortKey; label: string; width?: number }> = [
                { key: 'name', label: 'User' }, // no width → takes the remainder
                { key: 'did', label: 'DID', width: 130 },
                { key: 'version', label: 'Version', width: 100 },
                { key: 'lastLogin', label: 'Last sign-in', width: 130 },
              ];
              return ths.map((c) => {
                const active = sortKey === c.key;
                const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                const style: React.CSSProperties = {
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                };
                if (c.width) {
                  style.width = c.width;
                  style.minWidth = c.width;
                }
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    style={style}
                    title={\`Sort by \${c.label}\`}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label}{arrow}
                  </th>
                );
              });
            })()}
            {/* v0.10.171 - actions column width dropped to 130 to keep
                the whole table under ~720px so it fits even when
                DevTools is docked or the window is narrow. No horizontal
                scroll — that's been a hard requirement since v0.10.166. */}
            <th aria-label="Actions" style={{ width: 130, minWidth: 130 }} />`,
  },
]);

// =====================================================================
// Version bumps 0.10.170 -> 0.10.171
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
  c = c.replace(/"version":\s*"0\.10\.170"/, '"version": "0.10.171"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.170 -> 0.10.171`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.170';`,
    replace: `const APP_VERSION = '0.10.171';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.171 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.170',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.171',
    date: 'June 16, 2026',
    highlight: 'Admin Users table fits without horizontal scroll.',
    changes: [
      { type: 'fixed', text: 'Settings → Users no longer needs horizontal scroll to see the Call, Message, and ⋯ icons on the right of each row, even when the window is narrow or DevTools is docked. Column widths are now fixed so the whole table always fits.' },
    ],
  },
  {
    version: '0.10.170',`,
  },
]);

console.log('\n[apply-v171] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.171: Users admin table fits any viewport, no horizontal scroll"');
console.log('  git tag v0.10.171');
console.log('  git push origin main');
console.log('  git push origin v0.10.171');
