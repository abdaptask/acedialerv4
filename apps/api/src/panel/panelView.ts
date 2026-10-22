// What the browser extension's side panel is shown. Pure, so the shapes —
// and the absence of anything anyone said — are pinned by tests.
//
// The panel lives beside arbitrary websites with a scoped token (CLAUDE.md
// §2.4), so every row here is who, when and what kind: numbers, saved names,
// directions, outcomes, times. Never a message body, transcript, recording
// URL or media link. Each mapper builds its output field by field rather
// than spreading a row, so a column added to the table later can't ride
// along into the extension.

export const last10 = (n: string | null | undefined): string => (n ?? '').replace(/\D/g, '').slice(-10);

/** Saved names keyed by last-10 digits: the user's own favorites only. */
export type NameBook = Map<string, string>;

export function favoriteName(f: { firstName: string | null; lastName: string | null; label: string | null }): string {
  const first = (f.firstName ?? '').trim();
  const last = (f.lastName ?? '').trim();
  const joined = first && last && first.toLowerCase().includes(last.toLowerCase()) ? first : `${first} ${last}`.trim();
  return joined || (f.label ?? '').trim();
}

export function nameBook(
  favorites: Array<{ phone: string; firstName: string | null; lastName: string | null; label: string | null; numbers: Array<{ phone: string }> }>,
): NameBook {
  const book: NameBook = new Map();
  for (const f of favorites) {
    const name = favoriteName(f);
    if (!name) continue;
    for (const p of [f.phone, ...f.numbers.map((n) => n.phone)]) {
      const k = last10(p);
      // Under 10 digits a suffix match would label short codes as contacts.
      if (k.length === 10 && !book.has(k)) book.set(k, name);
    }
  }
  return book;
}

const nameFor = (book: NameBook, number: string) => book.get(last10(number)) ?? null;

// ── Recents ─────────────────────────────────────────────────────────────

export type RecentOutcome = 'answered' | 'missed' | 'blocked' | 'forwarded' | 'no_answer' | 'failed';

export interface PanelRecent {
  number: string;
  name: string | null;
  direction: 'inbound' | 'outbound';
  outcome: RecentOutcome;
  at: string;
  /** Talk time; null when the call never connected. */
  talkSeconds: number | null;
}

export interface CallRowForPanel {
  direction: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
}

/** One row of the panel's Recents, from a call that has already been through
 *  dedupeCallLegs. Talk time is endedAt − answeredAt (CLAUDE.md §31.3):
 *  durationSeconds includes ringing. */
export function toPanelRecent(c: CallRowForPanel, book: NameBook): PanelRecent {
  const inbound = c.direction === 'inbound';
  const number = inbound ? c.fromNumber : c.toNumber;
  let outcome: RecentOutcome;
  if (c.status === 'blocked') outcome = 'blocked';
  else if (c.status === 'forwarded') outcome = 'forwarded';
  else if (c.answeredAt) outcome = 'answered';
  // Every unanswered inbound reads as missed to the person it rang for,
  // whether the caller hung up, it rang out, or it was declined.
  else if (inbound) outcome = 'missed';
  else outcome = c.status === 'failed' ? 'failed' : 'no_answer';
  const talk =
    c.answeredAt && c.endedAt ? Math.max(0, Math.round((c.endedAt.getTime() - c.answeredAt.getTime()) / 1000)) : null;
  return {
    number,
    name: nameFor(book, number),
    direction: inbound ? 'inbound' : 'outbound',
    outcome,
    at: c.startedAt.toISOString(),
    talkSeconds: talk,
  };
}

// ── Text threads ────────────────────────────────────────────────────────

export interface PanelThread {
  number: string;
  name: string | null;
  /** Who sent the latest message: 'inbound' = they did. */
  lastDirection: 'inbound' | 'outbound';
  lastAt: string;
  unread: number;
  /** The latest outbound text failed to deliver. */
  failed: boolean;
}

const FAILED_TEXT = new Set(['delivery_failed', 'failed', 'undelivered', 'sending_failed']);

export function toPanelThread(
  t: { threadKey: string; direction: string; status: string; createdAt: Date },
  unread: number,
  book: NameBook,
): PanelThread {
  const inbound = t.direction === 'inbound';
  return {
    number: t.threadKey,
    name: nameFor(book, t.threadKey),
    lastDirection: inbound ? 'inbound' : 'outbound',
    lastAt: t.createdAt.toISOString(),
    unread,
    failed: !inbound && FAILED_TEXT.has(t.status),
  };
}

// ── Contacts ────────────────────────────────────────────────────────────

export interface PanelContact {
  name: string;
  numbers: Array<{ label: string | null; number: string }>;
}

export function toPanelContacts(
  favorites: Array<{
    phone: string;
    firstName: string | null;
    lastName: string | null;
    label: string | null;
    numbers: Array<{ phone: string; label: string | null; sortOrder: number }>;
  }>,
): PanelContact[] {
  const out: PanelContact[] = [];
  for (const f of favorites) {
    const numbers = f.numbers.length
      ? [...f.numbers].sort((a, b) => a.sortOrder - b.sortOrder).map((n) => ({ label: n.label, number: n.phone }))
      : [{ label: null, number: f.phone }];
    out.push({ name: favoriteName(f) || f.phone, numbers });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
