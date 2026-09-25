// Why a text wasn't delivered, in words a recruiter can act on.
// Codes are Telnyx messaging error codes (developers.telnyx.com/docs/overview/errors).
// Unknown codes fall back to Telnyx's own title, never to nothing.

const REASONS: Record<string, string> = {
  '40001': 'This number can’t receive texts (usually a landline or a number not in service)',
  '40002': 'The carrier blocked it as possible spam (temporary). Try again later or call instead',
  '40003': 'The carrier blocked it as spam',
  '40004': 'The carrier rejected the message',
  '40005': 'The message expired before the phone accepted it (phone off or out of coverage)',
  '40006': 'The recipient’s carrier was unavailable',
  '40008': 'The carrier couldn’t deliver it',
  '40009': 'The message content was rejected',
  '40010': 'Our sending number isn’t registered for business texting (10DLC)',
  '40011': 'Too many texts sent too fast; the carrier throttled them',
  '40012': 'Not a valid phone number',
  '40013': 'Our sending number can’t send texts',
  '40300': 'This person opted out (texted STOP)',
};

export function textFailureReason(code: string | null, title: string | null): string {
  if (code && REASONS[code]) return REASONS[code];
  if (title) return title;
  return 'The carrier didn’t say why';
}
