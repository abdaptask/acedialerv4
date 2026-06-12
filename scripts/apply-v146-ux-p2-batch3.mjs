#!/usr/bin/env node
// v0.10.146 - UX P2 batch 3 (2 CSS items, all narrow-viewport fixes).
//   UX-018 - .app-header @media (max-width: 540) used grid-template-columns
//            but the parent is flex, so the mobile rule never applied.
//            Rewrite as flex-friendly properties.
//   UX-043 - .incoming-banner missing max-width — overflows tiny screens.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v146] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) { console.error(`[apply-v146] FATAL: file not found: ${fp}`); process.exit(1); }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v146] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v146] FATAL: duplicate match for edit #${i+1} (${edit.label})`);
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
    label: 'UX-018: rewrite @media 540 .app-header to use flex-friendly props',
    find: `@media (max-width: 540px) {
  .app-header { grid-template-columns: auto 1fr auto; gap: 0.6rem; padding: 0.4rem 0.7rem; }
  .app-header .version { display: none; }
  .user-name { display: none; }
  .user-chip { padding: 0.2rem 0.35rem 0.2rem 0.3rem; }
  .sip-status-label { display: none; }
  .sip-status-pill { padding: 0.3rem 0.5rem; }
}`,
    replace: `@media (max-width: 540px) {
  /* v0.10.146 - UX-018 - parent .app-header is display:flex, not grid.
     The old grid-template-columns rule never applied. Convert to
     flex-friendly properties that actually work. */
  .app-header { gap: 0.5rem; padding: 0.4rem 0.7rem; flex-wrap: nowrap; }
  .app-header-center { gap: 0.3rem; min-width: 0; flex: 1 1 auto; }
  .app-header .version { display: none; }
  .user-name { display: none; }
  .user-chip { padding: 0.2rem 0.35rem 0.2rem 0.3rem; }
  .sip-status-label { display: none; }
  .sip-status-pill { padding: 0.3rem 0.5rem; }
}`,
  },
  {
    label: 'UX-043: .incoming-banner max-width to prevent overflow on small screens',
    find: `.incoming-banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #111827;
  color: #fff;
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  z-index: 1000;
  min-width: 280px;
  animation: incoming-slide-down 200ms ease-out;
}`,
    replace: `.incoming-banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #111827;
  color: #fff;
  border-radius: 14px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  z-index: 1000;
  min-width: 280px;
  /* v0.10.146 - UX-043 - prevent overflow on very narrow viewports
     (e.g. 480px Electron window) where 280px min-width + flex children
     could exceed screen width and clip the Accept button off the right. */
  max-width: calc(100vw - 24px);
  animation: incoming-slide-down 200ms ease-out;
}`,
  },
]);

// Version bumps to 0.10.146
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'apps/socket/package.json', 'apps/webhooks/package.json', 'packages/db/package.json'];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.145"/, '"version": "0.10.146"');
  if (c !== before) { writeFileSync(fp, c, 'utf8'); console.log(`  ✓ ${rp}: bumped 0.10.145 → 0.10.146`); }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  { label: 'bump APP_VERSION', find: `const APP_VERSION = '0.10.145';`, replace: `const APP_VERSION = '0.10.146';` },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.146 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.145',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.146',\n    date: 'June 12, 2026',\n    highlight: 'UX P2 polish batch 3 — narrow-viewport fixes',\n    changes: [\n      { type: 'fixed', text: 'Mobile/narrow viewport (≤540px) app header now actually applies its layout overrides. The previous media-query rule used grid-template-columns but the header is a flexbox, so the rule was a no-op. Rewritten to use flex-friendly properties that work.' },\n      { type: 'fixed', text: 'Incoming-call banner (the small non-fullscreen variant) no longer overflows beyond very narrow viewports. Adds a max-width: calc(100vw - 24px) cap so the Accept/Decline buttons stay on-screen even at ~480px window widths.' },\n    ],\n  },\n  {\n    version: '0.10.145',`,
  },
]);

console.log('\n[apply-v146] ALL EDITS APPLIED SUCCESSFULLY');
