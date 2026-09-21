// Key layout is spec §5. These are the strings that become permanent public
// URLs, so a change here silently orphans every object written before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingKey, mmsKey, sanitizeFilename } from './mediaKeys.js';

test('sanitizeFilename keeps safe characters', () => {
  assert.equal(sanitizeFilename('photo_1.final-v2.jpg'), 'photo_1.final-v2.jpg');
});

test('sanitizeFilename replaces path separators and spaces', () => {
  assert.equal(sanitizeFilename('../../etc/pass wd.jpg'), '.._.._etc_pass_wd.jpg');
});

test('sanitizeFilename replaces non-ASCII', () => {
  assert.equal(sanitizeFilename('résumé.pdf'), 'r_sum_.pdf');
});

test('mmsKey nests under media/mms/out and the user', () => {
  assert.equal(
    mmsKey(12, 'photo.jpg', 1700000000000),
    'media/mms/out/u12/1700000000000_photo.jpg',
  );
});

test('greetingKey separates the noanswer and busy slots', () => {
  assert.equal(
    greetingKey(3, 'noanswer', 'hello.wav', 1700000000000),
    'media/greetings/u3/noanswer/1700000000000_hello.wav',
  );
  assert.equal(
    greetingKey(3, 'busy', 'hello.wav', 1700000000000),
    'media/greetings/u3/busy/1700000000000_hello.wav',
  );
});

test('every key starts with the media/ prefix', () => {
  // The bucket is shared with an unrelated `updates` prefix and the
  // public-read policy is scoped to media/* — a key outside it would be
  // written but unreadable.
  for (const key of [mmsKey(1, 'a.jpg'), greetingKey(1, 'busy', 'a.wav')]) {
    assert.ok(key.startsWith('media/'), `${key} escapes the media/ prefix`);
  }
});
