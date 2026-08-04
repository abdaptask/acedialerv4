// v0.10.216 — SMS character and segment counting.
//
// The composer previously showed no length feedback at all, so a user had no
// way to know that adding one emoji to a 90-character message silently turned
// it into two billable segments, or that a long template insert had crossed
// into three. This module is the counting logic behind the counter that now
// sits under the compose box.
//
// ── Why segments, not just characters ──────────────────────────────────
// Carriers bill per *segment*, not per message. A single SMS carries 160
// characters when every character is in the GSM 03.38 alphabet. Add one
// character outside it — a curly quote, an em dash, an emoji, an accented
// letter — and the whole message switches to UCS-2 encoding, where a single
// segment holds only 70 characters. That cliff is invisible while typing and
// is the source of "why did my one text arrive as three".
//
// Concatenated (multi-segment) messages spend 6 bytes per segment on a UDH
// header that says "part N of M", which is why the per-segment capacity drops
// from 160 to 153 (GSM-7) and from 70 to 67 (UCS-2) once there's more than one.
//
// Pure and dependency-free so it can be unit-tested directly:
//   npm run test -w apps/web

/** Characters that occupy one septet in the GSM 03.38 default alphabet. */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/**
 * GSM 03.38 extension-table characters. Each is transmitted as an ESC byte
 * plus the character, so it costs TWO septets rather than one — the reason a
 * message of exactly 160 characters can still spill into a second segment.
 */
const GSM_EXTENDED = '^{}\\[~]|€';

const GSM_BASIC_SET = new Set(GSM_BASIC);
const GSM_EXTENDED_SET = new Set(GSM_EXTENDED);

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsLength {
  /**
   * Characters as a human counts them — grapheme-ish: astral symbols such as
   * emoji count as 1 here even though they occupy 2 UCS-2 code units. This is
   * the number shown to the user.
   */
  chars: number;
  /** Billable segments this message will be split into. */
  segments: number;
  encoding: SmsEncoding;
  /** Characters still available before another segment is started. */
  remainingInSegment: number;
  /** Capacity of each segment under the current encoding + segment count. */
  perSegment: number;
}

/** True when every character fits the GSM 03.38 alphabet (basic + extension). */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM_BASIC_SET.has(ch) && !GSM_EXTENDED_SET.has(ch)) return false;
  }
  return true;
}

/**
 * Billing weight of the text in its encoding's units:
 *   GSM-7 → septets (extension chars cost 2)
 *   UCS-2 → 16-bit code units (astral chars such as emoji cost 2)
 */
function encodedUnits(text: string, encoding: SmsEncoding): number {
  if (encoding === 'UCS-2') {
    // .length is exactly the UTF-16 code-unit count, which is what UCS-2
    // segmentation bills on. An emoji is a surrogate pair → 2 units.
    return text.length;
  }
  let units = 0;
  for (const ch of text) units += GSM_EXTENDED_SET.has(ch) ? 2 : 1;
  return units;
}

/** Count graphemes approximately — code points, not UTF-16 units. */
function countChars(text: string): number {
  // Spreading a string iterates by code point, so a surrogate pair counts once.
  return [...text].length;
}

export function measureSms(text: string): SmsLength {
  const encoding: SmsEncoding = isGsm7(text) ? 'GSM-7' : 'UCS-2';
  const single = encoding === 'GSM-7' ? 160 : 70;
  const concat = encoding === 'GSM-7' ? 153 : 67;

  const units = encodedUnits(text, encoding);
  const chars = countChars(text);

  if (units === 0) {
    return { chars: 0, segments: 0, encoding, remainingInSegment: single, perSegment: single };
  }
  if (units <= single) {
    return {
      chars,
      segments: 1,
      encoding,
      remainingInSegment: single - units,
      perSegment: single,
    };
  }

  const segments = Math.ceil(units / concat);
  return {
    chars,
    segments,
    encoding,
    remainingInSegment: segments * concat - units,
    perSegment: concat,
  };
}

/**
 * Compact label for the composer, e.g. "142 chars · 1 SMS" or
 * "181 chars · 2 SMS · UCS-2".
 *
 * The encoding is named only when it's UCS-2, because that's the case worth
 * explaining — it tells the user *why* their limit suddenly looks small.
 */
export function formatSmsLength(m: SmsLength): string {
  if (m.segments === 0) return '';
  const parts = [
    `${m.chars} char${m.chars === 1 ? '' : 's'}`,
    `${m.segments} SMS`,
  ];
  if (m.encoding === 'UCS-2') parts.push('UCS-2');
  return parts.join(' · ');
}
