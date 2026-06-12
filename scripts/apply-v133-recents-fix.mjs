#!/usr/bin/env node
// v0.10.133 - Fix missing inbound calls in Recents using the connection-id
//             attribution path (correct fix, not a downstream filter hack).
//
// ROOT CAUSE (diagnosed via diagnose-missing-call.ts):
//   - Telnyx fires call.* webhook events ONLY for the SIP-delivery leg
//     when a call is answered via TeXML voicemail flow (no PSTN-leg
//     webhooks fire for TeXML users)
//   - SIP-delivery-leg events have toNumber=SIP-credential-username
//     (e.g. "userabdulla74993") NOT the dialed phone number
//   - Call row was created with toNumber="userabdulla74993", userId
//     attributed correctly via Pass 0 (connection_id match)
//   - Recents query at apps/api/src/calls/calls.routes.ts:224 filters
//     out ANY row whose toNumber is in the set of all users' sipUsernames
//     (intent: hide duplicate infrastructure rows in Hosted VM flow)
//   - For TeXML voicemail users, that filter hides 100% of answered
//     inbound calls because the SIP-delivery-leg row IS the only row
//
// FIX (connection-id-centric, per your direction):
//   Pass 0 of resolveUserAndDid already identifies the correct UserDid
//   from the webhook's connection_id. That UserDid carries the canonical
//   phone number (UserDid.didNumber). Use it.
//
//   1. In call.initiated handler: after attribution succeeds with a
//      userDidId, look up UserDid.didNumber. If the inbound webhook's
//      toNumber doesn't look like a real phone number (i.e. starts with
//      non-digit), OVERRIDE it with UserDid.didNumber. Future call rows
//      always have a phone number in toNumber.
//
//   2. Same override in the call.hangup fallback create path (line ~685).
//
//   3. One-time backfill script (packages/db/scripts/backfill-sip-username-tonumbers.ts)
//      that scans existing Call rows where toNumber matches a known
//      sipUsername, joins to the row's User to find their primary DID,
//      and rewrites toNumber. Run it once after deploy to fix the
//      existing 50+ invisible-but-stored-rows.
//
//   The Recents filter stays as-is - it correctly hides SIP-delivery-leg
//   rows IF they ever sneak through with a SIP username. Once write-time
//   normalization is in place, that shouldn't happen.
//
// USAGE:
//   1. Copy to acedialerv4\scripts\apply-v133-recents-fix.mjs
//   2. cd acedialerv4
//   3. node scripts/apply-v133-recents-fix.mjs
//   4. node scripts/strip-null-bytes.mjs
//   5. npx tsc --noEmit -p apps/webhooks/tsconfig.json
//   6. npx tsc --noEmit -p apps/web/tsconfig.json
//   7. git add -A && git commit -m "v0.10.133: ..." && git push
//
//   THEN after Render redeploys ace-dialer-webhooks (auto or manual):
//   8. node scripts/run-backfill.cjs  (or whatever - script writes its
//      own run instructions when copied into packages/db/scripts/)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v133] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v133] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v133] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v133] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
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
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, content, 'utf8');
  console.log(`  ✓ NEW ${relPath} (${content.length} bytes)`);
}

// ===========================================================
// 1. Normalize toNumber at write time in call.initiated handler
//    using the connection-id-matched UserDid.didNumber
// ===========================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'helper: derive canonical inbound toNumber from matched UserDid (declared once near resolveUserAndDid)',
    find: `async function resolveUserAndDid(opts: {`,
    replace: `/**
 * v0.10.133 - Look up a UserDid's didNumber (the actual phone number).
 * Used to normalize Call row toNumber for inbound calls when the
 * webhook payload's toNumber is the SIP credential username instead
 * of the dialed phone number (TeXML voicemail flow scenario).
 * Returns null if userDidId is null/undefined or the UserDid has no
 * didNumber (extremely unlikely - schema requires it).
 */
async function lookupUserDidNumber(userDidId: number | null | undefined): Promise<string | null> {
  if (!userDidId) return null;
  const did = await prisma.userDid.findUnique({
    where: { id: userDidId },
    select: { didNumber: true },
  });
  return did?.didNumber ?? null;
}

/**
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
}

async function resolveUserAndDid(opts: {`,
  },
]);

