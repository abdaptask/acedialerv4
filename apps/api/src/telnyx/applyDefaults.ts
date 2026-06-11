// v0.10.64 — AptLink Telnyx defaults helpers.
//
// Centralizes the "every new or migrated user's Telnyx config must look
// like THIS" rules in one place. Two surfaces:
//
//   applyAceConnectionDefaults(connectionId, country)
//     Tunes the Credential Connection AFTER it's created from the template.
//     Most settings (audio enhancements, codecs, channel limits, SRTP,
//     SHAKEN/STIR, etc.) come from the template clone in
//     createConnectionFromTemplate. This helper applies the few per-user
//     overrides the template can't provide — namely anchorsite based on
//     the user's country.
//
//   applyAcePhoneNumberDefaults(numberId)
//     Tunes the phone_number resource AFTER it's been routed to a
//     Credential Connection. Sets HD voice, CNAM listing (caller ID name
//     = "ApTask"), voicemail enabled, voicemail PIN = "12345".
//     These are NOT part of the credential connection clone — they live
//     on the phone_number resource and must be PATCHed separately.
//
// Both functions are best-effort: they LOG warnings on failure but never
// throw. The user is already created at the point we call these, so a
// Telnyx config hiccup shouldn't roll back the migration; admin can use
// the future "Re-apply AptLink Telnyx defaults" button to retry.

import { config } from '../config.js';

interface PatchResult {
  ok: boolean;
  status: number;
  detail?: unknown;
}

/**
 * Internal helper — single Telnyx PATCH with the API key + body.
 * Returns a flat ok/status/detail so callers can log without throwing.
 */
