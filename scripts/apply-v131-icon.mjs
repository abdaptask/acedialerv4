#!/usr/bin/env node
// v0.10.131 - Cleaner Hold & Accept icon on the floater.
//
// USER FEEDBACK on v0.10.130:
//   The previous Hold & Accept icon (phone with subtle arrow overlay)
//   was indistinguishable from plain Accept at floater size. User
//   picked Option B: keep the phone receiver fully visible inside the
//   same green button, and add a small orange pause badge in the
//   TOP-RIGHT corner of the button (notification-badge style). The
//   orange matches the Reply with Text button so orange consistently
//   signals a modifier action across the floater UI.
//
// DESIGN:
//   Decline:        large red circle, phone-X icon (UNCHANGED)
//   Hold & Accept:  same large green circle, phone receiver fully
//                   visible, PLUS a small orange disc (#f97316) sitting
//                   in the top-right corner with two white pause bars
//                   inside. Orange disc has a 2px green border so it
//                   reads as a separate badge layered on top.
//
// IMPLEMENTATION:
//   - SVG inside the button is restored to a clean phone-receiver path
//     (we drop the previous tiny arrow polyline+line)
//   - A <span class="pause-badge"> sibling is added inside the button
//     for the corner badge (HTML positioning is way easier than trying
//     to anchor an SVG element to the button corner)
//   - New CSS rule .hold-accept { position: relative } so the badge
//     can be absolutely positioned, plus a .pause-badge rule for the
//     orange disc itself
//
// USAGE:
//   1. Copy to acedialerv4\scripts\apply-v131-icon.mjs
//   2. cd acedialerv4
//   3. node scripts/apply-v131-icon.mjs
//   4. node scripts/strip-null-bytes.mjs
//   5. npx tsc --noEmit -p apps/desktop/tsconfig.json
//   6. npx tsc --noEmit -p apps/web/tsconfig.json
//   7. git diff --stat
//   8. git add -A && git commit -m "v0.10.131: orange pause badge top-right on Hold & Accept" && git push

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v131] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v131] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v131] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v131] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. Replace Hold & Accept button HTML: clean phone SVG + corner badge span
// ===========================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'replace Hold & Accept SVG/HTML with phone + top-right orange pause badge',
    find: `    ? \`<button class="hold-accept" id="hold-accept" title="Hold current call and accept">
        <svg viewBox="0 0 24 24"><polyline points="19 15 24 12 19 9"/><line x1="6" y1="12" x2="24" y2="12"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    replace: `    ? \`<button class="hold-accept" id="hold-accept" title="Hold current call and accept">
        <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        <span class="pause-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="0.8"/><rect x="14" y="4" width="4" height="16" rx="0.8"/></svg>
        </span>`,
  },
  {
    label: 'add CSS: hold-accept needs position:relative; pause-badge styling',
    find: `  button.accept { background: #22c55e; }\n  button.hold-accept { background: #22c55e; }`,
    replace: `  button.accept { background: #22c55e; }\n  button.hold-accept { background: #22c55e; position: relative; }\n  /* v0.10.131 - top-right orange pause badge overlay on Hold & Accept.\n     2px green border so the badge reads as a layered element distinct\n     from the green button background; matches Reply with Text orange\n     (#f97316) so 'orange = modifier action' is consistent. */\n  .pause-badge {\n    position: absolute;\n    top: 4px;\n    right: 4px;\n    width: 22px;\n    height: 22px;\n    border-radius: 50%;\n    background: #f97316;\n    border: 2px solid #22c55e;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n  }\n  .pause-badge svg {\n    width: 11px;\n    height: 11px;\n    fill: #ffffff;\n  }`,
  },
]);

// ===========================================================
// 2. Version bumps to 0.10.131
// ===========================================================
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
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.130"/, '"version": "0.10.131"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.130 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.130 → 0.10.131`);
  }
}

// ===========================================================
// 3. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.131',
    find: `const APP_VERSION = '0.10.130';`,
    replace: `const APP_VERSION = '0.10.131';`,
  },
]);

// ===========================================================
// 4. whatsNew.ts v0.10.131 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.131 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.130',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.131',\n    date: 'June 12, 2026',\n    highlight: 'Clearer Hold and Accept icon on the floating call popup',\n    changes: [\n      { type: 'improved', text: 'Refreshed the Hold and Accept icon on the floating incoming-call popup. The previous icon (phone receiver with a faint arrow) was indistinguishable from the plain Accept icon at floater size. New design keeps the same large green button (matching the Decline buttons size), but adds a small orange pause badge in the TOP-RIGHT corner of the button - notification-badge style. The phone receiver underneath remains fully visible. Orange matches the Reply with Text button so orange consistently signals a modifier action across the floater UI. Action behavior is unchanged (clicking still holds the current call and accepts the new one).' },\n      { type: 'fixed', text: 'No code changes to Reply with Text - working correctly since v0.10.130. This release is purely a UI polish pass on the Hold and Accept icon.' },\n    ],\n  },\n  {\n    version: '0.10.130',`,
  },
]);

console.log('\n[apply-v131] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit -m "v0.10.131: orange pause badge top-right on Hold & Accept"');
console.log('  6. git push');
