// What the browser extension's side panel is shown. Pure, so the shapes —
// and the absence of anything anyone said — are pinned by tests.
//
// The panel lives beside arbitrary websites with a scoped token (CLAUDE.md
// §2.4), so every row here is who, when and what kind: numbers, saved names,
// directions, outcomes, times. Never a message body, transcript, recording
// URL or media link. Each mapper builds its output field by field rather
// than spreading a row, so a column added to the table later can't ride
// along into the extension.
//
// The panel must read the same as the dialer. Labels, red rows and names
// below are a deliberate copy of apps/web/src/pages/Recents.tsx
// (effectiveStatus / statusLabel / isDangerStatus) and lib/userPrefs.ts
// (getFavoriteName). There is no shared package between web and api
// (CLAUDE.md §1.4), so a change to either side needs the other in the same
// commit; panelView.test.ts pins the table.

export const last10 = (n: string | null | undefined): string => (n ?? '').replace(/\D/g, '').slice(-10);

// ── Names: saved favorite, then a JobDiva name the dialer already looked up ──

type FavoriteRow = { phone: string; firstName: string | null; lastName: string | null; label: string | null };

/** getFavoriteName's rule: first + last, else the legacy label, else nothing. */
export function favoriteName(f: FavoriteRow): string | null {
  const full = [f.firstName, f.lastName].filter(Boolean).join(' ').trim();
  return full || f.label || null;
}

/** Keyed by the favorite's own number (last 10), exactly as the dialer's
 *  favorites cache is: rows in GET /favorites order, a later row with the
 *  same key replacing an earlier one. */
export type NameBook = Map<string, string | null>;

export function nameBook(favorites: FavoriteRow[]): NameBook {
  const book: NameBook = new Map();
  for (const f of favorites) {
    const k = last10(f.phone);
    if (k) book.set(k, favoriteName(f));
  }
  return book;
}

export type JobDivaNames = (phone: string) => string | null;

function nameFor(book: NameBook, jobDiva: JobDivaNames, number: string): string | null {
  return book.get(last10(number)) ?? jobDiva(number);
}

// ── Recents ─────────────────────────────────────────────────────────────

export interface PanelRecent {
  number: string;
  name: string | null;
  direction: 'inbound' | 'outbound';
  /** The dialer's wording: Missed, Declined, Busy, Caller canceled, Blocked,
   *  Forwarded, Failed, Inbound, Outgoing. */
  label: string;
  /** Shown in red, as the dialer shows it. */
  red: boolean;
  at: string;
  /** What the dialer shows after the label (durationSeconds, 0 = nothing). */
  durationSeconds: number;
}

export interface CallRowForPanel {
  direction: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  hangupCause: string | null;
  startedAt: Date;
  durationSeconds: number | null;
}

/** Recents.tsx effectiveStatus: old rows recorded a caller hanging up while it
 *  rang as missed + originator_cancel. */
function effectiveStatus(c: CallRowForPanel): string {
  if (c.direction === 'inbound' && c.status === 'missed' && (c.hangupCause ?? '').toLowerCase() === 'originator_cancel') {
    return 'caller_canceled';
  }
  return c.status;
}

/** Recents.tsx statusLabel. */
export function callLabel(c: CallRowForPanel): string {
  const s = effectiveStatus(c);
  if (s === 'blocked') return 'Blocked';
  if (c.direction === 'inbound') {
    if (s === 'rejected') return 'Declined';
    if (s === 'busy') return 'Busy';
    if (s === 'caller_canceled') return 'Caller canceled';
    if (s === 'forwarded') return 'Forwarded';
    if (s === 'missed' || s === 'no_answer') return 'Missed';
    if (s === 'failed') return 'Failed';
    return 'Inbound';
  }
  return 'Outgoing';
}

/** Recents.tsx isDangerStatus, collapsed: blocked in either direction, and on
 *  inbound anything but answered or forwarded. */
export function callIsRed(c: CallRowForPanel): boolean {
  const s = effectiveStatus(c);
  if (s === 'blocked') return true;
  if (c.direction !== 'inbound') return false;
  return ['missed', 'no_answer', 'failed', 'caller_canceled', 'busy', 'rejected'].includes(s);
}

/** One row of the panel's Recents, from a row of loadRecents() — the same
 *  rows, in the same order, as the dialer's Recents. */
export function toPanelRecent(c: CallRowForPanel, book: NameBook, jobDiva: JobDivaNames): PanelRecent {
  const inbound = c.direction === 'inbound';
  const number = inbound ? c.fromNumber : c.toNumber;
  return {
    number,
    name: nameFor(book, jobDiva, number),
    direction: inbound ? 'inbound' : 'outbound',
    label: callLabel(c),
    red: callIsRed(c),
    at: c.startedAt.toISOString(),
    durationSeconds: c.durationSeconds ?? 0,
  };
}

