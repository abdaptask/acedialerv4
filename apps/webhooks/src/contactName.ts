// Caller-name resolution for outbound notifications (Teams cards + emails).
//
// Every notification surface used to lead with a bare formatted number, so a
// missed call from a candidate the user had already saved read exactly like a
// cold call from a stranger. The card builders have always accepted an optional
// `fromName` (see teamsCards/missedCall.ts) — nothing populated it. This is
// that missing lookup.
//
// Resolution order — most specific naming wins:
//   1. The user's own Favorites, including the v0.10.66 multi-number children
//      (Cell / Home / Work / Other). What the user typed for a contact beats
//      anything we could infer.
//   2. Another ACE user's DID — an internal call from a coworker resolves to
//      their name instead of a number nobody recognises.
// No JobDiva: this module runs inside apps/webhooks, which can't import from
// apps/api (CLAUDE.md §1.4), and the notify path shouldn't grow an external
// HTTP round-trip. Favorites + DIDs are both already in the shared Prisma DB.
//
// FAILS OPEN. A DB blip returns null and the notification still goes out with
// the number alone — the same contract as the rest of the notifier stack
// ("failures never throw"). A named card is nice; a dropped card is a missed
// call the user never hears about.

import { prisma } from '@ace/db';

/** Last-10-digit key — the dialer-wide phone-matching convention (CLAUDE.md
 *  §3.4). Tolerates carrier formatting differences between what Telnyx sends
 *  and what the user saved. */
function last10(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^\d]/g, '').slice(-10);
}

/** Join a first/last pair, falling back to the legacy pre-joined `label`
 *  column that older clients wrote instead of firstName+lastName. */
function displayName(
  firstName: string | null,
  lastName: string | null,
  label?: string | null,
): string | null {
  const joined = [firstName, lastName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (joined) return joined;
  const fallback = (label ?? '').trim();
  return fallback || null;
}

/**
 * Resolve a display name for `phone` as seen by `userId`, or null when we
 * have nothing better than the number itself.
 *
 * Callers pass the result straight into a card builder's `fromName` (which
 * renders `Sarah Chen — (732) 200-1305`) or an email's caller line.
 */
export async function resolveContactName(
  userId: number,
  phone: string | null | undefined,
): Promise<string | null> {
  const want = last10(phone);
  // Short of 10 digits we can't match safely: anonymous/withheld callers and
  // SMS short codes would collide with real contacts on a suffix compare.
  if (want.length < 10) return null;

  try {
    // Favorites first. Filtering in JS rather than SQL mirrors the blocklist
    // and /contacts/history lookups: the digit-normalised compare can't be
    // expressed in a Prisma where clause without raw SQL, and per-user
    // favorite counts are small.
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      select: {
        phone: true,
        firstName: true,
        lastName: true,
        label: true,
        numbers: { select: { phone: true } },
      },
    });
    for (const fav of favorites) {
      const hit =
        last10(fav.phone) === want ||
        fav.numbers.some((n) => last10(n.phone) === want);
      if (!hit) continue;
      const name = displayName(fav.firstName, fav.lastName, fav.label);
      if (name) return name;
      // A favorite with no name at all is still a match — stop here rather
      // than falling through and labelling it with a coworker's name.
      return null;
    }

    // Then internal DIDs — a coworker calling from their ACE line.
    const dids = await prisma.userDid.findMany({
      where: { userId: { not: null } },
      select: {
        didNumber: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const did = dids.find((d) => last10(d.didNumber) === want);
    if (did?.user) return displayName(did.user.firstName, did.user.lastName);

    return null;
  } catch (e) {
    console.warn('[contactName] lookup failed — falling back to number only', {
      userId,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
