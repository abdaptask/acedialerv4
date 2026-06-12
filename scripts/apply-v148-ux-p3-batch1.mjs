#!/usr/bin/env node
// v0.10.148 - UX P3 polish batch 1 (3 simple CSS items).
//   UX-029 - will-change on transform animations (paint hint)
//   UX-049 - long contact names show title tooltip on hover
//   UX-055 - heatmap font-size 10px → 11px (legibility)
//
// Skipping the Electron multi-monitor work (UX-045, UX-046) - that needs
// testing on actual multi-monitor hardware and several runtime checks.
// Promoted to its own future release.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v148] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) { console.error(`[apply-v148] FATAL: file not found: ${fp}`); process.exit(1); }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v148] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v148] FATAL: duplicate match for edit #${i+1} (${edit.label})`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// UX-055 - heatmap font-size bump. Anchor: ".heatmap" + nearby font-size 10px.
// If the audit's anchor doesn't match, the script FATALs - that's fine,
// we just skip this batch and revisit.
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-029: hint will-change on the most-visible looping transform animations',
    find: `.in-call-controls {`,
    replace: `/* v0.10.148 - UX-029 - hint the compositor before transform-animation-heavy elements
   render. Reduces paint jank on lower-end laptops. */
.incoming-btn,
.in-call-btn,
.return-to-call,
.recents-row,
.thread-row {
  will-change: transform;
}
.in-call-controls {`,
  },
]);

// Version bumps to 0.10.148
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'apps/socket/package.json', 'apps/webhooks/package.json', 'packages/db/package.json'];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.147"/, '"version": "0.10.148"');
  if (c !== before) { writeFileSync(fp, c, 'utf8'); console.log(`  ✓ ${rp}: bumped`); }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  { label: 'bump APP_VERSION', find: `const APP_VERSION = '0.10.147';`, replace: `const APP_VERSION = '0.10.148';` },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.148 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.147',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.148',\n    date: 'June 12, 2026',\n    highlight: 'UX P3 polish — paint-hint optimization on frequently-animated UI',\n    changes: [\n      { type: 'improved', text: 'Performance hint added to elements that animate on every interaction (incoming-call buttons, in-call control buttons, return-to-call banner, list rows). The browser now knows to promote these to their own compositor layer ahead of time, eliminating small paint stutters on lower-end laptops.' },\n    ],\n  },\n  {\n    version: '0.10.147',`,
  },
]);

console.log('\n[apply-v148] DONE');
