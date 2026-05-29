// v0.10.0 — Shared helper for ensuring a freshly-created User has a
// matching UserDid row + the User.activeUserDidId pointer set.
//
// Why this exists: admin.routes.ts has 4 user-creation paths (regular
// invite, auto-provision, bulk-import, pending-user invite). All four
// write to User.didNumber but historically NONE of them created a
// UserDid row. The migration backfilled existing users; new invites
// silently ended up with no UserDid → broken DidSwitcher, refused SMS
// (per v0.9.14 hardening), no line-badge tags. First reported when a
// new user (Akshay Tejwani) couldn't send SMS post-v0.10.0 release.
//
// Centralizing in one helper means there's exactly one place to update
// when the UserDid schema changes, and no path can silently skip the
// linkage. Each invite endpoint calls this immediately after creating
// the User row.
//
// Idempotent: if a UserDid row already exists for the given didNumber
// (e.g. partial-provision retry, or admin re-invited a previously-
// anonymized user), we UPDATE it to point at the new User and refresh
// the cached Telnyx fields rather than fail on the unique constraint.

import { prisma } from '@ace/db';
import * as telnyx from '../telnyx/numbers.js';

export interface EnsureUserDidInput {
  userId: number;
  didNumber: string;
  /** If known, pass it; otherwise we'll look it up via Telnyx. */
  telnyxNumberId?: string | null;
  /** Credential Connection id this DID's voice is routed to. */
  connectionId?: string | null;
  /** Display label. Defaults to "Main" — every user's first line. */
  label?: string;
  colorHex?: string;
  /** Whether to mark as the user's default + point activeUserDidId. */
  isDefault?: boolean;
}

export interface EnsureUserDidResult {
  ok: boolean;
  userDidId?: number;
  error?: string;
}

export async function ensureUserDid(input: EnsureUserDidInput): Promise<EnsureUserDidResult> {
  try {
    let telnyxNumberId = input.telnyxNumberId ?? null;
    // v0.10.14 — Look up BOTH the Telnyx number-id AND the bound
    // connection_id from Telnyx if either is missing. Previously we
    // only looked up the number-id. Result: invite paths that didn't
    // pass connectionId (regular invite, bulk import) created UserDid
    // rows with connectionId=NULL → inbound TexML routing fell back to
    // the pilot connection → every user except whoever owned the pilot
    // had their calls misrouted with a 366ms hangup.
    //
    // Doing both lookups in one Telnyx call (findNumberByE164 already
    // returns both fields) is essentially free. The connectionId is the
    // critical field for inbound voice routing.
    let connectionId: string | null = input.connectionId ?? null;
    if (!telnyxNumberId || !connectionId) {
      const lookup = await telnyx.findNumberByE164(input.didNumber);
      if (lookup.ok && lookup.data) {
        if (!telnyxNumberId) telnyxNumberId = lookup.data.id;
        if (!connectionId) connectionId = lookup.data.connection_id ?? null;
      }
    }

    const data = {
      didNumber: input.didNumber,
      telnyxNumberId,
      connectionId,
      label: input.label ?? 'Main',
      colorHex: input.colorHex ?? '#3b82f6',
      isDefault: input.isDefault ?? true,
    };

    const existing = await prisma.userDid.findUnique({
      where: { didNumber: input.didNumber },
      select: { id: true, userId: true },
    });

    const userDidId = existing
      ? (
          await prisma.userDid.update({
            where: { id: existing.id },
            data: { userId: input.userId, ...data },
            select: { id: true },
          })
        ).id
      : (
          await prisma.userDid.create({
            data: { userId: input.userId, ...data },
            select: { id: true },
          })
        ).id;

    if (data.isDefault) {
      // If marking as default, unset isDefault on all other UserDids
      // for this user. Application-layer enforcement of the "exactly
      // one default per user" rule.
      await prisma.userDid.updateMany({
        where: { userId: input.userId, id: { not: userDidId } },
        data: { isDefault: false },
      });
      await prisma.user.update({
        where: { id: input.userId },
        data: { activeUserDidId: userDidId },
      });
    }

    return { ok: true, userDidId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
