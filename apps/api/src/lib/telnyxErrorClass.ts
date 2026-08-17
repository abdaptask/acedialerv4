// Telnyx messaging error CLASSIFICATION for the scheduled-message worker.
//
// ── Why this exists next to apps/web/src/lib/telnyxErrorBlurb.ts ───────
// That module is the PRESENTATION half: it turns a Telnyx error code into a
// paragraph a recruiter can read next to a failed bubble. This module is the
// DECISION half: given the same error, should the worker try again?
//
// They are deliberately split rather than shared. CLAUDE.md §1.4 forbids
// importing TS across apps outside packages/db, and the deepgram.ts copy set
// the precedent for duplicating "the lines that matter" instead of coupling
// deploys. But note what is NOT duplicated here: none of the `detail` prose.
// Copying fifteen paragraphs would create fifteen chances for the two files
// to drift into saying different things to the user. The web file stays the
// single source of user-facing wording; this file carries only the code →
// permanence mapping plus a short label for the failure notification, which
// is text the web app never renders.
//
// If you add a code to the web BLURBS table, add it here too — an unknown
// code falls back to `transient`, which means the worker will spend all five
// attempts on it. That's the safe default (better to over-try than to drop a
// message someone scheduled), but it's not the RIGHT answer for a code we
// could have classified. The web copy carries the same note.
//
// Reference: https://developers.telnyx.com/docs/messaging/error-codes

/**
 * What the worker should do about a failed send.
 *
 * - `permanent`  — the same request will fail identically forever. Stop now
 *                  and tell the user. (Opted out, disconnected number,
 *                  landline, carrier-filtered, malformed request.)
 * - `rate_limited` — we sent too fast, or Telnyx/the carrier is briefly
 *                  refusing volume. Retry WITHOUT consuming an attempt: the
 *                  message was never rejected on its merits.
 * - `transient`  — might work later (handset off, unexplained carrier
 *                  reject). Retry and consume an attempt.
 */
export type TelnyxErrorKind = 'permanent' | 'rate_limited' | 'transient';

export interface TelnyxErrorClass {
  kind: TelnyxErrorKind;
  /** Short human label, e.g. for the "your scheduled message failed" card. */
  short: string;
  /** The Telnyx code we matched, when we found one. Stored for diagnostics. */
  code: string | null;
}

const CLASSIFICATION: Record<string, { kind: TelnyxErrorKind; short: string }> = {
  // Queue overflow / sending too fast. The one code that is explicitly about
  // volume rather than the recipient, so it must not burn an attempt.
  '30001': { kind: 'rate_limited', short: 'Too many messages too fast' },
  '30002': { kind: 'permanent', short: 'Messaging suspended on Telnyx' },
  // Handset off / out of coverage. Genuinely worth another try later.
  '30003': { kind: 'transient', short: 'Phone is off or out of coverage' },
  '30004': { kind: 'permanent', short: 'Recipient blocked you' },
  '30005': { kind: 'permanent', short: "Number doesn't exist" },
  '30006': { kind: 'permanent', short: "Landline — can't receive SMS" },
  '30007': { kind: 'permanent', short: 'Carrier filtered as spam' },
  // Carrier rejected without saying why. The web copy calls this "often
  // transient" and it's the one ambiguous entry — we keep retrying because a
  // false permanent silently drops a legitimate message.
  '30008': { kind: 'transient', short: 'Carrier rejected — reason unknown' },
  '30010': { kind: 'permanent', short: 'Empty message' },
  '30011': { kind: 'permanent', short: 'Bad recipient number format' },
  '30022': { kind: 'permanent', short: 'Toll-free number not verified' },
  '40002': { kind: 'permanent', short: 'Invalid recipient number' },
  '40005': { kind: 'permanent', short: 'No sending number on your account' },
  '40010': { kind: 'permanent', short: 'SMS routing not set up' },
};

/**
 * Pull the first Telnyx error code out of whatever shape we were handed.
 *
 * Accepts, in the shapes this codebase actually produces:
 *  - a bare code, as string or number ("30007" / 30007)
 *  - the Telnyx envelope: { errors: [{ code, title, detail }] }
 *  - the envelope's `errors` array on its own — which is what
 *    sendMessageImmediate puts in SendMessageErr.detail (`detail: json.errors`),
 *    and the case the web parser silently misses, falling through to its
 *    generic blurb. Handled first here for exactly that reason.
 */
function extractCode(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') return String(input);
  if (typeof input === 'string') return /^\d+$/.test(input) ? input : null;

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        const c = (entry as Record<string, unknown>).code;
        if (c !== undefined && c !== null) return String(c);
      }
    }
    return null;
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.errors)) return extractCode(obj.errors);
    if (obj.code !== undefined && obj.code !== null) return String(obj.code);
  }

  return null;
}

/**
 * Classify a Telnyx failure. Never throws, always returns a decision.
 *
 * An unrecognised or absent code is `transient` on purpose: the worker will
 * use its attempt budget and then fail loudly, which is recoverable. Guessing
 * `permanent` on an unknown code would drop a message the user scheduled and
 * tell them it was undeliverable, which is not.
 */
export function classifyTelnyxError(input: unknown): TelnyxErrorClass {
  const code = extractCode(input);
  if (code && CLASSIFICATION[code]) {
    return { ...CLASSIFICATION[code], code };
  }
  return {
    kind: 'transient',
    short: code ? `Telnyx error ${code}` : 'Send failed',
    code,
  };
}
