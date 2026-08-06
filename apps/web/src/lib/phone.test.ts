// v0.10.218 — parseSelectedNumber tests.
//
// This function is the trust boundary for click-to-dial: every capture path
// (tel: handler, browser extension, clipboard hotkey) feeds it arbitrary text
// a human highlighted. Each case below is a shape that actually turns up in a
// recruiting workflow, not a synthetic one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSelectedNumber } from './phone.js';

const ok = (input: string) => {
  const r = parseSelectedNumber(input);
  assert.equal(r.ok, true, r.ok ? '' : `unexpectedly rejected: ${r.message}`);
  return r.ok ? r.value : null;
};
const bad = (input: string, error: string) => {
  const r = parseSelectedNumber(input);
  assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(input)}`);
  if (!r.ok) assert.equal(r.error, error);
};

// ── Everyday US formats ─────────────────────────────────────────────────

test('common US formats all normalize to the same E.164', () => {
  for (const s of [
    '+1 (732) 555-1234',
    '(732) 555-1234',
    '732-555-1234',
    '732.555.1234',
    '732 555 1234',
    '7325551234',
    '+17325551234',
    '1-732-555-1234',
  ]) {
    assert.equal(ok(s)?.e164, '+17325551234', s);
  }
});

// ── Country codes must never be rewritten ───────────────────────────────

test('an explicit country code is preserved, not coerced to US', () => {
  assert.equal(ok('+91 98765 43210')?.e164, '+919876543210');
  assert.equal(ok('+44 20 7946 0958')?.e164, '+442079460958');
  assert.equal(ok('+52 55 1234 5678')?.e164, '+525512345678');
});

test('a UK number is not silently turned into a US number', () => {
  // The failure this guards: stripping '+' and applying defaultCountry=US
  // would produce a plausible-looking but completely wrong number.
  const r = ok('+44 20 7946 0958');
  assert.ok(r!.e164.startsWith('+44'));
});

// ── Extensions ──────────────────────────────────────────────────────────

test('extensions are captured and turned into post-dial DTMF', () => {
  for (const s of [
    '732-555-1234 x203',
    '732-555-1234 ext 203',
    '732-555-1234 ext. 203',
    '(732) 555-1234 extn 203',
  ]) {
    const r = ok(s);
    assert.equal(r?.e164, '+17325551234', s);
    assert.equal(r?.extension, '203', s);
    assert.equal(r?.dialString, '+17325551234,,203', s);
  }
});

test('an extension is not absorbed into the number', () => {
  // The bug this prevents: "x203" folded into the digits gives a 13-digit
  // string that either fails at Telnyx or dials a stranger.
  assert.equal(ok('732-555-1234 x203')?.e164.length, 12);
});

test('no extension means no comma syntax', () => {
  const r = ok('+1 732 555 1234');
  assert.equal(r?.extension, '');
  assert.equal(r?.dialString, '+17325551234');
});

// ── Text as it actually arrives from real apps ──────────────────────────

test('a number embedded in a sentence is extracted', () => {
  assert.equal(ok('Call me on 732-555-1234 today')?.e164, '+17325551234');
  assert.equal(ok('Best,\nJean\nMobile: (732) 555-1234')?.e164, '+17325551234');
});

test('Word / Outlook unicode punctuation is handled', () => {
  // en-dash, non-breaking space, fullwidth plus — all common from copy-paste.
  assert.equal(ok('+1 732–555–1234')?.e164, '+17325551234');
  assert.equal(ok('732 555 1234')?.e164, '+17325551234');
});

test('tel: and callto: URIs parse directly', () => {
  assert.equal(ok('tel:+17325551234')?.e164, '+17325551234');
  assert.equal(ok('callto:+17325551234')?.e164, '+17325551234');
  const r = ok('tel:+17325551234;ext=203');
  assert.equal(r?.e164, '+17325551234');
  assert.equal(r?.extension, '203');
});

test('the longest candidate wins when text holds several numbers', () => {
  // "Suite 200" should not beat the actual phone number.
  assert.equal(ok('Suite 200, 732-555-1234')?.e164, '+17325551234');
});

// ── Things that must be refused ─────────────────────────────────────────

test('vanity numbers are refused rather than silently mangled', () => {
  bad('1-800-FLOWERS', 'invalid');
  bad('855-CALL-NOW', 'invalid');
});

test('non-phone text is refused', () => {
  bad('hello world', 'no_digits');
  bad('', 'empty');
  bad('   ', 'empty');
});

test('too-short numbers are refused', () => {
  bad('12345', 'too_few_digits');
});

test('a 7-digit local number is refused as invalid, not dialed', () => {
  // Long enough to clear the digit floor, but not a valid US number without
  // an area code. Refusing is right — guessing an area code would dial a
  // stranger.
  bad('555-1234', 'invalid');
});

test('prose around a number does not trigger the vanity guard', () => {
  // Regression: the first version of the vanity check rejected any two
  // letters after the first digit, which killed the most common real input.
  assert.equal(parseSelectedNumber('Call me on 732-555-1234 today').ok, true);
  assert.equal(parseSelectedNumber('office 732-555-1234 please').ok, true);
});

test('absurdly long digit runs are refused', () => {
  bad('1234567890123456789', 'too_many_digits');
});

test('a whole-document selection is refused, not parsed', () => {
  bad('a'.repeat(201) + ' 732-555-1234', 'too_long');
});

test('an invoice or ID number is refused', () => {
  // 9 digits, not a valid US number — must not become a dial attempt.
  bad('Invoice 123456789', 'invalid');
});

// ── Display ─────────────────────────────────────────────────────────────

test('display is human-readable and mentions the extension', () => {
  assert.match(ok('7325551234')!.display, /732/);
  assert.match(ok('732-555-1234 x203')!.display, /ext\. 203/);
});
