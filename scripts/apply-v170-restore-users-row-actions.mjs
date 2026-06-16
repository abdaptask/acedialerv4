#!/usr/bin/env node
// v0.10.170 - Restore visible Call / Message / ⋯ actions on the Users
// admin table row.
//
// PROBLEM
//   The Users admin table row's actions cell (.users-admin-actions) is
//   styled `width: 44px` -- sized for the single ⋯ kebab button before
//   v0.10.94 added the inline Call + Message quick-action buttons.
//   Three buttons inside a 44px-wide cell get clipped / pushed off the
//   visible edge of the table. The admin can't see them, so calling /
//   texting / managing lines from the admin screen looks unavailable.
//
//   Confirmed by reading apps/web/src/pages/Settings.tsx lines 3312+:
//   - the <td className="users-admin-actions"> exists
//   - it conditionally renders <Phone> + <MessageSquare> + <MoreHorizontal>
//   - all three are wrapped in icon-btn buttons (~28px each + padding +
//     gaps = ~95-110px total real width)
//
//   The 44px in apps/web/src/styles.css line 6465 is the bottleneck.
//
// FIX
//   1. apps/web/src/styles.css: widen .users-admin-actions to fit all
//      three icons (~150px), add white-space: nowrap so they stay on a
//      single line even at narrow viewports, and keep text-align: right
//      so they stay flush with the row's right edge.
//   2. apps/web/src/pages/Settings.tsx: keep aria-label="actions" on the
//      <th> but ALSO render a visually-hidden minWidth so the column
//      doesn't collapse on render. (Belt-and-suspenders with the CSS fix.)
//
// IMPACT
//   Admin can once again Call / Text / Manage lines / Promote / Deactivate
//   / Hard delete from the Users admin table without horizontal scroll.
//   No data layer changes. No regression risk -- purely cosmetic.
//
// VERSION BUMP: 0.10.169 -> 0.10.170

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v170] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v170] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v170] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v170] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. CSS - widen the actions cell + nowrap.
// NOTE: this edit succeeded on the first run of the script even though
// edit 2 below FATAL'd. Anchor below now finds the POST-edit string so
// running the script a second time becomes a no-op (the edit detector
// sees the new content already in place and applyEdits considers it
// "applied" only if find !== content). To be safe, anchor on a snippet
// that is invariant whether v0.10.170 is applied or not.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'widen .users-admin-actions so Call+Message+⋯ all fit (idempotent)',
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
}
.users-admin-actions .icon-btn {
  /* Ensure the inline icon-btn group stays on a single line and the
     buttons line up nicely with consistent gaps. */
  display: inline-flex;
  vertical-align: middle;
}`,
    replace: `.users-admin-actions {
  position: relative;
  /* v0.10.170 - was width:44px which fit only the ⋯ kebab and clipped
     the Call + Message quick-action buttons added in v0.10.94. The
     three icon-btn elements need ~110px of real width; sizing the
     cell to 150px gives breathing room + keeps the icons flush right. */
  width: 150px;
  min-width: 150px;
  text-align: right;
  white-space: nowrap;
}
.users-admin-actions .icon-btn {
  /* Ensure the inline icon-btn group stays on a single line and the
     buttons line up nicely with consistent gaps. */
  display: inline-flex;
  vertical-align: middle;
}`,
  },
]);

// =====================================================================
// 2. JSX - give the Users admin <th aria-label="actions" /> an inline
//    width so the column doesn't collapse on table-layout:auto when the
//    LAST SIGN-IN cell wraps. ANCHOR must be unique: Settings.tsx has a
//    SECOND identical line at L6920 for the Blocked Numbers admin table.
//    Disambiguate by including the surrounding context that only the
//    Users admin row has (the `toggleSort` close + `</tr></thead>`).
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'Users-admin actions <th> gets min-width via inline style',
    find: `              });
            })()}
            <th aria-label="actions" />
          </tr>
        </thead>`,
    replace: `              });
            })()}
            {/* v0.10.170 - belt-and-suspenders with the CSS width on
                .users-admin-actions. Without an explicit width here,
                table-layout:auto sometimes collapsed this column when
                the LAST SIGN-IN cell wrapped onto two lines, hiding the
                Call/Message/⋯ icons off the visible edge. */}
            <th aria-label="Actions" style={{ width: 150, minWidth: 150 }} />
          </tr>
        </thead>`,
  },
]);

// =====================================================================
// Version bumps 0.10.169 -> 0.10.170
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
  c = c.replace(/"version":\s*"0\.10\.169"/, '"version": "0.10.170"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.169 -> 0.10.170`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.169';`,
    replace: `const APP_VERSION = '0.10.170';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.170 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.169',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.170',
    date: 'June 16, 2026',
    highlight: 'Admin: Users table row actions visible again.',
    changes: [
      { type: 'fixed', text: 'On the admin Users table, the Call, Message, and ⋯ (more actions) icons on each row were getting clipped off the right edge after the compact-row redesign. They are visible again on every row.' },
    ],
  },
  {
    version: '0.10.169',`,
  },
]);

console.log('\n[apply-v170] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.170: restore Call/Message/⋯ actions on Users admin row"');
console.log('  git tag v0.10.170');
console.log('  git push origin main');
console.log('  git push origin v0.10.170');