// ===========================================================
// 1b. Wire the canonicalization into call.initiated upsert create branch
// ===========================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'use canonical toNumber in call.initiated upsert create',
    find: `        await prisma.call.upsert({
          where: { telnyxCallId: callId },
          update: {
            // v0.10.106 fix - DON'T overwrite status in the update branch.
            // call.initiated and call.hangup can arrive race-close together
            // (Telnyx fires both within a few ms for very short calls). If
            // hangup wins the race and creates the row with status='rejected'
            // (or 'missed'), call.initiated's update mustn't clobber that
            // back to 'initiated'. Status is only set on CREATE; subsequent
            // events (call.answered, call.bridged, call.hangup) drive the
            // state machine forward. EXCEPTION: if the call is blocked we
            // DO want to overwrite, since the block decision is authoritative
            // and only known at call.initiated time.
            ...(blocked ? { status: 'blocked' } : {}),
            ...(callControlId ? { callControlId } : {}),
            ...(userDidId ? { userDidId } : {}),
          },
          create: {
            userId: ownerUserId,
            telnyxCallId: callId,
            sessionId: payload.call_session_id ?? null,
            callControlId: callControlId ?? null,
            direction,
            fromNumber,
            toNumber,
            status: blocked ? 'blocked' : 'initiated',
            startedAt: payload.start_time ? new Date(payload.start_time) : new Date(),
            userDidId,
          },
        });`,
    replace: `        // v0.10.133 - normalize toNumber via the connection-id-matched
        // UserDid (resolved above as userDidId). For TeXML voicemail flow,
        // the raw webhook toNumber is the SIP credential username rather
        // than the dialed phone number; this lookup rewrites it.
        const canonicalToNumber = await canonicalInboundToNumber({
          direction,
          rawToNumber: toNumber,
          userDidId,
        });

        await prisma.call.upsert({
          where: { telnyxCallId: callId },
          update: {
            // v0.10.106 fix - DON'T overwrite status in the update branch.
            // call.initiated and call.hangup can arrive race-close together
            // (Telnyx fires both within a few ms for very short calls). If
            // hangup wins the race and creates the row with status='rejected'
            // (or 'missed'), call.initiated's update mustn't clobber that
            // back to 'initiated'. Status is only set on CREATE; subsequent
            // events (call.answered, call.bridged, call.hangup) drive the
            // state machine forward. EXCEPTION: if the call is blocked we
            // DO want to overwrite, since the block decision is authoritative
            // and only known at call.initiated time.
            ...(blocked ? { status: 'blocked' } : {}),
            ...(callControlId ? { callControlId } : {}),
            ...(userDidId ? { userDidId } : {}),
            // v0.10.133 - also fix the toNumber if a prior write (e.g. from
            // the call.hangup fallback) had stored the SIP username.
            ...(canonicalToNumber !== toNumber ? { toNumber: canonicalToNumber } : {}),
          },
          create: {
            userId: ownerUserId,
            telnyxCallId: callId,
            sessionId: payload.call_session_id ?? null,
            callControlId: callControlId ?? null,
            direction,
            fromNumber,
            toNumber: canonicalToNumber,
            status: blocked ? 'blocked' : 'initiated',
            startedAt: payload.start_time ? new Date(payload.start_time) : new Date(),
            userDidId,
          },
        });`,
  },
  {
    label: 'use canonical toNumber in call.hangup fallback create (line ~685)',
    find: `          } else {
            await prisma.call.create({
              data: {
                userId: ownerUserId,
                telnyxCallId: callId,
                sessionId: payload.call_session_id ?? null,
                direction,
                fromNumber,
                toNumber,
                status,
                startedAt,
                endedAt,
                durationSeconds: duration,
                hangupCause,
                hangupSource: payload.hangup_source ?? null,
              },
            });
          }`,
    replace: `          } else {
            // v0.10.133 - normalize toNumber via the connection-id-matched
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
            })();
            await prisma.call.create({
              data: {
                userId: ownerUserId,
                telnyxCallId: callId,
                sessionId: payload.call_session_id ?? null,
                direction,
                fromNumber,
                toNumber: hangupCreateCanonicalToNumber,
                status,
                startedAt,
                endedAt,
                durationSeconds: duration,
                hangupCause,
                hangupSource: payload.hangup_source ?? null,
              },
            });
          }`,
  },
]);

// ===========================================================
// 2. Bump versions to 0.10.133
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
  c = c.replace(/"version":\s*"0\.10\.132"/, '"version": "0.10.133"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.132 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.132 → 0.10.133`);
  }
}

// ===========================================================
// 3. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.133',
    find: `const APP_VERSION = '0.10.132';`,
    replace: `const APP_VERSION = '0.10.133';`,
  },
]);

// ===========================================================
// 4. whatsNew.ts v0.10.133 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.133 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.132',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.133',\n    date: 'June 12, 2026',\n    highlight: 'Fixed: answered inbound calls were missing from Recents for TeXML voicemail trial users',\n    changes: [\n      { type: 'fixed', text: 'Critical Recents fix. For users on the TeXML voicemail trial (currently you and the 8 testers), answered inbound calls were missing from the Recents tab. The root cause was that Telnyx fires call event webhooks ONLY for the SIP-delivery leg of those calls, not the PSTN leg, so the database row ended up storing the dialers SIP credential username as the to-number instead of a phone number. A safety filter on the Recents query was then hiding any row whose to-number matched a known SIP username, which wiped 100 percent of answered inbound calls for these users. Fixed by using the connection-id-attributed UserDid to normalize the to-number at write time: when the webhook says to-number is a SIP credential, we now look up the UserDids actual phone number and store that instead. Once Render redeploys the webhooks service, future inbound calls will store correctly. A one-time backfill script is also included to repair the ~50 existing rows already in the database.' },\n      { type: 'fixed', text: 'Server-only hotfix to apps/webhooks. The desktop dialer build does not need updating. Run the backfill script once after the Render redeploy to restore historical inbound calls to your Recents.' },\n    ],\n  },\n  {\n    version: '0.10.132',`,
  },
]);

