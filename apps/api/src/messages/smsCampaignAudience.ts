// Who actually gets the message — the correctness half of a multi-select send.
//
// Pure functions, no Prisma, because everything that can go wrong with a bulk
// send goes wrong here rather than in the sending. The route supplies the
// user's real favorites and blocklist; this decides who is in and who is out,
// and NAMES every exclusion so a partial send can never be silent.
//
// ── The traps this exists to avoid ─────────────────────────────────────
//
//   1. ONE TEXT PER PERSON, not per number. A Favorite can carry Cell + Home +
//      Work (v0.10.66). Fanning out over numbers instead of people sends the
//      same message three times to one contact — the single worst outcome of
//      this feature, because it's indistinguishable from a broken app.
//
//   2. TWO FAVORITES CAN SHARE A NUMBER. A shared desk line, a spouse, the
//      same person starred twice under different spellings. Deduped on last-10.
//
//   3. THE CLIENT'S LIST IS A REQUEST, NOT AN AUTHORITY. It can be stale (a
//      favorite deleted in another tab) or forged. Only numbers currently on
//      the caller's own favorites survive, so a crafted payload can't turn this
//      into a send-anywhere endpoint.
//
//   4. THE BLOCKLIST APPLIES OUTBOUND HERE. Today it's enforced inbound only,
//      which is fine for 1:1 — you don't hand-dial someone you blocked. A bulk
//      send over a saved list absolutely can, so it's checked.
//
//   5. AN UNRESOLVED PLACEHOLDER FAILS CLOSED. "Hi {firstName}," sent literally
//      to 60 people is unrecoverable. Per CLAUDE.md §18.4 a placeholder is
//      never resolved to an empty string, so the only safe move is to refuse
//      the recipient and say which token didn't fill.
import { last10, toE164 } from '../lib/phone.js';

/**
 * Blast-radius ceiling, not a throughput limit.
 *
 * Sized against real data: the heaviest favorites list in production is 155
 * (next is 56), so 200 cannot reject a legitimate send — it exists so a bug or
 * a mis-click can't text 800 people, which is not undoable.
 */
export const MAX_CAMPAIGN_RECIPIENTS = 200;

export type SkipReason =
  | 'not_dialable'
  | 'duplicate'
  | 'not_a_favorite'
  | 'blocked'
  | 'body_too_long'
  | 'unresolved_placeholder'
  | 'empty_body';

export interface RequestedRecipient {
  favoriteId: number;
  phone: string;
  /** The per-recipient body, already placeholder-filled by the client. */
  body: string;
}

export interface OwnedFavorite {
  id: number;
  /** Legacy primary mirror. */
  phone: string;
  numbers: Array<{ phone: string; label: string; isPrimary: boolean }>;
}

export interface AcceptedRecipient {
  favoriteId: number;
  /** E.164, what we hand to Telnyx. */
  phone: string;
  body: string;
}

export interface SkippedRecipient {
  phone: string;
  favoriteId: number | null;
  reason: SkipReason;
  /** Human sentence for the UI. Never a bare code. */
  detail: string;
}

export interface AudienceResult {
  accepted: AcceptedRecipient[];
  skipped: SkippedRecipient[];
}

/**
 * Pick the single number a send targets for one favorite.
 *
 * Prefers the explicit primary, then the first listed number, then the legacy
 * `Favorite.phone` mirror for rows predating v0.10.66. Returning exactly one
 * number is trap #1 above.
 */
export function pickPrimaryPhone(fav: OwnedFavorite): string {
  return fav.numbers.find((n) => n.isPrimary)?.phone ?? fav.numbers[0]?.phone ?? fav.phone;
}

/**
 * Build a last-10 → favoriteId index over EVERY number the user has starred.
 *
 * All numbers are indexed, not just primaries, so a client that legitimately
 * asks to reach someone on their Work line is allowed to — the ownership check
 * is "is this number on one of my favorites", not "is this the primary".
 */
export function indexOwnedNumbers(favorites: OwnedFavorite[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const fav of favorites) {
    for (const phone of [fav.phone, ...fav.numbers.map((n) => n.phone)]) {
      const key = last10(phone);
      // First favorite wins when two share a number — arbitrary but stable,
      // and the recipient is deduped anyway so only the attribution differs.
      if (key && !out.has(key)) out.set(key, fav.id);
    }
  }
  return out;
}

/** Placeholder tokens still unfilled in a rendered body. */
export function unresolvedPlaceholders(body: string): string[] {
  return [...(body ?? '').matchAll(/\{([^{}]+)\}/g)].map((m) => m[0]);
}

