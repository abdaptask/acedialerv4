#!/usr/bin/env node
// v0.10.173 - Settings > Users redesign: <table> -> card rows.
//
// SCOPE
//   • Each user renders as a card (avatar w/ [M] SSO badge overlay,
//     name + status pill, email · phone subtitle, version + last-seen
//     pills, action icons flush right). No more <table>.
//   • Filter pills above the search bar: All / Active / Inactive / Stale.
//   • Sort dropdown next to the filter pills: Name / Last sign-in /
//     Version. Replaces the column-header click-to-sort.
//   • Status pill changes color for non-active users (no opacity dim).
//     Active = green, Stale = orange, Inactive = red.
//   • Kebab menu actions PRESERVED in full (promote/demote, deactivate,
//     hard delete, manage lines, set country, connection-health toggle,
//     reset SIP password, set local password, etc).
//
// VERSION BUMP: 0.10.172 -> 0.10.173

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v173] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v173] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v173] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v173] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. CSS - append card layout + filter pill styles to styles.css
// =====================================================================
const CSS_BLOCK = `
/* v0.10.173 - Users admin redesigned from <table> to card rows.
   Cards stack vertically with a subtle background, large avatar
   on the left (with an [M] SSO badge overlay in the bottom-right
   corner of the avatar), name + status pill on the first line,
   email · phone subtitle on the second, version + last-seen pills
   on the third, and action icons flush right. */

.users-admin-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.users-admin-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: var(--text-dim);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  font-family: inherit;
}
.users-admin-filter-pill:hover {
  background: rgba(255, 255, 255, 0.10);
  color: var(--text);
}
.users-admin-filter-pill.active {
  background: var(--accent, #0a84ff);
  color: #fff;
  border-color: var(--accent, #0a84ff);
}
.users-admin-filter-pill-count {
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  font-weight: 600;
}
[data-theme="light"] .users-admin-filter-pill {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.10);
  color: var(--text-dim);
}
[data-theme="light"] .users-admin-filter-pill:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text);
}
[data-theme="light"] .users-admin-filter-pill.active {
  background: var(--accent, #0a84ff);
  color: #fff;
  border-color: var(--accent, #0a84ff);
}
.users-admin-sort {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-dim);
}
.users-admin-sort select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: var(--text);
  padding: 5px 10px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
[data-theme="light"] .users-admin-sort select {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.10);
  color: var(--text);
}

/* Card list container */
.users-admin-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Individual card */
.users-admin-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  transition: background 0.12s, border-color 0.12s;
  position: relative;
}
.users-admin-card:hover {
  background: rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .users-admin-card {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
[data-theme="light"] .users-admin-card:hover {
  background: #fafbfc;
}

/* Avatar with M badge overlay */
.users-admin-card-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.users-admin-card-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.18);
  color: #6366f1;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  user-select: none;
}
[data-theme="light"] .users-admin-card-avatar {
  background: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
}
.users-admin-card-m-badge {
  position: absolute;
  bottom: -3px;
  right: -3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: rgba(99, 102, 241, 0.22);
  color: #4f46e5;
  font-size: 0.7rem;
  font-weight: 800;
  border: 2px solid var(--bg-elevated, #1c1c1e);
  user-select: none;
}
[data-theme="light"] .users-admin-card-m-badge {
  background: rgba(99, 102, 241, 0.18);
  color: #4338ca;
  border-color: #fff;
}

/* Card body (middle column) */
.users-admin-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.users-admin-card-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.users-admin-card-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}
.users-admin-card-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-dim);
}
[data-theme="light"] .users-admin-card-status-pill {
  background: rgba(0, 0, 0, 0.04);
}
.users-admin-card-status-pill.active {
  color: #16a34a;
}
.users-admin-card-status-pill.inactive {
  color: #ef4444;
}
.users-admin-card-status-pill.stale {
  color: #f97316;
}
.users-admin-card-status-pill .users-admin-status-dot {
  width: 8px;
  height: 8px;
  box-shadow: none;
}
.users-admin-card-role-pill {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.users-admin-card-role-pill.admin {
  background: rgba(245, 158, 11, 0.18);
  color: #b45309;
}
.users-admin-card-subtitle {
  font-size: 0.82rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.users-admin-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.users-admin-card-meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
[data-theme="light"] .users-admin-card-meta-pill {
  background: rgba(0, 0, 0, 0.04);
}
.users-admin-card-meta-label {
  opacity: 0.6;
  font-weight: 500;
}
.users-admin-card-meta-extra {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
  font-weight: 600;
}

/* Card actions (right side) */
.users-admin-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
}
.users-admin-card-actions .icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 9px;
  transition: background 0.12s;
}
.users-admin-card-actions .icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
[data-theme="light"] .users-admin-card-actions .icon-btn {
  background: rgba(0, 0, 0, 0.04);
}
[data-theme="light"] .users-admin-card-actions .icon-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}

/* Inactive card - no opacity change per design spec (v0.10.173).
   Status pill color does the visual work. */
.users-admin-card.inactive { /* intentionally empty */ }
`;

