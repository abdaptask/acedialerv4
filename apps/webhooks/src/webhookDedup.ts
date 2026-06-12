// v0.10.142 — QA-005 — Cross-replica webhook dedup.
//
// Replaces module-local Set<id> dedup in teamsNotifier.ts /
// emailNotifier.ts. Set-based dedup ONLY works when there's a single
// replica (each process has its own Set, so the same event delivered
// to two replicas would fire two cards). The Postgres-backed dedup
// here is a single source of truth across all replicas.
//
// USAGE:
//   if (!(await claimSend(`teams:missedCall:${callDbId}`))) {
//     // Another replica (or earlier event in this replica) already
//     // sent the card. Skip.
//     return;
//   }
//   // proceed with send
//
// GRACEFUL DEGRADATION:
// If the WebhookDedup table doesn't exist yet (db:push hasn't been
// run), the helper logs a warning and returns true (treats the
// claim as successful). This lets you deploy the code BEFORE the
// migration runs without breaking the service. The in-memory Set
// fallback in teamsNotifier.ts still works within a single replica.

import { prisma } from '@ace/db';

/**
 * Attempt to claim a dedup key. Returns true if the claim succeeded
 * (this is the first time we've seen this key), false if it's already
 * been claimed by another sender.
 *
 * Falls back to true (claim succeeded) if the WebhookDedup table
 * doesn't exist yet (degrades to in-memory-only dedup during the
 * migration window).
 */
export async function claimSend(key: string): Promise<boolean> {
  try {
    await prisma.webhookDedup.create({ data: { key } });
    return true;
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    const code = err?.code;
    if (code === 'P2002') {
      // Unique violation - another replica already claimed this key.
      return false;
    }
    if (code === 'P2021' || code === 'P2022') {
      // Table doesn't exist yet (db:push hasn't run). Degrade gracefully.
      console.warn(
        '[webhookDedup] table missing - falling back to in-memory only. Run db:push to enable cross-replica dedup.',
      );
      return true;
    }
    // Unexpected error - log but don't block the send; the in-memory
    // Set in the caller is the backup defense.
    console.warn(
      '[webhookDedup] claim failed unexpectedly - proceeding with send',
      err?.message ?? err,
    );
    return true;
  }
}
