// ===========================================================================
// backfill-telnyx-number-ids.ts - for each DID passed on the command line,
// look up the Telnyx phone_numbers resource via the public Telnyx API and
// cache the resource's `id` field into UserDid.telnyxNumberId.
//
// WHY: the TeXML migrate endpoint (and Call Control migrate, and rollback)
// all require UserDid.telnyxNumberId to be set so they can PATCH the
// /v2/phone_numbers/<id> resource. Some older UserDid rows predate the
// cache and have null telnyxNumberId, which makes those endpoints fail
// with `telnyxNumberId not cached on UserDid`.
//
// SAFE TO RE-RUN: idempotent. If telnyxNumberId is already set, we DO NOT
// overwrite (since Telnyx IDs are immutable). If the DID isn't found in
// Telnyx (e.g. the number was released), we just print a warning.
//
// Requires TELNYX_API_KEY in .env (same one webhooks/api use).
//
// Usage:
//   npm --workspace=packages/db run backfill-telnyx-number-ids -- \
//     +17322014727 +17327344818 ...
// ===========================================================================

import { PrismaClient } from '@prisma/client';

const TELNYX_API = 'https://api.telnyx.com/v2';

interface TelnyxPhoneNumberResponse {
  data?: Array<{
    id?: string;
    phone_number?: string;
    connection_id?: string;
  }>;
}

async function lookupTelnyxNumber(
  apiKey: string,
  did: string,
): Promise<{ id: string | null; connectionId: string | null; httpStatus: number }> {
  const url = `${TELNYX_API}/phone_numbers?filter[phone_number]=${encodeURIComponent(did)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    return { id: null, connectionId: null, httpStatus: res.status };
  }
  const json = (await res.json().catch(() => ({}))) as TelnyxPhoneNumberResponse;
  const first = json?.data?.[0];
  return {
    id: first?.id ?? null,
    connectionId: first?.connection_id ?? null,
    httpStatus: res.status,
  };
}

async function main() {
  const dids = process.argv.slice(2).map((d) => d.trim()).filter(Boolean);
  if (dids.length === 0) {
    console.error('Usage: tsx backfill-telnyx-number-ids.ts <DID1> [DID2] ...');
    process.exit(2);
  }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error('TELNYX_API_KEY is not set in .env');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  let updatedCount = 0;
  let alreadySetCount = 0;
  let notFoundInTelnyxCount = 0;
  let notFoundInDbCount = 0;
  let multiUserDidCount = 0;

  try {
    for (const did of dids) {
      console.log(`\n--- ${did} ---`);
      const userDids = await prisma.userDid.findMany({
        where: { didNumber: did },
        select: { id: true, didNumber: true, telnyxNumberId: true, userId: true },
      });

      if (userDids.length === 0) {
        console.log('  WARN: no UserDid row found for this DID in our DB. Skipping.');
        notFoundInDbCount++;
        continue;
      }
      if (userDids.length > 1) {
        console.log(`  WARN: multiple UserDid rows for ${did}. Will update all of them.`);
        multiUserDidCount++;
      }

      const allSet = userDids.every((u) => u.telnyxNumberId);
      if (allSet) {
        console.log(`  Already set on all ${userDids.length} row(s). Skipping API call.`);
        for (const u of userDids) {
          console.log(`    UserDid ${u.id} (user ${u.userId}) -> telnyxNumberId=${u.telnyxNumberId}`);
        }
        alreadySetCount++;
        continue;
      }

      const tx = await lookupTelnyxNumber(apiKey, did);
      if (!tx.id) {
        console.log(`  WARN: Telnyx did not return a phone_numbers resource for ${did} (http ${tx.httpStatus}). Skipping.`);
        notFoundInTelnyxCount++;
        continue;
      }
      console.log(`  Telnyx ID: ${tx.id}`);
      console.log(`  Telnyx connection_id: ${tx.connectionId ?? '(null)'}`);

      for (const u of userDids) {
        if (u.telnyxNumberId) {
          console.log(`    UserDid ${u.id}: already has telnyxNumberId=${u.telnyxNumberId} - not overwriting.`);
          continue;
        }
        await prisma.userDid.update({
          where: { id: u.id },
          data: { telnyxNumberId: tx.id },
        });
        console.log(`    UserDid ${u.id} (user ${u.userId}): updated telnyxNumberId -> ${tx.id}`);
        updatedCount++;
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('');
  console.log('================================================================');
  console.log('SUMMARY');
  console.log(`  Rows updated:                 ${updatedCount}`);
  console.log(`  DIDs already had ID set:      ${alreadySetCount}`);
  console.log(`  DIDs not found in Telnyx:     ${notFoundInTelnyxCount}`);
  console.log(`  DIDs not in our DB:           ${notFoundInDbCount}`);
  console.log(`  DIDs with multiple UserDids:  ${multiUserDidCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