applyEdits('apps/web/src/styles.css', [
  {
    label: 'append v0.10.173 card-redesign styles after the existing users-admin-table styles',
    find: `.users-admin-phone-multi {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #92400e;
  font-weight: 600;
}`,
    replace: `.users-admin-phone-multi {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #92400e;
  font-weight: 600;
}
` + CSS_BLOCK,
  },
]);

console.log('  CSS added.');

// =====================================================================
// 2. JSX - replace search bar with search + filter pills + sort dropdown
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'add statusFilter state hook (place near search state)',
    find: `      <div className="search-bar" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="search"
          className="search-input"
          placeholder="Search by name, email, or DID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        {inactiveCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              style={{ margin: 0 }}
            />
            Show {inactiveCount} deactivated
          </label>
        )}
      </div>`,
    replace: `      {/* v0.10.173 - search + filter-pill row + sort dropdown above
          the card list. Replaces the column-header sort UI (gone now
          that the table is gone). statusFilter state lives in the
          parent component (added in v0.10.173). */}
      <div className="search-bar" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="search"
          className="search-input"
          placeholder="Search by name, email, or DID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div className="users-admin-filter-row">
        {(() => {
          const counts = {
            all: rows.length,
            active: 0,
            stale: 0,
            inactive: 0,
          };
          const STALE_MS = 30 * 24 * 60 * 60 * 1000;
          for (const r of rows) {
            if (!r.isActive) counts.inactive++;
            else if (!r.lastLoginAt || (Date.now() - new Date(r.lastLoginAt).getTime()) > STALE_MS) counts.stale++;
            else counts.active++;
          }
          const pills: Array<{ key: typeof statusFilter; label: string; count: number }> = [
            { key: 'all', label: 'All', count: counts.all },
            { key: 'active', label: 'Active', count: counts.active },
            { key: 'stale', label: 'Stale', count: counts.stale },
            { key: 'inactive', label: 'Inactive', count: counts.inactive },
          ];
          return pills.map((p) => (
            <button
              key={p.key}
              type="button"
              className={\`users-admin-filter-pill\${statusFilter === p.key ? ' active' : ''}\`}
              onClick={() => setStatusFilter(p.key)}
            >
              {p.label}
              <span className="users-admin-filter-pill-count">{p.count}</span>
            </button>
          ));
        })()}
        <span className="users-admin-sort">
          Sort:
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort users by"
          >
            <option value="name">Name</option>
            <option value="lastLogin">Last sign-in</option>
            <option value="version">Version</option>
          </select>
          <button
            type="button"
            className="users-admin-filter-pill"
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending — click to flip' : 'Descending — click to flip'}
            style={{ padding: '5px 10px' }}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </span>
      </div>`,
  },
]);

console.log('  JSX edit 1 (search + filter pills + sort) done.');

