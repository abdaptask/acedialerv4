// buildPublicUrl is the only pure part of the S3 helper, and it is the part
// that decides what string lands in the database — so it gets the tests.
// putObject is a thin PutObjectCommand wrapper with nothing to assert
// without a network mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicUrl } from './s3Url.js';

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
