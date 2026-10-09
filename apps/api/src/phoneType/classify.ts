// Pure pieces of the phone-type lookup: input gate + provider-response
// normalisation. No Prisma, no fetch — tested in phoneType.test.ts.

export type LineType =
  | 'mobile'
  | 'landline'
  /** A "fixed line" answer from a source that can't see VoIP — see
   *  parseTelnyxLookup. */
  | 'landline_or_voip'
  | 'voip'
  | 'toll_free'
  | 'premium_rate'
  | 'unknown';

export interface LookupResult {
  lineType: LineType;
  carrier: string | null;
  /** null when the provider doesn't say. */
  ported: boolean | null;
}

/**
 * Numbers we will spend a carrier lookup on: valid-shaped NANP E.164 only.
 * NPA and exchange can't start with 0/1, which also screens out obvious junk
 * before it reaches a paid API. Widening to other countries means widening
 * this AND the client's LOOKUP_REGIONS together.
 */
const NANP_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/** NANP toll-free / premium codes. These are certain from the number alone,
 *  so a carrier lookup on them is money spent learning nothing. */
const NANP_NON_GEOGRAPHIC = /^\+1(800|833|844|855|866|877|888|900)/;

export type LookupEligibility = 'ok' | 'invalid' | 'unsupported_region' | 'not_needed';

export function lookupEligibility(e164: string): LookupEligibility {
  if (!/^\+\d{8,15}$/.test(e164)) return 'invalid';
  if (!e164.startsWith('+1')) return 'unsupported_region';
  if (!NANP_E164.test(e164)) return 'invalid';
  if (NANP_NON_GEOGRAPHIC.test(e164)) return 'not_needed';
  return 'ok';
}

/**
 * Map a provider's free-text line type onto ours.
 *
 * Providers disagree on vocabulary ("wireless" vs "mobile", "fixed line" vs
 * "landline", "non-fixed voip"…), so this matches on keywords rather than
 * exact strings. Ambiguous answers — "fixed line or mobile" — stay 'unknown':
 * labelling one side would present a guess as a verified fact.
 */
export function normalizeLineType(raw: unknown): LineType {
  if (typeof raw !== 'string') return 'unknown';
  const s = raw.toLowerCase().replace(/[_-]/g, ' ').trim();
  if (!s) return 'unknown';
  if (s.includes(' or ')) return 'unknown';
  if (s.includes('voip')) return 'voip';
  if (s.includes('toll')) return 'toll_free';
  if (s.includes('premium')) return 'premium_rate';
  if (s.includes('mobile') || s.includes('wireless') || s.includes('cell')) return 'mobile';
  if (s.includes('fixed') || s.includes('landline') || s.includes('wireline')) return 'landline';
  return 'unknown';
}

/**
 * Normalise a Telnyx `GET /v2/number_lookup/{n}` body (field names per the
 * Telnyx identity docs: portability.line_type "voip", ported_status "Y").
 *
 * Prefers `portability.line_type` over `carrier.type`: the portability block
 * comes from the LRN dip and reflects where the number lives NOW, while the
 * carrier block can describe the original block holder — exactly the
 * landline-ported-to-VoIP case this feature exists to catch.
 */
export function parseTelnyxLookup(body: unknown): LookupResult | null {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  const carrier = (data.carrier ?? {}) as Record<string, unknown>;
  const portability = (data.portability ?? {}) as Record<string, unknown>;

  const fromPortability = normalizeLineType(portability.line_type);
  let lineType =
    fromPortability !== 'unknown' ? fromPortability : normalizeLineType(carrier.type);
  // Telnyx's "fixed line" means the number BLOCK is registered to a wireline
  // carrier, and interconnected-VoIP providers (Telnyx itself, Bandwidth,
  // RingCentral, Google Voice…) hold wireline blocks. Measured Oct 9 2026: our
  // own Telnyx DID comes back "fixed line" from both the bare and the
  // type=carrier lookup. Saying "Landline" with a verified badge would be a
  // confident wrong answer for every such number, so we say what we know.
  if (lineType === 'landline') lineType = 'landline_or_voip';

  const name =
    (typeof portability.spid_carrier_name === 'string' && portability.spid_carrier_name) ||
    (typeof carrier.name === 'string' && carrier.name) ||
    null;

  let ported: boolean | null = null;
  if (typeof portability.ported_status === 'string') {
    // Telnyx reports "Y" / "N" (and sometimes words).
    const p = portability.ported_status.trim().toLowerCase();
    if (p === 'y' || p === 'yes' || p === 'ported') ported = true;
    else if (p === 'n' || p === 'no' || p === 'not ported') ported = false;
  }

  return { lineType, carrier: name, ported };
}
