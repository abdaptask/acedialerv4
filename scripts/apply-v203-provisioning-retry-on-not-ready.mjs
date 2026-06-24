#!/usr/bin/env node
// v0.10.203 - Retry the three sub-resource PATCHes during new-user
// provisioning when Telnyx returns "Resource not found" (error
// 10003 / 10005) because the DID was just purchased and its
// sub-resources haven't propagated through Telnyx's provisioning
// workflow yet.
//
// THE BUG
//   On shivas's 2026-06-24 provisioning, the new-user flow hit:
//     ✓ purchase DID +17325176448
//     ✗ bind DID to ACE messaging profile  — error 10005 "Resource not found"
//     ✗ apply ACE DID defaults — voice=undefined, voicemail error 10003
//   The findNumberByE164 lookup that comes BEFORE these PATCHes
//   succeeded — so the phone_number main record was queryable, but
//   the /messaging /voice /voicemail sub-resources weren't created
//   yet. Telnyx provisions them async after purchase.
//
// THE FIX
//   Wrap the three sub-resource PATCHes with retry-on-10003/10005:
//   wait 3s, retry; wait 6s, retry. Up to 3 attempts total (~9s
//   max). Any OTHER error returns immediately (don't retry on
//   permission errors, malformed bodies, etc.).
//
// FILES TOUCHED
//   apps/api/src/telnyx/applyDefaults.ts — new telnyxPatchWithRetry
//                                          helper; used by voice +
//                                          voicemail PATCHes.
//   apps/api/src/telnyx/numbers.ts       — assignNumberMessagingProfile
//                                          wraps its call() with same
//                                          retry logic.
//
// VERSION BUMP: 0.10.202 -> 0.10.203

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v203] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v203] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v203] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v203] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// applyDefaults.ts
//   Edit 1: insert telnyxPatchWithRetry helper above applyAcePhoneNumberDefaults
//   Edit 2: voice PATCH uses the retrying helper
//   Edit 3: voicemail PATCH uses the retrying helper
// =====================================================================
applyEdits('apps/api/src/telnyx/applyDefaults.ts', [
  {
    label: '1: insert telnyxPatchWithRetry helper before applyAcePhoneNumberDefaults',
    find: `export interface ApplyPhoneNumberDefaultsResult {
  voice: PatchResult;
  voicemail: PatchResult;
}

export async function applyAcePhoneNumberDefaults(`,
    replace: `export interface ApplyPhoneNumberDefaultsResult {
  voice: PatchResult;
  voicemail: PatchResult;
}

/**
 * v0.10.203 — telnyxPatch + retry-on-not-ready.
 *
 * Telnyx errors 10003 / 10005 ("Resource not found") fire when we PATCH
 * a sub-resource on a phone_number whose async provisioning hasn't
 * completed yet (typical right after a fresh DID purchase). The
 * phone_number main record is queryable instantly, but /messaging,
 * /voice, /voicemail sub-resources are created by a background worker
 * over ~1-10 seconds.
 *
 * This helper retries the PATCH up to 3 times with a 3s/6s backoff
 * (~9s total wall time max) if AND ONLY IF the error body contains
 * code 10003 or 10005. Any other error (auth, malformed body, etc.)
 * returns immediately so we don't waste time retrying real bugs.
 */
async function telnyxPatchWithRetry(
  path: string,
  body: Record<string, unknown>,
): Promise<PatchResult> {
  const delaysMs = [0, 3000, 6000];
  let last: PatchResult = { ok: false, status: 0 };
  for (const delay of delaysMs) {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    last = await telnyxPatch(path, body);
    if (last.ok) return last;
    // detail is the raw response text from telnyxPatch — substring-match
    // on the Telnyx error code, since the body is JSON-ish text.
    const detailStr =
      typeof last.detail === 'string'
        ? last.detail
        : JSON.stringify(last.detail ?? '');
    const isNotReady =
      /\\"code\\"\\s*:\\s*\\"100(03|05)\\"/.test(detailStr) ||
      detailStr.includes('"code":"10003"') ||
      detailStr.includes('"code":"10005"');
    if (!isNotReady) return last;
    // Log so the operator can see retry behavior in API logs.
    // eslint-disable-next-line no-console
    console.warn(
      \`[telnyx] \${path} -> 10003/10005 (sub-resource not ready), retrying after \${delay + 3000}ms\`,
    );
  }
  return last;
}

export async function applyAcePhoneNumberDefaults(`,
  },
  {
    label: '2: voice PATCH uses telnyxPatchWithRetry',
    find: `  // Voice (HD voice + CNAM listing) — single PATCH on the /voice sub-resource.
  const voice = await telnyxPatch(\`/phone_numbers/\${numberId}/voice\`, {`,
    replace: `  // Voice (HD voice + CNAM listing) — single PATCH on the /voice sub-resource.
  // v0.10.203 — retrying variant; tolerates the post-purchase race.
  const voice = await telnyxPatchWithRetry(\`/phone_numbers/\${numberId}/voice\`, {`,
  },
  {
    label: '3: voicemail PATCH uses telnyxPatchWithRetry',
    find: `  // Voicemail — separate sub-resource.
  const voicemail = await telnyxPatch(\`/phone_numbers/\${numberId}/voicemail\`, {`,
    replace: `  // Voicemail — separate sub-resource.
  // v0.10.203 — retrying variant; tolerates the post-purchase race.
  const voicemail = await telnyxPatchWithRetry(\`/phone_numbers/\${numberId}/voicemail\`, {`,
  },
]);

