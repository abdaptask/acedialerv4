#!/usr/bin/env node
// v0.10.143 - QA-003: Gate the code-signing override behind an env var,
// document the EV cert procurement plan, start the 2-week clock.
//
// CONTEXT: apps/desktop/src/main.ts line 932 makes verifyUpdateCodeSignature
// a no-op (returns null), so electron-updater skips signature verification
// on ALL Windows auto-updates. This was added because the EXE isn't signed
// and the publisher-name check failed otherwise. The trade-off is real
// supply-chain risk: an attacker who controls our GitHub Releases could
// push a malicious .exe and every dialer would auto-install it.
//
// CHANGES:
//   1. apps/desktop/src/main.ts - gate the no-op behind an env var
//      ACE_BYPASS_CODE_SIGNING. If the env var is set to the magic value
//      'allowed-during-procurement', the override stays active. Otherwise
//      the override is REMOVED and electron-updater enforces signature
//      verification (which will fail until we ship an EV-signed binary
//      - that's the intent, fail-closed).
//
//   2. NEW FILE docs/ev-cert-procurement.md - step-by-step procurement
//      plan, vendor comparison, GitHub Actions secret setup, smoke-test
//      checklist. Aimed at whoever does the cert purchase.
//
//   3. Standard version bumps + whatsNew entry.
//
// CURRENT POSTURE: ACE_BYPASS_CODE_SIGNING is NOT set in the production
// build (no electron-builder env-inject). So the override is now inactive
// in shipped binaries - electron-updater will refuse to install ANY new
// version until either (a) we ship an EV-signed exe, or (b) you explicitly
// set ACE_BYPASS_CODE_SIGNING in the installer environment.
//
// IMPORTANT WORKFLOW:
//   - During the 2-week procurement window, users on v0.10.143+ CANNOT
//     auto-update. They must download installers from GitHub Releases
//     manually. THIS IS INTENTIONAL - it eliminates the supply-chain
//     risk during the gap.
//   - Once the EV cert is in hand, ship a v0.10.144+ that signs the
//     binary AND removes this override stub entirely. Users back on
//     auto-update path.
//
// IF YOU NEED TO TEMPORARILY KEEP AUTO-UPDATE WORKING DURING PROCUREMENT
//   (e.g. to push a critical security fix BEFORE the cert lands):
//   Add this to apps/desktop/electron-builder env in the build pipeline:
//     "extraMetadata": { "env": { "ACE_BYPASS_CODE_SIGNING": "allowed-during-procurement" } }
//   But document explicitly in the release notes why it was needed -
//   ideally only your own machine, not the 40-user rollout.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v143] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v143] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v143] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v143] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeNewFile(relPath, content) {
  const fp = join(ROOT, relPath);
  if (existsSync(fp)) {
    console.error(`[apply-v143] FATAL: ${fp} already exists. Aborting to avoid overwrite.`);
    process.exit(1);
  }
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, content, 'utf8');
  console.log(`  ✓ NEW ${relPath} (${content.length} bytes)`);
}

// ===========================================================
// 1. apps/desktop/src/main.ts - gate the override behind an env var
// ===========================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'QA-003: gate code-signing override behind ACE_BYPASS_CODE_SIGNING env var',
    find: `  // electron-updater refuses to install ANY update on Windows since
  // package.json declares publisherName: "ApTask" but our GitHub Actions
  // workflow doesn't actually sign the EXE — so the publisher-name match
  // check fails and the user sees "Update failed: not signed by the
  // application owner". MITM risk is low since downloads come from GitHub
  // Releases over HTTPS; remove this override once we wire the EV cert in.
  if (process.platform === 'win32') {
    // The property is undocumented but recognised by NsisUpdater; making
    // it a no-op resolver tells electron-updater to skip the signature
    // verification step entirely.
    (autoUpdater as unknown as {
      verifyUpdateCodeSignature?: (publisherNames: string[], file: string) => Promise<string | null>;
    }).verifyUpdateCodeSignature = async () => null;
  }`,
    replace: `  // v0.10.143 - QA-003 - gate the code-signing override behind an
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
  },
]);

// ===========================================================
// 2. NEW FILE: docs/ev-cert-procurement.md
// ===========================================================
writeNewFile('docs/ev-cert-procurement.md', `# EV Code-Signing Certificate Procurement Plan

**Status:** In progress as of v0.10.143 (2026-06-12)
**Owner:** Abdulla Sheikh (abdulla@aptask.com)
**Why:** QA-003 from QA_AUDIT.md — auto-updater currently has signature
verification disabled because we don't have an EV cert. v0.10.143 gates
the override behind an env var; production builds now ENFORCE signature
verification, which will fail until the cert lands and the build pipeline
signs the .exe.

