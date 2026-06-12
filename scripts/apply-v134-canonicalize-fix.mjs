#!/usr/bin/env node
// v0.10.134 - Fix canonicalInboundToNumber for the shared-connection-ID case.
//
// WHAT V0.10.133 GOT WRONG:
//   For TeXML voicemail trial users, payload.connection_id equals the shared
//   TELNYX_VOICEMAIL_CC_APP_ID. resolveUserAndDid's Pass 0 explicitly skips
//   the UserDid lookup in that case (Edge Case A) to avoid mis-attributing
//   to the first migrated user. Passes 1/2 then attribute via sipUsername
//   match - but they only set userId, NOT userDidId. So when call.initiated
//   ran canonicalInboundToNumber(userDidId=null), the helper had no UserDid
//   to look up and returned the raw sipUsername. Result: no fix in practice.
//
// THIS FIX:
//   Extend canonicalInboundToNumber to take userId as well. When userDidId
//   is null, fall back to looking up the user's UserDid via userId
//   (preferring activeUserDidId, else first UserDid by id).
//
//   This makes Pass-1/Pass-2 (sipUsername-only) attribution produce
//   canonical toNumbers, same as Pass 0 (connection_id) does today.
//
// CALL SITES UPDATED:
//   - call.initiated upsert path
//   - call.hangup race-fallback create path (already had a local
//     lookup; harmonize it to use the helper)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v134] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v134] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v134] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v134] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. Extend canonicalInboundToNumber to accept userId fallback
// ===========================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'expand canonicalInboundToNumber to accept userId fallback',
    find: `/**
 * v0.10.133 - Pick the canonical toNumber for an inbound Call row.
 *
 * Background: for TeXML voicemail trial users, Telnyx fires call.*
 * webhook events ONLY for the SIP-delivery leg. The payload's toNumber
 * on that leg is the SIP credential username (e.g. "userabdulla74993")
 * not the dialed phone number. Storing that as toNumber breaks the
 * Recents query filter (which excludes any toNumber matching a known
 * sipUsername to hide duplicate infrastructure rows).
 *
 * Strategy: if attribution found a UserDid (via connection_id - Pass 0),
 * use UserDid.didNumber as the canonical toNumber. Otherwise, fall back
 * to whatever the webhook said (which for normal PSTN-leg events IS
 * already the phone number).
 *
 * Only applies to direction=inbound. Outbound toNumber is the dialed
 * external party and never needs override.
 */
async function canonicalInboundToNumber(opts: {
  direction: 'inbound' | 'outbound';
  rawToNumber: string;
  userDidId: number | null;
}): Promise<string> {
  if (opts.direction !== 'inbound') return opts.rawToNumber;
  // If rawToNumber already looks like a phone number (+ or all digits),
  // accept it - that's a PSTN-leg event with the dialed number.
  const trimmed = opts.rawToNumber.trim();
  if (trimmed.startsWith('+') || /^\\d{7,}$/.test(trimmed)) {
    return opts.rawToNumber;
  }
  // Otherwise it's a SIP credential username or similar non-phone string.
  // Look up the matched UserDid's didNumber and use that.
  const didNumber = await lookupUserDidNumber(opts.userDidId);
  return didNumber ?? opts.rawToNumber;
}`,
    replace: `/**
 * v0.10.133/v0.10.134 - Pick the canonical toNumber for an inbound Call row.
 *
 * Background: for TeXML voicemail trial users, Telnyx fires call.*
 * webhook events ONLY for the SIP-delivery leg. The payload's toNumber
 * on that leg is the SIP credential username (e.g. "userabdulla74993")
 * not the dialed phone number. Storing that as toNumber breaks the
 * Recents query filter (which excludes any toNumber matching a known
 * sipUsername to hide duplicate infrastructure rows).
 *
 * Strategy:
 *   1. If rawToNumber already looks like a phone number, accept it.
 *   2. Else if userDidId is set (Pass 0 connection_id matched), use
 *      that UserDid.didNumber.
 *   3. Else if userId is set (Pass 1/2 sipUsername matched - typical
 *      for TeXML trial users because their connection_id is the shared
 *      TELNYX_VOICEMAIL_CC_APP_ID, causing Pass 0 to skip - see Edge
 *      Case A in resolveUserAndDid), look up the user's UserDids and
 *      pick the activeUserDidId (or first by id) and use its didNumber.
 *   4. Else return the rawToNumber unchanged.
 *
 * Only applies to direction=inbound. Outbound toNumber is the dialed
 * external party and never needs override.
 */
async function canonicalInboundToNumber(opts: {
  direction: 'inbound' | 'outbound';
  rawToNumber: string;
  userDidId: number | null;
  userId?: number | null;
}): Promise<string> {
  if (opts.direction !== 'inbound') return opts.rawToNumber;
  // If rawToNumber already looks like a phone number (+ or all digits),
  // accept it - that's a PSTN-leg event with the dialed number.
  const trimmed = opts.rawToNumber.trim();
  if (trimmed.startsWith('+') || /^\\d{7,}$/.test(trimmed)) {
    return opts.rawToNumber;
  }
  // Otherwise it's a SIP credential username or similar non-phone string.
  // Path A: matched UserDid via Pass 0 (connection_id) - has didNumber directly.
  const didNumberA = await lookupUserDidNumber(opts.userDidId);
  if (didNumberA) return didNumberA;
  // Path B (v0.10.134): Pass 1/2 attribution by sipUsername only sets
  // userId; UserDid wasn't pinpointed. Look up the user's primary
  // UserDid (activeUserDidId if set, else first by id) and use its
  // didNumber. This is the path that fires for TeXML trial users
  // because their connection_id is the shared CC App ID.
  if (opts.userId) {
    const u = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: {
        activeUserDidId: true,
        userDids: {
          take: 1,
          orderBy: { id: 'asc' },
          select: { didNumber: true },
        },
      },
    });
    if (u?.activeUserDidId) {
      const activeDid = await prisma.userDid.findUnique({
        where: { id: u.activeUserDidId },
        select: { didNumber: true },
      });
      if (activeDid?.didNumber) return activeDid.didNumber;
    }
    if (u?.userDids?.[0]?.didNumber) return u.userDids[0].didNumber;
  }
  return opts.rawToNumber;
}`,
  },
  {
    label: 'pass userId at call.initiated invocation site',
    find: `        const canonicalToNumber = await canonicalInboundToNumber({
          direction,
          rawToNumber: toNumber,
          userDidId,
        });`,
    replace: `        const canonicalToNumber = await canonicalInboundToNumber({
          direction,
          rawToNumber: toNumber,
          userDidId,
          userId: ownerUserId,
        });`,
  },
  {
    label: 'simplify call.hangup race-fallback path to use helper with userId',
    find: `            // v0.10.133 - normalize toNumber via the connection-id-matched
            // UserDid before insertion. resolveUserId only returns the
            // userId (no userDidId), so we have to do an extra lookup here
            // to canonicalize. Acceptable because this branch is the rare
            // race-fallback path; most calls go through the call.initiated
            // upsert above.
            const hangupCreateCanonicalToNumber = await (async () => {
              if (direction !== 'inbound') return toNumber;
              const trimmed = (toNumber ?? '').trim();
              if (trimmed.startsWith('+') || /^\\d{7,}$/.test(trimmed)) return toNumber;
              const did = await prisma.userDid.findFirst({
                where: { userId: ownerUserId },
                orderBy: { id: 'asc' },
                select: { didNumber: true },
              });
              return did?.didNumber ?? toNumber;
            })();`,
    replace: `            // v0.10.134 - reuse the central canonicalInboundToNumber helper.
            // The helper handles the case where userDidId is null (which it
            // always is in this path because resolveUserId only returns
            // userId) by looking up the user's primary UserDid via userId.
            const hangupCreateCanonicalToNumber = await canonicalInboundToNumber({
              direction,
              rawToNumber: toNumber,
              userDidId: null,
              userId: ownerUserId,
            });`,
  },
]);

