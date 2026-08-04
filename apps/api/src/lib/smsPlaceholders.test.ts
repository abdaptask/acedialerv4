// v0.10.216 — Placeholder registry + validator tests.
//
// Run: npm run test -w apps/api
//
// The load-bearing test here is "every seeded template body validates
// clean". Strict validation is new; the 20 templates in production predate
// it. If someone adds a key to a seed body without adding it to the
// registry, that test fails before it can reject an admin's save.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SMS_PLACEHOLDERS,
  canonicalPlaceholderKey,
  describePlaceholderProblem,
  isPlaceholderScanClean,
  placeholderMultiset,
  publicPlaceholders,
  scanPlaceholders,
  suggestPlaceholder,
} from './smsPlaceholders.js';
import { SMS_TEMPLATE_SEEDS } from './smsTemplateSeed.js';

// ── Registry integrity ──────────────────────────────────────────────────

test('registry keys are unique and camelCase', () => {
  const seen = new Set<string>();
  for (const p of SMS_PLACEHOLDERS) {
    assert.equal(seen.has(p.key), false, `duplicate key ${p.key}`);
    seen.add(p.key);
    assert.match(p.key, /^[a-z][a-zA-Z0-9]*$/, `${p.key} is not camelCase`);
  }
});

test('no key or alias collides with another entry', () => {
  const seen = new Map<string, string>();
  for (const p of SMS_PLACEHOLDERS) {
    for (const spelling of [p.key, ...(p.aliases ?? [])]) {
      const lower = spelling.toLowerCase();
      const prior = seen.get(lower);
      assert.equal(prior, undefined, `${spelling} claimed by both ${prior} and ${p.key}`);
      seen.set(lower, p.key);
    }
  }
});

test('every placeholder has a label and a sample', () => {
  for (const p of SMS_PLACEHOLDERS) {
    assert.ok(p.label.length > 0, `${p.key} missing label`);
    assert.ok(p.sample.length > 0, `${p.key} missing sample`);
  }
});

test('publicPlaceholders pre-renders the brace token', () => {
  for (const p of publicPlaceholders()) {
    assert.equal(p.token, `{${p.key}}`);
  }
});

// ── The production regression guard ─────────────────────────────────────

test('all 20 seeded template bodies validate clean', () => {
  assert.equal(SMS_TEMPLATE_SEEDS.length, 20);
  for (const seed of SMS_TEMPLATE_SEEDS) {
    const scan = scanPlaceholders(seed.body);
    assert.deepEqual(
      scan.malformed,
      [],
      `"${seed.name}" has malformed placeholders`,
    );
    assert.deepEqual(
      scan.unknown,
      [],
      `"${seed.name}" uses unregistered field(s): ${scan.unknown.map((u) => u.raw).join(', ')}`,
    );
  }
});

test('the 16 keys observed in production are all registered', () => {
  // Captured from a read-only query against the live sms_templates table
  // before strict validation was introduced.
  const inProduction = [
    'askedRate', 'client', 'clientRate', 'currentCompany', 'date', 'dueDate',
    'firstName', 'location', 'option1', 'option2', 'rate', 'recruiter',
    'referrer', 'role', 'startDate', 'time',
  ];
  for (const key of inProduction) {
    assert.equal(canonicalPlaceholderKey(key), key, `${key} not registered`);
  }
});

test('seeded bodies are unchanged by normalization', () => {
  // Normalization only fixes casing/aliases. Since the seeds already use
  // canonical spellings, normalizing must be a no-op — proof that saving an
  // existing template can't silently rewrite an admin's text.
  for (const seed of SMS_TEMPLATE_SEEDS) {
    assert.equal(scanPlaceholders(seed.body).normalizedBody, seed.body, seed.name);
  }
});

// ── Case-insensitive matching + normalization ───────────────────────────

test('matching is case-insensitive', () => {
  for (const spelling of ['firstName', 'FirstName', 'FIRSTNAME', 'firstname', 'fIrStNaMe']) {
    assert.equal(canonicalPlaceholderKey(spelling), 'firstName', spelling);
  }
});

test('PascalCase input normalizes to canonical casing', () => {
  const scan = scanPlaceholders('Hi {FirstName} {LastName}, this is {RecruiterName}.');
  assert.equal(isPlaceholderScanClean(scan), true);
  assert.equal(scan.normalizedBody, 'Hi {firstName} {lastName}, this is {recruiterName}.');
  assert.deepEqual(scan.keys, ['firstName', 'lastName', 'recruiterName']);
});

test('snake_case aliases resolve and normalize', () => {
  const scan = scanPlaceholders('{first_name} {job_title} {company_name}');
  assert.equal(isPlaceholderScanClean(scan), true);
  assert.equal(scan.normalizedBody, '{firstName} {jobTitle} {companyName}');
});

test('the five fields named in the feature request all resolve', () => {
  for (const [input, expected] of [
    ['FirstName', 'firstName'],
    ['LastName', 'lastName'],
    ['JobTitle', 'jobTitle'],
    ['CompanyName', 'companyName'],
    ['RecruiterName', 'recruiterName'],
  ] as const) {
    assert.equal(canonicalPlaceholderKey(input), expected, input);
  }
});

