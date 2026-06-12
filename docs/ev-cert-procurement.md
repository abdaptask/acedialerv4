# EV Code-Signing Certificate Procurement Plan

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
   (`SSLCOM_USERNAME`, `SSLCOM_PASSWORD`, `SSLCOM_CREDENTIAL_ID`)
   that we put into GitHub Actions secrets.
3. electron-builder calls their cloud signing CLI in the build step.

### Step 3: Update electron-builder config
In `apps/desktop/electron-builder.json` (or `package.json` build block),
add:

```json
{
  "win": {
    "publisherName": "ApTask",
    "signingHashAlgorithms": ["sha256"],
    "signtoolOptions": {
      "sign": "./scripts/sign-cli.js"
    }
  }
}
```

And create `apps/desktop/scripts/sign-cli.js` that invokes the cloud
signing tool (or local SAC) with the file path electron-builder hands it.

### Step 4: GitHub Actions secrets
Repo Settings → Secrets and variables → Actions → add:
- `SSLCOM_USERNAME`
- `SSLCOM_PASSWORD`
- `SSLCOM_CREDENTIAL_ID`
(or the DigiCert KeyLocker equivalent)

### Step 5: Update .github/workflows/build-desktop.yml
Add the signing tools install step before `npm run dist`:

```yaml
- name: Install eSigner CKA
  run: |
    Invoke-WebRequest -Uri https://www.ssl.com/download/ssl-com-esigner-cka/ -OutFile esigner.zip
    Expand-Archive esigner.zip -DestinationPath C:\esigner
```

Then pass the credentials into the electron-builder build via env vars.

### Step 6: Remove the override stub
Once the build pipeline signs binaries successfully, remove this entire
block from `apps/desktop/src/main.ts` (the v0.10.143 gate). The
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
