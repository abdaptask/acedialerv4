// v0.10.72 — User-friendly explanations for Telnyx SMS error codes.
//
// When a message fails (either at send time or later via a delivery_failed
// webhook), Telnyx returns a numeric error code in the `errors` payload.
// Users see codes like "30007" or "40002" with no context. This module
// maps the common ones to plain-English explanations: what happened, why
// it might have happened, what to do about it.
//
// The blurbs are intentionally short — one or two sentences — so they fit
// inline next to a failed-message bubble without overwhelming the UI.
//
// Coverage:
//   * 30xxx range — Carrier-level delivery errors (the common ones)
//   * 40xxx range — delivery outcomes on message.finalized (see textReasons.ts)
//   * Generic "unknown" fallback that still gives the user something useful
//     ("the carrier rejected this message") instead of a bare code.
//
// ── Sibling: apps/api/src/lib/telnyxErrorClass.ts ──────────────────────
// This file is the PRESENTATION half — the prose a recruiter reads next to a
// failed bubble. The API carries a narrow CLASSIFICATION half that maps the
// same codes to permanent / rate_limited / transient, because the
// scheduled-message worker has to decide whether to retry and can't import
// across apps (CLAUDE.md §1.4). Only the code list and the `retryable` call
// are duplicated there; none of the `detail` prose below is, so the two files
// can't drift into telling the user different things.
//
// If you add a code to BLURBS, add it to the classification table too. An
// unclassified code defaults to `transient`, meaning the worker spends all
// five attempts on it before giving up.
//
// Reference: https://developers.telnyx.com/docs/messaging/error-codes

export interface TelnyxErrorBlurb {
  /** Short label suitable for an inline pill / icon tooltip. */
  short: string;
  /** Longer explanation for click-to-expand UI. */
  detail: string;
  /** Whether the user can usefully retry. False for "wrong number" / opt-out;
   *  true for transient issues like rate-limit. */
  retryable: boolean;
}

const BLURBS: Record<string, TelnyxErrorBlurb> = {
  // 30001 — Queue overflow / too many messages
  '30001': {
    short: 'Too many messages too fast',
    detail: 'The carrier is rate-limiting your number. Wait a few minutes and try again. If this keeps happening, contact admin to check your DID\'s daily/hourly throughput cap.',
    retryable: true,
  },
  // 30002 — Account suspended
  '30002': {
    short: 'Account suspended on Telnyx',
    detail: 'Telnyx has suspended messaging on your sending number. This usually means a billing or compliance issue. Contact admin.',
    retryable: false,
  },
  // 30003 — Unreachable destination handset
  '30003': {
    short: 'Phone is off or out of coverage',
    detail: 'The recipient\'s phone is currently unreachable — turned off, out of coverage, or has a dead battery. Try again later.',
    retryable: true,
  },
  // 30004 — Message blocked
  '30004': {
    short: 'Recipient blocked you',
    detail: 'The recipient has texted STOP at some point or otherwise opted out. Their carrier is blocking all SMS from your DID to their number until they send START.',
    retryable: false,
  },
  // 30005 — Unknown destination handset
  '30005': {
    short: 'Number doesn\'t exist',
    detail: 'The number you sent to isn\'t in service — disconnected, never existed, or ported out and reassigned. Double-check the digits.',
    retryable: false,
  },
  // 30006 — Landline or unreachable carrier
  '30006': {
    short: 'Landline — can\'t receive SMS',
    detail: 'This number is a landline (not a mobile phone) and can\'t receive text messages. Call them instead, or ask for their cell.',
    retryable: false,
  },
  // 30007 — Carrier violation (10DLC / spam filter)
  '30007': {
    short: 'Carrier filtered as spam',
    detail: 'The destination carrier (typically T-Mobile, Verizon, or AT&T) blocked this message — usually because your DID isn\'t registered for 10DLC application-to-person messaging, or the message content triggered a spam filter. Contact admin; this needs 10DLC brand/campaign registration to fix.',
    retryable: false,
  },
  // 30008 — Unknown error
  '30008': {
    short: 'Carrier rejected — reason unknown',
    detail: 'The destination carrier rejected the message but didn\'t say why. Often transient. Try again in a few minutes; if it keeps happening, the recipient\'s carrier may be filtering your DID.',
    retryable: true,
  },
  // 30010 — Missing message body
  '30010': {
    short: 'Empty message',
    detail: 'The message body was empty. Telnyx requires text content (or an MMS attachment) — can\'t send a fully blank SMS.',
    retryable: false,
  },
  // 30011 — Invalid number
  '30011': {
    short: 'Bad recipient number format',
    detail: 'The recipient number isn\'t in a valid format. Make sure it has the country code (e.g. +1 for US, +91 for India).',
    retryable: false,
  },
  // 30022 — Toll-free violation
  '30022': {
    short: 'Toll-free number not verified',
    detail: 'The sending DID is a toll-free number that hasn\'t completed Telnyx\'s toll-free verification. Contact admin to register it.',
    retryable: false,
  },
  // 40xxx — delivery outcomes, as Telnyx actually reports them on
  // message.finalized (e.g. 40001 "Not routable", 40012 "Invalid messaging
  // destination number"). Earlier entries here guessed these were API
  // validation errors, which gave 40002/40005/40010 the wrong meaning; this
  // table now matches apps/api/src/reports/textReasons.ts so a failed bubble
  // and the Reports page explain the same failure the same way.
  '40001': {
    short: 'Can’t receive texts',
    detail: 'This number can’t receive texts — usually a landline or a number that isn’t in service. Call them instead, or ask for a mobile number.',
    retryable: false,
  },
  '40002': {
    short: 'Blocked as possible spam',
    detail: 'The recipient’s carrier temporarily blocked this as possible spam. Wait a while before texting again, or call instead.',
    retryable: true,
  },
  '40003': {
    short: 'Blocked as spam',
    detail: 'The recipient’s carrier blocked this message as spam. Rewording won’t reliably help — call instead, and tell your admin if it keeps happening.',
    retryable: false,
  },
  '40004': {
    short: 'Rejected by their carrier',
    detail: 'The recipient’s carrier refused the message without saying why. Try again later, or call instead.',
    retryable: true,
  },
  '40005': {
    short: 'Phone off or out of coverage',
    detail: 'The message expired before their phone accepted it — the phone was off or out of coverage. Try again later.',
    retryable: true,
  },
  '40006': {
    short: 'Their carrier was unavailable',
    detail: 'The recipient’s carrier was temporarily unavailable. Try again in a few minutes.',
    retryable: true,
  },
  '40008': {
    short: 'Couldn’t be delivered',
    detail: 'The carrier couldn’t deliver this message. Check the number, then try again or call instead.',
    retryable: true,
  },
  '40009': {
    short: 'Message content rejected',
    detail: 'The carrier rejected the content of this message. Links and some wording are filtered — try removing any link and sending again.',
    retryable: false,
  },
  '40010': {
    short: 'Our number isn’t registered for texting',
    detail: 'Your sending number isn’t registered for business texting (10DLC), so carriers won’t deliver from it. Contact your admin.',
    retryable: false,
  },
  '40011': {
    short: 'Too many texts too fast',
    detail: 'The carrier slowed down texts from your number. Wait a few minutes and try again.',
    retryable: true,
  },
  '40012': {
    short: 'Not a valid phone number',
    detail: 'The carrier says this isn’t a valid number to text. Double-check the digits and the country code.',
    retryable: false,
  },
  '40013': {
    short: 'Our number can’t send texts',
    detail: 'Your sending number isn’t able to send texts. Contact your admin.',
    retryable: false,
  },
  '40300': {
    short: 'They opted out (STOP)',
    detail: 'This person texted STOP, so carriers block texts from your number to them until they text START. Call them instead.',
    retryable: false,
  },
};

