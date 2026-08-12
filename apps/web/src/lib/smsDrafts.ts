// Per-thread compose drafts.
//
// WHY THIS EXISTS: the compose box is local state inside ThreadDetail, so
// anything that unmounts it threw the user's typing away — and the two things
// that unmount it are the two things that happen most: an inbound call
// (Accept navigates to /in-call) and switching tabs to look something up
// mid-sentence. Recruiters compose long, considered messages; retyping one
// because a call came in is the kind of small loss that erodes trust in the
// whole app.
//
// DEVICE-LOCAL ON PURPOSE. A draft belongs to the machine you were typing on,
// not to your account. Syncing it server-side would mean resolving conflicts
// between two devices editing the same thread, which is real work in service
// of a case that barely occurs (nobody starts a text on desktop and finishes
// it in a browser). Same reasoning as quick replies — see userPrefs.ts.
//
// PRIVACY: drafts routinely contain candidate names, pay rates, and phone
// numbers, and localStorage is plaintext on disk. Two mitigations: entries
// expire after MAX_AGE_DAYS, and clearAllDrafts() runs on logout so a shared
// machine can't leak one user's half-written message to the next.

const KEY = 'ace_sms_drafts';

/** Drop drafts older than this. Long enough to survive a weekend, short
 *  enough that abandoned candidate details don't sit on disk indefinitely. */
const MAX_AGE_DAYS = 14;

/** Ceiling on retained threads, newest-first. Guards the localStorage quota
 *  against a user who opens hundreds of threads without ever sending. */
const MAX_THREADS = 200;

interface DraftEntry {
  body: string;
  /** Epoch ms. Drives both expiry and the newest-first eviction order. */
  updatedAt: number;
}

type DraftMap = Record<string, DraftEntry>;

function readAll(): DraftMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const out: DraftMap = {};
    for (const [threadKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const { body, updatedAt } = value as Partial<DraftEntry>;
      if (typeof body !== 'string' || body === '') continue;
      if (typeof updatedAt !== 'number' || updatedAt < cutoff) continue;
      out[threadKey] = { body, updatedAt };
    }
    return out;
  } catch {
    // Corrupt JSON or a browser with storage disabled. A lost draft is a
    // papercut; a compose box that throws on mount is a broken app.
    return {};
  }
}

function writeAll(map: DraftMap): void {
  try {
    let entries = Object.entries(map);
    if (entries.length > MAX_THREADS) {
      entries = entries
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, MAX_THREADS);
    }
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota exceeded (a pasted document) or private mode. Deliberately silent:
    // the in-memory compose state is unaffected, so the user keeps typing and
    // only loses the cross-navigation restore.
  }
}

/** The saved draft for a thread, or '' if there isn't one. Safe to call as a
 *  useState initializer — never throws. */
export function getDraft(threadKey: string): string {
  if (!threadKey) return '';
  return readAll()[threadKey]?.body ?? '';
}

/**
 * Persist (or, for empty/whitespace-only text, remove) a thread's draft.
 *
 * The body is stored at whatever length the user typed, deliberately
 * un-truncated even past MAX_SMS_BODY_CHARS. Send is already disabled with an
 * explanation above the limit; silently shortening what we hand back would
 * destroy the tail of a paste — the same trap the compose textarea avoids by
 * refusing a maxLength attribute.
 */
export function saveDraft(threadKey: string, body: string): void {
  if (!threadKey) return;
  const map = readAll();
  if (body.trim() === '') {
    if (!(threadKey in map)) return; // nothing stored — skip the write
    delete map[threadKey];
  } else {
    map[threadKey] = { body, updatedAt: Date.now() };
  }
  writeAll(map);
}

/** Discard a thread's draft. Call once the text has gone somewhere real —
 *  sent, or handed off to a scheduled send. */
export function clearDraft(threadKey: string): void {
  saveDraft(threadKey, '');
}

/** Wipe every draft. Runs on logout so a shared machine doesn't hand one
 *  user's unsent message to the next, mirroring clearFavoritesCache(). */
export function clearAllDrafts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage disabled — nothing was persisted to begin with */
  }
}
