#!/usr/bin/env node
// v0.10.172 - Two changes in one release:
//
//   A. REVERT v0.10.171's overaggressive column constraints.
//      table-layout:fixed + overflow:hidden on the User cell made
//      name/role/SSO/email clip at full window width. Back to default
//      auto layout.
//
//   B. COMPACT User cell + remove the DID column.
//      Per user direction:
//        - Replace the full "Microsoft SSO" line under the name with
//          a small [M] badge inline RIGHT AFTER the status dot.
//        - Move the phone number (DID) INTO the User cell as its own
//          line, just below the name.
//        - Remove the standalone DID column entirely. The table now
//          has 4 columns instead of 5 — User / Version / Last sign-in
//          / Actions — which fits any reasonable viewport without
//          horizontal scroll and gives the User cell room to show
//          everything fully.
//        - Multi-DID users still show the default DID + "+N" badge
//          (matching current behavior, just relocated into the User
//          cell).
//
// VERSION BUMP: 0.10.171 -> 0.10.172

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v172] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v172] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v172] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v172] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. CSS - revert v0.10.171 + add styles for the new [M] SSO badge
//          and the phone-line inside the User cell.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'revert table-layout:fixed and overflow:hidden from v0.10.171',
    find: `.users-admin-table {
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
    replace: `.users-admin-table {
  width: 100%;
  /* v0.10.172 - reverted v0.10.171's table-layout:fixed which was
     clipping name + role pill + SSO badge + email in the User cell
     even at full window widths. The DID column is now folded into
     the User cell (phone number on its own line below the name),
     so the table only has 4 columns (User / Version / Last sign-in
     / Actions) — narrow enough to fit any reasonable viewport
     without horizontal scroll. */
  border-collapse: collapse;
  font-size: 13px;
}

/* v0.10.172 - small [M] SSO badge that sits inline right after the
   status dot in the User cell. Replaces the full "Microsoft SSO"
   text line that used to sit below the name. Microsoft brand blue
   square with a white "M" — readable at 14px, doesn't compete with
   the name. Skipped entirely for local-password accounts (we just
   omit the badge for r.provider === 'local'). */
.users-admin-sso-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: #2563eb;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  user-select: none;
}

/* v0.10.172 - phone number row inside the User cell, just below the
   name line. Replaces the separate DID column. Uses the same muted
   font treatment as the email line for consistency. Multi-DID users
   get a "+N" badge inline. */
