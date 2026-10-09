// Phone-number type detection (Mobile / Landline / VoIP / Toll-free / …).
//
// Two sources, and they must never be confused with each other:
//
//   • INFERRED — from the numbering plan, via libphonenumber-js. Free,
//     instant, offline. Reliable ONLY for categories the plan itself encodes
//     (toll-free, premium-rate, and mobile vs fixed in countries whose plans
//     separate them). For US/Canada it can never say mobile vs landline vs
//     VoIP: NANP doesn't encode that in the number, and portability means no
//     prefix table could either — every geographic NANP number comes back as
//     FIXED_LINE_OR_MOBILE, which we surface as "Unknown".
//
//   • VERIFIED — from a carrier lookup on the server (GET /phone-type),
//     which reflects porting. Optional; off unless the API is configured.
//
// Nothing here may sit on the dial path. The type is an annotation; a call
// is never delayed, gated, or altered by it.
import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
  type NumberType,
  type PhoneNumber,
} from 'libphonenumber-js/min';

export type LineType =
  | 'mobile'
  | 'landline'
  | 'voip'
  | 'toll_free'
  | 'premium_rate'
  | 'unknown';

export const LINE_TYPE_LABEL: Record<LineType, string> = {
  mobile: 'Mobile',
  landline: 'Landline',
  voip: 'VoIP',
  toll_free: 'Toll-free',
  premium_rate: 'Premium-rate',
  unknown: 'Unknown',
};

/** Calling regions where a server carrier lookup is attempted. Initially the
 *  NANP countries we actually dial; widen alongside the server's allow-list. */
export const LOOKUP_REGIONS: ReadonlySet<string> = new Set(['US', 'CA']);

const DEFAULT_COUNTRY: CountryCode = 'US';

export type Inference =
  /** Nothing number-like yet (empty, DTMF-only, SIP URI). Render nothing. */
  | { kind: 'none' }
  /** Still being typed — too short to judge. Render nothing. */
  | { kind: 'incomplete' }
  /** Complete-length but not a real number (e.g. 555 area code, too long). */
  | { kind: 'invalid' }
  | {
      kind: 'inferred';
      e164: string;
      country: string | undefined;
      lineType: LineType;
      /** libphonenumber returned no type at all — usually because the
       *  bundled metadata flavour lacks type data for this country. The
       *  caller may retry with fuller metadata (see refineWithFullMetadata). */
      typeMissing: boolean;
    };

/** The dialable part of the field: drops post-dial DTMF ("…,,802") and an
 *  "x203" style extension, both of which the dial string may carry. */
export function dialablePart(raw: string): string {
  return raw.split(/[,;]/, 1)[0].replace(/\s*(?:ext\.?|x)\s*\d+$/i, '').trim();
}

/** Map libphonenumber's type to ours. Only categories the plan actually
 *  guarantees become concrete; ambiguous ones are 'unknown' on purpose. */
export function lineTypeFromNumberType(t: NumberType): LineType {
  switch (t) {
    case 'MOBILE':
      return 'mobile';
    case 'FIXED_LINE':
      return 'landline';
    case 'VOIP':
      return 'voip';
    case 'TOLL_FREE':
      return 'toll_free';
    case 'PREMIUM_RATE':
      return 'premium_rate';
    // FIXED_LINE_OR_MOBILE is the answer for every geographic NANP number.
    // Picking either side would be a coin flip presented as fact.
    default:
      return 'unknown';
  }
}

function fromParsed(parsed: PhoneNumber): Inference {
  if (!parsed.isValid()) return { kind: 'invalid' };
  const t = parsed.getType();
  return {
    kind: 'inferred',
    e164: parsed.number,
    country: parsed.country,
    lineType: lineTypeFromNumberType(t),
    typeMissing: t === undefined,
  };
}

/**
 * Classify whatever is in the dial field, synchronously.
 *
 * "Complete" is decided by length, not validity, so a number still being
 * typed renders nothing rather than flashing "Invalid" on every keystroke;
 * only a full-length number that fails validation is called invalid.
 */