## Timeline

| Phase | Effort | Owner |
|---|---|---|
| Vendor selection + purchase | 1-2 hours | Abdulla |
| Identity verification (DUNS, etc.) | 3-5 business days | Vendor + Abdulla |
| Hardware token shipment | 2-3 business days | Vendor → Abdulla |
| Token receipt + activation | 1 hour | Abdulla |
| GitHub Actions secret setup | 30 min | Abdulla |
| Build pipeline update | 30 min | Claude/Abdulla |
| First signed release | 1 release cycle | n/a |
| **Total:** | **~2 weeks** | |

## Vendor comparison

Pick one. Both ship physical USB tokens for EV cert key storage.

### Sectigo EV Code Signing
- **Price:** ~$329/yr (3-yr) or ~$429/yr (1-yr) — varies by reseller
- **Recommended reseller:** SSL.com or Comodo direct
- **Token:** SafeNet eToken 5110 (USB, ships in 1-3 business days)
- **Identity verification:** Phone + DUNS number + business documents
- **Caveat:** Sectigo's resellers sometimes have 2-3 day delays on
  identity verification compared to direct purchase

### DigiCert EV Code Signing
- **Price:** ~$499/yr — higher but with better support
- **Token:** SafeNet eToken 5110 (USB, same hardware as Sectigo)
- **Identity verification:** Often faster (DigiCert has a streamlined
  business-verification process). 1-3 days typical.
- **Caveat:** More expensive; brand recognition with antivirus vendors
  is similar to Sectigo

**Recommendation:** Sectigo via SSL.com for cost; DigiCert if you need
faster turnaround and don't mind paying ~$170 more/yr.

## Purchase checklist

Before you click "buy":

- [ ] Confirm ApTask business name + DUNS number on file with vendor
- [ ] Identify a business email address for the certificate (not personal)
- [ ] Pick a delivery address that someone can sign for (the token ships
      via FedEx/UPS — needs physical receipt)
- [ ] Have a credit card or PO process ready
- [ ] Decide on cert validity period: 1 year ($), 3 years ($$).
      3-year is usually cheaper per year and reduces re-procurement
      overhead.

## After the token arrives

### Step 1: Activate the token
1. Install SafeNet Authentication Client (SAC) on your Windows machine.
2. Plug in the token.
3. Set the token password (KEEP THIS SAFE - if lost, you must re-purchase
   the cert. There is NO recovery.)
4. Verify SAC sees the certificate.

### Step 2: Export the public key for GitHub Actions signing
Note: the PRIVATE key stays on the hardware token forever and never
leaves it. We can't put the cert in GitHub secrets directly.

Instead, we use a self-hosted GitHub Actions runner with the token plugged
in. Or use a service like ssl.com's eSigner cloud-signing service to sign
remotely.

**Option A — Self-hosted runner (free but ops overhead):**
1. Set up a dedicated Windows VM or physical box with the token attached.
2. Register it as a self-hosted GitHub Actions runner.
3. Update .github/workflows/build-desktop.yml to target this runner for
   the signing step.

**Option B — Cloud-signing (recommended, ~$10/mo extra):**
1. Sign up for ssl.com eSigner (works with Sectigo certs) or
   DigiCert KeyLocker.
