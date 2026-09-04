// The mapper that decides which entries of Message.mediaUrls get rewritten.
// Message.mediaUrls mixes OUR Supabase uploads with Telnyx's own inbound
// media URLs (apps/webhooks/src/main.ts:1086). Rewriting a Telnyx entry
// destroys inbound message history, so the prefix test is the whole safety
// property and it is tested exhaustively.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseMediaUrl, rewriteArray, supabaseUrlToKey } from './rewriteMediaUrls.mjs';

const BASE = 'https://abcdefg.supabase.co';
const BUCKET = 'ace-media';

test('recognises a Supabase public object URL', () => {
  assert.equal(
    isSupabaseMediaUrl(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1_a.jpg`, BASE),
    true,
  );
});

test('does not recognise a Telnyx media URL', () => {
  assert.equal(isSupabaseMediaUrl('https://media.telnyx.com/abc/def.jpg', BASE), false);
});

test('does not recognise an already-migrated S3 URL', () => {
  // This is what makes the script idempotent — a second run finds nothing.
  assert.equal(
    isSupabaseMediaUrl('https://apt-dialer.s3.us-east-1.amazonaws.com/media/mms/out/u12/1_a.jpg', BASE),
    false,
  );
});

test('does not recognise a different Supabase project', () => {
  assert.equal(
    isSupabaseMediaUrl('https://other.supabase.co/storage/v1/object/public/ace-media/u1/a.jpg', BASE),
    false,
  );
});

test('handles null and empty input', () => {
  assert.equal(isSupabaseMediaUrl(null, BASE), false);
  assert.equal(isSupabaseMediaUrl('', BASE), false);
});

test('extracts the object key from a public URL', () => {
  assert.equal(
    supabaseUrlToKey(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1700_a.jpg`, BASE, BUCKET),
    'u12/1700_a.jpg',
  );
});

test('extracts a nested object key', () => {
  assert.equal(
    supabaseUrlToKey(
      `${BASE}/storage/v1/object/public/${BUCKET}/voicemail-greetings/u3/busy/1700_hi.wav`,
      BASE,
      BUCKET,
    ),
    'voicemail-greetings/u3/busy/1700_hi.wav',
  );
});

test('returns null for a non-Supabase URL', () => {
  assert.equal(supabaseUrlToKey('https://media.telnyx.com/a.jpg', BASE, BUCKET), null);
});

test('rewriteArray rewrites only Supabase entries and preserves order', () => {
  const input = [
    'https://media.telnyx.com/inbound-1.jpg',
    `${BASE}/storage/v1/object/public/${BUCKET}/u12/1_ours.jpg`,
    'https://media.telnyx.com/inbound-2.jpg',
  ];
  const { next, changed } = rewriteArray(input, (u) =>
    isSupabaseMediaUrl(u, BASE) ? 'https://s3/new.jpg' : null,
  );
  assert.equal(changed, 1);
  assert.deepEqual(next, [
    'https://media.telnyx.com/inbound-1.jpg',
    'https://s3/new.jpg',
    'https://media.telnyx.com/inbound-2.jpg',
  ]);
});

test('rewriteArray leaves an all-Telnyx array untouched', () => {
  const input = ['https://media.telnyx.com/a.jpg', 'https://media.telnyx.com/b.jpg'];
  const { next, changed } = rewriteArray(input, () => null);
  assert.equal(changed, 0);
  assert.deepEqual(next, input);
});

test('rewriteArray handles an empty array', () => {
  const { next, changed } = rewriteArray([], () => 'https://s3/x');
  assert.equal(changed, 0);
  assert.deepEqual(next, []);
});

test('rewriteArray keeps the original entry when the mapper returns null', () => {
  // A failed download must leave the row usable, not blank it.
  const input = [`${BASE}/storage/v1/object/public/${BUCKET}/u1/a.jpg`];
  const { next, changed } = rewriteArray(input, () => null);
  assert.equal(changed, 0);
  assert.deepEqual(next, input);
});

test('strips query string from object key', () => {
  assert.equal(
    supabaseUrlToKey(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1_a.jpg?width=800&height=600`, BASE, BUCKET),
    'u12/1_a.jpg',
  );
});

test('strips fragment from object key', () => {
  assert.equal(
    supabaseUrlToKey(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1_a.jpg#section`, BASE, BUCKET),
    'u12/1_a.jpg',
  );
});

test('isSupabaseMediaUrl returns true for different bucket, but supabaseUrlToKey returns null', () => {
  // isSupabaseMediaUrl validates the project host only, not the bucket.
  // supabaseUrlToKey enforces the bucket check. This divergence is by design.
  const urlOtherBucket = `${BASE}/storage/v1/object/public/some-other-bucket/u1/a.jpg`;
  assert.equal(isSupabaseMediaUrl(urlOtherBucket, BASE), true);
  assert.equal(supabaseUrlToKey(urlOtherBucket, BASE, BUCKET), null);
});

test('rewriteArray keeps the original entry when the mapper returns empty string', () => {
  // Empty string is falsy and must be treated like null — leave the entry alone.
  const input = [`${BASE}/storage/v1/object/public/${BUCKET}/u1/a.jpg`];
  const { next, changed } = rewriteArray(input, () => '');
  assert.equal(changed, 0);
  assert.deepEqual(next, input);
});
