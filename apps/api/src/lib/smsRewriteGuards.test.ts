// v0.10.216 — AI rewrite guard tests.
//
// The model call itself can't be tested without a live key, so these cover
// the part that actually protects the user: the mechanical checks that decide
// whether a rewrite is allowed to reach the review sheet at all. Each case
// below is a real failure mode, not a synthetic one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRewrite, cleanModelText, factsToVerify } from './smsRewriteGuards.js';

const ok = (original: string, candidate: string) => {
  const v = checkRewrite(original, candidate);
  assert.equal(v.ok, true, v.ok ? '' : `unexpectedly rejected: ${v.reason}`);
  return v.ok ? v : null;
};
const rejected = (original: string, candidate: string, pattern: RegExp) => {
  const v = checkRewrite(original, candidate);
  assert.equal(v.ok, false, 'expected rejection');
  if (!v.ok) assert.match(v.reason, pattern);
};

// ── The happy path ──────────────────────────────────────────────────────

test('a clean grammar fix passes', () => {
  ok(
    'hey {firstName} can u snd me ur updated resume by fri, need it for the {role} sub',
    'Hi {firstName}, could you send me your updated resume by Friday? I need it for the {role} submission.',
  );
});

test('a shorter rewrite passes', () => {
  ok(
    'Hi {firstName}, I was just wondering whether or not you might possibly be available',
    'Hi {firstName}, are you available?',
  );
});

test('reordering placeholders is allowed', () => {
  ok(
    'The {role} role at {client} is open',
    '{client} has an open {role} role.',
  );
});

test('an unchanged message passes', () => {
  ok('Hi {firstName}, are you available for a call tomorrow?', 'Hi {firstName}, are you available for a call tomorrow?');
});

// ── Placeholder integrity ───────────────────────────────────────────────

test('dropping a placeholder is rejected', () => {
  rejected(
    'Hi {firstName}, the {role} role is open',
    'Hi {firstName}, the role is open.',
    /changed the template fields/,
  );
});

test('renaming a placeholder is rejected', () => {
  rejected(
    'Hi {firstName}, are you free?',
    'Hi {name}, are you free?',
    /changed the template fields/,
  );
});

test('adding a placeholder is rejected', () => {
  rejected(
    'Hi {firstName}, are you free?',
    'Hi {firstName} {lastName}, are you free?',
    /changed the template fields/,
  );
});

test('filling a placeholder with a real value is rejected', () => {
  rejected(
    'Hi {firstName}, are you free tomorrow?',
    'Hi Jean, are you free tomorrow?',
    /changed the template fields/,
  );
});

test('a placeholder duplicated by the rewrite is rejected', () => {
  rejected(
    'Hi {firstName}, thanks',
    'Hi {firstName}, thanks {firstName}',
    /changed the template fields/,
  );
});

test('changing only placeholder casing is allowed', () => {
  // Canonicalisation makes {FirstName} and {firstName} the same field, so
  // this is a no-op as far as what the candidate receives.
  ok('Hi {FirstName}, are you free tomorrow?', 'Hi {firstName}, are you free tomorrow?');
});

test('a rewrite that introduces a stray brace is rejected', () => {
  rejected(
    'Hi {firstName}, are you around today?',
    'Hi {firstName}, are you around {today?',
    /invalid template field syntax/,
  );
});

// ── Numbers: the guard that protects money ──────────────────────────────

test('changing a rate is rejected', () => {
  rejected(
    'Hi {firstName}, the rate is 65/hr for the {role} role',
    'Hi {firstName}, the rate is 60/hr for the {role} role.',
    /changed or dropped a number/,
  );
});

test('spelling out a number above twelve is rejected', () => {
  // Only 0-12 have accepted word forms (see NUMBER_WORDS). A rate is exactly
  // the kind of value that must survive as digits — "sixty-five" is where a
  // misreading turns into a mispriced placement.
  rejected(
    'Hi {firstName}, we can offer 65/hr',
    'Hi {firstName}, we can offer sixty-five dollars per hour.',
    /changed or dropped a number/,
  );
});

test('dropping a phone number is rejected', () => {
  rejected(
    'Call me on 7322001305 when you get a chance',
    'Please call me when you get a chance.',
    /changed or dropped a number/,
  );
});