test('legacy keys stay valid but are hidden from the picker', () => {
  for (const key of ['recruiter', 'currentCompany']) {
    assert.equal(canonicalPlaceholderKey(key), key);
    assert.equal(SMS_PLACEHOLDERS.find((p) => p.key === key)?.hidden, true);
  }
});

// ── Malformed syntax ────────────────────────────────────────────────────

test('unclosed brace is rejected', () => {
  const scan = scanPlaceholders('Hi {firstName, are you around?');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.equal(scan.malformed.length, 1);
  assert.match(scan.malformed[0].reason, /never closed/);
});

test('stray closing brace is rejected', () => {
  const scan = scanPlaceholders('Hi firstName} there');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.match(scan.malformed[0].reason, /no matching opening/);
});

test('empty braces are rejected', () => {
  const scan = scanPlaceholders('Hi {} there');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.match(scan.malformed[0].reason, /Empty field name/);
});

test('whitespace inside braces is rejected', () => {
  const scan = scanPlaceholders('Hi { firstName } there');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.match(scan.malformed[0].reason, /cannot contain spaces/);
});

test('nested braces are rejected', () => {
  const scan = scanPlaceholders('Hi {a{firstName}}');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.ok(scan.malformed.some((m) => /nested/.test(m.reason)));
});

test('a body with no placeholders is clean', () => {
  const scan = scanPlaceholders('Hi, are you available for a quick call?');
  assert.equal(isPlaceholderScanClean(scan), true);
  assert.deepEqual(scan.keys, []);
  assert.equal(scan.normalizedBody, 'Hi, are you available for a quick call?');
});

test('empty body is clean', () => {
  assert.equal(isPlaceholderScanClean(scanPlaceholders('')), true);
});

// ── Unknown keys + suggestions ──────────────────────────────────────────

test('unknown key is rejected with a suggestion', () => {
  const scan = scanPlaceholders('Hi {firstNmae}');
  assert.equal(isPlaceholderScanClean(scan), false);
  assert.equal(scan.unknown.length, 1);
  assert.equal(scan.unknown[0].suggestion, 'firstName');
  assert.match(describePlaceholderProblem(scan) ?? '', /did you mean \{firstName\}/);
});

test('a wildly unrelated key gets no suggestion', () => {
  const scan = scanPlaceholders('Hi {xylophone}');
  assert.equal(scan.unknown.length, 1);
  assert.equal(scan.unknown[0].suggestion, undefined);
});

test('suggestions never point at a hidden legacy key', () => {
  // 'recruiterNam' is 1 edit from the offered 'recruiterName' and 4 from the
  // hidden legacy 'recruiter'. Both are valid keys, but only the offered one
  // may be suggested — we never teach a user a spelling we've retired.
  assert.equal(suggestPlaceholder('recruiterNam'), 'recruiterName');
  // 'compayName' is 1 edit from 'companyName' and 3 from hidden 'currentCompany'.
  assert.equal(suggestPlaceholder('compayName'), 'companyName');
});

test('a typo close only to a hidden key yields no suggestion', () => {
  // 'recruter' is 1 edit from the hidden 'recruiter' but 5 from any offered
  // key. Rather than surface a retired spelling we stay silent and let the
  // user reach for the field picker.
  assert.equal(suggestPlaceholder('recruter'), undefined);
});

test('unknown keys are preserved verbatim in normalizedBody', () => {
  const body = 'Hi {firstNmae} and {FirstName}';
  const scan = scanPlaceholders(body);
  // The valid one is normalized; the invalid one is left exactly as typed.
  assert.equal(scan.normalizedBody, 'Hi {firstNmae} and {firstName}');
});

test('describePlaceholderProblem returns null when clean', () => {
  assert.equal(describePlaceholderProblem(scanPlaceholders('Hi {firstName}')), null);
});

test('malformed is reported ahead of unknown', () => {
  const scan = scanPlaceholders('{} and {nope}');
  assert.match(describePlaceholderProblem(scan) ?? '', /Empty field name/);
});

// ── Multiset (AI rewrite guard) ─────────────────────────────────────────

test('multiset counts duplicates and ignores order', () => {
  assert.deepEqual(
    placeholderMultiset('{firstName} x {role} y {firstName}'),
    ['firstName', 'firstName', 'role'],
  );
  assert.deepEqual(
    placeholderMultiset('{role} {firstName} {firstName}'),
    placeholderMultiset('{firstName} {firstName} {role}'),
  );
});

test('multiset is casing-insensitive, so a case change alone passes the guard', () => {
  assert.deepEqual(
    placeholderMultiset('Hi {FirstName}'),
    placeholderMultiset('Hi {firstName}'),
  );
});

test('multiset differs when a placeholder is dropped or added', () => {
  assert.notDeepEqual(
    placeholderMultiset('Hi {firstName}, re {role}'),
    placeholderMultiset('Hi {firstName}, re the role'),
  );
  assert.notDeepEqual(
    placeholderMultiset('Hi {firstName}'),
    placeholderMultiset('Hi {firstName} {firstName}'),
  );
});
