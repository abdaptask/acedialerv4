// "Who haven't I been in touch with?" — the reminder half of monthly outreach.
//
// Pure functions only, no Prisma, so the matching rules below are testable.
// The route in favorites.routes.ts does the queries and calls in here.
//
// ── What counts as "in touch" ──────────────────────────────────────────
// Three decisions shape every number this produces, and all three are easy to
// get subtly wrong:
//
//   1. CALLS COUNT. This is a dialer; excluding voice would tell a recruiter
//      they haven't contacted someone they spoke to yesterday, which makes the
//      whole feature untrustworthy on first use. Only calls that actually
//      connected count — `Call.answeredAt` non-null. A missed outbound call is
//      an attempt, not a contact.
//
//   2. A FAILED SMS IS NOT A CONTACT. Message.status='failed' means the
//      carrier never delivered it, so counting it would mark someone as
//      "recently contacted" precisely when they were not — the same class of
//      bug as a scheduled send failing silently. Excluded at the query.
//
//   3. INBOUND RESETS THE CLOCK TOO. If a candidate texted you on Tuesday you
//      are in touch, even though you didn't initiate. `due` is therefore
//      computed from the most recent contact in EITHER direction, while
//      lastOutboundAt / lastInboundAt stay separate in the response so the UI
//      can say "they messaged you" vs "you texted them".
//
// Matching is on the last 10 digits, the convention used everywhere else in
// this codebase (webhook block lookups, Recents dedupe) because carriers vary
// formatting. Every number on a favorite is matched, not just the primary — a
// contact reached on their Work line is still a contact.

/** Last 10 digits, or '' when the input can't be a US-dialable number. */
export function last10(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** One "we were in touch at" data point, already reduced to a match key. */
export interface ContactEvent {
  /** The other party's number, any format. */
  phone: string;
  at: Date;
}

/**
 * Collapse contact events to the latest timestamp per last-10 key.
 *
 * Takes the max rather than assuming sorted input, so a caller can concatenate
 * results from several queries (SMS + calls) in any order.
 */
export function indexLatestByKey(events: ContactEvent[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const e of events) {
    const key = last10(e.phone);
    if (!key || !e.at) continue;
    const existing = out.get(key);
    if (!existing || e.at.getTime() > existing.getTime()) out.set(key, e.at);
  }
  return out;
}

export interface FavoriteForTouchBase {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  label: string | null;
  numbers: Array<{ phone: string; label: string; isPrimary: boolean }>;
}

export interface TouchBaseRow {
  favoriteId: number;
  firstName: string | null;
  lastName: string | null;
  label: string | null;
  /** The number a bulk/1:1 send would use. */
  primaryPhone: string;
  /** Every number on the favorite, so the UI can offer a different one. */
  phones: Array<{ phone: string; label: string; isPrimary: boolean }>;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  /** Most recent of the two — what `due` is computed from. */
  lastContactAt: Date | null;
  /** Whole days since lastContactAt. Null when never contacted. */
  daysSinceContact: number | null;
  /** True when never contacted, or not contacted within `days`. */
  due: boolean;
  /** Distinguishes "never" from "a long time ago" for UI copy. */
  neverContacted: boolean;
}

/**
 * Pick the number a send should target.
 *
 * Prefers the explicit primary, falls back to the first number, then to the
 * legacy `Favorite.phone` mirror. Returning exactly ONE number per favorite is
 * the point: a favorite with Cell + Home + Work must never produce three
 * recipients, which is the failure mode of any bulk feature built on this.
 */
export function pickPrimaryPhone(fav: FavoriteForTouchBase): string {
  return fav.numbers.find((n) => n.isPrimary)?.phone ?? fav.numbers[0]?.phone ?? fav.phone;
}

const DAY_MS = 86_400_000;

/**
 * Build the touch-base list.
 *
 * `now` is injected rather than read from the clock so the tests aren't
 * time-dependent.
 */
export function computeTouchBase(args: {
  favorites: FavoriteForTouchBase[];
  outboundByKey: Map<string, Date>;
  inboundByKey: Map<string, Date>;
  days: number;
  now: Date;
}): TouchBaseRow[] {
  const { favorites, outboundByKey, inboundByKey, days, now } = args;
  const cutoffMs = now.getTime() - days * DAY_MS;

  const rows = favorites.map((fav): TouchBaseRow => {
    // Check every number on the favorite, not just the primary.
    const keys = [fav.phone, ...fav.numbers.map((n) => n.phone)]
      .map(last10)
      .filter((k) => k !== '');
    const uniqueKeys = [...new Set(keys)];

    const latestOf = (index: Map<string, Date>): Date | null => {
      let best: Date | null = null;
      for (const k of uniqueKeys) {
        const at = index.get(k);
        if (at && (!best || at.getTime() > best.getTime())) best = at;
      }
      return best;
    };

    const lastOutboundAt = latestOf(outboundByKey);
    const lastInboundAt = latestOf(inboundByKey);
    const lastContactAt =
      lastOutboundAt && lastInboundAt
        ? new Date(Math.max(lastOutboundAt.getTime(), lastInboundAt.getTime()))
        : (lastOutboundAt ?? lastInboundAt);

    return {
      favoriteId: fav.id,
      firstName: fav.firstName,
      lastName: fav.lastName,
      label: fav.label,
      primaryPhone: pickPrimaryPhone(fav),
      phones: fav.numbers.map((n) => ({ phone: n.phone, label: n.label, isPrimary: n.isPrimary })),
      lastOutboundAt,
      lastInboundAt,
      lastContactAt,
      daysSinceContact:
        lastContactAt === null
          ? null
          : Math.floor((now.getTime() - lastContactAt.getTime()) / DAY_MS),
      due: lastContactAt === null || lastContactAt.getTime() < cutoffMs,
      neverContacted: lastContactAt === null,
    };
  });

  // Most-overdue first, because the list exists to be worked top-down:
  // never-contacted, then longest-since, then everyone who's up to date.
  return rows.sort((a, b) => {
    if (a.due !== b.due) return a.due ? -1 : 1;
    if (a.neverContacted !== b.neverContacted) return a.neverContacted ? -1 : 1;
    const at = a.lastContactAt?.getTime() ?? 0;
    const bt = b.lastContactAt?.getTime() ?? 0;
    return at - bt;
  });
}

/** Clamp a caller-supplied window to something sane. */
export function parseDays(raw: unknown, fallback = 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 365);
}
