// Phone-number detection for the page scanner.
//
// This runs against every text node on an allowed page, so it has two jobs
// that pull against each other: find real phone numbers, and — more
// importantly — do NOT underline things that merely look numeric. An ATS page
// is full of candidate IDs, requisition numbers, dates, salaries, ZIP+4, and
// order references. Underlining those makes the feature feel broken and gets
// it switched off, so the bias here is deliberately toward false negatives.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/** Candidate shapes. Intentionally conservative: requires either a leading +,
 *  or separators, or an exact 10/11-digit run — a bare 8-digit blob is far
 *  more likely to be an ID than a phone number. */
const CANDIDATE_RE = new RegExp(
  [
    // +country ... (international, with or without separators)
    String.raw`\+\d[\d\s().\-]{7,20}\d`,
    // (732) 555-1234 / 732-555-1234 / 732.555.1234 / 732 555 1234
    String.raw`\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b`,
    // 1-732-555-1234
    String.raw`\b1[\s.\-]\d{3}[\s.\-]\d{3}[\s.\-]\d{4}\b`,
    // bare 10 or 11 digits
    String.raw`\b\d{10,11}\b`,
  ].join('|'),
  'g',
);

/** Contexts where a numeric run is almost never a phone number. Checked
 *  against the surrounding text, which kills the most common false positives
 *  on a recruiting page. */
const NEGATIVE_CONTEXT =
  /\b(?:invoice|order|req(?:uisition)?|id|ref(?:erence)?|ssn|ein|zip|postal|account|acct|tracking|po|sku|isbn|badge|employee|case|ticket|claim)\s*(?:#|no\.?|number)?\s*[:\-=.]*\s*$/i;

export interface Detected {
  /** Exact text matched, for replacement in the DOM. */
  raw: string;
  /** E.164. */
  e164: string;
  /** What to hand the app (may carry a post-dial extension). */
  dialString: string;
  /** Index within the text node. */
  start: number;
  end: number;
}

/**
 * Find dialable numbers inside a single text node's content.
 *
 * `defaultCountry` applies only when there's no leading '+', so an explicit
 * country code is never rewritten.
 */
export function detectNumbers(text: string, defaultCountry: CountryCode = 'US'): Detected[] {
  if (!text || text.length > 5000) return [];
  const out: Detected[] = [];

  CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CANDIDATE_RE.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;

    // Reject when the preceding words say this is an identifier, not a phone.
    const before = text.slice(Math.max(0, start - 24), start);
    if (NEGATIVE_CONTEXT.test(before)) continue;

    // Reject when glued to other digits or to a currency symbol.
    const prevChar = text[start - 1] ?? '';
    const nextChar = text[start + raw.length] ?? '';
    if (/[\d$£€₹%]/.test(prevChar) || /[\d%]/.test(nextChar)) continue;

    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) continue;

    const parsed = raw.trim().startsWith('+')
      ? parsePhoneNumberFromString(`+${digits}`)
      : parsePhoneNumberFromString(raw, defaultCountry);

    // isValid() (not isPossible()) — possible-but-not-valid is where the ID
    // numbers live.
    if (!parsed || !parsed.isValid()) continue;

    out.push({
      raw,
      e164: parsed.number,
      dialString: parsed.number,
      start,
      end: start + raw.length,
    });
  }
  return out;
}