2. Their dashboard generates an HSM-backed credentials triple
   (\`SSLCOM_USERNAME\`, \`SSLCOM_PASSWORD\`, \`SSLCOM_CREDENTIAL_ID\`)
   that we put into GitHub Actions secrets.
3. electron-builder calls their cloud signing CLI in the build step.

### Step 3: Update electron-builder config
In \`apps/desktop/electron-builder.json\` (or \`package.json\` build block),
add:

\`\`\`json
{
  "win": {
    "publisherName": "ApTask",
    "signingHashAlgorithms": ["sha256"],
    "signtoolOptions": {
      "sign": "./scripts/sign-cli.js"
    }
  }
}
\`\`\`

And create \`apps/desktop/scripts/sign-cli.js\` that invokes the cloud
signing tool (or local SAC) with the file path electron-builder hands it.

### Step 4: GitHub Actions secrets
Repo Settings → Secrets and variables → Actions → add:
- \`SSLCOM_USERNAME\`
- \`SSLCOM_PASSWORD\`
- \`SSLCOM_CREDENTIAL_ID\`
(or the DigiCert KeyLocker equivalent)

### Step 5: Update .github/workflows/build-desktop.yml
Add the signing tools install step before \`npm run dist\`:

\`\`\`yaml
- name: Install eSigner CKA
  run: |
    Invoke-WebRequest -Uri https://www.ssl.com/download/ssl-com-esigner-cka/ -OutFile esigner.zip
    Expand-Archive esigner.zip -DestinationPath C:\\esigner
\`\`\`

Then pass the credentials into the electron-builder build via env vars.

### Step 6: Remove the override stub
Once the build pipeline signs binaries successfully, remove this entire
block from \`apps/desktop/src/main.ts\` (the v0.10.143 gate). The
override is no longer needed - signature verification will succeed
naturally because the binary IS signed.

## Smoke test before promoting to all users

1. Build a signed binary via the new pipeline.
2. Install on YOUR machine (not via auto-update - manual download).
3. Verify Windows shows "Verified publisher: ApTask" in the install prompt
   (not "Unknown publisher").
4. Bump the version one more time and push to trigger auto-update.
5. On your installed dialer, force update via Settings → Check for updates.
6. Verify the update installs cleanly (no "publisher mismatch" error).
7. Only THEN remove the override stub + ship to all 40 users.

## Interim user impact (during procurement window)

**Users on v0.10.143+ cannot auto-update.** They must download new
installers from GitHub Releases manually. If you ship critical fixes
during the procurement window, communicate via email:

> "An updated dialer is available. Please download from [release URL]
> and install manually. Auto-update will resume in approximately 2 weeks
> when our signing certificate is activated."

If a user reports "auto-update failing", that is EXPECTED. Tell them the
manual-install path.

## Why this matters

Supply-chain attacks on GitHub Releases are real (see ESLint, Codecov,
PyPI typosquatting cases). An attacker who phishes a maintainer or
exploits a token leak could push a malicious .exe. With auto-update
running and signature verification disabled, every dialer on every
user's laptop would silently install the malicious binary on next poll.

With an EV cert in place, the attacker would also need the hardware
token + token password to sign their binary - a much higher bar that's
mathematically infeasible to bypass.

## Out-of-scope for this document

- Microsoft Defender SmartScreen reputation (separate issue; EV certs
  bootstrap reputation faster but it still takes 1-2 weeks of installs
  before SmartScreen stops warning users)
- macOS notarization (separate process; if we ever ship a Mac build,
  needs Apple Developer ID + altool/notarytool flow)
- Cross-platform signing (consider keychain-based credentials if scope
  expands)
`);

// ===========================================================
// Version bumps to 0.10.143
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
  c = c.replace(/"version":\s*"0\.10\.142"/, '"version": "0.10.143"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.142 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.142 → 0.10.143`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.143',
    find: `const APP_VERSION = '0.10.142';`,
    replace: `const APP_VERSION = '0.10.143';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.143 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.142',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.143',\n    date: 'June 12, 2026',\n    highlight: 'Auto-update security hardening — signature verification now enforced during EV cert procurement window',\n    changes: [\n      { type: 'fixed', text: 'Auto-update signature verification is now enforced by default. Previously the dialer had an override that disabled Windows publisher-name verification (added because our installer isnt EV-signed yet). That override left a supply-chain attack vector: anyone with access to GitHub Releases could push a malicious binary that every dialer would auto-install. The override is now gated behind an explicit ACE_BYPASS_CODE_SIGNING env var (not set in production builds), so updates will fail until we ship a properly signed binary. Procurement of an EV code-signing certificate is in progress; see docs/ev-cert-procurement.md for the timeline.' },\n      { type: 'fixed', text: 'During the procurement window (~2 weeks), auto-update may show "Update failed: not signed by the application owner" errors. This is EXPECTED. Until the cert lands, please download new installers from GitHub Releases manually. Auto-update will resume once v0.10.144+ ships with EV signing wired in.' },\n    ],\n  },\n  {\n    version: '0.10.142',`,
  },
]);

console.log('\n[apply-v143] ALL EDITS APPLIED SUCCESSFULLY');
console.log('');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs (if available)');
console.log('  2. npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  3. git diff --stat (should show ~10 files modified + 1 new doc file)');
console.log('  4. git add -A && git commit && git push');
console.log('');
console.log('IMPORTANT POST-DEPLOY:');
console.log('  - Users on v0.10.143+ will see "Update failed: not signed by ApTask"');
console.log('    when their dialer attempts to auto-update. THIS IS INTENTIONAL.');
console.log('  - During the procurement window (~2 weeks), distribute new releases');
console.log('    via manual download links until the EV cert + signing are live.');
console.log('  - Read docs/ev-cert-procurement.md for the full procurement plan.');
console.log('  - The first step (vendor selection + purchase) should happen TOMORROW');
console.log('    to start the 2-week clock.');
