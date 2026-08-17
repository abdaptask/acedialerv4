// Phone normalization + matching for API-side code.
//
// `toE164` already exists as a private copy in favorites.routes.ts and
// scheduledMessages.routes.ts. This is the shared home for new callers — not a
// refactor of those two, which would mean touching working routes for no
// behavioural gain. If you're editing one of them anyway, converge it here.
//
// The two functions answer different questions and are not interchangeable:
// `toE164` produces a value to STORE or SEND; `last10` produces a key to
// COMPARE. Storage is always normalized E.164; comparison always drops to the
// last ten digits, because carriers vary formatting and a webhook may report a
// number differently than the user typed it.

/** Normalize to E.164 for storage / sending to Telnyx. */
export function toE164(raw: string): string {
  const cleaned = (raw ?? '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Last 10 digits — the comparison key used across the codebase (webhook block
 * lookups, Recents dedupe).
 *
 * Returns '' for anything that can't be a dialable US number, so short codes
 * and junk never collide into a key that matches a real contact.
 */
export function last10(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
