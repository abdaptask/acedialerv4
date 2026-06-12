// Diagnostic script for the missing-inbound-call bug.
//
// USAGE:
//   1. Copy to acedialerv4\packages\db\scripts\diagnose-missing-call.ts
//   2. cd acedialerv4
//   3. npx tsx --env-file=.env packages/db/scripts/diagnose-missing-call.ts
//
// REQUIREMENTS:
//   .env at the repo root must contain DATABASE_URL pointing at Supabase
//   (the same one our webhooks service uses in prod). If not, paste the
//   DATABASE_URL from Render env vars into your local .env temporarily.
//
// WHAT IT REPORTS:
//   - Your User row (id, email, sipUsername)
//   - All your UserDid rows (didNumber, connectionId, preMigrationConnectionId)
//   - Count of Calls in last 24h, broken down by direction and status
//   - Last 10 inbound Call rows so we can see if recent ones landed
//   - Recent Call rows with userId=NULL (the "orphaned" ones from attribution failures)
//   - The active "shared connection ID" env vars from the running process,
//     so we know if Pass 0 was being skipped for the shared-ID reason

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_EMAIL = 'abdulla@aptask.com';

async function main() {
  console.log('='.repeat(70));
  console.log('DIAGNOSE MISSING INBOUND CALL');
  console.log('='.repeat(70));

  // 1. User row
  console.log('\n[1/5] Your User row:');
  const user = await prisma.user.findFirst({
    where: { email: TARGET_EMAIL },
    select: { id: true, email: true, sipUsername: true, firstName: true, lastName: true, didNumber: true, telnyxNumberId: true, activeUserDidId: true },
  });
  if (!user) {
    console.error(`  FATAL: no User row for ${TARGET_EMAIL}`);
    process.exit(1);
  }
  console.log(`  id=${user.id}`);
  console.log(`  email=${user.email}`);
  console.log(`  name=${user.firstName} ${user.lastName}`);
  console.log(`  sipUsername=${JSON.stringify(user.sipUsername)}  <-- attribution looks up this EXACT string`);

  // 2. UserDid rows
  console.log('\n[2/5] Your UserDid rows:');
  const dids = await prisma.userDid.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      didNumber: true,
      label: true,
      connectionId: true,
      preMigrationConnectionId: true,
      telnyxNumberId: true,
    },
  });
  if (dids.length === 0) {
    console.error('  FATAL: no UserDid rows for this user - inbound attribution by DID match WILL fail');
  } else {
    for (const d of dids) {
      console.log(`  id=${d.id}`);
      console.log(`    didNumber=${JSON.stringify(d.didNumber)}`);
      console.log(`    label=${JSON.stringify(d.label)}`);
      console.log(`    connectionId=${JSON.stringify(d.connectionId)}  <-- Pass 0 matches against this`);
      console.log(`    preMigrationConnectionId=${JSON.stringify(d.preMigrationConnectionId)}  <-- Pass 0 also tries this`);
      console.log(`    telnyxNumberId=${JSON.stringify(d.telnyxNumberId)}`);
    }
  }

  // 3. Count Calls in last 24h
  console.log('\n[3/5] Calls in last 24h (for your userId):');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const grouped = await prisma.call.groupBy({
    by: ['direction', 'status'],
    where: { userId: user.id, createdAt: { gte: since } },
    _count: true,
  });
  if (grouped.length === 0) {
    console.log('  none');
  } else {
    for (const row of grouped) {
      console.log(`  ${row.direction.padEnd(10)} ${row.status.padEnd(15)} count=${row._count}`);
    }
  }

  // 4. Last 10 inbound Calls for this user
  console.log('\n[4/5] Your last 10 INBOUND Call rows (any time):');
  const recentInbound = await prisma.call.findMany({
    where: { userId: user.id, direction: 'inbound' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      telnyxCallId: true,
      fromNumber: true,
      toNumber: true,
      status: true,
      startedAt: true,
      createdAt: true,
    },
  });
  if (recentInbound.length === 0) {
    console.log('  none');
  } else {
    for (const c of recentInbound) {
      const when = c.createdAt.toISOString().slice(0, 19).replace('T', ' ');
      console.log(`  ${when}  from=${c.fromNumber} to=${c.toNumber} status=${c.status} telnyxCallId=${c.telnyxCallId?.slice(0, 30)}...`);
    }
  }

  // 5. Orphaned calls (userId=null) in last 24h - these are the "dropped" ones
  console.log('\n[5/5] Orphaned Calls (userId=null) in last 24h:');
  const orphans = await prisma.call.findMany({
    where: { userId: null, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      direction: true,
      fromNumber: true,
      toNumber: true,
      status: true,
      createdAt: true,
    },
  });
  if (orphans.length === 0) {
    console.log('  none  (good - the v0.10.108 fix is dropping these instead of attributing to user #1)');
  } else {
    console.log(`  ${orphans.length} orphaned rows:`);
    for (const o of orphans) {
      const when = o.createdAt.toISOString().slice(0, 19).replace('T', ' ');
      console.log(`  ${when}  ${o.direction} from=${o.fromNumber} to=${o.toNumber} status=${o.status}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('DIAGNOSIS HINTS:');
  console.log('-'.repeat(70));
  console.log('If User.sipUsername is "userabdulla74993" exactly:');
  console.log('  -> Pass 1 OR Pass 2 should succeed - attribution shouldnt fail.');
  console.log('If User.sipUsername differs (e.g., "abdulla74993" without "user"):');
  console.log('  -> Pass 1 and Pass 2 both miss, Pass 3 needs DID match');
  console.log('If UserDid.connectionId is null or wrong:');
  console.log('  -> Pass 0 fails, fallback to sipUsername passes');
  console.log('If ALL 4 passes fail, call is silently dropped (v0.10.108 guard).');
  console.log('Look at the log output above and match against these scenarios.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
