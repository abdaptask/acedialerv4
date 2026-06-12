// Diagnose the v0.10.132 duplicate-voicemail report.
//
// USAGE:
//   1. Copy to acedialerv4\packages\db\scripts\diagnose-duplicate-voicemail.ts
//   2. cd acedialerv4
//   3. npx tsx --env-file=.env packages/db/scripts/diagnose-duplicate-voicemail.ts
//
// What it shows:
//   - Last 20 voicemail rows for Abdulla, sorted newest-first
//   - All dedup-relevant fields: telnyxCallId, fromNumber, receivedAt
//   - Adjacent rows with same fromNumber + receivedAt within 60s
//     get flagged DUPLICATE in the output
//   - Same call_session_id (telnyxCallId starts with v3:CALLID portion)
//     gets cross-checked

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_EMAIL = 'abdulla@aptask.com';

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: TARGET_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`No user for ${TARGET_EMAIL}`);
    process.exit(1);
  }
  console.log(`User #${user.id} (${user.email})`);

  const vms = await prisma.voicemail.findMany({
    where: { userId: user.id },
    orderBy: { receivedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      telnyxCallId: true,
      fromNumber: true,
      toNumber: true,
      receivedAt: true,
      durationSeconds: true,
      recordingUrl: true,
      transcription: true,
      createdAt: true,
    },
  });

  console.log(`\nLast ${vms.length} voicemails (newest first):\n`);

  // Flag adjacent rows with same fromNumber + receivedAt within 60s
  // OR same telnyxCallId
  for (let i = 0; i < vms.length; i += 1) {
    const v = vms[i];
    const prev = i > 0 ? vms[i - 1] : null;
    let flag = '';
    if (prev) {
      const dtSec = Math.abs((prev.receivedAt.getTime() - v.receivedAt.getTime()) / 1000);
      const sameFrom = prev.fromNumber === v.fromNumber;
      const sameCallId = prev.telnyxCallId === v.telnyxCallId;
      if (sameCallId && prev.telnyxCallId) {
        flag = `  ⚠ SAME telnyxCallId as #${prev.id} - v0.10.121 dedup FAILED!`;
      } else if (sameFrom && dtSec < 60) {
        flag = `  ⚠ SAME fromNumber + within ${Math.round(dtSec)}s of #${prev.id} - v0.10.126 dedup FAILED!`;
      }
    }
    console.log(`#${v.id.toString().padStart(5, ' ')}  rcvd=${v.receivedAt.toISOString()}  from=${v.fromNumber}  to=${v.toNumber}  dur=${v.durationSeconds ?? '?'}s${flag}`);
    console.log(`         telnyxCallId=${v.telnyxCallId ?? '(null)'}`);
    if (v.recordingUrl) {
      const tail = v.recordingUrl.slice(-30);
      console.log(`         recordingUrl=…${tail}`);
    }
    console.log('');
  }

  // Quickly summarize unique vs duplicate metrics
  const byCallId = new Map<string, number>();
  for (const v of vms) {
    if (!v.telnyxCallId) continue;
    byCallId.set(v.telnyxCallId, (byCallId.get(v.telnyxCallId) ?? 0) + 1);
  }
  const dupGroups = [...byCallId.entries()].filter(([_, n]) => n > 1);
  if (dupGroups.length > 0) {
    console.log('Duplicate groups by telnyxCallId:');
    for (const [id, count] of dupGroups) {
      console.log(`  ${id}  → ${count} rows`);
    }
  } else {
    console.log('No duplicates by telnyxCallId in the last 20 rows.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
