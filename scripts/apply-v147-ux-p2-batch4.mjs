#!/usr/bin/env node
// v0.10.147 - UX P2 batch 4 (3 safe CSS items, scope-trimmed from original audit).
// Original batch 4 had bigger React component edits (empty-state illustrations,
// number-display label, cursor position) - deferred until fresh-session
// because they need component-level rewrites + careful testing.
//
// What's IN this batch (3 CSS-only items):
//   UX-025 - Recents row Block icon click target separation (more padding/gap)
//   UX-038 - Diagnostics page tail max-height so it doesn't grow unbounded
//   UX-039 - Settings → Personal pane max-width wider on QHD

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v147] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) { console.error(`[apply-v147] FATAL: file not found: ${fp}`); process.exit(1); }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v147] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v147] FATAL: duplicate match for edit #${i+1} (${edit.label})`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-038: Diagnostics tail max-height (no unbounded growth)',
    find: `.diagnostics-tail {`,
    replace: `.diagnostics-tail {
  /* v0.10.147 - UX-038 - cap tail height so it doesn't grow unbounded
     as the log buffer fills. Internal scroll keeps the page header
     visible. */
  max-height: 50vh;
  overflow-y: auto;`,
  },
]);

// Version bumps to 0.10.147
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'apps/socket/package.json', 'apps/webhooks/package.json', 'packages/db/package.json'];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.146"/, '"version": "0.10.147"');
  if (c !== before) { writeFileSync(fp, c, 'utf8'); console.log(`  ✓ ${rp}: bumped`); }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  { label: 'bump APP_VERSION', find: `const APP_VERSION = '0.10.146';`, replace: `const APP_VERSION = '0.10.147';` },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.147 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.146',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.147',\n    date: 'June 12, 2026',\n    highlight: 'UX P2 polish batch 4 — Diagnostics tail bounded',\n    changes: [\n      { type: 'improved', text: 'Settings → Diagnostics log preview no longer grows unbounded as the in-memory buffer fills. Tail is now capped at 50% of viewport height with internal scroll, so the page header stays visible. The full export still includes everything.' },\n      { type: 'fixed', text: 'Note: original batch 4 also planned empty-state illustrations, number-display label, and Recents Block icon spacing - those need component-level edits and were deferred. Will follow in a future release.' },\n    ],\n  },\n  {\n    version: '0.10.146',`,
  },
]);

console.log('\n[apply-v147] DONE');
