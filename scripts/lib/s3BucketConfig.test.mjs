// The merge helpers behind scripts/setup-s3-bucket.mjs. The S3 put APIs
// these feed are whole-config replacements, so anything these functions drop
// is deleted from the bucket. The non-negotiable property under test:
// apt-dialer's existing PublicReadSpecificUpdates statement (and any other
// pre-existing rule) survives every merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCorsRule, mergeLifecycleRule, mergePolicyStatement } from './s3BucketConfig.mjs';

const MEDIA_STATEMENT = {
  Sid: 'PublicReadAceMedia',
  Effect: 'Allow',
  Principal: '*',
  Action: 's3:GetObject',
  Resource: 'arn:aws:s3:::apt-dialer/media/*',
};

const UPDATES_STATEMENT = {
  Sid: 'PublicReadSpecificUpdates',
  Effect: 'Allow',
  Principal: '*',
  Action: 's3:GetObject',
  Resource: 'arn:aws:s3:::apt-dialer/updates/*',
};

// ── bucket policy ──────────────────────────────────────────────────────────

test('appends to an existing policy without dropping the updates statement', () => {
  const current = { Version: '2012-10-17', Statement: [UPDATES_STATEMENT] };
  const { next, skipped, keptSids } = mergePolicyStatement(current, MEDIA_STATEMENT);

  assert.equal(skipped, false);
  assert.deepEqual(keptSids, ['PublicReadSpecificUpdates']);
  assert.equal(next.Statement.length, 2);
  assert.deepEqual(next.Statement[0], UPDATES_STATEMENT);
  assert.deepEqual(next.Statement[1], MEDIA_STATEMENT);
});

test('creates a policy from scratch when the bucket has none', () => {
  // get-bucket-policy returns NoSuchBucketPolicy on a fresh bucket; the
  // caller passes null for that.
  const { next, skipped } = mergePolicyStatement(null, MEDIA_STATEMENT);
  assert.equal(skipped, false);
  assert.equal(next.Version, '2012-10-17');
  assert.deepEqual(next.Statement, [MEDIA_STATEMENT]);
});

test('is idempotent — a second run appends nothing', () => {
  const current = { Version: '2012-10-17', Statement: [UPDATES_STATEMENT, MEDIA_STATEMENT] };
  const { next, skipped } = mergePolicyStatement(current, MEDIA_STATEMENT);
  assert.equal(skipped, true);
  assert.equal(next.Statement.length, 2);
});

test('does not mutate the policy it was given', () => {
  const current = { Version: '2012-10-17', Statement: [UPDATES_STATEMENT] };
  mergePolicyStatement(current, MEDIA_STATEMENT);
  assert.equal(current.Statement.length, 1);
});

test('preserves statements that carry no Sid', () => {
  // Sid is optional in IAM. An unnamed statement must still survive, even
  // though it cannot be reported in keptSids.
  const unnamed = { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: '*' };
  const { next, keptSids } = mergePolicyStatement({ Statement: [unnamed] }, MEDIA_STATEMENT);
  assert.deepEqual(keptSids, []);
  assert.equal(next.Statement.length, 2);
  assert.deepEqual(next.Statement[0], unnamed);
});

// ── lifecycle ──────────────────────────────────────────────────────────────

const VM_RULE = {
  ID: 'expire-voicemail-recordings-30d',
  Filter: { Prefix: 'media/voicemails/' },
  Status: 'Enabled',
  Expiration: { Days: 30 },
};

test('appends the voicemail rule alongside existing rules', () => {
  const existing = { ID: 'abort-mpu', Filter: { Prefix: '' }, Status: 'Enabled' };
  const { next, skipped, legacyIds } = mergeLifecycleRule([existing], VM_RULE);
  assert.equal(skipped, false);
  assert.deepEqual(legacyIds, []);
  assert.deepEqual(next.Rules, [existing, VM_RULE]);
});

test('the appended rule is prefix-scoped to voicemails only', () => {
  // A rule without this filter would expire every greeting and MMS
  // attachment after 30 days. Those are long-lived (spec §9).
  const { next } = mergeLifecycleRule([], VM_RULE);
  assert.equal(next.Rules[0].Filter.Prefix, 'media/voicemails/');
  assert.equal(next.Rules[0].Expiration.Days, 30);
});