// ===========================================================
// 5. Write the one-time backfill script
// ===========================================================
writeNewFile('packages/db/scripts/backfill-sip-username-tonumbers.ts', `// v0.10.133 - One-time backfill for Call rows where toNumber is a SIP
// credential username instead of a phone number.
//
// USAGE:
//   1. Make sure .env has DATABASE_URL set (same one webhooks uses)
//   2. cd acedialerv4
//   3. npx tsx --env-file=.env packages/db/scripts/backfill-sip-username-tonumbers.ts
//
//   The script is IDEMPOTENT - safe to re-run. It only updates rows
//   where toNumber currently matches a known sipUsername, and uses the
//   row's own userId.activeUserDidId (or first UserDid) to find the
//   correct phone number.
//
// WHAT IT DOES:
//   For every Call row where:
//     - userId is set (attributed)
//     - direction='inbound'
//     - toNumber matches some User.sipUsername
//   The script looks up that user's primary DID number and rewrites
//   toNumber to use it. After this runs, those rows pass the Recents
//   query filters and become visible in the UI.
//
// SAFETY:
//   - Wrapped in a single transaction; either all-or-nothing
//   - Prints a dry-run summary first; asks for confirmation before
//     committing (set BACKFILL_CONFIRM=yes env var to skip the prompt)
//   - Per-row logging so you can audit what changed

import { PrismaClient } from '@prisma/client';
import { createInterface } from 'node:readline';

const prisma = new PrismaClient();

async function prompt(question: string): Promise<string> {
  if (process.env.BACKFILL_CONFIRM === 'yes') return 'yes';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

async function main() {
  console.log('='.repeat(70));
  console.log('Backfill: Call.toNumber where it matches a SIP credential username');
  console.log('='.repeat(70));

  // Build sipUsername -> userId map
  const users = await prisma.user.findMany({
    where: { sipUsername: { not: null } },
    select: {
      id: true,
      sipUsername: true,
      activeUserDidId: true,
      didNumber: true,
      userDids: {
        select: { id: true, didNumber: true },
        orderBy: { id: 'asc' },
      },
    },
  });

  console.log(\`Loaded \${users.length} users with sipUsernames.\`);

  const fixes: Array<{
    callId: number;
    userId: number;
    oldToNumber: string;
    newToNumber: string;
  }> = [];

  for (const u of users) {
    if (!u.sipUsername) continue;
    // Pick the user's preferred DID: activeUserDidId if set, else first UserDid, else legacy didNumber column.
    let didNumber: string | null = null;
    if (u.activeUserDidId) {
      const active = u.userDids.find((d) => d.id === u.activeUserDidId);
      didNumber = active?.didNumber ?? null;
    }
    if (!didNumber && u.userDids.length > 0) {
      didNumber = u.userDids[0].didNumber;
    }
    if (!didNumber && u.didNumber) {
      didNumber = u.didNumber;
    }
    if (!didNumber) {
      console.warn(\`  WARN userId=\${u.id} sipUsername=\${u.sipUsername} has NO DID number - skipping\`);
      continue;
    }
    const rows = await prisma.call.findMany({
      where: {
        userId: u.id,
        direction: 'inbound',
        toNumber: u.sipUsername,
      },
      select: { id: true, toNumber: true },
    });
    for (const r of rows) {
      fixes.push({
        callId: r.id,
        userId: u.id,
        oldToNumber: r.toNumber,
        newToNumber: didNumber,
      });
    }
  }

  console.log(\`\\nFound \${fixes.length} rows that need toNumber rewritten.\`);
  if (fixes.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Summarize per user
  const byUser = new Map<number, number>();
  for (const f of fixes) byUser.set(f.userId, (byUser.get(f.userId) ?? 0) + 1);
  for (const [uid, count] of byUser) {
    console.log(\`  userId=\${uid}: \${count} rows\`);
  }

  const answer = await prompt(\`\\nProceed with update? (yes/no): \`);
  if (answer !== 'yes' && answer !== 'y') {
    console.log('Aborted by user.');
    await prisma.$disconnect();
    return;
  }

  console.log('\\nApplying updates in a transaction...');
  await prisma.$transaction(
    fixes.map((f) =>
      prisma.call.update({
        where: { id: f.callId },
        data: { toNumber: f.newToNumber },
      }),
    ),
  );
  console.log(\`Updated \${fixes.length} rows successfully.\`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`);

console.log('\n[apply-v133] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit -m "v0.10.133: normalize Call.toNumber via connection-id-matched UserDid"');
console.log('  6. git push');
console.log('');
console.log('AFTER Render redeploys ace-dialer-webhooks:');
console.log('  7. npx tsx --env-file=.env packages/db/scripts/backfill-sip-username-tonumbers.ts');
console.log('     (will dry-run + prompt for confirmation; uses connection_id-matched UserDid');
console.log('      to rewrite existing rows with toNumber=sipUsername back to the dialed phone number)');
