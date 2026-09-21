// Voicemail recordings arrive from three Telnyx paths with two different
// audio formats. Hosted Voicemail serves .wav (observed on
// voice-mail-prod.s3.amazonaws.com); the Recordings API serves .mp3. The
// previous Supabase code hardcoded .mp3 + audio/mpeg, which mislabelled
// every hosted-voicemail object — these tests exist to stop that recurring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extAndContentTypeFromUrl, voicemailKey } from './mediaKeys.js';

test('voicemailKey nests under media/voicemails and the user', () => {
  assert.equal(voicemailKey(12, 345, 'wav'), 'media/voicemails/u12/345.wav');
});

test('voicemailKey starts with the media/ prefix', () => {
  // The public-read bucket policy is scoped to media/*; a key outside it
  // uploads fine and then 403s on playback.
  assert.ok(voicemailKey(1, 1, 'mp3').startsWith('media/'));
});

test('derives wav from a plain .wav URL', () => {
  const got = extAndContentTypeFromUrl('https://example.com/a/b.wav');
  assert.deepEqual(got, { ext: 'wav', contentType: 'audio/wav' });
});

test('derives mp3 from a plain .mp3 URL', () => {
  const got = extAndContentTypeFromUrl('https://example.com/a/b.mp3');
  assert.deepEqual(got, { ext: 'mp3', contentType: 'audio/mpeg' });
});

test('ignores a presigned query string when deriving the extension', () => {
  // This is the real shape: Telnyx hands us a presigned S3 URL whose query
  // string is longer than the path. A naive endsWith('.wav') misses it.
  const url =
    'https://voice-mail-prod.s3.us-east-1.amazonaws.com/%2B17329935698/b0fba8e9.wav' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800';
  assert.deepEqual(extAndContentTypeFromUrl(url), { ext: 'wav', contentType: 'audio/wav' });
});

test('uppercase extensions normalise to lowercase', () => {
  assert.deepEqual(extAndContentTypeFromUrl('https://x/a.WAV'), {
    ext: 'wav',
    contentType: 'audio/wav',
  });
});

test('falls back to mp3 when the URL has no extension', () => {
  // Falling back to mp3 rather than refusing keeps the copy working on an
  // unfamiliar URL shape; a mislabelled object still plays in every browser
  // we support, whereas a skipped copy loses the recording.
  assert.deepEqual(extAndContentTypeFromUrl('https://example.com/recording'), {
    ext: 'mp3',
    contentType: 'audio/mpeg',
  });
});

test('ignores a URL fragment when deriving the extension', () => {
  const got = extAndContentTypeFromUrl('https://example.com/a/b.wav#section');
  assert.deepEqual(got, { ext: 'wav', contentType: 'audio/wav' });
});

test('ignores both a query string and a fragment when deriving the extension', () => {
  const url =
    'https://voice-mail-prod.s3.us-east-1.amazonaws.com/%2B17329935698/b0fba8e9.wav' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800#section';
  assert.deepEqual(extAndContentTypeFromUrl(url), { ext: 'wav', contentType: 'audio/wav' });
});
