// One-off provisioning for the apt-dialer S3 bucket: plan Task 1 steps 2-6
// and 9. Operator tool — run by hand with admin credentials, never imported
// (CLAUDE.md §1.4).
//
//   node scripts/setup-s3-bucket.mjs                      # dry run
//   node scripts/setup-s3-bucket.mjs --commit             # applies changes
//   node scripts/setup-s3-bucket.mjs --commit --create-access-key
//   node scripts/setup-s3-bucket.mjs --profile ace-admin --commit
//
// Shells out to the `aws` CLI rather than using an SDK so it inherits the
// operator's existing credential chain — profile, SSO, or MFA session —
// without this repo growing an IAM dependency it would never use at runtime.
//
// WHY THIS EXISTS: three of these S3 APIs are whole-config REPLACEMENTS, not
// merges. put-bucket-policy, put-bucket-lifecycle-configuration and
// put-bucket-cors each overwrite everything already on the bucket. The
// console's Edit screens merge for you; the CLI does not. apt-dialer already
// carries a PublicReadSpecificUpdates statement serving the `updates` prefix,
// and a hand-run `aws s3api put-bucket-policy` is one paste away from
// deleting it. Every mutation here is get -> merge -> put, snapshots what it
// found before writing, and skips when the desired state is already present.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mergeCorsRule, mergeLifecycleRule, mergePolicyStatement } from './lib/s3BucketConfig.mjs';

const COMMIT = process.argv.includes('--commit');
const CREATE_ACCESS_KEY = process.argv.includes('--create-access-key');
const ALLOW_ANY_ACCOUNT = process.argv.includes('--allow-any-account');
const PROFILE = argValue('--profile');

// Plan "Global Constraints". The account check is a guardrail, not trivia:
// these calls are destructive against whatever account the ambient
// credentials point at, and an operator with several profiles configured is
// exactly the person running this.
const BUCKET = 'apt-dialer';
const REGION = 'us-east-1';
const EXPECTED_ACCOUNT = '216898427665';

const IAM_USER = 'ace-dialer-media';
const IAM_POLICY_NAME = 'AceDialerMediaRW';
const POLICY_SID = 'PublicReadAceMedia';
const LIFECYCLE_RULE_ID = 'expire-voicemail-recordings-30d';
const MEDIA_ARN = `arn:aws:s3:::${BUCKET}/media/*`;

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = `scripts/out/s3-setup-${STAMP}`;

const actions = [];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function record(step, action, detail) {
  actions.push({ step, action, detail });
}

/**
 * Run an aws CLI command. Returns parsed JSON, or null when the call failed
 * with one of `tolerate` — the "not configured yet" errors (NoSuchBucketPolicy,
 * NoSuchLifecycleConfiguration, ...) are the normal first-run state, not
 * failures, and every caller needs to tell those apart from a real error.
 */
function aws(args, { tolerate = [] } = {}) {
  const full = [...args, '--region', REGION, '--output', 'json'];
  if (PROFILE) full.push('--profile', PROFILE);
  try {
    const out = execFileSync('aws', full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() ? JSON.parse(out) : {};
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (tolerate.some((code) => stderr.includes(code))) return null;
    if (err.code === 'ENOENT') {
      fail('The `aws` CLI is not installed or not on PATH. Install AWS CLI v2 and retry.');
    }
    // Name the credential source on an auth failure. Without this the CLI
    // reports only "the security token is invalid", which reads as a bad key
    // when the usual cause is the opposite: no key was supplied at all, so it
    // silently fell back to a stale `default` profile.
    if (/InvalidClientTokenId|SignatureDoesNotMatch|ExpiredToken|could not be found/.test(stderr)) {
      const source = PROFILE
        ? `--profile ${PROFILE}`
        : process.env.AWS_PROFILE
          ? `AWS_PROFILE=${process.env.AWS_PROFILE}`
          : process.env.AWS_ACCESS_KEY_ID
            ? `AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID.slice(0, 8)}… from the environment`
            : 'the `default` profile (no --profile flag and no AWS_* env vars were set)';
      fail(`credentials rejected — this run authenticated with ${source}.\n${stderr.trim()}`);
    }
    fail(`aws ${args.join(' ')}\n${stderr.trim() || err.message}`);
  }
}

function fail(msg) {
  console.error(`\nFAILED: ${msg}`);
  if (actions.length) {
    console.error('\nCompleted before the failure:');
    console.table(actions);
  }
  process.exit(1);
}

// Snapshots exist purely so an operator can put the old config back by hand.
// Written before every mutation, under a per-run timestamped directory so a
// second run can never overwrite the first run's record of the original.
function snapshot(name, data) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(`${BACKUP_DIR}/${name}.json`, JSON.stringify(data ?? null, null, 2));
}

