// v0.10.218 — page-scanner detection tests.
//
// Run: npm run test -w apps/extension
//
// The "should ignore" half is the important half. A recruiting page is full of
// numeric runs that are not phone numbers, and underlining candidate IDs and
// requisition numbers is precisely what makes a user disable the feature. The
// bias is deliberately toward false negatives: a missed number costs one
// copy-paste, a wrong underline costs trust in the whole thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectNumbers } from './detect.js';

const firstE164 = (s: string) => detectNumbers(s)[0]?.e164;

test('detects the formats that appear on real pages', () => {
  for (const [text, expected] of [
    ['Mobile: (732) 555-1234', '+17325551234'],
    ['Call 732-555-1234 to reach me', '+17325551234'],
    ['732.555.1234', '+17325551234'],
    ['+1 732 555 1234', '+17325551234'],
    ['1-732-555-1234', '+17325551234'],
    ['7325551234', '+17325551234'],
  ] as const) {
    assert.equal(firstE164(text), expected, text);
  }
});

test('preserves an explicit country code rather than assuming US', () => {
  assert.equal(firstE164('Contact: +91 98765 43210'), '+919876543210');
  assert.equal(firstE164('Tel +44 20 7946 0958'), '+442079460958');
});

test('ignores identifier-shaped numbers', () => {
  for (const text of [
    'Invoice 1234567890',
    'Req # 2024551234',
    'Candidate ID 8675309124',
    'Order no. 7325551234',
    'Reference: 7325551234',
    'PO# 7325551234',
    'Acct: 7325551234',
    'Ticket #7325551234',
    'Case no. 7325551234',
    'Employee number 7325551234',
  ]) {
    assert.deepEqual(detectNumbers(text), [], `false positive: ${text}`);
  }
});

test('ignores money, dates, versions, and other numerics', () => {
  for (const text of [
    'Salary $120000 per year',
    'Posted 2026-08-06',
    'ZIP 08540-1234',
    'Rate 65.00/hr for 40 hrs',
    'Version 10.2.1.4',
    'Suite 200',
    '12345',
    'SSN 123-45-6789',
    'Tracking 9400111899223197428490',
  ]) {
    assert.deepEqual(detectNumbers(text), [], `false positive: ${text}`);
  }
});

test('finds several numbers in one block of text', () => {
  const hits = detectNumbers('Office 732-555-1234, mobile 732-555-9876');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].e164, '+17325551234');
  assert.equal(hits[1].e164, '+17325559876');
});

test('reports offsets so the DOM can be spliced accurately', () => {
  const text = 'Call 732-555-1234 now';
  const [hit] = detectNumbers(text);
  assert.equal(text.slice(hit.start, hit.end), hit.raw);
});

test('skips absurdly long text rather than hanging the page', () => {
  assert.deepEqual(detectNumbers('7325551234 '.repeat(1000)), []);
});

test('empty and digitless text is cheap and safe', () => {
  assert.deepEqual(detectNumbers(''), []);
  assert.deepEqual(detectNumbers('no numbers at all here'), []);
});