// ── Text threads ────────────────────────────────────────────────────────

export interface PanelThread {
  number: string;
  name: string | null;
  /** Who sent the latest message: 'inbound' = they did. */
  lastDirection: 'inbound' | 'outbound';
  lastAt: string;
  /** Inbound texts not yet opened anywhere (Message.readAt null). */
  unread: number;
  /** The latest outbound text failed to deliver. */
  failed: boolean;
}

const FAILED_TEXT = new Set(['delivery_failed', 'failed', 'undelivered', 'sending_failed']);

export function toPanelThread(
  t: { threadKey: string; direction: string; status: string; createdAt: Date },
  unread: number,
  book: NameBook,
  jobDiva: JobDivaNames,
): PanelThread {
  const inbound = t.direction === 'inbound';
  return {
    number: t.threadKey,
    name: nameFor(book, jobDiva, t.threadKey),
    lastDirection: inbound ? 'inbound' : 'outbound',
    lastAt: t.createdAt.toISOString(),
    // The dialer marks a thread unread only while their message is the last
    // one; a reply means it was read.
    unread: inbound ? unread : 0,
    failed: !inbound && FAILED_TEXT.has(t.status),
  };
}

// ── Favorites ───────────────────────────────────────────────────────────

export interface PanelContact {
  name: string;
  numbers: Array<{ label: string | null; number: string }>;
}

/** The dialer's Favorites page: newest added first (input order), every
 *  number in the favorite's own order. */
export function toPanelContacts(
  favorites: Array<FavoriteRow & { numbers: Array<{ phone: string; label: string | null }> }>,
): PanelContact[] {
  return favorites.map((f) => ({
    name: favoriteName(f) ?? f.phone,
    numbers: f.numbers.length ? f.numbers.map((n) => ({ label: n.label, number: n.phone })) : [{ label: null, number: f.phone }],
  }));
}

// ── One number's history (the wide panel's detail pane) ─────────────────

export interface PanelHistoryEvent {
  kind: 'call' | 'text' | 'voicemail';
  direction: 'inbound' | 'outbound';
  /** Calls use the dialer's Recents wording; texts and voicemails a fixed one. */
  label: string;
  /** How it went: a call's length, a text's delivery, a voicemail's length.
   *  Never what was said. */
  detail: string;
  red: boolean;
  at: string;
}

export interface PanelHistory {
  number: string;
  name: string | null;
  days: number;
  items: PanelHistoryEvent[];
}

const HISTORY_CAP = 50;

/** m:ss, as the panel shows a call length (Recents.tsx formatDuration). */
const mss = (sec: number) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');

/** Every call, text and voicemail with one number, newest first. Calls arrive
 *  already deduped (dedupeCallLegs), as in Recents. */
export function toPanelHistory(
  number: string,
  days: number,
  src: {
    calls: CallRowForPanel[];
    texts: Array<{ direction: string; status: string; createdAt: Date }>;
    voicemails: Array<{ receivedAt: Date; durationSeconds: number }>;
  },
  book: NameBook,
  jobDiva: JobDivaNames,
): PanelHistory {
  const items: PanelHistoryEvent[] = [
    ...src.calls.map((c) => ({
      kind: 'call' as const,
      direction: c.direction === 'inbound' ? ('inbound' as const) : ('outbound' as const),
      label: callLabel(c),
      detail: mss(c.durationSeconds ?? 0),
      red: callIsRed(c),
      at: c.startedAt.toISOString(),
    })),
    ...src.texts.map((t) => {
      const inbound = t.direction === 'inbound';
      const failed = !inbound && FAILED_TEXT.has(t.status);
      return {
        kind: 'text' as const,
        direction: inbound ? ('inbound' as const) : ('outbound' as const),
        label: inbound ? 'They texted' : 'You texted',
        detail: inbound ? '' : failed ? 'Didn’t deliver' : t.status === 'delivered' ? 'Delivered' : 'Sent',
        red: failed,
        at: t.createdAt.toISOString(),
      };
    }),
    ...src.voicemails.map((v) => ({
      kind: 'voicemail' as const,
      direction: 'inbound' as const,
      label: 'Voicemail',
      detail: mss(v.durationSeconds),
      red: false,
      at: v.receivedAt.toISOString(),
    })),
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { number, name: nameFor(book, jobDiva, number), days, items: items.slice(0, HISTORY_CAP) };
}
