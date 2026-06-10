// Show the 10 most-recent Voicemail rows. Use to verify whether the
// TeXML recording-complete handler actually wrote a row to the database.
//
// Usage:
//   npm --workspace=packages/db run recent-voicemails
//
// Add to package.json scripts:
//   "recent-voicemails": "tsx --env-file=../../.env scripts/recent-voicemails.ts"

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.voicemail.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        userId: true,
        userDidId: true,
        fromNumber: true,
        toNumber: true,
        durationSeconds: true,
        telnyxCallId: true,
        recordingUrl: true,
        transcription: true,
        receivedAt: true,
        createdAt: true,
      },
    });
    if (rows.length === 0) {
      console.log('No voicemails in DB.');
      return;
    }
    for (const r of rows) {
      console.log('---');
      console.log(`id:            ${r.id}`);
      console.log(`createdAt:     ${r.createdAt.toISOString()}`);
      console.log(`receivedAt:    ${r.receivedAt.toISOString()}`);
      console.log(`userId:        ${r.userId}`);
      console.log(`userDidId:     ${r.userDidId ?? '(null)'}`);
      console.log(`from -> to:    ${r.fromNumber} -> ${r.toNumber}`);
      console.log(`duration:      ${r.durationSeconds}s`);
      console.log(`telnyxCallId:  ${r.telnyxCallId ?? '(null)'}`);
      console.log(`recordingUrl:  ${r.recordingUrl?.slice(0, 100) ?? '(null)'}${(r.recordingUrl?.length ?? 0) > 100 ? '...' : ''}`);
      console.log(`transcription: ${r.transcription?.slice(0, 100) ?? '(null)'}${(r.transcription?.length ?? 0) > 100 ? '...' : ''}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
