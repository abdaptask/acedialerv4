// Thread-key resolution for SMS/MMS conversations.
//
// WHY THIS EXISTS (root-cause fix for two shipped bugs):
//   The threads-list endpoint groups messages by the EXACT stored
//   `thread_key` (SQL `DISTINCT ON (thread_key)`) and hands that verbatim
//   key back to the client as the conversation identifier. When the client
//   opens a thread it passes that same key back to the detail endpoint.
//   The detail endpoint USED to run the key through `toE164()` before
//   matching — which prepends "+" to anything that isn't already E.164.
//   For short-code / alphanumeric senders that corrupts the key:
//     - "72524"  -> "+72524"  : matches NO stored row -> thread opens EMPTY
//                               even though the list showed a preview.
//     - "83356"  -> "+83356"  : matches a DIFFERENT bucket ("+83356") than
//                               the "83356" row the user clicked -> the
//                               thread shows unrelated messages and its
//                               latest no longer matches the list preview.
//   Real phone numbers were unaffected (they normalize to themselves), but
//   short codes and alphanumeric sender IDs broke.
//
// THE RULE:
//   - Match the stored key VERBATIM. This guarantees the opened thread
//     contains exactly the messages the list grouped/previewed under that
//     row, so preview text + timestamp always equal the thread's latest.
//   - ALSO accept the E.164-normalized form, but ONLY for genuine phone
//     numbers (>= 10 digits). This keeps deep links working when a
//     formatted or non-"+"-prefixed real number is passed (e.g.
//     `/messages?to=+15551234567`, "(267) 252-4323", "12672524323").
//   - Short codes and alphanumeric sender IDs (< 10 digits) are matched
//     verbatim ONLY — never normalized — because they are not phone numbers.

/** Normalize a raw phone string to E.164. Mirrors the messaging send path. */
export function toE164(raw: string): string {
  const cleaned = (raw ?? '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  return `+${cleaned}`;
}

/**
 * The set of stored `threadKey` values that identify a single conversation
 * for the given conversation identifier (as returned by the threads list or
 * passed via a deep link). Feed straight into Prisma `{ threadKey: { in } }`.
 *
 * `param` must already be URL-decoded.
 */
export function threadKeyCandidates(param: string): string[] {
  const raw = (param ?? '').trim();
  const set = new Set<string>();
  if (raw) set.add(raw); // verbatim — the source-of-truth key the list uses
  const digits = raw.replace(/\D/g, '');
  // Only real phone numbers (>= 10 digits) get an E.164 alias. Short codes
  // and alphanumeric sender IDs stay verbatim so we never corrupt them.
  if (digits.length >= 10) set.add(toE164(raw));
  return [...set];
}

/**
 * Would a message stored under `storedKey` belong to the conversation the
 * user opened with `param`? Faithful model of the Prisma `{ in }` match used
 * by the detail / read / unread endpoints — exported for unit tests.
 */
export function matchesStoredKey(storedKey: string, param: string): boolean {
  return threadKeyCandidates(param).includes(storedKey);
}