function preflight() {
  const id = aws(['sts', 'get-caller-identity']);
  console.log(`  identity: ${id.Arn}`);
  if (id.Account !== EXPECTED_ACCOUNT && !ALLOW_ANY_ACCOUNT) {
    fail(
      `account ${id.Account} is not the expected ${EXPECTED_ACCOUNT}. ` +
        'Check --profile, or pass --allow-any-account if this is deliberate.',
    );
  }
  // A missing bucket must stop the run here. Without this the later steps
  // report a pile of identical NoSuchBucket errors that read like a
  // permissions problem.
  if (aws(['s3api', 'head-bucket', '--bucket', BUCKET], { tolerate: ['404', 'Not Found', 'NoSuchBucket'] }) === null) {
    fail(`bucket ${BUCKET} does not exist or is not visible to these credentials.`);
  }
}

// ── Step 2: scoped IAM user ────────────────────────────────────────────────
// PutObject/GetObject/DeleteObject on media/* and nothing else. No s3:*, no
// second bucket, no ListAllMyBuckets (spec §9).
function step2IamUser() {
  const policyDoc = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AceDialerMediaRW',
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        Resource: MEDIA_ARN,
      },
    ],
  };

  const existing = aws(['iam', 'get-user', '--user-name', IAM_USER], { tolerate: ['NoSuchEntity'] });
  if (existing) {
    record(2, 'skip', `IAM user ${IAM_USER} already exists`);
  } else if (!COMMIT) {
    record(2, 'would-create', `IAM user ${IAM_USER}`);
  } else {
    aws(['iam', 'create-user', '--user-name', IAM_USER]);
    record(2, 'created', `IAM user ${IAM_USER}`);
  }

  // Re-put the inline policy unconditionally in commit mode: put-user-policy
  // is idempotent by name, and re-applying is how a policy someone widened by
  // hand gets pulled back to the scoped version.
  if (!COMMIT) {
    record(2, 'would-apply', `inline policy ${IAM_POLICY_NAME} -> ${MEDIA_ARN}`);
  } else {
    aws([
      'iam', 'put-user-policy',
      '--user-name', IAM_USER,
      '--policy-name', IAM_POLICY_NAME,
      '--policy-document', JSON.stringify(policyDoc),
    ]);
    record(2, 'applied', `inline policy ${IAM_POLICY_NAME}`);
  }

  if (!CREATE_ACCESS_KEY) {
    record(2, 'skip', 'access key (pass --create-access-key)');
    return;
  }
  // AWS caps a user at two access keys, and the second one is usually an
  // accident: a re-run of this script. Refuse rather than silently consuming
  // the only remaining slot.
  const keys = aws(['iam', 'list-access-keys', '--user-name', IAM_USER], { tolerate: ['NoSuchEntity'] });
  if (keys?.AccessKeyMetadata?.length) {
    record(2, 'skip', `access key exists (${keys.AccessKeyMetadata.length}); rotate by hand if intended`);
    return;
  }
  if (!COMMIT) {
    record(2, 'would-create', 'access key');
    return;
  }
  const created = aws(['iam', 'create-access-key', '--user-name', IAM_USER]);
  // Printed once, to stdout, and deliberately never written to a snapshot or
  // any other file: AWS will not show the secret again, and the plan's
  // constraint is that credential values live only in the host's .env.
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  ACCESS KEY — shown once. Copy into the app host .env now.');
  console.log(`  S3_ACCESS_KEY_ID="${created.AccessKey.AccessKeyId}"`);
  console.log(`  S3_SECRET_ACCESS_KEY="${created.AccessKey.SecretAccessKey}"`);
  console.log('  Do not paste these into a chat, a ticket, or a commit.');
  console.log('─────────────────────────────────────────────────────────────\n');
  record(2, 'created', `access key ${created.AccessKey.AccessKeyId} (secret printed above, not saved)`);
}

