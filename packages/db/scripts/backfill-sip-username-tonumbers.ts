// v0.10.133 backfill (v2) - SAFER. Updates toNumber on Call rows where:
//   - direction = 'inbound'
//   - toNumber matches a User.sipUsername
//   - userDidId IS NOT NULL  <-- NEW: only touches rows that went through
//     the v0.10.108+ proper attribution pipeline. Pre-v0.10.108 rows
//     have userDidId=NULL because the old code didn't populate it
//     correctly. Those legacy rows were stamped onto userId=1 (admin)
//     as a fallback even when the call didn't belong to user 1, so
//     rewriting their toNumber to user 1's didNumber would falsely
//     surface them in user 1's Recents.
//
// Resulting toNumber: pulled directly from THIS ROW's userDidId
// (UserDid.didNumber). No guessing - we use exactly what proper
// attribution identified.
//
// SAFETY:
//   - Wrapped in $transaction (atomic, all-or-nothing)
//   - Prints per-user counts before prompting for confirmation
//   - Per-row log shows id, userId, before/after toNumber
//   - BACKFILL_CONFIRM=yes env var to skip the prompt (CI mode)
//
// USAGE:
//   cd acedialerv4
//   1. Replace the OLD script:
//      Copy-Item this-file packages/db/scripts/backfill-sip-username-tonumbers.ts -Force
//   2. Run:
//      npx tsx --env-file=.env packages/db/scripts/backfill-sip-username-tonumbers.ts

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
  console.log('Backfill v2: Call.toNumber where toNumber matches a SIP username');
  console.log('            AND the row has userDidId set (proper attribution)');
  console.log('='.repeat(70));

  // Load sipUsername -> userId mapping (still used to identify "this Call row's toNumber is a sipUsername")
  const users = await prisma.user.findMany({
    where: { sipUsername: { not: null } },
    select: { id: true, sipUsername: true },
  });
  const sipUsernames = users.map((u) => u.sipUsername).filter((s): s is string => !!s);
  console.log(`Loaded ${users.length} users with sipUsernames.`);
  console.log(`Looking for inbound Call rows where toNumber IN (${sipUsernames.length} usernames) AND userDidId IS NOT NULL.`);

  // The CRITICAL filter: userDidId IS NOT NULL. This is the column populated
  // by v0.10.108+ proper attribution. If it's null, the row is from the
  // legacy fallback bug era and we MUST NOT touch it.
  const candidates = await prisma.call.findMany({
    where: {
      direction: 'inbound',
      toNumber: { in: sipUsernames },
      userDidId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      userDidId: true,
      toNumber: true,
      userDid: {
        select: { didNumber: true },
      },
    },
  });

  console.log(`\nFound ${candidates.length} candidate rows (much smaller than v1's 4905 because we skipped pre-v0.10.108 rows).`);

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Sanity check: every candidate has userDid populated (since userDidId IS NOT NULL)
  const fixes: Array<{ callId: number; userId: number | null; oldToNumber: string; newToNumber: string }> = [];
  let skippedNoDidNumber = 0;
  for (const c of candidates) {
    if (!c.userDid?.didNumber) {
      skippedNoDidNumber += 1;
      continue;
    }
    fixes.push({
      callId: c.id,
      userId: c.userId,
      oldToNumber: c.toNumber,
      newToNumber: c.userDid.didNumber,
    });
  }
  if (skippedNoDidNumber > 0) {
    console.log(`Skipped ${skippedNoDidNumber} rows whose userDid has no didNumber (shouldn't happen but defensive).`);
  }

  // Group by userId for the summary
  console.log(`\nWill update ${fixes.length} rows. Per userId breakdown:`);
  const byUser = new Map<number | null, number>();
  for (const f of fixes) byUser.set(f.userId, (byUser.get(f.userId) ?? 0) + 1);
  const sorted = Array.from(byUser.entries()).sort((a, b) => (b[1] - a[1]));
  for (const [uid, count] of sorted) {
    console.log(`  userId=${uid}: ${count} rows`);
  }

  // Sanity guardrail - if anyone has >300 rows, that's still suspicious for the trial period
  const TRIAL_DAYS = 30;
  const MAX_EXPECTED_PER_USER = 300;
  const suspicious = sorted.filter(([_, count]) => count > MAX_EXPECTED_PER_USER);
  if (suspicious.length > 0) {
    console.log(`\n⚠ Warning: ${suspicious.length} user(s) exceed ${MAX_EXPECTED_PER_USER} rows.`);
    console.log(`   That's unusually high for a ${TRIAL_DAYS}-day trial window.`);
    console.log(`   If userId=1 is in this list, double-check the count before proceeding.`);
  }

  const answer = await prompt(`\nProceed with update? (yes/no): `);
  if (answer !== 'yes' && answer !== 'y') {
    console.log('Aborted by user.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying updates in a transaction...');
  // Chunk in batches of 200 because a single $transaction with 5000+ ops can hit
  // statement-timeout on Supabase Pooler. 200 per batch is well under timeout.
  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < fixes.length; i += BATCH) {
    const slice = fixes.slice(i, i + BATCH);
    await prisma.$transaction(
      slice.map((f) =>
        prisma.call.update({
          where: { id: f.callId },
          data: { toNumber: f.newToNumber },
        }),
      ),
    );
    updated += slice.length;
    console.log(`  ... ${updated}/${fixes.length}`);
  }
  console.log(`\nUpdated ${updated} rows successfully.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
