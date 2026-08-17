// Tests for template placeholder resolution.
//
// Written after a live bug: the multi-select send read the signed-in user's
// first name from a sessionStorage key that nothing in the app ever writes, so
// {recruiter} was permanently unresolved and the review gate refused every
// template using it. The 1:1 composer was fine because it takes the name from
// /me. Nothing about the interpolation was wrong — only what was fed to it —
// which is exactly the kind of fault a test on the fill contract catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplateBody, remainingPlaceholders } from './smsPlaceholderFill';
import type { SmsPlaceholder } from '../api';

/** Trimmed stand-in for what GET /me/sms-placeholders serves. */
const REGISTRY: SmsPlaceholder[] = [
  { key: 'firstName', label: 'Contact first name', source: 'contact' },
  { key: 'lastName', label: 'Contact last name', source: 'contact' },
  { key: 'jobTitle', label: 'Contact job title', source: 'contact' },
  { key: 'companyName', label: "Contact's current company", source: 'contact' },
  { key: 'recruiterName', label: 'Your first name', source: 'user' },
  { key: 'recruiter', label: 'Your first name', source: 'user', hidden: true },
  { key: 'role', label: 'Role being pitched', source: 'manual' },
  { key: 'client', label: 'Hiring client', source: 'manual' },
] as SmsPlaceholder[];

// ── The regression ──────────────────────────────────────────────────────

test('{recruiter} resolves from recruiterFirstName', () => {
  const out = fillTemplateBody(
    'Hi {firstName}, this is {recruiter} from ApTask.',
    { displayName: 'Shirin Bilimoria', recruiterFirstName: 'Abdulla' },
    REGISTRY,
  );
  assert.equal(out, 'Hi Shirin, this is Abdulla from ApTask.');
});

test('{recruiterName} — the non-legacy spelling — resolves identically', () => {
  const out = fillTemplateBody(
    'this is {recruiterName}',
    { recruiterFirstName: 'Abdulla' },
    REGISTRY,
  );
  assert.equal(out, 'this is Abdulla');
});

// The exact failure mode: a caller that supplies no recruiter name at all
// leaves the token literal, which the bulk review gate then blocks. This test
// documents that the module is behaving correctly and the caller was at fault.
test('a missing recruiter name leaves {recruiter} literal rather than blanking it', () => {
  const out = fillTemplateBody('this is {recruiter}', { recruiterFirstName: null }, REGISTRY);
  assert.equal(out, 'this is {recruiter}', 'a visible token beats a silent empty gap');
  assert.deepEqual(remainingPlaceholders(out, REGISTRY), ['recruiter']);
});

test('an empty-string recruiter name is treated as missing, not as ""', () => {
  const out = fillTemplateBody('this is {recruiter}', { recruiterFirstName: '   ' }, REGISTRY);
  assert.equal(out, 'this is {recruiter}');
});

// ── Explicit contact names ──────────────────────────────────────────────

test('explicit contact names are used in preference to splitting a display string', () => {
  const out = fillTemplateBody(
    '{firstName} {lastName}',
    // A display string that would split wrong: honorific first, comma order.
    { displayName: 'Dr. Amy Chen', contactFirstName: 'Amy', contactLastName: 'Chen' },
    REGISTRY,
  );
  assert.equal(out, 'Amy Chen', 'splitting "Dr. Amy Chen" would have yielded "Dr." as the first name');
});

test('JobDiva still outranks explicit names, so the 1:1 composer is unchanged', () => {
  const out = fillTemplateBody(
    '{firstName}',
    {
      contactFirstName: 'Bob',
      jobDiva: { firstName: 'Robert', lastName: 'Smith' } as never,
    },
    REGISTRY,
  );
  assert.equal(out, 'Robert');
});

test('display-name splitting still works when nothing explicit is supplied', () => {
  assert.equal(
    fillTemplateBody('{firstName}', { displayName: 'Nilesh Darekar' }, REGISTRY),
    'Nilesh',
  );
});

test('a display name that is really a phone number yields no first name', () => {
  const out = fillTemplateBody('Hi {firstName}', { displayName: '+1 (732) 555-1000' }, REGISTRY);
  assert.equal(out, 'Hi {firstName}', 'must never greet someone by their phone number');
});

// ── Manual placeholders stay literal, by design ─────────────────────────

test('manual placeholders are never auto-resolved', () => {
  const out = fillTemplateBody(
    'the {role} role at {client}',
    { displayName: 'Shirin', recruiterFirstName: 'Abdulla' },
    REGISTRY,
  );
  assert.equal(out, 'the {role} role at {client}');
  assert.deepEqual(remainingPlaceholders(out, REGISTRY).sort(), ['client', 'role']);
});

// This is why the bulk composer needs its own "fill in for everyone" inputs:
// 18 of the 20 company templates contain {client} and 10 contain {role}, so a
// gate that refuses any leftover token would block almost all of them.
test('a realistic company template leaves exactly the manual fields open', () => {
  const body = 'Hi {firstName}, this is {recruiter} from ApTask about the {role} role at {client}.';
  const out = fillTemplateBody(
    body,
    { contactFirstName: 'Shirin', recruiterFirstName: 'Abdulla' },
    REGISTRY,
  );
  assert.equal(out, 'Hi Shirin, this is Abdulla from ApTask about the {role} role at {client}.');
  assert.deepEqual(remainingPlaceholders(out, REGISTRY).sort(), ['client', 'role']);
});

// ── Unknown tokens ──────────────────────────────────────────────────────

test('a token not in the registry is left completely alone', () => {
  // A typo. The template editor validates on save so a stored body can't carry
  // one, but the bulk composer accepts free text — hence its scanner is
  // registry-independent and catches this too.
  const out = fillTemplateBody('Hi {frstName}', { contactFirstName: 'Amy' }, REGISTRY);
  assert.equal(out, 'Hi {frstName}');
  assert.deepEqual(remainingPlaceholders(out, REGISTRY), [], 'unknown keys are not registry keys');
});

test('case-insensitive matching works for a body written before normalisation', () => {
  assert.equal(
    fillTemplateBody('Hi {FirstName}', { contactFirstName: 'Amy' }, REGISTRY),
    'Hi Amy',
  );
});