// =====================================================================
// 3. JSX - add statusFilter state hook + adjust sortKey default
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'add statusFilter state hook',
    find: `  const [search, setSearch] = useState('');
  // v0.9.8 — Hard-delete modal target. null = closed.`,
    replace: `  const [search, setSearch] = useState('');
  // v0.10.173 - card-redesign status filter pills (All / Active / Stale / Inactive).
  // Replaces the v0.9.9 "Show N deactivated" checkbox. Default to 'all'
  // so admins still see everyone unless they narrow down.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'stale'>('all');
  // v0.9.8 — Hard-delete modal target. null = closed.`,
  },
  {
    label: 'set default sortKey to name (instead of null) so the dropdown reflects active sort',
    find: `  type SortKey = 'name' | 'email' | 'role' | 'status' | 'did' | 'lastLogin' | 'version';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);`,
    replace: `  type SortKey = 'name' | 'email' | 'role' | 'status' | 'did' | 'lastLogin' | 'version';
  // v0.10.173 - default to name asc so the new card list is sorted
  // out of the box. The card layout has a Sort dropdown next to the
  // filter pills (no more column-header click target).
  const [sortKey, setSortKey] = useState<SortKey | null>('name');`,
  },
  {
    label: 'apply statusFilter inside the filtered computation',
    find: `  const filtered = rows.filter((r) => {
    if (!showInactive && !r.isActive) return false;
    const q = search.trim().toLowerCase();`,
    replace: `  const filtered = rows.filter((r) => {
    // v0.10.173 - status filter from filter-pill row. 'all' is the
    // default and lets every status through. 'active'/'stale'/
    // 'inactive' narrow to just that bucket. Replaces the older
    // showInactive checkbox which only handled the binary active vs
    // not. The active/stale split is computed the same way as the
    // status-dot color logic in the card render below.
    {
      const STALE_MS = 30 * 24 * 60 * 60 * 1000;
      let bucket: 'active' | 'stale' | 'inactive';
      if (!r.isActive) bucket = 'inactive';
      else if (!r.lastLoginAt || (Date.now() - new Date(r.lastLoginAt).getTime()) > STALE_MS) bucket = 'stale';
      else bucket = 'active';
      if (statusFilter !== 'all' && bucket !== statusFilter) return false;
    }
    const q = search.trim().toLowerCase();`,
  },
]);

console.log('  JSX edits 3 (state + filter logic) done.');