// ===========================================================
// 2. Version bumps to 0.10.134
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
  c = c.replace(/"version":\s*"0\.10\.133"/, '"version": "0.10.134"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.133 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.133 → 0.10.134`);
  }
}

// ===========================================================
// 3. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.134',
    find: `const APP_VERSION = '0.10.133';`,
    replace: `const APP_VERSION = '0.10.134';`,
  },
]);

// ===========================================================
// 4. whatsNew.ts v0.10.134 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.134 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.133',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.134',\n    date: 'June 12, 2026',\n    highlight: 'Completes the v0.10.133 missing-Recents fix - works for TeXML trial users too',\n    changes: [\n      { type: 'fixed', text: 'v0.10.133 introduced canonicalInboundToNumber but it only worked when attribution had matched a specific UserDid via connection_id. For TeXML voicemail trial users, the webhook payload connection_id is the shared TELNYX_VOICEMAIL_CC_APP_ID (the same Voice API App is shared across all migrated trial users), so the UserDid lookup is intentionally skipped to avoid wrong attribution. Attribution then succeeds via sipUsername (Pass 1 or 2) but only sets userId, not userDidId. Without a userDidId, v0.10.133s canonicalization silently fell back to the raw SIP credential username - same outcome as before the fix. This release teaches canonicalInboundToNumber to ALSO accept the resolved userId and look up the users primary UserDid (activeUserDidId, else first by id) for the didNumber. Now any inbound Call row whose toNumber is a SIP username gets rewritten to the dialed phone number, regardless of which attribution pass matched.' },\n      { type: 'fixed', text: 'Server-only. No client changes. Once Render redeploys ace-dialer-webhooks, future TeXML trial calls land with correct toNumber. The v0.10.133 backfill script (rewritten with a userDidId IS NOT NULL guard to avoid touching legacy pre-v0.10.108 mis-attribution rows) can be run separately to repair historical rows.' },\n    ],\n  },\n  {\n    version: '0.10.133',`,
  },
]);

console.log('\n[apply-v134] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit -m "v0.10.134: canonicalInboundToNumber userId fallback (shared CC App ID case)"');
console.log('  6. git push');
console.log('  7. Wait for Render to redeploy ace-dialer-webhooks');
console.log('  8. Test: make a call, answer it, check Recents');