// ── Step 3: public-read bucket policy statement ────────────────────────────
function step3BucketPolicy() {
  const wrapper = aws(['s3api', 'get-bucket-policy', '--bucket', BUCKET], {
    tolerate: ['NoSuchBucketPolicy'],
  });
  const current = wrapper ? JSON.parse(wrapper.Policy) : null;
  snapshot('bucket-policy.before', current);

  const { next, skipped, keptSids } = mergePolicyStatement(current, {
    Sid: POLICY_SID,
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: MEDIA_ARN,
  });
  if (skipped) {
    record(3, 'skip', `${POLICY_SID} already present (kept: ${keptSids.join(', ')})`);
    return;
  }
  snapshot('bucket-policy.after', next);

  const kept = keptSids.length ? `preserving ${keptSids.join(', ')}` : 'no prior statements';
  if (!COMMIT) {
    record(3, 'would-append', `${POLICY_SID} (${kept})`);
    return;
  }
  aws(['s3api', 'put-bucket-policy', '--bucket', BUCKET, '--policy', JSON.stringify(next)]);
  record(3, 'appended', `${POLICY_SID} (${kept})`);
}

// ── Step 4: 30-day lifecycle on voicemail recordings only ──────────────────
// Prefix-scoped on purpose. A rule without the prefix filter would expire
// every greeting and MMS attachment too — those are long-lived.
function step4Lifecycle() {
  const current = aws(['s3api', 'get-bucket-lifecycle-configuration', '--bucket', BUCKET], {
    tolerate: ['NoSuchLifecycleConfiguration'],
  });
  const rules = current?.Rules ?? [];
  snapshot('lifecycle.before', current);

  // Pass the whole response, not just rules — it carries siblings the put
  // would otherwise reset (see mergeLifecycleRule).
  const { next, skipped, legacyIds } = mergeLifecycleRule(current, {
    ID: LIFECYCLE_RULE_ID,
    Filter: { Prefix: 'media/voicemails/' },
    Status: 'Enabled',
    Expiration: { Days: 30 },
  });
  if (skipped) {
    record(4, 'skip', `${LIFECYCLE_RULE_ID} already present`);
    return;
  }
  // A rule carrying a top-level Prefix is the pre-2019 schema. Mixing it with
  // a Filter-style rule in one put is rejected outright, and the error names
  // neither rule — flag it here instead of letting the API do it.
  if (legacyIds.length) {
    fail(
      `existing lifecycle rules use the legacy top-level Prefix field: ${legacyIds.join(', ')}. ` +
        'Migrate them to Filter in the console first, or S3 will reject the combined put.',
    );
  }
  snapshot('lifecycle.after', next);

  const kept = rules.length ? `preserving ${rules.length} existing rule(s)` : 'no prior rules';
  if (!COMMIT) {
    record(4, 'would-append', `${LIFECYCLE_RULE_ID} (${kept})`);
    return;
  }
  aws([
    's3api', 'put-bucket-lifecycle-configuration',
    '--bucket', BUCKET,
    '--lifecycle-configuration', JSON.stringify(next),
  ]);
  record(4, 'appended', `${LIFECYCLE_RULE_ID} (${kept})`);
}

// ── Step 5: CORS for the save-attachment fetch ─────────────────────────────
// Messages.tsx fetches attachments with mode:'cors' to save them to disk.
// Supabase answered every request with Access-Control-Allow-Origin:*; S3
// sends no CORS headers at all without a rule, and the page's catch silently
// falls back to opening a tab — broken with nothing in the console.
function step5Cors() {
  const desired = {
    AllowedMethods: ['GET', 'HEAD'],
    AllowedOrigins: ['*'],
    AllowedHeaders: ['*'],
    MaxAgeSeconds: 3000,
  };
  const current = aws(['s3api', 'get-bucket-cors', '--bucket', BUCKET], {
    tolerate: ['NoSuchCORSConfiguration'],
  });
  const rules = current?.CORSRules ?? [];
  snapshot('cors.before', current);

  const { next, satisfied } = mergeCorsRule(rules, desired);
  if (satisfied) {
    record(5, 'skip', 'an existing CORS rule already allows GET/HEAD from *');
    return;
  }
  snapshot('cors.after', next);

  const kept = rules.length ? `preserving ${rules.length} existing rule(s)` : 'no prior rules';
  if (!COMMIT) {
    record(5, 'would-append', `GET/HEAD from * (${kept})`);
    return;
  }
  aws(['s3api', 'put-bucket-cors', '--bucket', BUCKET, '--cors-configuration', JSON.stringify(next)]);
  record(5, 'appended', `GET/HEAD from * (${kept})`);
}

