#!/usr/bin/env node
// v0.10.138 - UX batch supplement.
//
// CONTEXT: the v0.10.137 commit ("catch up What's New entries") actually
// included partial UX-005/011/012/013 changes that the prior script
// landed before pushing. UX-008 (in-call overflow) and UX-013 for
// Messages.tsx + Settings.tsx are STILL pending. Plus the .in-call CSS
// block in the live tree has a different shape than the audit reported,
// so the UX-008 anchor needs to be corrected.
//
// This script:
//   - Applies UX-008 with corrected anchors for the actual .in-call block.
//   - Finishes UX-013 by fixing the remaining !confirm() sites in
//     Messages.tsx (1) and Settings.tsx (5+ — we'll do them via the
//     `allowDuplicates` path for the pattern `if (!confirm(`).
//   - Bumps version 0.10.137 → 0.10.138.
//   - Adds the v0.10.138 whatsNew entry.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v138] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v138] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v138] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    const allowDuplicates = !!edit.allowDuplicates;
    if (!allowDuplicates && content.split(find).length - 1 > 1) {
      console.error(`[apply-v138] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = allowDuplicates ? content.split(find).join(replace) : content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// UX-008 with CORRECTED anchor for the actual .in-call block
// ===========================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-008 step 1: add overflow-y:auto inside .in-call rule',
    find: `/* ============ IN-CALL SCREEN ============ */
.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 420px;
  padding: 3rem 1.5rem 3rem;
  min-height: 100%;
  margin: 0 auto;
}
.in-call-number {`,
    replace: `/* ============ IN-CALL SCREEN ============ */
.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 420px;
  padding: 3rem 1.5rem 3rem;
  min-height: 100%;
  margin: 0 auto;
  /* v0.10.138 - UX-008 - internal scroll for short viewports when
     held-call strip + 3x3 control grid + transfer dialog exceed the
     visible area on 1366x768. */
  overflow-y: auto;
}
/* v0.10.138 - UX-008 - compact in-call layout on short viewports.
   On 1366x768 with 125% DPI scaling and a held call visible, the
   3x3 control grid plus hangup row was clipping. These overrides
   shrink the spacing and control icons to keep everything reachable
   without sacrificing tappability. Bails out above 700px viewport
   height so taller displays are unaffected. */
@media (max-height: 700px) {
  .in-call { padding: 1rem 1rem 0.75rem; gap: 1rem; }
  .in-call-grid { gap: 10px 18px; }
  .ic-ctrl-icon { width: 56px; height: 56px; }
}
.in-call-number {`,
  },
]);

// ===========================================================
// UX-013 — remaining sites (Messages.tsx + Settings.tsx)
// ===========================================================

// Messages.tsx — the multi-line block-number confirm at line ~542
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: 'UX-013 Messages: block-number confirm strict-true (multi-line)',
    find: `    if (
      !confirm(
        \`Block \${friendly}?\\n\\nThey won't be able to call or text you. \` +
          'You can unblock them later in Settings → Blocked numbers.',
      )
    ) {
      return;
    }`,
    replace: `    if (
      // v0.10.138 - UX-013 - strict check; Electron sometimes returns null from confirm.
      window.confirm(
        \`Block \${friendly}?\\n\\nThey won't be able to call or text you. \` +
          'You can unblock them later in Settings → Blocked numbers.',
      ) !== true
    ) {
      return;
    }`,
  },
]);

// Settings.tsx — 8+ `if (!confirm(...))` sites. Use allowDuplicates with a
// pattern-style find that captures the whole single-line pattern.
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'UX-013 Settings: Remove tenant hold music confirm',
    find: `    if (!confirm('Remove the tenant-wide default hold music? Users\\' own local files are not affected.')) return;`,
    replace: `    if (window.confirm('Remove the tenant-wide default hold music? Users\\' own local files are not affected.') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Remove saved hold music confirm',
    find: `    if (!confirm('Remove the saved hold music?')) return;`,
    replace: `    if (window.confirm('Remove the saved hold music?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Remove audio greeting confirm',
    find: `    if (!confirm('Remove this audio greeting?')) return;`,
    replace: `    if (window.confirm('Remove this audio greeting?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Import preferences confirm',
    find: `    if (!confirm('Importing will overwrite your current preferences. Continue?')) return;`,
    replace: `    if (window.confirm('Importing will overwrite your current preferences. Continue?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Replace quick replies confirm',
    find: `    if (!confirm('Replace your quick replies with the defaults?')) return;`,
    replace: `    if (window.confirm('Replace your quick replies with the defaults?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Unblock number confirm',
    find: `    if (!confirm('Unblock this number? Future calls and SMS from it will reach you again.')) return;`,
    replace: `    if (window.confirm('Unblock this number? Future calls and SMS from it will reach you again.') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: Archive template confirm',
    find: `    if (!confirm('Archive this template? It will disappear from users\\' picker. You can un-archive by editing.')) return;`,
    replace: `    if (window.confirm('Archive this template? It will disappear from users\\' picker. You can un-archive by editing.') !== true) return;`,
  },
]);

// ===========================================================
// Version bumps 0.10.137 → 0.10.138
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
  c = c.replace(/"version":\s*"0\.10\.137"/, '"version": "0.10.138"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.137 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.137 → 0.10.138`);
  }
}

// ===========================================================
// DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.138',
    find: `const APP_VERSION = '0.10.137';`,
    replace: `const APP_VERSION = '0.10.138';`,
  },
]);

// ===========================================================
// whatsNew.ts - add v0.10.138 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.138 entry above v0.10.137',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.137',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.138',\n    date: 'June 12, 2026',\n    highlight: 'UX batch #2 (completed) - in-call layout, safer confirmations, modal contrast',\n    changes: [\n      { type: 'fixed', text: 'Delete/block confirmations are now reliable in the Electron desktop app. Previously some confirmation dialogs could silently confirm the action when Electron returned null from window.confirm. Explicit click now required for Block, Remove Favorite, Cancel Scheduled Message, Remove Hold Music, Remove Audio Greeting, Import Preferences, Replace Quick Replies, Unblock Number, Archive Template, and more.' },\n      { type: 'improved', text: 'In-call screen adapts to short viewports. On 1366x768 displays with a held call plus the full 3x3 control grid, the hangup button used to clip below the visible area. The layout now compacts on viewports under 700px tall.' },\n      { type: 'improved', text: 'Tip banner no longer overlaps the bottom navigation bar on 1366x768 laptops. The Voicemail tab and its unread badge are now fully visible when a tip is open.' },\n      { type: 'fixed', text: 'Modal backdrops are consistently dark across all overlays. Four modals (contacts quick-pick, call history detail, audio greeting picker, post-decline reply sheet) were rendering with semi-transparent backdrops. They now match the design spec.' },\n      { type: 'fixed', text: 'Internal: added missing CSS rules for incoming-call action labels and tab badge wrappers.' },\n    ],\n  },\n  {\n    version: '0.10.137',`,
  },
]);

console.log('\n[apply-v138] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.138: UX 5-pack complete (UX-008 + UX-013 finish)"');
console.log('  5. git push');