export function inferPhoneType(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): Inference {
  if (!raw) return { kind: 'none' };
  const text = dialablePart(String(raw));
  if (!text || /^sip:/i.test(text)) return { kind: 'none' };
  const digits = text.replace(/\D/g, '');
  if (!digits || /^[*#]/.test(text)) return { kind: 'none' };

  let lengthIssue: ReturnType<typeof validatePhoneNumberLength>;
  try {
    lengthIssue = validatePhoneNumberLength(text, defaultCountry);
  } catch {
    lengthIssue = 'NOT_A_NUMBER';
  }
  // TOO_SHORT is the normal state while typing. INVALID_COUNTRY covers a
  // bare "+" or a half-typed country code.
  if (lengthIssue === 'TOO_SHORT' || lengthIssue === 'INVALID_COUNTRY') {
    return { kind: 'incomplete' };
  }
  if (lengthIssue === 'NOT_A_NUMBER') {
    return digits.length < 7 ? { kind: 'incomplete' } : { kind: 'invalid' };
  }
  if (lengthIssue) return { kind: 'invalid' };

  try {
    const parsed = parsePhoneNumberFromString(text, defaultCountry);
    return parsed ? fromParsed(parsed) : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * The bundled `min` metadata has type patterns for NANP but not for most
 * other countries (India comes back typeless). The full `max` metadata is
 * ~140 KB, so it's loaded on demand — only once someone actually enters an
 * international number — rather than shipped to every dialer user.
 */
let maxModule: Promise<typeof import('libphonenumber-js/max')> | null = null;

export async function refineWithFullMetadata(e164: string): Promise<Inference> {
  maxModule ??= import('libphonenumber-js/max');
  try {
    const { parsePhoneNumberFromString: parseMax } = await maxModule;
    const parsed = parseMax(e164);
    return parsed ? fromParsed(parsed) : { kind: 'invalid' };
  } catch {
    // A failed chunk load (offline Electron, stale deploy) must not take the
    // badge down — clear the memo so a later number can retry.
    maxModule = null;
    return { kind: 'inferred', e164, country: undefined, lineType: 'unknown', typeMissing: true };
  }
}

/** Whether a server carrier lookup is worth attempting for this inference.
 *  Toll-free and premium-rate are certain from the plan alone, so paying a
 *  carrier to confirm them would be money for nothing. */
export function shouldLookUp(inf: Inference): inf is Extract<Inference, { kind: 'inferred' }> {
  return (
    inf.kind === 'inferred' &&
    !!inf.country &&
    LOOKUP_REGIONS.has(inf.country) &&
    inf.lineType !== 'toll_free' &&
    inf.lineType !== 'premium_rate'
  );
}

// ── Combined display state ─────────────────────────────────────────────

export interface VerifiedLookup {
  lineType: LineType;
  carrier?: string | null;
  ported?: boolean | null;
  checkedAt?: string;
}

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'verified'; result: VerifiedLookup }
  /** Lookup not configured, region unsupported, over budget, or failed. */
  | { status: 'unavailable'; reason: string };

export type PhoneTypeDisplay =
  | { state: 'hidden' }
  | { state: 'invalid'; label: string }
  | {
      state: 'shown';
      lineType: LineType;
      label: string;
      source: 'verified' | 'inferred';
      loading: boolean;
      /** Explanatory tooltip — always says WHERE the answer came from. */
      detail: string;
    };

/**
 * Merge inference + lookup into one thing to render. Verified beats inferred;
 * a failed lookup falls back to the inference (which may well be "Unknown").
 */
export function describePhoneType(inf: Inference, lookup: LookupState): PhoneTypeDisplay {
  if (inf.kind === 'none' || inf.kind === 'incomplete') return { state: 'hidden' };
  if (inf.kind === 'invalid') return { state: 'invalid', label: 'Invalid number' };

  if (lookup.status === 'verified') {
    const r = lookup.result;
    const bits = ['Verified by carrier lookup'];
    if (r.carrier) bits.push(r.carrier);
    if (r.ported) bits.push('ported');
    return {
      state: 'shown',
      lineType: r.lineType,
      label: LINE_TYPE_LABEL[r.lineType],
      source: 'verified',
      loading: false,
      detail: bits.join(' · '),
    };
  }

  const known = inf.lineType !== 'unknown';
  let detail: string;
  if (known) {
    detail = 'Inferred from the number format — not carrier-verified. Ported numbers may differ.';
  } else if (inf.country && LOOKUP_REGIONS.has(inf.country)) {
    detail =
      lookup.status === 'loading'
        ? 'Checking the carrier…'
        : 'US and Canadian numbers don’t show mobile, landline or VoIP in the number itself, and carrier lookup is unavailable.';
  } else {
    detail = 'The type can’t be determined from this number’s format.';
  }

  return {
    state: 'shown',
    lineType: inf.lineType,
    label: LINE_TYPE_LABEL[inf.lineType],
    source: 'inferred',
    loading: lookup.status === 'loading',
    detail,
  };
}
