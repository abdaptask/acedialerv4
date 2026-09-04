// buildPublicUrl is the only pure part of this hand-copy of
// apps/api/src/lib/s3Url.ts (CLAUDE.md §1.4 forbids sharing it, so both
// copies must be tested independently or they're free to drift). putObject
// and isS3Configured aren't covered here — they read process.env directly,
// but every such read is inside a function body, so importing this module
// runs no env validation and needs no fixture setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicUrl } from './s3.js';

test('builds a virtual-hosted-style URL from bucket + region', () => {
  const got = buildPublicUrl('media/mms/out/u12/1700000000000_photo.jpg', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
  });
  assert.equal(
    got,
    'https://apt-dialer.s3.us-east-1.amazonaws.com/media/mms/out/u12/1700000000000_photo.jpg',
  );
});

test('publicBase overrides bucket + region', () => {
  const got = buildPublicUrl('media/greetings/u3/busy/1_hi.wav', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
    publicBase: 'https://media.aptask.com',
  });
  assert.equal(got, 'https://media.aptask.com/media/greetings/u3/busy/1_hi.wav');
});

test('a trailing slash on publicBase does not produce a double slash', () => {
  const got = buildPublicUrl('media/x.txt', { publicBase: 'https://media.aptask.com/' });
  assert.equal(got, 'https://media.aptask.com/media/x.txt');
});

test('an empty publicBase falls back to bucket + region', () => {
  // config.optional() yields '' for an unset-but-declared var, so the empty
  // string must not be treated as a configured override.
  const got = buildPublicUrl('media/x.txt', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
    publicBase: '',
  });
  assert.equal(got, 'https://apt-dialer.s3.us-east-1.amazonaws.com/media/x.txt');
});