/**
 * Resolve the final recipient list.
 *
 * Order matters: the over-limit check runs against the REQUESTED count before
 * any filtering, so a caller asking for 500 gets told they asked for too many
 * rather than being silently trimmed to 200.
 */
export function resolveAudience(args: {
  requested: RequestedRecipient[];
  ownedFavorites: OwnedFavorite[];
  /** Last-10 keys of the caller's blocked numbers. */
  blockedKeys: Set<string>;
  maxBodyChars: number;
  maxRecipients?: number;
}): AudienceResult {
  const maxRecipients = args.maxRecipients ?? MAX_CAMPAIGN_RECIPIENTS;
  const owned = indexOwnedNumbers(args.ownedFavorites);

  const accepted: AcceptedRecipient[] = [];
  const skipped: SkippedRecipient[] = [];
  const seen = new Set<string>();
  const seenFavorites = new Set<number>();

  for (const r of args.requested) {
    const key = last10(r.phone);
    const favoriteId = r.favoriteId ?? null;

    if (!key) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'not_dialable',
        detail: `"${r.phone}" isn't a dialable number.`,
      });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'duplicate',
        detail: 'Already in this send — the same number appears more than once.',
      });
      continue;
    }
    // Dedupe by PERSON as well as by number. Deduping only on the number
    // leaves trap #1 open: a favorite carrying Cell + Home + Work has three
    // distinct numbers, so three entries would all pass the check above and
    // that one contact gets three texts. Enforcing it here rather than
    // trusting the client to send one entry per favorite is the point — the
    // client picking primaries correctly is a convention, this is a guarantee.
    const owningFavorite = owned.get(key);
    if (owningFavorite !== undefined && seenFavorites.has(owningFavorite)) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'duplicate',
        detail: 'Already in this send — this contact is being messaged on another number.',
      });
      continue;
    }
    if (!owned.has(key)) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'not_a_favorite',
        detail: 'Not on your favorites list any more.',
      });
      continue;
    }
    if (args.blockedKeys.has(key)) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'blocked',
        detail: 'You have this number blocked.',
      });
      continue;
    }

    const body = r.body ?? '';
    if (body.trim() === '') {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'empty_body',
        detail: 'The message came through empty for this recipient.',
      });
      continue;
    }
    if (body.length > args.maxBodyChars) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'body_too_long',
        detail: `${body.length} characters; the limit is ${args.maxBodyChars}.`,
      });
      continue;
    }
    const leftover = unresolvedPlaceholders(body);
    if (leftover.length > 0) {
      skipped.push({
        phone: r.phone,
        favoriteId,
        reason: 'unresolved_placeholder',
        detail: `${leftover.join(' ')} didn't fill in for this contact.`,
      });
      continue;
    }

    seen.add(key);
    seenFavorites.add(owned.get(key)!);
    accepted.push({
      // Attribute to the owning favorite rather than trusting the client's id.
      favoriteId: owned.get(key)!,
      phone: toE164(r.phone),
      body,
    });
  }

  return { accepted, skipped };
}

export interface CampaignCounts {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  canceled: number;
}

export type CampaignStatus = 'sending' | 'done' | 'canceled' | 'empty';

/**
 * Derive a campaign's status from its recipient rows.
 *
 * DERIVED, not stored, and deliberately so. The stored SmsCampaign.status
 * column was written once at enqueue and never updated — the worker drains
 * ScheduledMessage rows and has no reason to know about campaigns, so a
 * finished send still reported "queued" forever. The options were to make the
 * worker scan every open campaign each 30s tick, or to compute this from rows
 * we're already fetching. The second can't go stale.
 *
 * The column is still written on create/cancel as an audit breadcrumb, but the
 * API returns this instead. Don't reintroduce a code path that trusts it.
 */
export function deriveCampaignStatus(counts: CampaignCounts): CampaignStatus {
  if (counts.total === 0) return 'empty';
  if (counts.pending > 0) return 'sending';
  // Every row canceled = the user pulled the whole thing before it went out.
  // A partial cancel still counts as done: some texts were delivered, and
  // calling that "canceled" would misrepresent what the recipients received.
  if (counts.canceled === counts.total) return 'canceled';
  return 'done';
}

/** True when the request is too large to accept at all. */
export function isOverRecipientLimit(
  requestedCount: number,
  maxRecipients = MAX_CAMPAIGN_RECIPIENTS,
): boolean {
  return requestedCount > maxRecipients;
}