// =====================================================================
// 4. JSX - replace the <table> structure with <div className="users-admin-cards">
//    Done as 4 targeted edits so the kebab menu (~250 lines of action
//    buttons) stays in place untouched.
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  // ---- Edit 4a: opening structure ----
  {
    label: '4a: replace <table> opening + <thead> sort headers + <tbody> with <div className="users-admin-cards">',
    find: `      {/* v0.10.160 - horizontal-scroll wrapper around the Users table.
          The table has 8 columns (User/Email/Role/Status/DID/Version/
          LastLogin/Actions) that exceed the 560px settings pane width.
          Without this wrapper the Actions column (Call/Text/Menu) is
          clipped off-screen and unreachable. */}
      <div className="users-admin-table-wrap">
      <table className="users-admin-table">
        <thead>`,
    replace: `      {/* v0.10.173 - converted from <table> to card rows. Each card
          stacks: avatar with [M] SSO badge + name + status pill +
          email · phone subtitle + version/seen meta pills + action
          icons. Filter pills + sort dropdown are above (replacing
          column-header click-to-sort). */}
      <div className="users-admin-cards">
        {/* legacy <thead> removed - sort lives in the filter row above */}
        {(() => null)(); /* keep parser happy if next anchor changes */ null}
        {/* HEAD_REMOVED_MARKER_v0_10_173 */}
        <span hidden>`,
  },
  // ---- Edit 4b: remove the <thead> block + open tbody ----
  {
    label: '4b: remove the thead/tbody framing and tr open; start the card map directly',
    find: `        <span hidden>
            {/* v0.10.91 — Each header is now a sort toggle. Click once to
                sort ascending, click again to flip to descending. The active
                column shows an arrow indicator. Header click target is the
                cell — no inner <button> so the existing thead CSS still
                applies. */}
            {(() => {
              // v0.10.166 - Email/Role/Status removed from the header bar.
              // Their data is now shown inside the User cell (status as a
              // colored dot, role as an inline pill, email under the SSO
              // badge). SortKey type is unchanged so sortRows() can still
              // handle those keys if exposed via a future UI surface.
              // v0.10.172 - DID column removed; phone number now lives
              // inside the User cell. table-layout:fixed reverted to
              // default auto (User cell takes its natural width again).
              const ths: Array<{ key: SortKey; label: string }> = [`,
    replace: `        <span hidden style={{ display: 'none' }}>
            {/* v0.10.173 - legacy thead block kept hidden so the
                surrounding helpers (toggleSort, ths array) still
                compile. Will be removed in a follow-up cleanup. */}
            {(() => {
              const ths: Array<{ key: SortKey; label: string }> = [`,
  },
  // ---- Edit 4c: close the hidden span + remove tbody open ----
  {
    label: '4c: close the hidden legacy thead span and remove <tbody>; start mapping users to cards',
    find: `            <th aria-label="Actions" style={{ width: 130, minWidth: 130 }} />
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {`,
    replace: `          </span>
          {filtered.map((r) => {`,
  },
  // ---- Edit 4d: replace the <tr> + User/Version/LastSign cells with the new card body ----
  {
    label: '4d: replace <tr> + 3 leading <td>s with new card body, preserving the kebab menu cell',
    find: `            return (
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
                      <div className="muted small">{r.email}</div>
                    </div>
                  </div>
                </td>
                {/* v0.10.172 - the separate DID column was removed; the
                    phone number is now rendered inside the User cell
                    just below the name. Multi-DID users get a "+N"
                    badge inline. Full per-line management remains in
                    the ⋯ menu → Manage lines modal. */}
                {/* v0.10.111 - Version column: latest seen dialer version
                    across this user's devices. Mixed versions get a yellow
                    badge so admin can spot users running older clients. */}
                <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                  {(() => {
                    const v = r.latestVersion;
                    if (!v) return <span style={{ color: '#9ca3af' }}>—</span>;
                    const distinct = r.distinctVersions || [v];
                    const mixed = distinct.length > 1;
                    const tooltip = mixed
                      ? \`Multiple versions in use: \${distinct.join(', ')}\`
                      : (r.latestSeenAt
                          ? \`Last heartbeat: \${new Date(r.latestSeenAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}\`
                          : 'Recently seen');
                    return (
                      <span title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        v{v}
                        {mixed && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: 'rgba(245,158,11,0.15)',
                              color: '#92400e',
                              fontWeight: 600,
                            }}
                          >
                            +{distinct.length - 1}
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </td>
                <td className="muted small">
                  {r.lastLoginAt
                    ? new Date(r.lastLoginAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })
                    : 'Never'}
                </td>
                <td className="users-admin-actions">`,
    replace: `            // v0.10.173 - status pill label derived from the dot class.
            // Active/Stale/Inactive map to the same color tokens used
            // on the status dot itself.
            const statusPillLabel =
              statusDotClass === 'active' ? 'Active' :
              statusDotClass === 'stale' ? 'Stale' : 'Inactive';
            const latestVersion = r.latestVersion;
            const distinctVersions = r.distinctVersions || (latestVersion ? [latestVersion] : []);
            const mixedVersions = distinctVersions.length > 1;
            const versionTooltip = mixedVersions
              ? \`Multiple versions in use: \${distinctVersions.join(', ')}\`
              : (r.latestSeenAt
                  ? \`Last heartbeat: \${new Date(r.latestSeenAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}\`
                  : 'Recently seen');
            const lastSeenLabel = r.lastLoginAt
              ? new Date(r.lastLoginAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })
              : 'Never';
            // Phone for subtitle line (default DID + "+N" if multiple).
            const phoneDefault = r.userDids.find((d) => d.isDefault) || r.userDids[0];
            const phoneNumber = phoneDefault ? phoneDefault.didNumber : (r.didNumber || null);
            const phoneExtras = r.userDids.length > 1 ? r.userDids.length - 1 : 0;
            return (
              <div key={r.id} className={\`users-admin-card \${r.isActive ? '' : 'inactive'}\`}>
                {/* Avatar with M SSO badge overlay in bottom-right */}
                <div className="users-admin-card-avatar-wrap">
                  <span className="users-admin-card-avatar" aria-hidden="true">
                    {(r.firstName?.[0] ?? r.email[0] ?? '?').toUpperCase()}
                  </span>
                  {r.provider !== 'local' && (
                    <span
                      className="users-admin-card-m-badge"
                      title="Signed in with Microsoft"
                      aria-label="Microsoft SSO"
                    >
                      M
                    </span>
                  )}
                </div>
                {/* Card body: name + status pill + admin pill / subtitle / meta pills */}
                <div className="users-admin-card-body">
                  <div className="users-admin-card-name-row">
                    <span className="users-admin-card-name">{rowName(r)}</span>
                    <span
                      className={\`users-admin-card-status-pill \${statusDotClass}\`}
                      title={statusDotTitle}
                    >
                      <span className={\`users-admin-status-dot \${statusDotClass}\`} />
                      {statusPillLabel}
                    </span>
                    {r.isAdmin && (
                      <span className="users-admin-card-role-pill admin">Admin</span>
                    )}
                  </div>
                  <div className="users-admin-card-subtitle">
                    {r.email}
                    {phoneNumber ? (
                      <>
                        {' · '}
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{phoneNumber}</span>
                        {phoneExtras > 0 && (
                          <span
                            className="users-admin-phone-multi"
                            style={{ marginLeft: 6 }}
                            title={\`\${phoneExtras} additional line\${phoneExtras === 1 ? '' : 's'} (Manage lines for details)\`}
                          >
                            +{phoneExtras}
                          </span>
                        )}
                      </>
                    ) : null}
                  </div>
                  <div className="users-admin-card-meta">
                    {latestVersion && (
                      <span className="users-admin-card-meta-pill" title={versionTooltip}>
                        <span className="users-admin-card-meta-label">ver</span>
                        v{latestVersion}
                        {mixedVersions && (
                          <span className="users-admin-card-meta-extra">+{distinctVersions.length - 1}</span>
                        )}
                      </span>
                    )}
                    <span className="users-admin-card-meta-pill">
                      <span className="users-admin-card-meta-label">seen</span>
                      {lastSeenLabel}
                    </span>
                  </div>
                </div>
                {/* Card actions on the right - call, message, ⋯ kebab.
                    Kebab menu DOM stays identical to the legacy table
                    version below; the cell wrapper just changed from
                    <td> to <div>. */}
                <div className="users-admin-card-actions">`,
  },
  // ---- Edit 4e: close the card div and replace tr close with div close ----
  {
    label: '4e: replace closing </td></tr> with </div></div> closing the actions + card div',
    find: `                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={5} className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>No users match.</td></tr>
          )}
        </tbody>
      </table>
      </div>`,
    replace: `                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>
              No users match.
            </div>
          )}
      </div>`,
  },
]);