.users-admin-phone {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.users-admin-phone-multi {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #92400e;
  font-weight: 600;
}`,
  },
]);

// =====================================================================
// 2. JSX - Settings.tsx
//   2a. Remove DID from the sortable <th> array (keep type union;
//       just no header for DID since the column is gone).
//   2b. Remove the v0.10.171 actions <th> width comment annotation
//       (it's still 130, just cleaner wording).
//   2c. Restructure the User <td> contents:
//       - Add the [M] badge inline after the status dot
//       - Add the phone-number line below the name line
//       - Remove the "Microsoft SSO" / "Local password" muted line
//       - Keep the email line
//   2d. Remove the entire <td className="muted small"> for DID.
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'remove DID from sortable th array + clean up actions th comment',
    find: `              // v0.10.171 - explicit column widths so table-layout:fixed
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
    replace: `              // v0.10.172 - DID column removed; phone number now lives
              // inside the User cell. table-layout:fixed reverted to
              // default auto (User cell takes its natural width again).
              const ths: Array<{ key: SortKey; label: string }> = [
                { key: 'name', label: 'User' },
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
            {/* v0.10.170 - explicit width on Actions <th> so the column
                stays sized for Call + Message + ⋯ icons. */}
            <th aria-label="Actions" style={{ width: 130, minWidth: 130 }} />`,
  },
  {
    label: 'User <td> compact layout: [M] badge inline + phone line + email; remove SSO text line',
    find: `                      <div className="users-admin-name-line">
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
                      <div className="muted small">{r.email}</div>`,
    replace: `                      <div className="users-admin-name-line">
                        <span
                          className={\`users-admin-status-dot \${statusDotClass}\`}
                          title={statusDotTitle}
                          aria-label={statusDotTitle}
                        />
                        {/* v0.10.172 - small [M] badge for Microsoft SSO
                            accounts, inline right after the status dot.
                            Replaces the full "Microsoft SSO" text line
                            that used to sit below the name. Local-password
                            accounts (admin break-glass) omit the badge. */}
                        {r.provider !== 'local' && (
                          <span
                            className="users-admin-sso-badge"
                            title="Signed in with Microsoft"
                            aria-label="Microsoft SSO"
                          >
                            M
                          </span>
                        )}
                        <span>{rowName(r)}</span>
                        <span className={\`role-pill \${r.isAdmin ? 'admin' : 'user'}\`}>
                          {r.isAdmin ? 'Admin' : 'User'}
                        </span>
                      </div>
                      {/* v0.10.172 - phone number inline, just below the
                          name. Replaces the separate DID column. Default
                          DID is shown; users with multiple lines get a
                          "+N" badge next to it. */}
                      {(() => {
                        if (r.userDids.length === 0) {
                          return r.didNumber ? (
                            <div className="users-admin-phone">{r.didNumber}</div>
                          ) : null;
                        }
                        const defaultDid =
                          r.userDids.find((d) => d.isDefault) || r.userDids[0];
                        const extras = r.userDids.length - 1;
                        return (
                          <div
                            className="users-admin-phone"
                            title={
                              extras > 0
                                ? \`Default line; \${extras} additional \${extras === 1 ? 'line' : 'lines'} (Manage lines for details)\`
                                : 'Default line'
                            }
                          >
                            <span>{defaultDid.didNumber}</span>
                            {extras > 0 && (
                              <span className="users-admin-phone-multi">+{extras}</span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="muted small">{r.email}</div>`,
  },
  {
    label: 'remove the standalone DID <td> (its content moved into the User cell)',
    find: `                </td>
                <td className="muted small">
                  {/* v0.10.40 — Show the user's default-assigned line
                      (from UserDid rows) instead of the legacy
                      User.didNumber, which doesn't track adds/changes.
                      If they have more than one line, show "+N" badge. */}
                  {/* v0.10.108 — Show ALL DIDs assigned to the user, not
                      just the default + "+N" badge. Default DID gets a
                      blue "default" pill; the rest stack underneath. */}
                  {(() => {
                    if (r.userDids.length === 0) {
                      return r.didNumber || '—';
                    }
                    const sorted = [...r.userDids].sort((a, b) => {
                      if (a.isDefault && !b.isDefault) return -1;
                      if (!a.isDefault && b.isDefault) return 1;
                      return a.didNumber.localeCompare(b.didNumber);
                    });
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {sorted.map((d) => (
                          <span
                            key={d.didNumber}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title={d.isDefault ? 'Default line' : 'Additional line'}
                          >
                            {d.didNumber}
                            {d.isDefault && sorted.length > 1 && (
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: 'rgba(59,130,246,0.12)',
                                  color: '#1d4ed8',
                                  fontWeight: 600,
                                }}
                              >
                                default
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                {/* v0.10.111 - Version column: latest seen dialer version`,
    replace: `                </td>
                {/* v0.10.172 - the separate DID column was removed; the
                    phone number is now rendered inside the User cell
                    just below the name. Multi-DID users get a "+N"
                    badge inline. Full per-line management remains in
                    the ⋯ menu → Manage lines modal. */}
                {/* v0.10.111 - Version column: latest seen dialer version`,
  },
]);

// =====================================================================
// Version bumps 0.10.171 -> 0.10.172
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
  c = c.replace(/"version":\s*"0\.10\.171"/, '"version": "0.10.172"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.171 -> 0.10.172`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.171';`,
    replace: `const APP_VERSION = '0.10.172';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.172 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.171',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.172',
    date: 'June 16, 2026',
    highlight: 'Admin Users table: compact rows with phone number inline.',
    changes: [
      { type: 'improved', text: 'Each user row in Settings → Users now shows the phone number directly below the name. The standalone DID column is gone, and the "Microsoft SSO" text line is replaced with a small blue [M] badge inline next to the status dot. Less vertical space, more horizontal room, no horizontal scroll at any reasonable window width.' },
      { type: 'fixed', text: 'Reverted the v0.10.171 layout change that was clipping names and emails on the right side of the User cell.' },
    ],
  },
  {
    version: '0.10.171',`,
  },
]);

console.log('\n[apply-v172] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.172: Users table compact rows; phone inline; [M] SSO badge"');
console.log('  git tag v0.10.172');
console.log('  git push origin main');
console.log('  git push origin v0.10.172');
