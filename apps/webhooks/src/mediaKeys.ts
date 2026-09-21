// S3 key layout for voicemail recordings. Spec §5.
//
// Separate from apps/api/src/lib/mediaKeys.ts by design: this service
// cannot import from apps/api (CLAUDE.md §1.4), and it owns a media type
// that service never writes.

export function voicemailKey(userId: number, voicemailId: number, ext: string): string {
  return `media/voicemails/u${userId}/${voicemailId}.${ext}`;
}

/**
 * Derive the stored extension and content-type from the source recording URL.
 *
 * Telnyx serves .wav from Hosted Voicemail and .mp3 from the Recordings API,
 * always behind a presigned query string longer than the path itself. The
 * previous implementation hardcoded .mp3/audio/mpeg and so mislabelled every
 * hosted-voicemail object. Unknown shapes fall back to mp3 rather than
 * refusing — a mislabelled object still plays, a skipped copy loses the
 * recording.
 */
export function extAndContentTypeFromUrl(url: string): { ext: string; contentType: string } {
  // Split on both '?' and '#': a presigned URL's query string is the common
  // case, but a URL ending in a fragment (no query string) needs the same
  // stripping or the fragment gets swept into the "extension" match below.
  // scripts/lib/rewriteMediaUrls.mjs solved this the same way — keep them
  // in agreement rather than drifting apart.
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = (/\.([a-zA-Z0-9]+)$/.exec(path)?.[1] ?? 'mp3').toLowerCase();
  const contentType = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
  return { ext, contentType };
}