// ── Step 6: block ACLs, keep policy-based public read ──────────────────────
function step6PublicAccess() {
  const current = aws(['s3api', 'get-public-access-block', '--bucket', BUCKET], {
    tolerate: ['NoSuchPublicAccessBlockConfiguration'],
  });
  snapshot('public-access-block.before', current);

  // The two policy settings stay false deliberately: the whole access model
  // is the PublicReadAceMedia statement. Turning either on 403s every media
  // URL. The two ACL settings go on so public read can only ever come from
  // the policy, never from an object ACL someone sets by hand.
  const desired = {
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: false,
    RestrictPublicBuckets: false,
  };
  const cfg = current?.PublicAccessBlockConfiguration;
  const matches = cfg && Object.entries(desired).every(([k, v]) => cfg[k] === v);
  if (matches) {
    record(6, 'skip', 'public access block already correct');
  } else if (!COMMIT) {
    record(6, 'would-apply', 'BlockPublicAcls+IgnorePublicAcls on, policy settings off');
  } else {
    aws([
      's3api', 'put-public-access-block',
      '--bucket', BUCKET,
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false',
    ]);
    record(6, 'applied', 'BlockPublicAcls+IgnorePublicAcls on, policy settings off');
  }

  // Report-only: SSE-S3 is the expected default, but enabling encryption is
  // not something to do silently to a bucket that already holds objects.
  const enc = aws(['s3api', 'get-bucket-encryption', '--bucket', BUCKET], {
    tolerate: ['ServerSideEncryptionConfigurationNotFoundError'],
  });
  const algo =
    enc?.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
  record(6, algo ? 'verified' : 'WARN', `default encryption: ${algo ?? 'NOT CONFIGURED — enable SSE-S3 in the console'}`);
}

// ── Step 9: prove public read actually works ───────────────────────────────
// Fetched with plain fetch(), no credentials — that is the whole point. A
// signed request would succeed even with the policy missing and tell us
// nothing.
async function step9Probe() {
  const key = 'media/probe.txt';
  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
  if (!COMMIT) {
    record(9, 'would-probe', url);
    return;
  }

  aws([
    's3api', 'put-object',
    '--bucket', BUCKET,
    '--key', key,
    '--body', '/dev/null',
    '--content-type', 'text/plain',
  ]);
  try {
    const res = await fetch(url);
    if (res.ok) {
      record(9, 'verified', `${res.status} unauthenticated GET on ${key}`);
    } else {
      record(9, 'FAIL', `${res.status} on ${key} — ${POLICY_SID} missing or its Resource is wrong`);
    }
  } catch (err) {
    record(9, 'FAIL', `probe fetch threw: ${err.message}`);
  } finally {
    // Always clean up, including after a failed assertion — a stray
    // world-readable probe object left in the bucket is its own small mess.
    aws(['s3api', 'delete-object', '--bucket', BUCKET, '--key', key]);
  }
}

async function main() {
  console.log(COMMIT ? '=== COMMIT MODE — applying changes ===' : '=== DRY RUN — pass --commit to apply ===');
  console.log(`  bucket: ${BUCKET} (${REGION}), account ${EXPECTED_ACCOUNT}`);
  preflight();

  step2IamUser();
  step3BucketPolicy();
  step4Lifecycle();
  step5Cors();
  step6PublicAccess();
  await step9Probe();

  console.log('');
  console.table(actions);
  console.log(`snapshots: ${BACKUP_DIR}/ (pre-change config, for manual rollback)`);

  const problems = actions.filter((a) => a.action === 'FAIL' || a.action === 'WARN');
  if (problems.length) {
    console.error(`\n${problems.length} item(s) need attention — see FAIL/WARN rows above.`);
    process.exit(1);
  }
  if (!COMMIT) console.log('\nNothing was changed. Re-run with --commit to apply.');
}

main().catch((e) => fail(e.stack ?? e.message));
