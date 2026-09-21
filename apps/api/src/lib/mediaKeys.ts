// S3 key layout for the media this service uploads. Spec §5.
//
// Everything lives under media/ because the apt-dialer bucket is shared
// with an unrelated `updates` prefix and the public-read bucket policy is
// scoped to media/* — a key outside that prefix uploads fine and then 403s
// on every read.
//
// Voicemail-recording keys live in apps/webhooks/src/mediaKeys.ts instead;
// that service writes them and cannot import from here (CLAUDE.md §1.4).

/** Strip anything that would change the key's shape or escape its prefix. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function mmsKey(userId: number, filename: string, now: number = Date.now()): string {
  return `media/mms/out/u${userId}/${now}_${sanitizeFilename(filename)}`;
}

export function greetingKey(
  userId: number,
  type: 'noanswer' | 'busy',
  filename: string,
  now: number = Date.now(),
): string {
  return `media/greetings/u${userId}/${type}/${now}_${sanitizeFilename(filename)}`;
}