async function telnyxPatch(path: string, body: Record<string, unknown>): Promise<PatchResult> {
  if (!config.telnyxApiKey) {
    return { ok: false, status: 0, detail: 'TELNYX_API_KEY missing' };
  }
  try {
    const res = await fetch(`https://api.telnyx.com/v2${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.telnyxApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: txt };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Translate AptLink's User.country code to a Telnyx anchorsite_override value.
 *
 * v0.10.85 — THIRD ATTEMPT, this time with the actual Telnyx-published
 * values. The previous two attempts both got rejected with error 10015:
 *   - v0.10.64:  'Chennai' / 'Latency'                  (capital L wrong)
 *   - v0.10.81:  'Chennai, India' / 'Latency Routing'   (Chennai PoP doesn't exist)
 *
 * Per https://developers.telnyx.com/docs/voice/sip-trunking/routing/anchorsite-configuration
 * Telnyx's accepted values are:
 *   - "latency"               (LOWERCASE — auto-select closest PoP by ping)
 *   - "Chicago, IL"           (NA Central)
 *   - "Ashburn, VA"           (NA East)
 *   - "San Jose, CA"          (NA West)
 *   - "Toronto, Canada"       (NA NE)
 *   - "Montreal, Canada"      (NA NE)
 *   - "Vancouver, Canada"     (NA NW)
 *   - "London, UK"            (Europe)
 *   - "Amsterdam, Netherlands"
 *   - "Frankfurt, Germany"
 *   - "Sydney, Australia"     (ONLY Asia Pacific PoP — closest to India)
 *
 * CRITICAL FINDING: there is no Chennai, Mumbai, India, or Singapore PoP.
 * The mental model "India users → Chennai anchor" assumed Telnyx had
 * Indian infrastructure; they don't. The closest geographic PoP to
 * India is Sydney (~10,000 km), which often routes via worse undersea
 * cables than "latency" mode would choose dynamically.
 *
 * Policy (v0.10.85): "latency" for EVERY user, regardless of country.
 * Telnyx pings the user's endpoint and picks whichever real PoP gives
 * the lowest measured latency that moment. For an India endpoint that's
 * typically Frankfurt or Sydney depending on day-of-week routing; for a
 * US endpoint it's whichever NA PoP is closest. No country tag needed
 * for this PATCH; we keep the country argument for forward-compat in
 * case Telnyx ever spins up Chennai or Mumbai.
 */
export function anchorsiteForCountry(_country: string | null | undefined): string {
  // Country argument intentionally unused — Telnyx has no India PoP to
  // route to, so all users get latency-mode auto-selection (which is
  // the best they can get on Telnyx's current network footprint).
  return 'latency';
}

/**
 * v0.10.86 — REPURPOSED. Previous versions tried to PATCH anchorsite_override
 * with various string values, all rejected by Telnyx with error 10015. Per
 * admin direction, we now MANAGE ANCHORSITE MANUALLY via Telnyx Mission
 * Control on the master template; new users inherit it through
 * createConnectionFromTemplate's clone body (which copies the template's
 * anchorsite_override verbatim — a known-working value because the admin
 * set it via the GUI).
 *
 * This function now PATCHes Noise Suppression instead. The master template
 * has noise suppression configured (config="Both Inbound and Outbound",
 * engine="Krisp Viva Tel Lite"). The template clone is supposed to copy
 * this onto new connections, but a recurring symptom is that the field
 * doesn't stick on POST/PATCH of clone bodies — apparently Telnyx
 * sometimes drops it from large bodies. A SEPARATE PATCH that only sends
 * noise_suppression isolates the field so it lands reliably.
 *
 * Behavior:
 *   1. Re-fetch the master template (via TELNYX_TEMPLATE_CONNECTION_ID)
 *   2. Extract template.noise_suppression
 *   3. PATCH it onto the user's new connection (separate API call)
 *
 * The country argument is retained on the signature for callsite
 * stability, but currently unused.
 *
 * Returns the PATCH result. Never throws. Falls back to ok:true with
 * a "skipped" note if the template fetch fails or the template has no
 * noise_suppression set — caller shouldn't treat the migration as
 * failed for this.
 */
export async function applyAceConnectionDefaults(
  connectionId: string,
  _country: string | null | undefined,
): Promise<PatchResult> {
  if (!config.telnyxApiKey) {
    return { ok: true, status: 200, detail: 'skipped — TELNYX_API_KEY not set' };
  }
  const tplId = (config.telnyxTemplateConnectionId ?? '').trim();
  if (!tplId) {
    // No template configured → nothing to copy from. Don't fail the
    // migration; just record that we skipped.
    return { ok: true, status: 200, detail: 'skipped — no TELNYX_TEMPLATE_CONNECTION_ID configured' };
  }
  // Fetch template to read its noise_suppression value (use the real
  // string format Telnyx returned for the template — never hardcode
  // "both"/"krisp_viva_tel_lite", because Telnyx's accepted enum
  // values shift over time and the template GUI dropdown holds the
  // canonical strings).
  let templateNoise: unknown = null;
  try {
    const res = await fetch(`https://api.telnyx.com/v2/credential_connections/${tplId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.telnyxApiKey}` },
    });
    if (!res.ok) {
      return { ok: true, status: 200, detail: `skipped — template fetch returned ${res.status}` };
    }
    const json = (await res.json()) as { data?: { noise_suppression?: unknown } };
    templateNoise = json?.data?.noise_suppression ?? null;
  } catch (e) {
    return { ok: true, status: 200, detail: `skipped — template fetch threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!templateNoise || typeof templateNoise !== 'object') {
    return { ok: true, status: 200, detail: 'skipped — template has no noise_suppression set' };
  }
  // PATCH only the noise_suppression field — isolated so it lands
  // independently of whatever else the clone PATCH might have dropped.
  return telnyxPatch(`/credential_connections/${connectionId}`, {
    noise_suppression: { ...(templateNoise as Record<string, unknown>) },
  });
}

/**
 * v0.10.64 — Apply per-DID AptLink defaults to a phone number. Sets:
 *
 *   • hd_voice: true        — HD audio codec when both ends support
 *   • cnam_listing_enabled: true with cnam_listing_details: "ApTask"
 *                            (so caller-ID receivers see "ApTask" instead
 *                             of the raw number)
 *   • voicemail: enabled, pin "12345"
 *
 * Telnyx splits these settings across two sub-resources on phone_number:
 *  - /phone_numbers/:id/voice         → hd_voice
 *  - /phone_numbers/:id/voice         → cnam_listing fields
 *  - /phone_numbers/:id/voicemail     → voicemail enable + pin
 *
 * We submit them as separate PATCHes and report on each. A failure on
 * one doesn't block the others.
 *
 * NOTE: Voicemail PIN "12345" is a tenant-wide default per admin policy.
 * If you change the policy, update the constant below.
 */
const ACE_DEFAULT_VOICEMAIL_PIN = '12345';
const ACE_DEFAULT_CALLER_ID_NAME = 'ApTask';

export interface ApplyPhoneNumberDefaultsResult {
  voice: PatchResult;
  voicemail: PatchResult;
}

export async function applyAcePhoneNumberDefaults(
  numberId: string,
): Promise<ApplyPhoneNumberDefaultsResult> {
  // Voice (HD voice + CNAM listing) — single PATCH on the /voice sub-resource.
  const voice = await telnyxPatch(`/phone_numbers/${numberId}/voice`, {
    // Telnyx field name. HD voice means Opus or AMR-WB advertised in SDP.
    hd_voice_enabled: true,
    // CNAM (Caller ID Name) outbound display.
    // Two related fields exist on Telnyx; we set both so the field rename
    // in any future API version doesn't silently drop our setting.
    cnam_listing_enabled: true,
    cnam_listing_details: ACE_DEFAULT_CALLER_ID_NAME,
  });

  // Voicemail — separate sub-resource.
  const voicemail = await telnyxPatch(`/phone_numbers/${numberId}/voicemail`, {
    enabled: true,
    pin: ACE_DEFAULT_VOICEMAIL_PIN,
  });

  return { voice, voicemail };
}