test('a decimal rate is preserved exactly', () => {
  ok('rate is 62.50/hr ok?', 'Is the rate of 62.50/hr acceptable?');
  rejected('rate is 62.50/hr ok?', 'Is the rate of 62.5/hr acceptable?', /number/);
});

test('reformatting around a number is allowed as long as digits survive', () => {
  ok('interview on 12 at 2 pm', 'Your interview is on the 12th at 2 PM.');
});

test('a number range keeps both endpoints', () => {
  ok('rate range 60-70 works', 'The rate range of 60-70 works.');
  rejected('rate range 60-70 works', 'The rate range of 60 works.', /number/);
});

// ── Links and emails ────────────────────────────────────────────────────

test('altering a URL is rejected', () => {
  // Digit-free path so this isolates the link guard — a URL containing
  // numbers trips the (earlier) number guard first, which is also a correct
  // rejection but a different code path.
  rejected(
    'join here https://meet.example.com/abc-xyz at 2pm',
    'Please join here: https://meet.example.com/abc at 2 PM.',
    /altered a link or email/,
  );
});

test('truncating a URL that contains digits is also rejected', () => {
  rejected(
    'join here https://meet.example.com/abc-123 at 2pm',
    'Please join here: https://meet.example.com/abc at 2 PM.',
    /number|link/,
  );
});

test('dropping an email is rejected', () => {
  rejected(
    'snd ur resume to recruiting@aptask.com asap',
    'Please send your resume as soon as possible.',
    /altered a link or email/,
  );
});

test('a preserved URL passes', () => {
  ok(
    'join here https://meet.example.com/abc-123 at 2pm',
    'Please join here: https://meet.example.com/abc-123 at 2 PM.',
  );
});

// ── Length ──────────────────────────────────────────────────────────────

test('a padded-out rewrite is rejected', () => {
  const original = 'Hi {firstName}, can you talk tomorrow?';
  const bloated =
    'Hi {firstName}, I hope this message finds you well. I wanted to reach out to ask ' +
    'whether you might have some availability tomorrow for a brief conversation about ' +
    'an opportunity I think could be a great fit for your background and career goals.';
  rejected(original, bloated, /too long/);
});

test('short drafts get room to be corrected', () => {
  // 20 chars in, 34 out — a 1.7x expansion that is nonetheless the correct
  // rewrite. The +40 floor exists for exactly this case.
  ok('hey can u snd resume', 'Hi, could you send me your resume?');
});

test('long drafts are held to the tighter ratio', () => {
  const original = 'a'.repeat(400);
  ok(original, 'a'.repeat(455));
  rejected(original, 'a'.repeat(600), /too long/);
});

test('an empty rewrite is rejected', () => {
  rejected('Hi {firstName}, are you free?', '', /came back empty/);
});

// ── Proper nouns: warn, never block ─────────────────────────────────────

test('a dropped name warns but does not block', () => {
  const v = ok(
    'Hi {firstName}, Priya said you worked at Acme before',
    'Hi {firstName}, I heard you worked there before.',
  );
  assert.ok(v);
  assert.equal(v!.warnings.length, 1);
  assert.match(v!.warnings[0], /Priya/);
  assert.match(v!.warnings[0], /Acme/);
});

test('preserved names produce no warning', () => {
  const v = ok(
    'Hi {firstName}, Priya said u worked at Acme',
    'Hi {firstName}, Priya mentioned you worked at Acme.',
  );
  assert.deepEqual(v!.warnings, []);
});

test('a sentence-initial capital is not treated as a name', () => {
  // "Thanks" opens the second sentence, so dropping it must not warn —
  // this is the false positive that would make the warning useless noise.
  const v = ok('Hi {firstName}. Thanks for the quick reply', 'Hi {firstName}, thanks for replying so quickly.');
  assert.deepEqual(v!.warnings, []);
});

// ── Model output cleanup ────────────────────────────────────────────────

test('cleanModelText strips a wrapping pair of quotes', () => {
  assert.equal(cleanModelText('"Hi there, are you free?"'), 'Hi there, are you free?');
  assert.equal(cleanModelText('“Hi there.”'), 'Hi there.');
});

test('cleanModelText keeps interior quotes intact', () => {
  assert.equal(
    cleanModelText('Reply "yes" and I will submit'),
    'Reply "yes" and I will submit',
  );
});