/**
 * Convert a Telnyx error payload to a friendly blurb.
 *
 * Accepts:
 *  - A plain error code string ("30007")
 *  - A code number (30007)
 *  - The full Telnyx error envelope ({ errors: [{ code, title, detail }] })
 *  - The status string itself ("delivery_failed", "failed") with no code
 *
 * Returns a blurb regardless — we always say something useful, even if it's
 * generic. Never returns null; null-handling at the call site is unnecessary.
 */
export function telnyxErrorBlurb(input: unknown): TelnyxErrorBlurb {
  // Pull out the first error code we can find.
  let code: string | null = null;

  if (typeof input === 'string') {
    // Either a bare code or a status string. Telnyx codes are all-digit.
    if (/^\d+$/.test(input)) code = input;
  } else if (typeof input === 'number') {
    code = String(input);
  } else if (Array.isArray(input)) {
    // The shape actually stored on a Message row and returned by the send
    // route: the bare `errors` array, not the envelope around it. Missing this
    // case made every failed bubble say "Send failed" with no reason.
    const first = input[0] as Record<string, unknown> | undefined;
    if (first?.code !== undefined) code = String(first.code);
  } else if (input && typeof input === 'object') {
    // Telnyx error envelope shapes:
    //   { errors: [{ code: '30007', title: '...', detail: '...' }] }
    //   { code: '30007', ... }
    //   { detail: 'Foo', code: '40002' }
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = obj.errors[0] as Record<string, unknown>;
      if (first?.code !== undefined) code = String(first.code);
    } else if (obj.code !== undefined) {
      code = String(obj.code);
    }
  }

  if (code && BLURBS[code]) return BLURBS[code];

  // Generic fallbacks — distinguish "we know nothing" from "we know it's a
  // delivery problem" from "we know it's a send problem".
  if (typeof input === 'string') {
    if (input === 'delivery_failed') {
      return {
        short: 'Carrier didn\'t deliver',
        detail: 'Telnyx accepted the message but the recipient\'s carrier refused to deliver it. Most common reasons: the number is wrong, the recipient opted out, or your DID needs 10DLC registration. Check the recipient number is valid and try again.',
        retryable: true,
      };
    }
    if (input === 'failed') {
      return {
        short: 'Couldn\'t send',
        detail: 'Telnyx rejected the message before sending. Check that the recipient number has a country code and try again. If this keeps happening, contact admin.',
        retryable: true,
      };
    }
  }

  return {
    short: code ? `Error ${code}` : 'Send failed',
    detail: code
      ? `Telnyx returned error code ${code} — we don\'t have a friendly explanation for that specific code yet. The carrier rejected the message. Try again in a few minutes, and if it keeps happening, tell admin to look up code ${code} in Telnyx\'s error reference.`
      : 'Something went wrong sending this message. Try again, and if it keeps happening, contact admin.',
    retryable: true,
  };
}
