// v0.10.134 backfill (v3) - companion to v2.
//
// v2 fixed rows where userDidId IS NOT NULL (Pass-0-attributed rows).
// v3 fixes rows where userDidId IS NULL but the row is legitimately
// self-attributed via sipUsername (Pass 1/2 attribution).
//
// FILTER LOGIC:
//   For each user u with sipUsername:
//     find Call rows where:
//       userId      = u.id                ← attributed to this user
//       toNumber    = u.sipUsername       ← row's toNumber IS THIS USER's sipUsername
//       direction   = 'inbound'
//       userDidId   IS NULL               ← skipped by v2
//
//   "userId = u.id AND toNumber = u.sipUsername" forms a self-attribution
//   gate: the row is included only when the recorded userId matches the
//   owner of the SIP credential username stored in toNumber. Cross-user
//   contamination is impossible here because Telnyx never delivers
//   another user's sipUsername to your SIP credential.
//
// EXPECTED COUNTS (from comparing v1 vs v2 outputs):
//   userId=1   (abdulla):    ~4646 rows  ← the big one
//   userId=41  (Stefan?):    ~48 rows
//   userId=17:               ~15 rows
//   userId=33:               ~14 rows
//   userId=25:               ~8 rows
//   userId=29:               ~8 rows
//   userId=48:               ~6 rows
//   userId=35:               ~1 row
//   Others:                  0 rows (fully covered by v2 already)
//   TOTAL:                   ~4700 rows
//
// SAFETY:
//   - Per-user count printed BEFORE prompting for confirmation
//   - Batched in 200-row chunks to avoid statement-timeout
//   - BACKFILL_CONFIRM=yes env var to skip the prompt (CI mode)

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
  console.log('Backfill v3: Pass-1/2 attributed rows (userDidId IS NULL but user-self-matched)');
  console.log('='.repeat(70));

  const users = await prisma.user.findMany({
    where: { sipUsername: { not: null } },
    select: {
      id: true,
      sipUsername: true,
      activeUserDidId: true,
      userDids: {
        select: { id: true, didNumber: true },
        orderBy: { id: 'asc' },
      },
    },
  });
  console.log(`Loaded ${users.length} users with sipUsernames.`);

  const fixes: Array<{ callId: number; userId: number; oldToNumber: string; newToNumber: string }> = [];

  for (const u of users) {
    if (!u.sipUsername) continue;

    // Find this user's primary DID number
    let didNumber: string | null = null;
    if (u.activeUserDidId) {
      const active = u.userDids.find((d) => d.id === u.activeUserDidId);
      didNumber = active?.didNumber ?? null;
    }
    if (!didNumber && u.userDids.length > 0) {
      didNumber = u.userDids[0].didNumber;
    }
    if (!didNumber) {
      console.warn(`  WARN userId=${u.id} sipUsername=${u.sipUsername} has NO DID number - skipping`);
      continue;
    }

    // Self-attributed rows with userDidId NULL
    const rows = await prisma.call.findMany({
      where: {
        userId: u.id,
        direction: 'inbound',
        toNumber: u.sipUsername,
        userDidId: null,
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

  console.log(`\nFound ${fixes.length} rows to update.`);
  if (fixes.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Per-user summary
  const byUser = new Map<number, number>();
  for (const f of fixes) byUser.set(f.userId, (byUser.get(f.userId) ?? 0) + 1);
  const sorted = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1]);
  console.log('\nPer userId breakdown:');
  for (const [uid, count] of sorted) {
    console.log(`  userId=${uid}: ${count} rows`);
  }

  const answer = await prompt(`\nProceed with update? (yes/no): `);
  if (answer !== 'yes' && answer !== 'y') {
    console.log('Aborted by user.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying updates in 200-row transaction batches...');
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
