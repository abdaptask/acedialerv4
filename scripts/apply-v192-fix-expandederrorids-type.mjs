#!/usr/bin/env node
// v0.10.192 - Fix TS type mismatch shipped in v0.10.191.
//
// In v0.10.191 I declared expandedErrorIds as Set<string>, but
// MessageRecord.id is `number` (apps/web/src/api.ts line 986). That
// produced 5 TS2345 errors in Messages.tsx around the Failed-pill
// click handler:
//   if (next.has(m.id)) next.delete(m.id);
//   else next.add(m.id);
//   aria-expanded={expandedErrorIds.has(m.id)}
//   {expandedErrorIds.has(m.id) && ...}
//
// FIX
//   Set<string> -> Set<number>. One anchored edit.
//
// VERSION BUMP: 0.10.191 -> 0.10.192

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v192] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v192] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v192] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v192] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: expandedErrorIds Set<string> -> Set<number> (MessageRecord.id is number)',
    find: `  // v0.10.191 — Which failed bubbles currently have their error details
  // expanded. Default: collapsed (just a "Failed" pill). Click toggles.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<string>>(new Set());`,
    replace: `  // v0.10.191 — Which failed bubbles currently have their error details
  // expanded. Default: collapsed (just a "Failed" pill). Click toggles.
  // v0.10.192 — Set<number> not Set<string>: MessageRecord.id is number.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<number>>(new Set());`,
  },
]);

// =====================================================================
// Version bumps 0.10.191 -> 0.10.192
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
  c = c.replace(/"version":\s*"0\.10\.191"/, '"version": "0.10.192"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.191 -> 0.10.192`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v192] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.191';`,
    replace: `const APP_VERSION = '0.10.192';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.192 entry (internal fixup)',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.191',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.192',
    date: 'June 18, 2026',
    highlight: 'Internal: TypeScript fixup for v0.10.191.',
    changes: [
      { type: 'fixed', text: 'Internal: v0.10.191 had a TypeScript type mismatch on the failed-message expand state (Set<string> vs Set<number>). Functional behavior was unaffected; this release just gets the strict typecheck clean.' },
    ],
  },
  {
    version: '0.10.191',`,
  },
]);

console.log('\n[apply-v192] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json   # should be clean now');
console.log('  git add -A');
console.log('  git commit -m "v0.10.192: Fix TS type on expandedErrorIds (Set<number>)"');
console.log('  git tag v0.10.192');
console.log('  git push origin main');
console.log('  git push origin v0.10.192');
