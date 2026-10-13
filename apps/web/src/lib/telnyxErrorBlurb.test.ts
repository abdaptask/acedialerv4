// Run: npm run test -w apps/web
//
// The stored shape is what matters here: a Message row's `errors` and the
// send route's `details` are the bare Telnyx errors ARRAY. The parser only
// handled the envelope around it, so every failed bubble in production read
// "Send failed" with no reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { telnyxErrorBlurb } from './telnyxErrorBlurb.js';

const stored = [
  {
    code: '40001',
    meta: { url: 'https://developers.telnyx.com/docs/overview/errors/40001' },
    title: 'Not routable',
    detail: 'The destination number is either a landline or a non-routable wireless number.',
  },
];

test('reads the code from the bare errors array stored on a message', () => {
  assert.equal(telnyxErrorBlurb(stored).short, 'Can’t receive texts');
});

test('still reads the envelope and bare-code shapes', () => {
  assert.equal(telnyxErrorBlurb({ errors: stored }).short, 'Can’t receive texts');
  assert.equal(telnyxErrorBlurb('40300').short, 'They opted out (STOP)');
  assert.equal(telnyxErrorBlurb(40012).short, 'Not a valid phone number');
});

test('40002 is the temporary spam block, not a malformed number', () => {
  const b = telnyxErrorBlurb([{ code: '40002' }]);
  assert.equal(b.short, 'Blocked as possible spam');
  assert.equal(b.retryable, true);
});

test('an empty array or unknown code falls back without throwing', () => {
  assert.equal(telnyxErrorBlurb([]).short, 'Send failed');
  assert.equal(telnyxErrorBlurb([{ code: '49999' }]).short, 'Error 49999');
});
