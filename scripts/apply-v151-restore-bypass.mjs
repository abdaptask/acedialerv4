#!/usr/bin/env node
// v0.10.151 - Restore unconditional auto-update bypass.
//
// User explicitly chose to defer EV cert procurement and restore
// auto-update functionality immediately. The v0.10.143 gate (which
// required ACE_BYPASS_CODE_SIGNING env var to be set) is being
// removed; the verifyUpdateCodeSignature override goes back to being
// unconditional on Windows.
//
// TRADE-OFF (re-introduced from v0.10.143's closure):
//   If our GitHub repo were compromised, an attacker could push a
//   malicious .exe and every user's dialer would auto-install it on
//   next update poll. We accept this risk because:
//     - 40 internal users at ApTask, no public distribution
//     - Repo access is owner-only
//     - The alternative (manual file distribution) is operationally
//       worse for the user
//
// To re-close this hole later: procure an OV or EV code-signing cert
// (see docs/ev-cert-procurement.md), wire it into the GitHub Actions
// build pipeline, then re-add the gate.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v151] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v151] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v151] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200 chars): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v151] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. apps/desktop/src/main.ts - restore unconditional bypass
// ---------------------------------------------------------------------
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'replace v0.10.143 gate with unconditional bypass',
    find: `  // v0.9.4 — TEMPORARY: bypass Windows code-signing verification because
  // we don't have an EV cert yet (see task #194 / #233). Without this,
  // v0.10.143 - QA-003 - gate the code-signing override behind an
  // explicit env var so we stop silently shipping with verification off.
  //
  // BACKGROUND: electron-updater refuses to install ANY update on Windows
  // when package.json declares publisherName: "ApTask" but the EXE isn't
  // actually signed. The publisher-name check fails and the user sees
  // "Update failed: not signed by the application owner". The historical
  // workaround was to make verifyUpdateCodeSignature a no-op resolver.
  //
  // The trade-off was real supply-chain risk: an attacker controlling
  // GitHub Releases could push a malicious .exe and every dialer auto-
  // installs it. With the v0.10.143 gate active, the override is
  // DISABLED by default. Auto-update will fail until we ship an
  // EV-signed binary OR the user sets ACE_BYPASS_CODE_SIGNING to the
  // magic value below.
  //
  // See docs/ev-cert-procurement.md for the procurement plan + how to
  // wire the signature into the GitHub Actions build pipeline.
  if (process.platform === 'win32') {
    if (process.env.ACE_BYPASS_CODE_SIGNING === 'allowed-during-procurement') {
      console.warn(
        '[auto-update] WARNING: code-signing verification override ACTIVE via ' +
          'ACE_BYPASS_CODE_SIGNING env var. This bypasses Windows publisher-name ' +
          'verification - supply-chain risk if attacker controls GitHub Releases.',
      );
      (autoUpdater as unknown as {
        verifyUpdateCodeSignature?: (publisherNames: string[], file: string) => Promise<string | null>;
      }).verifyUpdateCodeSignature = async () => null;
    } else {
      console.log(
        '[auto-update] code-signing verification ENFORCED (default). Auto-update ' +
          "will fail until the binary is EV-signed. See docs/ev-cert-procurement.md.",
      );
    }
  }`,
    replace: `  // v0.10.151 - Unconditional Windows code-signing bypass restored.
  //
  // electron-updater refuses to install any update on Windows when
  // package.json declares publisherName: "ApTask" but the .exe is not
  // actually signed. We do not currently have a code-signing cert (OV
  // or EV), so we override verifyUpdateCodeSignature to a no-op
  // resolver. This lets auto-update keep working for the 40 internal
  // ApTask users.
  //
  // TRADE-OFF: if our GitHub repo were compromised, an attacker could
  // push a malicious .exe and every dialer would auto-install it on
  // next update poll. Bounded by: internal-only distribution, repo
  // access is owner-only. Revisit when shipping outside ApTask or when
  // user count grows materially.
  //
  // v0.10.143 added a gate (ACE_BYPASS_CODE_SIGNING env var) to close
  // this hole pending cert procurement. v0.10.151 reverts that gate
  // because cert procurement is deferred and users were stuck unable
  // to auto-update.
  //
  // To re-close this hole later: procure an OV or EV cert (see
  // docs/ev-cert-procurement.md), wire signing into
  // .github/workflows/build-desktop.yml, then re-add the gate.
  if (process.platform === 'win32') {
    console.log(
      '[auto-update] Windows code-signing verification BYPASSED (no cert yet). ' +
        'See v0.10.151 comment for trade-off context.',
    );
    (autoUpdater as unknown as {
      verifyUpdateCodeSignature?: (publisherNames: string[], file: string) => Promise<string | null>;
    }).verifyUpdateCodeSignature = async () => null;
  }`,
  },
]);

// ---------------------------------------------------------------------
// 2. Version bumps to 0.10.151 across all package.json files
// ---------------------------------------------------------------------
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
  if (!existsSync(fp)) {
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.150"/, '"version": "0.10.151"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.150 -> 0.10.151`);
  } else {
    console.log(`  - ${rp}: no 0.10.150 found (already bumped or different)`);
  }
}

// ---------------------------------------------------------------------
// 3. DiagnosticsSection.tsx - bump APP_VERSION
// ---------------------------------------------------------------------
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION constant',
    find: `const APP_VERSION = '0.10.150';`,
    replace: `const APP_VERSION = '0.10.151';`,
  },
]);

// ---------------------------------------------------------------------
// 4. whatsNew.ts - add v0.10.151 entry at the top
// ---------------------------------------------------------------------
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.151 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.150',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.151',
    date: 'June 15, 2026',
    highlight: 'Auto-update restored. You no longer need to manually install update files.',
    changes: [
      { type: 'fixed', text: 'Auto-update was blocked on Windows because the dialer was waiting for a code-signing certificate that has not been procured yet. The dialer now installs updates directly from GitHub, the same way it did before. You will get future versions automatically without any action.' },
    ],
  },
  {
    version: '0.10.150',`,
  },
]);

console.log('\n[apply-v151] DONE');
console.log('');
console.log('NEXT STEPS (run in repo root):');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.151: restore unconditional auto-update bypass (defer EV cert)"');
console.log('  git tag v0.10.151');
console.log('  git push origin main');
console.log('  git push origin v0.10.151');
console.log('');
console.log('Watch GitHub Actions - build-desktop.yml should trigger on the tag push,');
console.log('build the .exe + .dmg, and publish to GitHub Releases. Once published,');
console.log('users on v0.10.132 should auto-update on their next poll (within ~1 hour).');
