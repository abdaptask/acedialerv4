// Shared phone-number formatting helper.
// Uses libphonenumber-js so we render +44, +91, +52, etc. correctly instead
// of the homegrown US-only formatter that each page used to inline.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/** Default region for numbers without a country code. Tweak per deployment. */
const DEFAULT_COUNTRY: CountryCode = 'US';

/**
 * Format a phone for display.
 *   US 10-digit "9737270611"     → "(973) 727-0611"
 *   US E.164 "+19737270611"      → "(973) 727-0611"
 *   UK "+442012345678"           → "020 1234 5678"
 *   India "+919876543210"        → "098765 43210"
 *   SIP URI "sip:bob@x.com"      → "sip:bob@x.com" (untouched)
 * Falls back to the input string if parsing fails.
 */
export function formatPhone(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  // Untouched: SIP URIs, anything containing alpha chars before parsing.
  if (/^sip:/i.test(trimmed)) return trimmed;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_COUNTRY);
    if (!parsed) return trimmed;
    if (parsed.country === DEFAULT_COUNTRY) {
      // National format for the user's home country looks more natural
      // ("(973) 727-0611" rather than "+1 973-727-0611").
      return parsed.formatNational();
    }
    return parsed.formatInternational();
  } catch {
    return trimmed;
  }
}

/** Normalize to +E.164. Used before sending to the server. */
export function toE164(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (/^sip:/i.test(trimmed)) return trimmed;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_COUNTRY);
    if (parsed?.isValid()) return parsed.number; // already +E.164
  } catch {
    // fall through
  }
  // Fallback that matches our pre-existing logic for US 10/11-digit input.
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  return `+${cleaned}`;
}

/** Last 10 digits — used for cross-table matching tolerant of formatting. */
export function last10Digits(raw: string | undefined | null): string {
  return String(raw ?? '').replace(/[^\d]/g, '').slice(-10);
}

// ── v0.10.218 — Click-to-Dial: parsing a phone number out of arbitrary text ──
//
// Every click-to-dial capture path (the tel:/callto: protocol handler, the
// browser extension's context menu, and the clipboard hotkey) hands us a
// string a human highlighted somewhere. That string is *not* a phone number —
// it's whatever happened to be under the cursor: a signature block, a table
// cell with a trailing tab, a sentence containing a number, a Word paragraph
// with non-breaking spaces and en-dashes.
//
// This is deliberately STRICTER than `toE164()`. toE164 exists to coerce
// something we already believe is a number into E.164 for Telnyx. This
// function's job is the opposite: decide whether the text is a phone number
// at all, and refuse when it isn't, so we can show the user a real error
// instead of opening the dialer with garbage in the field.

/** Upper bound on input we'll even look at. A user who selects a whole page
 *  shouldn't hand us a megabyte to regex over. */
const MAX_SELECTION_CHARS = 200;

export interface ParsedSelection {
  /** E.164, ready for the dialer field. */
  e164: string;
  /** Digits after the number, e.g. "203" from "x203". Empty when absent. */
  extension: string;
  /**
   * What to actually put in the compose field. When an extension is present
   * this is `e164,,ext` — the post-dial DTMF syntax the dialer already
   * supports (see [[8-call-lifecycle]]), so "555 1234 x203" dials the main
   * line then sends the extension, which is what the user meant.
   */
  dialString: string;
  /** Pretty form for confirmation UI. */
  display: string;
}

export type SelectionParseError =
  | 'empty'
  | 'too_long'
  | 'no_digits'
  | 'too_few_digits'
  | 'too_many_digits'
  | 'invalid';

export type ParseSelectionResult =
  | { ok: true; value: ParsedSelection }
  | { ok: false; error: SelectionParseError; message: string };

/** Unicode punctuation that Word, Outlook, and PDFs love to emit. Normalising
 *  these first is what makes "+1 (732) 555–1234" (en-dash) work at all. */
function normalizeUnicode(raw: string): string {
  return raw
    .replace(/[   ]/g, ' ') // non-breaking / figure / narrow spaces
    .replace(/[‐-―−]/g, '-') // hyphen variants, en/em dash, minus
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[＋]/g, '+'); // fullwidth plus
}

