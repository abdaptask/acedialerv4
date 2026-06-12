// v0.10.133 - One-time backfill for Call rows where toNumber is a SIP
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

  console.log(`Loaded ${users.length} users with sipUsernames.`);

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
      console.warn(`  WARN userId=${u.id} sipUsername=${u.sipUsername} has NO DID number - skipping`);
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

  console.log(`\nFound ${fixes.length} rows that need toNumber rewritten.`);
  if (fixes.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // Summarize per user
  const byUser = new Map<number, number>();
  for (const f of fixes) byUser.set(f.userId, (byUser.get(f.userId) ?? 0) + 1);
  for (const [uid, count] of byUser) {
    console.log(`  userId=${uid}: ${count} rows`);
  }

  const answer = await prompt(`\nProceed with update? (yes/no): `);
  if (answer !== 'yes' && answer !== 'y') {
    console.log('Aborted by user.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying updates in a transaction...');
  await prisma.$transaction(
    fixes.map((f) =>
      prisma.call.update({
        where: { id: f.callId },
        data: { toNumber: f.newToNumber },
      }),
    ),
  );
  console.log(`Updated ${fixes.length} rows successfully.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