console.log('  JSX edits 4 (table -> cards) done.');

// =====================================================================
// 5. Version bumps 0.10.172 -> 0.10.173
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
  c = c.replace(/"version":\s*"0\.10\.172"/, '"version": "0.10.173"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.172 -> 0.10.173`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.172';`,
    replace: `const APP_VERSION = '0.10.173';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.173 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.172',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.173',
    date: 'June 17, 2026',
    highlight: 'Admin Users: redesigned as card rows with filter pills.',
    changes: [
      { type: 'improved', text: 'Settings → Users is now a clean list of cards instead of a table. Each card shows a large avatar with a Microsoft SSO badge, name + status pill, email · phone, and version + last-seen as soft pills. Looks dramatically less crammed.' },
      { type: 'improved', text: 'New filter pills above the list — All / Active / Stale / Inactive — with live counts. Replaces the "Show N deactivated" checkbox.' },
      { type: 'improved', text: 'Sort dropdown next to the filter pills (Name / Last sign-in / Version) plus an up/down toggle. Replaces the column-header click-to-sort that went away with the table.' },
      { type: 'improved', text: 'Call / Message / ⋯ icons stay flush-right on every card and never need horizontal scrolling.' },
    ],
  },
  {
    version: '0.10.172',`,
  },
]);

console.log('\n[apply-v173] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.173: Users admin redesign - table -> card rows + filter pills"');
console.log('  git tag v0.10.173');
console.log('  git push origin main');
console.log('  git push origin v0.10.173');