/**
 * Pull a dialable number out of highlighted text.
 *
 * Handles the shapes that actually turn up in a recruiting workflow:
 *   "+1 (732) 555-1234"              → +17325551234
 *   "732.555.1234 x203"              → +17325551234 ext 203
 *   "Call me on 732-555-1234 today"  → +17325551234   (embedded in prose)
 *   "tel:+17325551234;ext=203"       → +17325551234 ext 203
 *   "+91 98765 43210"                → +919876543210  (country code preserved)
 *   "1-800-FLOWERS"                  → error: vanity letters aren't dialable
 *
 * `defaultCountry` only applies to numbers with no country code; an explicit
 * "+" always wins, so we never rewrite someone's international number.
 */
export function parseSelectedNumber(
  raw: string | undefined | null,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): ParseSelectionResult {
  if (!raw) return { ok: false, error: 'empty', message: 'No text was selected.' };

  let text = normalizeUnicode(String(raw)).trim();
  if (!text) return { ok: false, error: 'empty', message: 'No text was selected.' };
  if (text.length > MAX_SELECTION_CHARS) {
    return {
      ok: false,
      error: 'too_long',
      message: 'That selection is too long — highlight just the phone number.',
    };
  }

  // Accept a tel:/callto: URI as input directly, so the protocol handler and
  // the extension can share this one function. RFC 3966 puts parameters after
  // ';' (e.g. tel:+17325551234;ext=203).
  const uri = text.match(/^(?:tel|callto|sip):(.+)$/i);
  if (uri) text = uri[1];

  // Extension, in the forms people actually write. Captured BEFORE digit
  // extraction, otherwise "x203" silently becomes part of the number and you
  // dial a 13-digit nonsense string.
  let extension = '';
  const extMatch = text.match(/(?:;\s*ext=|\b(?:ext|extn|x|#)\s*[.:]?\s*)(\d{1,6})\s*$/i);
  if (extMatch) {
    extension = extMatch[1];
    text = text.slice(0, extMatch.index).trim();
  }

  // Vanity numbers: letters wired INTO the dialable token, e.g. 1-800-FLOWERS
  // or 855-CALL-NOW. libphonenumber will happily strip the letters and hand
  // back a different number, so refuse explicitly rather than dialing
  // something the user never intended.
  //
  // The test has to be narrow. An earlier version rejected anything with two
  // letters after the first digit, which killed the single most common real
  // input — a number sitting in a sentence ("Call me on 732-555-1234 today").
  // The actual signal for vanity is letters joined to digits by a hyphen or
  // dot with no space; prose is always space-separated.
  const dialablePart = text.replace(/^(?:tel|callto|sip):/i, '');
  if (/\d[-.][A-Za-z]{2,}/.test(dialablePart) || /[A-Za-z]{2,}[-.]\d/.test(dialablePart)) {
    return {
      ok: false,
      error: 'invalid',
      message: "That looks like a vanity number — AceDialer can't dial letters.",
    };
  }

  // Extract the longest run that looks like a phone number, so a number
  // embedded in a sentence still works.
  const candidates = dialablePart.match(/\+?[\d][\d\s().\-]{5,}\d/g) ?? [];
  const candidate = candidates.sort((a, b) => digitCount(b) - digitCount(a))[0] ?? dialablePart;

  const digits = candidate.replace(/\D/g, '');
  if (digits.length === 0) {
    return { ok: false, error: 'no_digits', message: "That doesn't contain a phone number." };
  }
  // E.164 allows max 15 digits; below 7 nothing is a real external number.
  if (digits.length < 7) {
    return {
      ok: false,
      error: 'too_few_digits',
      message: 'That number is too short to dial.',
    };
  }
  if (digits.length > 15) {
    return {
      ok: false,
      error: 'too_many_digits',
      message: 'That number is too long to be a phone number.',
    };
  }

  // An explicit "+" means the user gave us a country code — never override it
  // with defaultCountry, or a UK number pasted in a US-defaulted client gets
  // silently rewritten into a wrong US number.
  const hasPlus = candidate.trim().startsWith('+');
  const parsed = hasPlus
    ? parsePhoneNumberFromString(`+${digits}`)
    : parsePhoneNumberFromString(candidate, defaultCountry);

  if (!parsed || !parsed.isValid()) {
    return {
      ok: false,
      error: 'invalid',
      message: "That doesn't look like a valid phone number.",
    };
  }

  const e164 = parsed.number;
  return {
    ok: true,
    value: {
      e164,
      extension,
      // ',,' is a ~2s pause; the dial path already understands this syntax.
      dialString: extension ? `${e164},,${extension}` : e164,
      display: extension ? `${parsed.formatInternational()} ext. ${extension}` : parsed.formatInternational(),
    },
  };
}

function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}
