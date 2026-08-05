// v0.10.216 — SMS segment counting tests.
//
// Run: npm run test -w apps/web
//
// The boundaries are the whole point of this file. Off-by-one at 160/161 or
// 70/71 means the counter tells a user their message is one SMS when the
// carrier will bill two.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSmsLength, isGsm7, measureSms } from './smsSegments.js';

const g = (n: number) => 'a'.repeat(n);

// ── Encoding detection ──────────────────────────────────────────────────

test('plain ASCII is GSM-7', () => {
  assert.equal(isGsm7('Hi {firstName}, are you free at 2pm?'), true);
  assert.equal(measureSms('Hello').encoding, 'GSM-7');
});

test('GSM-7 covers the accented letters in its alphabet', () => {
  assert.equal(isGsm7('Café costs £5 à Paris'), true);
});

test('an emoji forces UCS-2', () => {
  assert.equal(isGsm7('Thanks 👍'), false);
  assert.equal(measureSms('Thanks 👍').encoding, 'UCS-2');
});

test('a curly quote forces UCS-2 — the invisible cliff', () => {
  // This is the one that catches people out: iOS and Word autocorrect a
  // straight apostrophe into ’, which is outside GSM-7 and quarters the
  // per-segment capacity.
  assert.equal(isGsm7("it's fine"), true);
  assert.equal(isGsm7('it’s fine'), false);
});

test('an em dash forces UCS-2', () => {
  assert.equal(isGsm7('Yes — tomorrow'), false);
});

// ── GSM-7 boundaries ────────────────────────────────────────────────────

test('empty text measures as zero segments', () => {
  const m = measureSms('');
  assert.equal(m.chars, 0);
  assert.equal(m.segments, 0);
  assert.equal(formatSmsLength(m), '');
});

test('160 GSM-7 characters is one segment', () => {
  const m = measureSms(g(160));
  assert.equal(m.segments, 1);
  assert.equal(m.chars, 160);
  assert.equal(m.remainingInSegment, 0);
});

test('161 GSM-7 characters becomes two segments', () => {
  const m = measureSms(g(161));
  assert.equal(m.segments, 2);
  assert.equal(m.perSegment, 153);
});

test('306 GSM-7 characters is two segments, 307 is three', () => {
  // 2 x 153 = 306 — the concatenated boundary, not 2 x 160.
  assert.equal(measureSms(g(306)).segments, 2);
  assert.equal(measureSms(g(307)).segments, 3);
});

test('459 GSM-7 characters is three segments', () => {
  assert.equal(measureSms(g(459)).segments, 3);
  assert.equal(measureSms(g(460)).segments, 4);
});

// ── GSM-7 extension characters cost two septets ─────────────────────────

test('an extension character counts double toward segmentation', () => {
  // 159 plain + 1 extension char = 161 septets → two segments, even though a
  // human counts only 160 characters.
  const m = measureSms(`${g(159)}€`);
  assert.equal(m.chars, 160);
  assert.equal(m.segments, 2);
});

test('80 extension characters fill exactly one segment', () => {
  const m = measureSms('€'.repeat(80));
  assert.equal(m.chars, 80);
  assert.equal(m.segments, 1);
  assert.equal(m.remainingInSegment, 0);
});

test('braces are extension characters, so placeholders cost extra', () => {
  // Worth knowing: `{firstName}` is 11 visible characters but 13 septets.
  const m = measureSms('{firstName}');
  assert.equal(m.chars, 11);
  assert.equal(m.remainingInSegment, 160 - 13);
});

// ── UCS-2 boundaries ────────────────────────────────────────────────────

test('70 UCS-2 characters is one segment', () => {
  const m = measureSms(`${g(69)}’`);
  assert.equal(m.encoding, 'UCS-2');
  assert.equal(m.segments, 1);
  assert.equal(m.remainingInSegment, 0);
});

test('71 UCS-2 characters becomes two segments', () => {
  const m = measureSms(`${g(70)}’`);
  assert.equal(m.segments, 2);
  assert.equal(m.perSegment, 67);
});

test('134 UCS-2 characters is two segments, 135 is three', () => {
  assert.equal(measureSms(`${g(133)}’`).segments, 2);
  assert.equal(measureSms(`${g(134)}’`).segments, 3);
});

test('an emoji costs two UCS-2 units but counts as one character', () => {
  const m = measureSms('👍');
  assert.equal(m.chars, 1);
  assert.equal(m.encoding, 'UCS-2');
  assert.equal(m.remainingInSegment, 68);
});

test('35 emoji exactly fill a UCS-2 segment', () => {
  const m = measureSms('👍'.repeat(35));
  assert.equal(m.chars, 35);
  assert.equal(m.segments, 1);
  assert.equal(m.remainingInSegment, 0);
  assert.equal(measureSms('👍'.repeat(36)).segments, 2);
});

// ── Newlines and whitespace ─────────────────────────────────────────────

test('a newline is a valid GSM-7 character', () => {
  const m = measureSms('Line one\nLine two');
  assert.equal(m.encoding, 'GSM-7');
  assert.equal(m.segments, 1);
});

// ── Label formatting ────────────────────────────────────────────────────

test('label reads naturally for one segment', () => {
  assert.equal(formatSmsLength(measureSms('Hello there')), '11 chars · 1 SMS');
});

test('label singularises a one-character message', () => {
  assert.equal(formatSmsLength(measureSms('a')), '1 char · 1 SMS');
});

test('label names UCS-2 so the user knows why the limit shrank', () => {
  assert.match(formatSmsLength(measureSms('Thanks 👍')), /UCS-2/);
});

test('label omits the encoding for ordinary GSM-7 text', () => {
  assert.doesNotMatch(formatSmsLength(measureSms('Thanks')), /GSM/);
});

test('label reports multiple segments', () => {
  assert.match(formatSmsLength(measureSms(g(200))), /2 SMS/);
});

// ── Realistic composer content ──────────────────────────────────────────

test('a resolved template stays within one segment', () => {
  const body =
    'Hi Jean, this is Abdulla from ApTask. I came across your profile and have a ' +
    'Backend Engineer role that looks like a strong match. Open to a quick chat?';
  const m = measureSms(body);
  assert.equal(m.encoding, 'GSM-7');
  assert.equal(m.segments, 1);
});

test('an unresolved template body reports its literal length', () => {
  // The counter deliberately measures what's in the box, not a guess at what
  // the placeholders will resolve to.
  const body = 'Hi {firstName}, this is {recruiterName} from ApTask about the {role} role.';
  const m = measureSms(body);
  assert.equal(m.chars, body.length);
  assert.equal(m.segments, 1);
});
