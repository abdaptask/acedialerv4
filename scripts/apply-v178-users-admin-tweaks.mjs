#!/usr/bin/env node
// v0.10.178 - Two small Users-admin tweaks on top of the v0.10.173
// card redesign.
//
// SCOPE
//   1. New sort option in Settings -> Users -> Sort dropdown:
//      "Date added". Combined with the existing up/down arrow toggle
//      this gives Oldest-first (asc) and Newest-first (desc).
//      Backed by User.createdAt, which AdminUserRow already exposes.
//   2. User card avatar now shows first + last initial (e.g. "AS"
//      for "Abdulla Sheikh") instead of just the first letter ("A").
//      Falls back to a single initial when only one name is on file,
//      then to email[0], then to '?'.
//
// VERSION BUMP: 0.10.177 -> 0.10.178

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v178] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v178] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v178] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v178] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Settings.tsx - SortKey type, sort case, dropdown option, avatar
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: '1a: add "created" to SortKey union',
    find: `  type SortKey = 'name' | 'email' | 'role' | 'status' | 'did' | 'lastLogin' | 'version';`,
    replace: `  type SortKey = 'name' | 'email' | 'role' | 'status' | 'did' | 'lastLogin' | 'version' | 'created';`,
  },
  {
    label: '1b: add "created" case to the getKey switch (sort by User.createdAt)',
    find: `        case 'version':
          // v0.10.111 - sort by semver-ish numeric weight; missing version
          // sorts to the bottom in asc order.
          return r.latestVersion
            ? r.latestVersion.split('.').map((n) => Number(n) || 0).reduce((a, b) => a * 1000 + b, 0)
            : -Infinity;
      }`,
    replace: `        case 'version':
          // v0.10.111 - sort by semver-ish numeric weight; missing version
          // sorts to the bottom in asc order.
          return r.latestVersion
            ? r.latestVersion.split('.').map((n) => Number(n) || 0).reduce((a, b) => a * 1000 + b, 0)
            : -Infinity;
        case 'created':
          // v0.10.178 - sort by signup / invite date. Asc = oldest first,
          // desc = newest first. createdAt is required on AdminUserRow,
          // so the missing-value branch is mostly defensive.
          return r.createdAt ? new Date(r.createdAt).getTime() : -Infinity;
      }`,
  },
  {
    label: '1c: add "Date added" option to the sort dropdown',
    find: `            <option value="name">Name</option>
            <option value="lastLogin">Last sign-in</option>
            <option value="version">Version</option>
          </select>`,
    replace: `            <option value="name">Name</option>
            <option value="lastLogin">Last sign-in</option>
            <option value="version">Version</option>
            {/* v0.10.178 - Date added. Combined with the existing
                up/down arrow toggle this gives Oldest-first (asc)
                and Newest-first (desc). */}
            <option value="created">Date added</option>
          </select>`,
  },
  {
    label: '1d: avatar shows first+last initials instead of single char',
    find: `                  <span className="users-admin-card-avatar" aria-hidden="true">
                    {(r.firstName?.[0] ?? r.email[0] ?? '?').toUpperCase()}
                  </span>`,
    replace: `                  <span className="users-admin-card-avatar" aria-hidden="true">
                    {/* v0.10.178 - First + last initial when both are on
                        file ("AS" for "Abdulla Sheikh"). Falls back to a
                        single initial when only one name exists, then to
                        email[0], then to '?'. Mirrors the initialsFromLabel
                        pattern used in Voicemail.tsx and Messages.tsx. */}
                    {(() => {
                      const f = (r.firstName ?? '').trim();
                      const l = (r.lastName ?? '').trim();
                      if (f && l) return (f[0]! + l[0]!).toUpperCase();
                      if (f) return f.slice(0, 2).toUpperCase();
                      if (l) return l.slice(0, 2).toUpperCase();
                      return (r.email[0] ?? '?').toUpperCase();
                    })()}
                  </span>`,
  },
]);

// =====================================================================
// 2. Version bumps 0.10.177 -> 0.10.178
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
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.177"/, '"version": "0.10.178"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.177 -> 0.10.178`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.177 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v178] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.177';`,
    replace: `const APP_VERSION = '0.10.178';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.178 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.177',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.178',
    date: 'June 18, 2026',
    highlight: 'Admin Users: sort by date added + two-letter avatars.',
    changes: [
      { type: 'new', text: 'Settings → Users sort dropdown now has a "Date added" option. Combined with the up/down arrow next to it, you can list users oldest-first or newest-first.' },
      { type: 'improved', text: 'Each user card avatar now shows first + last initials (e.g. "AS" for Abdulla Sheikh) instead of just the first letter. Single-name accounts still show a single initial; email-only accounts fall back to email[0].' },
    ],
  },
  {
    version: '0.10.177',`,
  },
]);

console.log('\n[apply-v178] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.178: Users admin - sort by date added + two-letter avatars"');
console.log('  git tag v0.10.178');
console.log('  git push origin main');
console.log('  git push origin v0.10.178');
