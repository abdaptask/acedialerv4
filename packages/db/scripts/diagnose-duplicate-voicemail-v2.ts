// v2: broader scan - ALL voicemails across ALL users in the last 60 min.
// If two rows exist for the same call but got attributed to different
// users, the v1 query (filtered to userId=1) wouldn't have found them.
//
// USAGE:
//   npx tsx --env-file=.env packages/db/scripts/diagnose-duplicate-voicemail-v2.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  console.log(`Scanning all voicemails received since ${since.toISOString()}\n`);

  const vms = await prisma.voicemail.findMany({
    where: { receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      userId: true,
      telnyxCallId: true,
      fromNumber: true,
      toNumber: true,
      receivedAt: true,
      durationSeconds: true,
      recordingUrl: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });

  console.log(`Found ${vms.length} voicemail rows in the last 60 min.\n`);

  for (const v of vms) {
    const tail = v.recordingUrl ? `…${v.recordingUrl.slice(-25)}` : '(null)';
    console.log(
      `#${String(v.id).padStart(5, ' ')}  rcvd=${v.receivedAt.toISOString()}  ` +
      `user=${v.userId}(${v.user?.email ?? '?'})  ` +
      `from=${v.fromNumber}  to=${v.toNumber}  dur=${v.durationSeconds ?? '?'}s`
    );
    console.log(`         telnyxCallId=${v.telnyxCallId ?? '(null)'}`);
    console.log(`         recordingUrl=${tail}`);
    console.log(`         createdAt=${v.createdAt.toISOString()}`);
    console.log('');
  }

  // Cross-row dedup analysis
  console.log('─'.repeat(70));
  console.log('Cross-row dedup analysis:');

  // Group by telnyxCallId
  const byTelnyxCallId = new Map<string, typeof vms>();
  for (const v of vms) {
    if (!v.telnyxCallId) continue;
    const arr = byTelnyxCallId.get(v.telnyxCallId) ?? [];
    arr.push(v);
    byTelnyxCallId.set(v.telnyxCallId, arr);
  }
  let foundDup = false;
  for (const [callId, group] of byTelnyxCallId) {
    if (group.length > 1) {
      foundDup = true;
      console.log(`\n⚠ DUPLICATE by telnyxCallId=${callId}:`);
      for (const g of group) console.log(`   #${g.id}  user=${g.userId}  ${g.receivedAt.toISOString()}`);
    }
  }

  // Group by fromNumber + 60s window
  const sorted = [...vms].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const dtSec = (b.receivedAt.getTime() - a.receivedAt.getTime()) / 1000;
    if (dtSec < 60 && a.fromNumber === b.fromNumber) {
      foundDup = true;
      console.log(`\n⚠ DUPLICATE by fromNumber + ${Math.round(dtSec)}s window:`);
      console.log(`   #${a.id}  user=${a.userId}  ${a.receivedAt.toISOString()}  telnyxCallId=${a.telnyxCallId}`);
      console.log(`   #${b.id}  user=${b.userId}  ${b.receivedAt.toISOString()}  telnyxCallId=${b.telnyxCallId}`);
    }
  }

  if (!foundDup) {
    console.log('\nNo duplicates detected across users in the last 60 min.');
    console.log('If you saw two notifications, the duplicate may be in the NOTIFICATION path');
    console.log('(Teams card fired twice for a single row), not the DB write path.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