// =====================================================================
// numbers.ts
//   Edit 4: assignNumberMessagingProfile wraps call() with retry logic
// =====================================================================
applyEdits('apps/api/src/telnyx/numbers.ts', [
  {
    label: '4: assignNumberMessagingProfile retries on 10003/10005',
    find: `export function assignNumberMessagingProfile(
  numberId: string,
  messagingProfileId: string,
): Promise<TelnyxResult<SingleResponse<PhoneNumber>>> {
  return call(\`/phone_numbers/\${numberId}/messaging\`, {
    method: 'PATCH',
    body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
  });
}`,
    replace: `export async function assignNumberMessagingProfile(
  numberId: string,
  messagingProfileId: string,
): Promise<TelnyxResult<SingleResponse<PhoneNumber>>> {
  // v0.10.203 — Retry on Telnyx 10003/10005 ("Resource not found")
  // which fire when /phone_numbers/:id/messaging hasn't been
  // provisioned yet on a freshly-purchased DID. Up to 3 attempts
  // with a 3s/6s backoff (~9s max). Non-not-ready errors (auth,
  // invalid body, etc.) return immediately without retry.
  const delaysMs = [0, 3000, 6000];
  let last: TelnyxResult<SingleResponse<PhoneNumber>> = {
    ok: false,
    status: 0,
  };
  for (const delay of delaysMs) {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    last = await call<SingleResponse<PhoneNumber>>(
      \`/phone_numbers/\${numberId}/messaging\`,
      {
        method: 'PATCH',
        body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
      },
    );
    if (last.ok) return last;
    const errStr = JSON.stringify(last.error ?? '');
    const isNotReady =
      errStr.includes('"code":"10003"') ||
      errStr.includes('"code":"10005"');
    if (!isNotReady) return last;
    // eslint-disable-next-line no-console
    console.warn(
      \`[telnyx] /phone_numbers/\${numberId}/messaging not ready (10003/10005), retrying after \${delay + 3000}ms\`,
    );
  }
  return last;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.202 -> 0.10.203
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
  c = c.replace(/"version":\s*"0\.10\.202"/, '"version": "0.10.203"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.202 -> 0.10.203`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v203] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.202';`,
    replace: `const APP_VERSION = '0.10.203';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.203 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.202',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.203',
    date: 'June 24, 2026',
    highlight: 'New-user provisioning is now reliable on freshly purchased DIDs.',
    changes: [
      { type: 'fixed', text: 'When admin provisions a new user, the steps that bind the DID to ACE messaging profile and apply voice/voicemail defaults sometimes failed with Telnyx "Resource not found" errors because the sub-resources had not finished propagating yet after the DID purchase. Those PATCH calls now retry automatically up to 3 times with backoff (~9s max), eliminating the race.' },
    ],
  },
  {
    version: '0.10.202',`,
  },
]);

console.log('[apply-v203] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.203: Retry sub-resource PATCHes on Telnyx 10003/10005 (post-purchase race)"');
console.log('  git tag v0.10.203');
console.log('  git push origin main');
console.log('  git push origin v0.10.203');
console.log('');
console.log('NOTE: shivas\\'s user (+17325176448) was already provisioned in the broken');
console.log('state. The retry fix only helps FUTURE new users. For shivas, you still');
console.log('need to manually bind +17325176448 to the ACE messaging profile via the');
console.log('Telnyx portal (Numbers -> +17325176448 -> Messaging) -- without that bind,');
console.log('inbound SMS to that DID will not route to the dialer.');