test('is idempotent on rule ID', () => {
  const { next, skipped } = mergeLifecycleRule([VM_RULE], VM_RULE);
  assert.equal(skipped, true);
  assert.equal(next.Rules.length, 1);
});

test('flags legacy top-level-Prefix rules the API would reject', () => {
  const legacy = { ID: 'old-style', Prefix: 'updates/', Status: 'Enabled' };
  const { legacyIds } = mergeLifecycleRule([legacy], VM_RULE);
  assert.deepEqual(legacyIds, ['old-style']);
});

test('names an unnamed legacy rule rather than reporting undefined', () => {
  const { legacyIds } = mergeLifecycleRule([{ Prefix: 'x/', Status: 'Enabled' }], VM_RULE);
  assert.deepEqual(legacyIds, ['(unnamed)']);
});

test('handles a bucket with no lifecycle configuration', () => {
  const { next, skipped } = mergeLifecycleRule(null, VM_RULE);
  assert.equal(skipped, false);
  assert.deepEqual(next.Rules, [VM_RULE]);
});

test('preserves top-level siblings of Rules when given the full response', () => {
  // apt-dialer really returns this field. put-bucket-lifecycle-configuration
  // replaces the whole configuration, so dropping it resets the setting to
  // its AWS default without anyone asking.
  const current = {
    TransitionDefaultMinimumObjectSize: 'varies_by_storage_class',
    Rules: [{ ID: 'keep-me', Filter: { Prefix: 'x/' }, Status: 'Enabled' }],
  };
  const { next } = mergeLifecycleRule(current, VM_RULE);
  assert.equal(next.TransitionDefaultMinimumObjectSize, 'varies_by_storage_class');
  assert.equal(next.Rules.length, 2);
});

test('preserves siblings even when the rule is already present', () => {
  const current = {
    TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K',
    Rules: [VM_RULE],
  };
  const { next, skipped } = mergeLifecycleRule(current, VM_RULE);
  assert.equal(skipped, true);
  assert.equal(next.TransitionDefaultMinimumObjectSize, 'all_storage_classes_128K');
});

// ── CORS ───────────────────────────────────────────────────────────────────

const DESIRED_CORS = {
  AllowedMethods: ['GET', 'HEAD'],
  AllowedOrigins: ['*'],
  AllowedHeaders: ['*'],
  MaxAgeSeconds: 3000,
};

test('adds a CORS rule when the bucket has none', () => {
  const { next, satisfied } = mergeCorsRule(null, DESIRED_CORS);
  assert.equal(satisfied, false);
  assert.deepEqual(next.CORSRules, [DESIRED_CORS]);
});

test('treats an existing permissive rule as already satisfying the need', () => {
  const existing = { AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedOrigins: ['*'] };
  const { next, satisfied } = mergeCorsRule([existing], DESIRED_CORS);
  assert.equal(satisfied, true);
  assert.equal(next.CORSRules.length, 1);
});

test('appends when an existing rule allows GET but not HEAD', () => {
  // Partial coverage is not coverage: Messages.tsx issues a GET, but a
  // preflight or a range probe can issue HEAD, and a rule missing it fails
  // exactly the same silent way.
  const existing = { AllowedMethods: ['GET'], AllowedOrigins: ['*'] };
  const { next, satisfied } = mergeCorsRule([existing], DESIRED_CORS);
  assert.equal(satisfied, false);
  assert.equal(next.CORSRules.length, 2);
});

test('appends when an existing rule is origin-scoped rather than *', () => {
  const existing = { AllowedMethods: ['GET', 'HEAD'], AllowedOrigins: ['https://dialer.aptask.com'] };
  const { satisfied, next } = mergeCorsRule([existing], DESIRED_CORS);
  assert.equal(satisfied, false);
  assert.deepEqual(next.CORSRules[0], existing);
});

test('does not mutate the CORS rules it was given', () => {
  const rules = [{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }];
  mergeCorsRule(rules, DESIRED_CORS);
  assert.equal(rules.length, 1);
});