test('cleanModelText strips a markdown fence', () => {
  assert.equal(cleanModelText('```\nHi there\n```'), 'Hi there');
  assert.equal(cleanModelText('```text\nHi there\n```'), 'Hi there');
});

test('cleanModelText strips a preamble line', () => {
  assert.equal(
    cleanModelText("Here's the rewritten message:\n\nHi {firstName}, are you free?"),
    'Hi {firstName}, are you free?',
  );
});

test('cleanModelText leaves ordinary text alone', () => {
  assert.equal(cleanModelText('  Hi {firstName}, are you free?  '), 'Hi {firstName}, are you free?');
});

test("cleanModelText does not eat an apostrophe-led message", () => {
  assert.equal(cleanModelText("I'm following up on the role"), "I'm following up on the role");
});

// ── v0.10.216: numeral↔word equivalence ─────────────────────────────────
//
// Regression tests for the first false positive observed in production-shaped
// use: qwen3.5:9b rewrote "last 2 paystubs" as "last two payslips" — a good
// edit that the original guard rejected.

test('spelling a small number out in words is allowed', () => {
  ok(
    'hi {firstName} pls send PAN aadhaar n last 2 paystubs by {dueDate} for bgv',
    'Hi {firstName}, please send your PAN, Aadhaar, and the last two payslips by {dueDate} for background verification.',
  );
});

test('word form is accepted for each mapped numeral', () => {
  const words = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  words.forEach((word, n) => {
    ok(`please send ${n} documents today`, `Please send ${word} documents today.`);
  });
});

test('a changed value is still rejected even in word form', () => {
  rejected('the rate is 65/hr', 'The rate is sixty/hr.', /number/);
  rejected('send 2 paystubs', 'Send three paystubs.', /number/);
});

test('a number that simply disappears is still rejected', () => {
  rejected('send 2 paystubs by friday', 'Send your paystubs by Friday.', /number/);
});

test('word-boundary matching prevents a false positive', () => {
  // "one" must not be considered present merely because "money" contains it.
  rejected('I have 1 update about money', 'I have an update about money.', /number/);
});

test('large numbers have no word form, so they must survive as digits', () => {
  ok('call me on 7322001305', 'Please call me on 7322001305.');
  rejected('call me on 7322001305', 'Please call me on my cell.', /number/);
});

// ── v0.10.216: added-fact warnings ──────────────────────────────────────

test('a currency symbol the model invented produces a warning, not a rejection', () => {
  // Both Qwen models were observed doing exactly this to "65/hr".
  const v = ok('Hi {firstName}, the rate is 65/hr', 'Hi {firstName}, the rate is $65/hr.');
  assert.equal(v!.warnings.length, 1);
  assert.match(v!.warnings[0], /added \$/);
});

test('a currency symbol present in the original produces no warning', () => {
  const v = ok('rate is $65/hr ok?', 'Is the rate of $65/hr acceptable?');
  assert.deepEqual(v!.warnings, []);
});

// ── v0.10.216: factsToVerify ────────────────────────────────────────────

test('factsToVerify surfaces links, money, and day names', () => {
  const facts = factsToVerify(
    'Hi Jean, join https://meet.example.com/abc-xyz on Friday at 2pm — rate is $65/hr',
  );
  assert.ok(facts.some((f) => f.includes('meet.example.com')), 'link');
  assert.ok(facts.some((f) => f.includes('65')), 'rate');
  assert.ok(facts.some((f) => /friday/i.test(f)), 'day');
});

test('factsToVerify puts the link first — least detectable by reading', () => {
  const facts = factsToVerify('rate 65/hr, see https://x.example.com/y on Monday');
  assert.match(facts[0], /^https:\/\//);
});

test('factsToVerify finds an email address', () => {
  const facts = factsToVerify('send it to recruiting@aptask.com today');
  assert.ok(facts.some((f) => f === 'recruiting@aptask.com'));
});

test('factsToVerify returns nothing for a message with no checkable facts', () => {
  assert.deepEqual(factsToVerify('Hi, are you available for a quick call?'), []);
});

test('factsToVerify deduplicates and caps the list', () => {
  const facts = factsToVerify('65 65 65 monday monday 1 2 3 4 5 6 7 8 9');
  assert.equal(new Set(facts.map((f) => f.toLowerCase())).size, facts.length);
  assert.ok(facts.length <= 6);
});
