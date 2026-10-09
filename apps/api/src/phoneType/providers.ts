// Carrier-lookup providers for GET /phone-type.
//
// One interface so a second provider (Twilio Lookup, NumVerify, …) is a new
// object in PROVIDERS plus env, not a change to the route or the client.
// Selected by PHONE_LOOKUP_PROVIDER; unset or 'none' means no lookups and no
// spend — the client then shows the free numbering-plan inference only.
import { config } from '../config.js';
import { parseTelnyxLookup, type LookupResult } from './classify.js';

export type ProviderOutcome =
  | { ok: true; result: LookupResult }
  | { ok: false; error: string };

export interface PhoneLookupProvider {
  /** Stored on the cache row so a provider switch can be told apart later. */
  readonly name: string;
  isConfigured(): boolean;
  lookup(e164: string, signal: AbortSignal): Promise<ProviderOutcome>;
}

const telnyx: PhoneLookupProvider = {
  name: 'telnyx',
  isConfigured: () => !!config.telnyxApiKey,
  async lookup(e164, signal) {
    // Bare lookup, no `type`: it already returns the portability (LRN) block,
    // whose line_type is the post-porting answer we want — billed as an LRN
    // query ($0.0015 published, Oct 2026). `type=carrier` adds the MCC/MNC
    // block at $0.0025 and tells us nothing extra for this badge.
    const res = await fetch(
      `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}`,
      { headers: { Authorization: `Bearer ${config.telnyxApiKey}` }, signal },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `telnyx_${res.status}` };
    const result = parseTelnyxLookup(body);
    return result ? { ok: true, result } : { ok: false, error: 'telnyx_unparseable' };
  },
};

const PROVIDERS: Record<string, PhoneLookupProvider> = { telnyx };

export function activeProvider(): PhoneLookupProvider | null {
  const p = PROVIDERS[config.phoneLookupProvider];
  return p && p.isConfigured() ? p : null;
}
