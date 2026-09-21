# Supabase → S3 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every piece of media the dialer owns out of Supabase Storage into the ApTask-owned `apt-dialer` S3 bucket, persist voicemail recordings on all voicemail paths, and delete the last Supabase dependency.

**Architecture:** Three `fetch()`-based Supabase uploads are replaced by S3 `PutObject`. The DB keeps storing a **full public URL**, so every read path — browser `<audio src>`, MMS `<img>`, Telnyx `media_urls` fetch, Telnyx `playback_start`, the scheduled-message worker — is untouched. A thin `s3.ts` helper is duplicated in `apps/api` and `apps/webhooks` because CLAUDE.md §1.4 forbids shared code in `packages/` and forbids `apps/webhooks` importing from `apps/api`. A one-off operator script backfills existing objects and rewrites five DB columns.

**Tech Stack:** TypeScript ESM, Fastify, Prisma, `@aws-sdk/client-s3`, `node:test` (via `node --import tsx --test`), plain `.mjs` for operator scripts.

**Spec:** `docs/superpowers/specs/2026-09-03-supabase-to-s3-design.md`

## Global Constraints

- **Bucket:** `apt-dialer`, region `us-east-1`, AWS account `216898427665`.
- **All keys live under the `media/` prefix.** The bucket is shared with an existing `updates` prefix; never write outside `media/`.
- **Public URL stays in the DB.** Do not store object keys instead — that approach was explicitly rejected in spec §4.1.
- **No shared module.** `apps/api/src/lib/s3.ts` and `apps/webhooks/src/s3.ts` are deliberate duplicates. Do not create `packages/s3` (CLAUDE.md §1.4). Do not import across `apps/`.
- **No object ACLs.** Public read comes from the bucket policy only. Never pass `ACL: 'public-read'` to `PutObject` — Block Public Access blocks ACLs.
- **Webhook side is fire-and-forget.** Anything added to `apps/webhooks` must never throw into a handler or delay the Telnyx ack (CLAUDE.md §16.4).
- **Unconfigured env behaves like today.** MMS route returns 500; webhook logs and skips. A missing var never hard-crashes a service.
- **No credential values in the repo, in a log line, or in a commit.** Keys go only into the repo-root `.env` (gitignored, line 9).
- **ESM imports carry the `.js` extension** even for `.ts` sources — that is how this codebase compiles.
- **Tests are `node:test` + `node:assert/strict`,** co-located as `*.test.ts` beside the source. Not vitest, not jest.
- **Comments explain WHY, not WHAT** (CLAUDE.md cross-cutting invariants).

---

### Task 1: AWS prerequisites

**Executed by a human in the AWS console + on the app host. No code.** Nothing else in this plan works until it is done: without the bucket policy statement, every media URL returns 403.

**Files:**
- Modify: `.env.example` (add S3 keys, keep Supabase keys for now — they are removed in Task 12)
- Modify: repo-root `.env` on the app host (not in git)

- [ ] **Step 1: Deactivate the exposed access key**

The key `AKIAIZEP7…` was pasted into a chat transcript during design and must be treated as compromised. IAM → Users → that user → Security credentials → set the access key to **Inactive**, then Delete. Do not reuse it anywhere.

- [ ] **Step 2: Create a scoped IAM user**

IAM → Users → Create user, name `ace-dialer-media`. No console access. Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AceDialerMediaRW",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::apt-dialer/media/*"
    }
  ]
}
```

No `s3:*`. No second bucket. No `s3:ListAllMyBuckets`. Create an access key and hold it for Step 7.

- [ ] **Step 3: Add the public-read statement to the bucket policy**

S3 → `apt-dialer` → Permissions → Bucket policy → Edit. **Append** this statement to the existing `Statement` array. Do not replace the array — the existing `PublicReadSpecificUpdates` statement serves another purpose and must survive.

```json
{
  "Sid": "PublicReadAceMedia",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::apt-dialer/media/*"
}
```

- [ ] **Step 4: Add the voicemail lifecycle rule**

S3 → `apt-dialer` → Management → Lifecycle rules → Create rule.

- Name: `expire-voicemail-recordings-30d`
- Scope: Limit to prefix `media/voicemails/`
- Action: Expire current versions of objects, **30 days** after creation

30 matches `VOICEMAIL_RETENTION_DAYS` in `apps/api/src/voicemails/voicemails.routes.ts:166`. This rule is the whole reason S3 does not inherit the orphan leak the Supabase bucket has: nothing in the codebase ever deletes a stored object.

**Do not** add a rule for `media/greetings/` or `media/mms/` — those are long-lived. A prefix-less rule would silently delete every greeting after 30 days.

- [ ] **Step 5: Configure bucket CORS**

S3 → `apt-dialer` → Permissions → Cross-origin resource sharing (CORS) → Edit.

```json
[
  {
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

`apps/web/src/pages/Messages.tsx:210` fetches attachment URLs with `mode: 'cors'` to implement the one-click "save attachment to disk" feature (v0.10.177). Supabase Storage answers every request with `Access-Control-Allow-Origin: *`; S3 sends no CORS headers at all unless a rule is configured. Without this step, every S3-hosted attachment fails that fetch and the code's `catch` silently falls back to opening the file in a new tab instead of saving it — no error surfaces anywhere, so this is easy to ship broken and not notice (see Task 11 Step 8, which exists to catch exactly this).

`AllowedOrigins: ["*"]` is deliberate, not a shortcut: it matches the Supabase posture this migration replaces, and the Electron renderer sends `Origin: null` on these fetches, which an explicit origin allowlist would not match. `GET`/`HEAD` only — this bucket never needs to accept a CORS-preflighted write from a browser.

- [ ] **Step 6: Tighten Block Public Access**

S3 → `apt-dialer` → Permissions → Block public access → Edit. Leave "Block *all* public access" **off** (the policy needs to grant public read), but turn **on** both ACL-related settings:

- Block public access to buckets and objects granted through *new* access control lists (ACLs)
- Block public access to buckets and objects granted through *any* access control lists (ACLs)

Leave both policy-related settings off. Also confirm Properties → Default encryption is SSE-S3.

- [ ] **Step 7: Add env vars**

Append to the repo-root `.env` on the app host (gitignored):

```
S3_BUCKET="apt-dialer"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="<from Step 2>"
S3_SECRET_ACCESS_KEY="<from Step 2>"
# Optional. Defaults to https://$S3_BUCKET.s3.$S3_REGION.amazonaws.com
# Set this if a CloudFront distribution or custom domain is put in front.
S3_PUBLIC_BASE=""
```

- [ ] **Step 8: Mirror the keys into `.env.example` with empty values**

```bash
cat >> .env.example <<'EOF'

# AWS S3 — user media (MMS attachments, voicemail greetings, voicemail recordings)
S3_BUCKET="apt-dialer"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID=""            # scoped IAM user; PutObject/GetObject/DeleteObject on media/* only
S3_SECRET_ACCESS_KEY=""        # server-side only, never expose to clients
S3_PUBLIC_BASE=""              # optional CDN/custom-domain override
EOF
```

- [ ] **Step 9: Verify the policy took effect**

Upload any small file to `media/probe.txt` via the console, then:

```bash
curl -D- -o /dev/null https://apt-dialer.s3.us-east-1.amazonaws.com/media/probe.txt
```

Expected: `HTTP/1.1 200`. A `403` means the `PublicReadAceMedia` statement is missing or its `Resource` is wrong — fix before continuing. Delete `media/probe.txt` afterwards.

- [ ] **Step 10: Commit the `.env.example` change**

```bash
git add .env.example
git commit -m "chore(env): add S3 media storage variables"
```

---

### Task 2: S3 helper for `apps/api`

**Files:**
- Create: `apps/api/src/lib/s3.ts`
- Create: `apps/api/src/lib/s3.test.ts`
- Modify: `apps/api/src/config.ts:64-67` (replace the Supabase block)
- Modify: `apps/api/package.json` (add `@aws-sdk/client-s3`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `buildPublicUrl(key: string, opts: { bucket?: string; region?: string; publicBase?: string }): string`
  - `isS3Configured(): boolean`
  - `putObject(args: { key: string; body: Buffer; contentType: string }): Promise<{ publicUrl: string }>`
  - `config.s3Bucket`, `config.s3Region`, `config.s3AccessKeyId`, `config.s3SecretAccessKey`, `config.s3PublicBase` — all `string | undefined`

- [ ] **Step 1: Install the SDK**

```bash
npm install @aws-sdk/client-s3 -w apps/api
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/s3.test.ts`:

```ts
// buildPublicUrl is the only pure part of the S3 helper, and it is the part
// that decides what string lands in the database — so it gets the tests.
// putObject is a thin PutObjectCommand wrapper with nothing to assert
// without a network mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicUrl } from './s3.js';

test('builds a virtual-hosted-style URL from bucket + region', () => {
  const got = buildPublicUrl('media/mms/out/u12/1700000000000_photo.jpg', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
  });
  assert.equal(
    got,
    'https://apt-dialer.s3.us-east-1.amazonaws.com/media/mms/out/u12/1700000000000_photo.jpg',
  );
});

test('publicBase overrides bucket + region', () => {
  const got = buildPublicUrl('media/greetings/u3/busy/1_hi.wav', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
    publicBase: 'https://media.aptask.com',
  });
  assert.equal(got, 'https://media.aptask.com/media/greetings/u3/busy/1_hi.wav');
});

test('a trailing slash on publicBase does not produce a double slash', () => {
  const got = buildPublicUrl('media/x.txt', { publicBase: 'https://media.aptask.com/' });
  assert.equal(got, 'https://media.aptask.com/media/x.txt');
});

test('an empty publicBase falls back to bucket + region', () => {
  // config.optional() yields '' for an unset-but-declared var, so the empty
  // string must not be treated as a configured override.
  const got = buildPublicUrl('media/x.txt', {
    bucket: 'apt-dialer',
    region: 'us-east-1',
    publicBase: '',
  });
  assert.equal(got, 'https://apt-dialer.s3.us-east-1.amazonaws.com/media/x.txt');
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -w apps/api
```

Expected: FAIL — `Cannot find module './s3.js'`.

- [ ] **Step 4: Write the helper**

Create `apps/api/src/lib/s3.ts`:

```ts
// S3 object storage for user media (MMS attachments, voicemail greetings).
//
// This file is duplicated at apps/webhooks/src/s3.ts on purpose. CLAUDE.md
// §1.4 forbids shared code in packages/ outside db, and forbids
// apps/webhooks importing from apps/api — coupling the two deploys is
// worse than sixty duplicated lines, and the Supabase code this replaces
// was already duplicated across the same three call sites.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

/**
 * Resolve an object key to the public URL we persist in the database.
 *
 * Kept pure and parameterised so it is testable without env, and so the
 * publicBase indirection means a future CloudFront/custom domain is a config
 * change rather than a code change. Note the resolved URL still lands in DB
 * rows — that is the accepted tradeoff of spec §4.1.
 */
export function buildPublicUrl(
  key: string,
  opts: { bucket?: string; region?: string; publicBase?: string },
): string {
  const base = opts.publicBase
    ? opts.publicBase.replace(/\/+$/, '')
    : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com`;
  return `${base}/${key}`;
}

export function isS3Configured(): boolean {
  return Boolean(
    config.s3Bucket && config.s3Region && config.s3AccessKeyId && config.s3SecretAccessKey,
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKeyId as string,
        secretAccessKey: config.s3SecretAccessKey as string,
      },
    });
  }
  return client;
}

/**
 * Upload one object and return its public URL.
 *
 * Deliberately does NOT send an ACL: public read comes from the bucket
 * policy on media/*, and Block Public Access is configured to reject ACLs
 * outright, so passing one would fail the request.
 *
 * Throws on failure. Callers own the error mapping — the MMS route turns it
 * into an actionable hint, the webhook swallows it.
 */
export async function putObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ publicUrl: string }> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return {
    publicUrl: buildPublicUrl(args.key, {
      bucket: config.s3Bucket,
      region: config.s3Region,
      publicBase: config.s3PublicBase,
    }),
  };
}
```

- [ ] **Step 5: Add the config block**

In `apps/api/src/config.ts`, replace these four lines (currently 64-67):

```ts
  // Supabase Storage (for MMS uploads)
  supabaseUrl: optional('SUPABASE_URL'),
  supabaseServiceKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseMediaBucket: optional('SUPABASE_MEDIA_BUCKET', 'ace-media'),
```

with:

```ts
  // Supabase Storage — retained only until the S3 backfill completes.
  // Read by scripts/migrate-supabase-to-s3.mjs; no upload path uses it.
  supabaseUrl: optional('SUPABASE_URL'),
  supabaseServiceKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseMediaBucket: optional('SUPABASE_MEDIA_BUCKET', 'ace-media'),

  // AWS S3 — user media. Bucket apt-dialer, everything under the media/
  // prefix (the bucket is shared with an unrelated `updates` prefix).
  s3Bucket: optional('S3_BUCKET', 'apt-dialer'),
  s3Region: optional('S3_REGION', 'us-east-1'),
  s3AccessKeyId: optional('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: optional('S3_SECRET_ACCESS_KEY'),
  s3PublicBase: optional('S3_PUBLIC_BASE'),
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test -w apps/api
```

Expected: all four `s3.test.ts` tests PASS, and the pre-existing suites still pass.

- [ ] **Step 7: Typecheck**

```bash
npm run build -w apps/api
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/s3.ts apps/api/src/lib/s3.test.ts apps/api/src/config.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add S3 object-storage helper and config"
```

---

### Task 3: Media key builders for `apps/api`

**Files:**
- Create: `apps/api/src/lib/mediaKeys.ts`
- Create: `apps/api/src/lib/mediaKeys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sanitizeFilename(name: string): string`
  - `mmsKey(userId: number, filename: string, now?: number): string`
  - `greetingKey(userId: number, type: 'noanswer' | 'busy', filename: string, now?: number): string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/mediaKeys.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w apps/api
```

Expected: FAIL — `Cannot find module './mediaKeys.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/mediaKeys.ts`:

```ts
// S3 key layout for the media this service uploads. Spec §5.
//
// Everything lives under media/ because the apt-dialer bucket is shared
// with an unrelated `updates` prefix and the public-read bucket policy is
// scoped to media/* — a key outside that prefix uploads fine and then 403s
// on every read.
//
// Voicemail-recording keys live in apps/webhooks/src/mediaKeys.ts instead;
// that service writes them and cannot import from here (CLAUDE.md §1.4).

/** Strip anything that would change the key's shape or escape its prefix. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function mmsKey(userId: number, filename: string, now: number = Date.now()): string {
  return `media/mms/out/u${userId}/${now}_${sanitizeFilename(filename)}`;
}

export function greetingKey(
  userId: number,
  type: 'noanswer' | 'busy',
  filename: string,
  now: number = Date.now(),
): string {
  return `media/greetings/u${userId}/${type}/${now}_${sanitizeFilename(filename)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w apps/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mediaKeys.ts apps/api/src/lib/mediaKeys.test.ts
git commit -m "feat(api): add S3 media key builders"
```

---

### Task 4: Swap the MMS upload to S3

**Files:**
- Modify: `apps/api/src/messages/messages.routes.ts:220-290`

**Interfaces:**
- Consumes: `putObject`, `isS3Configured` from Task 2; `mmsKey` from Task 3.
- Produces: no new exports. `POST /messages/upload` keeps returning `{ url }`.

There is no unit test here — the route is a thin composition of two already-tested pure functions plus one network call, and this codebase has no HTTP-route test harness. Verification is the manual check in Step 4 and the end-to-end pass in Task 11.

- [ ] **Step 1: Add the imports**

At the top of `apps/api/src/messages/messages.routes.ts`, beside the existing imports:

```ts
import { isS3Configured, putObject } from '../lib/s3.js';
import { mmsKey } from '../lib/mediaKeys.js';
```

- [ ] **Step 2: Replace the config guard**

Find (in the `/messages/upload` handler, around line 238):

```ts
      if (!config.supabaseUrl || !config.supabaseServiceKey) {
        return reply.code(500).send({ error: 'Supabase Storage not configured' });
      }
```

Replace with:

```ts
      if (!isS3Configured()) {
        return reply.code(500).send({ error: 'S3 media storage not configured' });
      }
```

- [ ] **Step 3: Replace the upload block**

Find the block that starts at the `const safeName = ...` line (around 247) and ends with the `return { url: publicUrl };` line (around 289) — the whole `objectPath` / `uploadUrl` / `fetch` / error-hint / `publicUrl` sequence. Replace all of it with:

```ts
      const key = mmsKey(user.sub, body.filename);

      try {
        const { publicUrl } = await putObject({
          key,
          body: bytes,
          contentType: body.mimeType,
        });
        return { url: publicUrl };
      } catch (e) {
        const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
        const status = err.$metadata?.httpStatusCode ?? 0;
        app.log.warn(
          { status, name: err.name, message: err.message, bucket: config.s3Bucket, key },
          '[upload] s3 put failed',
        );
        // Pilot users have no API log access, so map the common AWS failures
        // to something they can act on — this mirrors what the Supabase
        // version did for its own error shapes.
        let hint = 'S3 rejected the upload.';
        if (err.name === 'NoSuchBucket') {
          hint = `Bucket "${config.s3Bucket}" not found. Check S3_BUCKET and S3_REGION.`;
        } else if (status === 403 || err.name === 'AccessDenied') {
          hint = `The IAM user lacks s3:PutObject on ${config.s3Bucket}/media/*. Check the inline policy.`;
        } else if (err.name === 'InvalidAccessKeyId' || err.name === 'SignatureDoesNotMatch') {
          hint = 'S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are wrong or the key was deactivated.';
        } else if (err.name === 'AccessControlListNotSupported') {
          hint = 'The upload sent an object ACL. It must not — public read comes from the bucket policy.';
        }
        return reply.code(502).send({
          error: 'storage_upload_failed',
          status,
          hint,
          details: err.message ?? String(e),
        });
      }
```

Note `config` stays imported — it is still used for the log line and the hints.

- [ ] **Step 4: Verify by hand**

```bash
npm run build -w apps/api
```

Expected: exit 0. Then, with `.env` populated, start the API and upload a small file:

```bash
npm run dev -w apps/api
# in another shell — replace TOKEN with a real JWT from sessionStorage
curl -s -X POST http://127.0.0.1:3000/messages/upload \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"filename":"probe.txt","mimeType":"text/plain","dataBase64":"aGVsbG8="}'
```

Expected: `{"url":"https://apt-dialer.s3.us-east-1.amazonaws.com/media/mms/out/u<id>/<ts>_probe.txt"}`. Then `curl -D- -o /dev/null <that url>` → `200`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/messages/messages.routes.ts
git commit -m "feat(messages): upload MMS attachments to S3 instead of Supabase"
```

---

### Task 5: Swap the voicemail greeting upload to S3

**Files:**
- Modify: `apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts:255-330`

**Interfaces:**
- Consumes: `putObject`, `isS3Configured` from Task 2; `greetingKey` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Add the imports**

```ts
import { isS3Configured, putObject } from '../lib/s3.js';
import { greetingKey } from '../lib/mediaKeys.js';
```

- [ ] **Step 2: Replace the config guard**

Find (around line 262):

```ts
      if (!config.supabaseUrl || !config.supabaseServiceKey) {
```

Replace the condition with `if (!isS3Configured()) {` and update the message in its body to `'S3 media storage not configured'`.

- [ ] **Step 3: Replace the upload block**

Find the sequence from `const safeName = effectiveFilename.replace(...)` (around 304) through `const publicUrl = ...` (around 327) — the `objectPath` / `uploadUrl` / `fetch` / `!uploadRes.ok` / `publicUrl` block. Replace with:

```ts
      const key = greetingKey(u.sub, type, effectiveFilename);

      let publicUrl: string;
      try {
        // effectiveMime, not the client's mimeType: the v0.10.152 ffmpeg
        // step transcodes in-app webm recordings to WAV, and Telnyx <Play>
        // needs the stored content-type to match the actual bytes.
        ({ publicUrl } = await putObject({ key, body: bytes, contentType: effectiveMime }));
      } catch (e) {
        const err = e as { name?: string; message?: string };
        app.log.warn(
          { name: err.name, message: err.message, type, key },
          '[vm-greeting] s3 put failed',
        );
        return reply.code(502).send({ error: 'Storage upload failed', details: err.message ?? String(e) });
      }
```

The `colsFor(type)` / `prisma.user.update` block below it is unchanged — it already writes whatever `publicUrl` holds.

- [ ] **Step 4: Typecheck**

```bash
npm run build -w apps/api
```

Expected: exit 0.

- [ ] **Step 5: Verify by hand**

Upload a greeting through Settings → Voicemail Greeting for both the no-answer and busy slots. Confirm each returns 200, that the Settings UI shows the stored filename, and that both URLs `curl` to `200` with `content-type: audio/wav` (for an in-app recording) or `audio/mpeg` (for an uploaded MP3).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts
git commit -m "feat(voicemail): upload greetings to S3 instead of Supabase"
```

---

### Task 6: S3 helper and key builders for `apps/webhooks`

**Files:**
- Create: `apps/webhooks/src/s3.ts`
- Create: `apps/webhooks/src/mediaKeys.ts`
- Create: `apps/webhooks/src/mediaKeys.test.ts`
- Modify: `apps/webhooks/package.json` (add `@aws-sdk/client-s3`, add a `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isS3Configured(): boolean`
  - `putObject(args: { key: string; body: Buffer; contentType: string }): Promise<{ publicUrl: string }>`
  - `voicemailKey(userId: number, voicemailId: number, ext: string): string`
  - `extAndContentTypeFromUrl(url: string): { ext: string; contentType: string }`

`apps/webhooks` has no test script today. This task adds one, copied from `apps/api`.

- [ ] **Step 1: Install the SDK and add the test script**

```bash
npm install @aws-sdk/client-s3 -w apps/webhooks
```

Then in `apps/webhooks/package.json`, add to `scripts` beside `dev`:

```json
    "test": "node --import tsx --test $(find src -name '*.test.ts')"
```

- [ ] **Step 2: Write the failing test**

Create `apps/webhooks/src/mediaKeys.test.ts`:

```ts
// Voicemail recordings arrive from three Telnyx paths with two different
// audio formats. Hosted Voicemail serves .wav (observed on
// voice-mail-prod.s3.amazonaws.com); the Recordings API serves .mp3. The
// previous Supabase code hardcoded .mp3 + audio/mpeg, which mislabelled
// every hosted-voicemail object — these tests exist to stop that recurring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extAndContentTypeFromUrl, voicemailKey } from './mediaKeys.js';

test('voicemailKey nests under media/voicemails and the user', () => {
  assert.equal(voicemailKey(12, 345, 'wav'), 'media/voicemails/u12/345.wav');
});

test('voicemailKey starts with the media/ prefix', () => {
  // The public-read bucket policy is scoped to media/*; a key outside it
  // uploads fine and then 403s on playback.
  assert.ok(voicemailKey(1, 1, 'mp3').startsWith('media/'));
});

test('derives wav from a plain .wav URL', () => {
  const got = extAndContentTypeFromUrl('https://example.com/a/b.wav');
  assert.deepEqual(got, { ext: 'wav', contentType: 'audio/wav' });
});

test('derives mp3 from a plain .mp3 URL', () => {
  const got = extAndContentTypeFromUrl('https://example.com/a/b.mp3');
  assert.deepEqual(got, { ext: 'mp3', contentType: 'audio/mpeg' });
});

test('ignores a presigned query string when deriving the extension', () => {
  // This is the real shape: Telnyx hands us a presigned S3 URL whose query
  // string is longer than the path. A naive endsWith('.wav') misses it.
  const url =
    'https://voice-mail-prod.s3.us-east-1.amazonaws.com/%2B17329935698/b0fba8e9.wav' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800';
  assert.deepEqual(extAndContentTypeFromUrl(url), { ext: 'wav', contentType: 'audio/wav' });
});

test('uppercase extensions normalise to lowercase', () => {
  assert.deepEqual(extAndContentTypeFromUrl('https://x/a.WAV'), {
    ext: 'wav',
    contentType: 'audio/wav',
  });
});

test('falls back to mp3 when the URL has no extension', () => {
  // Falling back to mp3 rather than refusing keeps the copy working on an
  // unfamiliar URL shape; a mislabelled object still plays in every browser
  // we support, whereas a skipped copy loses the recording.
  assert.deepEqual(extAndContentTypeFromUrl('https://example.com/recording'), {
    ext: 'mp3',
    contentType: 'audio/mpeg',
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -w apps/webhooks
```

Expected: FAIL — `Cannot find module './mediaKeys.js'`.

- [ ] **Step 4: Write `mediaKeys.ts`**

Create `apps/webhooks/src/mediaKeys.ts`:

```ts
// S3 key layout for voicemail recordings. Spec §5.
//
// Separate from apps/api/src/lib/mediaKeys.ts by design: this service
// cannot import from apps/api (CLAUDE.md §1.4), and it owns a media type
// that service never writes.

export function voicemailKey(userId: number, voicemailId: number, ext: string): string {
  return `media/voicemails/u${userId}/${voicemailId}.${ext}`;
}

/**
 * Derive the stored extension and content-type from the source recording URL.
 *
 * Telnyx serves .wav from Hosted Voicemail and .mp3 from the Recordings API,
 * always behind a presigned query string longer than the path itself. The
 * previous implementation hardcoded .mp3/audio/mpeg and so mislabelled every
 * hosted-voicemail object. Unknown shapes fall back to mp3 rather than
 * refusing — a mislabelled object still plays, a skipped copy loses the
 * recording.
 */
export function extAndContentTypeFromUrl(url: string): { ext: string; contentType: string } {
  const path = url.split('?')[0] ?? '';
  const ext = (/\.([a-zA-Z0-9]+)$/.exec(path)?.[1] ?? 'mp3').toLowerCase();
  const contentType = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
  return { ext, contentType };
}
```

- [ ] **Step 5: Write `s3.ts`**

Create `apps/webhooks/src/s3.ts`. Same contents as `apps/api/src/lib/s3.ts` from Task 2, except it reads `process.env` directly (matching how this service already handles Supabase at `voicemailCallControl.ts:220-222`) and drops the unused `isS3Configured` export shape difference:

```ts
// S3 object storage for voicemail recordings.
//
// Duplicate of apps/api/src/lib/s3.ts on purpose — CLAUDE.md §1.4 forbids
// shared code in packages/ outside db and forbids importing from apps/api.
// Reads process.env directly rather than a config module because that is
// how this service already reads its Supabase and Telnyx settings.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export function buildPublicUrl(
  key: string,
  opts: { bucket?: string; region?: string; publicBase?: string },
): string {
  const base = opts.publicBase
    ? opts.publicBase.replace(/\/+$/, '')
    : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com`;
  return `${base}/${key}`;
}

export function isS3Configured(): boolean {
  return Boolean(
    env('S3_BUCKET', 'apt-dialer') &&
      env('S3_REGION', 'us-east-1') &&
      env('S3_ACCESS_KEY_ID') &&
      env('S3_SECRET_ACCESS_KEY'),
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env('S3_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: env('S3_ACCESS_KEY_ID'),
        secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

/**
 * Upload one object and return its public URL.
 *
 * No ACL is sent: public read comes from the bucket policy on media/*, and
 * Block Public Access rejects ACLs outright.
 */
export async function putObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ publicUrl: string }> {
  const bucket = env('S3_BUCKET', 'apt-dialer');
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return {
    publicUrl: buildPublicUrl(args.key, {
      bucket,
      region: env('S3_REGION', 'us-east-1'),
      publicBase: env('S3_PUBLIC_BASE'),
    }),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -w apps/webhooks
npm run build -w apps/webhooks
```

Expected: 7 tests PASS, build exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/webhooks/src/s3.ts apps/webhooks/src/mediaKeys.ts apps/webhooks/src/mediaKeys.test.ts apps/webhooks/package.json package-lock.json
git commit -m "feat(webhooks): add S3 helper, voicemail key builders, and a test script"
```

---

### Task 7: Rewrite `persistRecordingToSupabase` as `persistRecording`

**Files:**
- Modify: `apps/webhooks/src/voicemailCallControl.ts:212-268` (the function), `:465` (the call site)

**Interfaces:**
- Consumes: `putObject`, `isS3Configured` from Task 6; `voicemailKey`, `extAndContentTypeFromUrl` from Task 6.
- Produces: `persistRecording(voicemailId: number, userId: number, telnyxUrl: string, logger: LogFn): Promise<void>` — exported so Task 8 can call it from `main.ts`. It was module-private before; export it now.

- [ ] **Step 1: Add the imports**

```ts
import { isS3Configured, putObject } from './s3.js';
import { extAndContentTypeFromUrl, voicemailKey } from './mediaKeys.js';
```

- [ ] **Step 2: Replace the function**

Replace the whole of `persistRecordingToSupabase` (from its leading comment at line 212 through its closing brace at 268) with:

```ts
// v0.10.101 / 2026-09 - Copy the Telnyx recording into our own S3 bucket so
// the playback URL doesn't expire. Telnyx presigns with a finite window
// (7 days on Hosted Voicemail, 10 minutes on the Recordings API); after
// that the object is only reachable by re-querying Telnyx.
//
// Exported because main.ts calls it from BOTH of its
// prisma.voicemail.create seams — see spec §8.
//
// Fire-and-forget by contract: the Telnyx 200 has already been sent
// (CLAUDE.md §16.4), so this never throws and never blocks. A failure
// leaves recordingUrl pointing at Telnyx, where the existing
// /voicemails/:id/fresh-url and audio-proxy paths still play it.
export async function persistRecording(
  voicemailId: number,
  userId: number,
  telnyxUrl: string,
  logger: LogFn,
): Promise<void> {
  if (!isS3Configured()) {
    logger({ voicemailId }, '[vm] S3 not configured - leaving the Telnyx URL in place');
    return;
  }
  try {
    // 1. Download from Telnyx while the presigned URL is still valid.
    const downloadRes = await fetch(telnyxUrl);
    if (!downloadRes.ok) {
      logger({ voicemailId, status: downloadRes.status }, '[vm] failed to download recording from Telnyx');
      return;
    }
    const bytes = Buffer.from(await downloadRes.arrayBuffer());
    if (bytes.length === 0) {
      logger({ voicemailId }, '[vm] Telnyx recording was empty - skipping persistence');
      return;
    }

    // 2. Upload, deriving the format from the source URL rather than
    //    assuming mp3 — Hosted Voicemail serves wav.
    const { ext, contentType } = extAndContentTypeFromUrl(telnyxUrl);
    const key = voicemailKey(userId, voicemailId, ext);
    const { publicUrl } = await putObject({ key, body: bytes, contentType });

    // 3. Repoint the row at the permanent URL.
    await prisma.voicemail.update({
      where: { id: voicemailId },
      data: { recordingUrl: publicUrl },
    });
    logger({ voicemailId, key, bytes: bytes.length }, '[vm] recording persisted to S3');
  } catch (e) {
    logger({ voicemailId, err: e instanceof Error ? e.message : String(e) }, '[vm] persistence threw');
  }
}
```

Note the log line records `key` and byte count, never the URL's query string and never audio content.

- [ ] **Step 3: Update the existing call site**

At line 465, change:

```ts
            void persistRecordingToSupabase(created.id, found.user.id, recordingUrl, logger);
```

to:

```ts
            void persistRecording(created.id, found.user.id, recordingUrl, logger);
```

- [ ] **Step 4: Confirm no stale references remain**

```bash
grep -rn "persistRecordingToSupabase" apps/ scripts/
```

Expected: no output.

- [ ] **Step 5: Typecheck**

```bash
npm run build -w apps/webhooks
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/webhooks/src/voicemailCallControl.ts
git commit -m "feat(webhooks): persist Call Control voicemail recordings to S3"
```

---

### Task 8: Persist recordings on the other two voicemail seams

**Files:**
- Modify: `apps/webhooks/src/main.ts` — after the `prisma.voicemail.create` at `:990`, and after the one at `:1903`

**Interfaces:**
- Consumes: `persistRecording` from Task 7.
- Produces: no new exports.

This is spec §8, the reason the migration is worth doing at all: without it, only Call Control users' recordings are ours. **There are two create seams and both need the call.** The comment at `main.ts:1927` claims the Hosted VM handler was refactored into `processVoicemail()`, but it still has its own inline create at `:990`. Do not trust that comment.

- [ ] **Step 1: Add the import**

At the top of `apps/webhooks/src/main.ts`, beside the other local imports:

```ts
import { persistRecording } from './voicemailCallControl.js';
```

If `voicemailCallControl.js` is currently only loaded via a dynamic `await import(...)` at `:525`, add this static import anyway — the module has no side effects at load time beyond defining functions.

- [ ] **Step 2: Wire seam 1 — the Hosted Voicemail handler**

In `case 'calls.voicemail.completed'`, immediately after the `const created = await prisma.voicemail.create({...})` block that ends at line ~1003 and before the `const unreadCount = ...` line, insert:

```ts
          // Telnyx presigns this URL for 7 days. Copy the bytes into our own
          // bucket so the recording outlives that window. Fire-and-forget:
          // the 200 already went back to Telnyx, and a failure just leaves
          // the Telnyx URL, which the fresh-url endpoint still resolves.
          void persistRecording(created.id, ownerUserId, recordingUrl, (obj, msg) =>
            app.log.info(obj, msg),
          );
```

- [ ] **Step 3: Wire seam 2 — `processVoicemail()`**

In `processVoicemail`, immediately after the `const created = await prisma.voicemail.create({...})` block that ends at line ~1915 and before the `const unreadCount = ...` line, insert:

```ts
  // Same reasoning as the Hosted-Voicemail seam above. This one covers
  // POST /texml/voicemail/recording-complete and the legacy
  // /webhooks/telnyx/voicemail route, which both funnel through here.
  void persistRecording(created.id, ownerUserId, payload.recordingUrl, (obj, msg) =>
    app.log.info(obj, msg),
  );
```

- [ ] **Step 4: Confirm both seams are wired**

```bash
grep -n "persistRecording" apps/webhooks/src/main.ts
```

Expected: exactly three lines — the import and two call sites.

- [ ] **Step 5: Typecheck**

```bash
npm run build -w apps/webhooks
```

Expected: exit 0.

- [ ] **Step 6: Verify against a real call**

Deploy to the host (`pm2 reload ace-webhooks`) and leave a voicemail on a Hosted-Voicemail DID. Then:

```bash
pm2 logs ace-webhooks --lines 200 | grep -E "\[vm\] (recording persisted|persistence threw|failed to download)"
aws s3 ls s3://apt-dialer/media/voicemails/ --recursive | tail
```

Expected: a `recording persisted to S3` line and a new `.wav` object. Confirm the row's `recordingUrl` now points at `apt-dialer` and that the voicemail plays in the UI.

- [ ] **Step 7: Commit**

```bash
git add apps/webhooks/src/main.ts
git commit -m "feat(webhooks): persist hosted and TeXML voicemail recordings to S3"
```

---

### Task 9: The backfill URL mapper

**Files:**
- Create: `scripts/lib/rewriteMediaUrls.mjs`
- Create: `scripts/lib/rewriteMediaUrls.test.mjs`

Plain `.mjs`, not TypeScript, because `scripts/` is outside every workspace's `src/` and so outside their test globs. `node --test` runs `.mjs` natively with no tsx needed.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isSupabaseMediaUrl(url, supabaseBase): boolean`
  - `supabaseUrlToKey(url, supabaseBase, bucket): string | null`
  - `rewriteArray(urls, mapFn): { next: string[]; changed: number }`

**This is the highest-risk component in the plan.** `Message.mediaUrls` holds our Supabase URLs *and* Telnyx's own inbound URLs in the same array (`apps/webhooks/src/main.ts:1086-1087`). A blind replace corrupts inbound message history irrecoverably.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/rewriteMediaUrls.test.mjs`:

```js
// The mapper that decides which entries of Message.mediaUrls get rewritten.
// Message.mediaUrls mixes OUR Supabase uploads with Telnyx's own inbound
// media URLs (apps/webhooks/src/main.ts:1086). Rewriting a Telnyx entry
// destroys inbound message history, so the prefix test is the whole safety
// property and it is tested exhaustively.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseMediaUrl, rewriteArray, supabaseUrlToKey } from './rewriteMediaUrls.mjs';

const BASE = 'https://abcdefg.supabase.co';
const BUCKET = 'ace-media';

test('recognises a Supabase public object URL', () => {
  assert.equal(
    isSupabaseMediaUrl(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1_a.jpg`, BASE),
    true,
  );
});

test('does not recognise a Telnyx media URL', () => {
  assert.equal(isSupabaseMediaUrl('https://media.telnyx.com/abc/def.jpg', BASE), false);
});

test('does not recognise an already-migrated S3 URL', () => {
  // This is what makes the script idempotent — a second run finds nothing.
  assert.equal(
    isSupabaseMediaUrl('https://apt-dialer.s3.us-east-1.amazonaws.com/media/mms/out/u12/1_a.jpg', BASE),
    false,
  );
});

test('does not recognise a different Supabase project', () => {
  assert.equal(
    isSupabaseMediaUrl('https://other.supabase.co/storage/v1/object/public/ace-media/u1/a.jpg', BASE),
    false,
  );
});

test('handles null and empty input', () => {
  assert.equal(isSupabaseMediaUrl(null, BASE), false);
  assert.equal(isSupabaseMediaUrl('', BASE), false);
});

test('extracts the object key from a public URL', () => {
  assert.equal(
    supabaseUrlToKey(`${BASE}/storage/v1/object/public/${BUCKET}/u12/1700_a.jpg`, BASE, BUCKET),
    'u12/1700_a.jpg',
  );
});

test('extracts a nested object key', () => {
  assert.equal(
    supabaseUrlToKey(
      `${BASE}/storage/v1/object/public/${BUCKET}/voicemail-greetings/u3/busy/1700_hi.wav`,
      BASE,
      BUCKET,
    ),
    'voicemail-greetings/u3/busy/1700_hi.wav',
  );
});

test('returns null for a non-Supabase URL', () => {
  assert.equal(supabaseUrlToKey('https://media.telnyx.com/a.jpg', BASE, BUCKET), null);
});

test('rewriteArray rewrites only Supabase entries and preserves order', () => {
  const input = [
    'https://media.telnyx.com/inbound-1.jpg',
    `${BASE}/storage/v1/object/public/${BUCKET}/u12/1_ours.jpg`,
    'https://media.telnyx.com/inbound-2.jpg',
  ];
  const { next, changed } = rewriteArray(input, (u) =>
    isSupabaseMediaUrl(u, BASE) ? 'https://s3/new.jpg' : null,
  );
  assert.equal(changed, 1);
  assert.deepEqual(next, [
    'https://media.telnyx.com/inbound-1.jpg',
    'https://s3/new.jpg',
    'https://media.telnyx.com/inbound-2.jpg',
  ]);
});

test('rewriteArray leaves an all-Telnyx array untouched', () => {
  const input = ['https://media.telnyx.com/a.jpg', 'https://media.telnyx.com/b.jpg'];
  const { next, changed } = rewriteArray(input, () => null);
  assert.equal(changed, 0);
  assert.deepEqual(next, input);
});

test('rewriteArray handles an empty array', () => {
  const { next, changed } = rewriteArray([], () => 'https://s3/x');
  assert.equal(changed, 0);
  assert.deepEqual(next, []);
});

test('rewriteArray keeps the original entry when the mapper returns null', () => {
  // A failed download must leave the row usable, not blank it.
  const input = [`${BASE}/storage/v1/object/public/${BUCKET}/u1/a.jpg`];
  const { next, changed } = rewriteArray(input, () => null);
  assert.equal(changed, 0);
  assert.deepEqual(next, input);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/lib/rewriteMediaUrls.test.mjs
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/rewriteMediaUrls.mjs`:

```js
// URL classification for the Supabase → S3 backfill.
//
// Operator-tool code. Never imported by anything under apps/ (CLAUDE.md
// §1.4); the direction is one-way.
//
// Message.mediaUrls mixes our own Supabase uploads with Telnyx's inbound
// media URLs in a single array. Everything here exists to make sure only
// the former are ever touched.

const PUBLIC_SEGMENT = '/storage/v1/object/public/';

/** True only for a public object URL belonging to OUR Supabase project. */
export function isSupabaseMediaUrl(url, supabaseBase) {
  if (!url || typeof url !== 'string') return false;
  const base = supabaseBase.replace(/\/+$/, '');
  return url.startsWith(`${base}${PUBLIC_SEGMENT}`);
}

/**
 * Pull the in-bucket object key out of a Supabase public URL.
 * Returns null for anything that isn't one, so callers can pass through.
 */
export function supabaseUrlToKey(url, supabaseBase, bucket) {
  if (!isSupabaseMediaUrl(url, supabaseBase)) return null;
  const base = supabaseBase.replace(/\/+$/, '');
  const prefix = `${base}${PUBLIC_SEGMENT}${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return key.length > 0 ? key : null;
}

/**
 * Map over an array of URLs, replacing only the entries the mapper resolves.
 *
 * A null from mapFn means "leave this one alone" — used both for Telnyx
 * entries and for entries whose copy failed. Order is preserved because
 * MMS renders attachments in array order.
 */
export function rewriteArray(urls, mapFn) {
  let changed = 0;
  const next = urls.map((u) => {
    const replacement = mapFn(u);
    if (replacement) {
      changed += 1;
      return replacement;
    }
    return u;
  });
  return { next, changed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/lib/rewriteMediaUrls.test.mjs
```

Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rewriteMediaUrls.mjs scripts/lib/rewriteMediaUrls.test.mjs
git commit -m "feat(scripts): add tested URL mapper for the Supabase to S3 backfill"
```

---

### Task 10: The backfill script

**Files:**
- Create: `scripts/migrate-supabase-to-s3.mjs`

**Interfaces:**
- Consumes: `isSupabaseMediaUrl`, `supabaseUrlToKey`, `rewriteArray` from Task 9.
- Produces: a CLI. `--dry-run` is the default; `--commit` writes. Emits `scripts/out/supabase-to-s3-manifest.json`.

- [ ] **Step 1: Write the script**

Create `scripts/migrate-supabase-to-s3.mjs`. It:

- Reads every Supabase-prefixed URL across the five columns (`Voicemail.recordingUrl`, `User.voicemailGreetingUrl`, `User.voicemailBusyGreetingUrl`, `Message.mediaUrls`, `ScheduledMessage.mediaUrls`), using `isSupabaseMediaUrl` / `supabaseUrlToKey` / `rewriteArray` from Task 9's `scripts/lib/rewriteMediaUrls.mjs`.
- Downloads each object from Supabase and `PutObject`s it to S3 under `media/{voicemails,greetings,mms/out}/legacy/<oldKey>`, preserving the old key verbatim (it already carries the user id and timestamp).
- In `--commit` mode, rewrites the DB column to the new public URL after a successful copy.
- Is idempotent: a second run finds no Supabase-prefixed URLs left and reports everything as `skipped`, so a partial or failed run is always safe to repeat.

> **Note (post-review):** this section originally embedded the full script body. That copy went stale the moment the script was revised during review and is deliberately not re-pasted here — a second embedded copy is a second place to keep in sync, and it already drifted once. **The committed file `scripts/migrate-supabase-to-s3.mjs` is authoritative.** Read it directly. The review pass added, beyond what's summarized above:
> - An append-only NDJSON journal (`scripts/out/supabase-to-s3-journal.ndjson`, `-dryrun` variant for dry runs) written per-entry in real time, distinct from the end-of-run JSON summary — the durable record a rollback replays, so it survives an interrupted run in a way the summary (written once, at the end) cannot.
> - A `wrong_bucket` outcome, counted separately from `failed`, for the case where the Supabase *project* in a URL matches but the *bucket* segment doesn't (`SUPABASE_MEDIA_BUCKET` misconfigured) — see Step 3 below for why this must gate the run.
> - Per-entry accounting on the array columns (`Message.mediaUrls`, `ScheduledMessage.mediaUrls`): each URL in the array is counted individually as scanned/rewritten/skipped/failed/wrong_bucket, not rolled up to one outcome per row, so a row with 2 of 3 attachments copied doesn't hide the one that didn't.
> - `SIGINT`/`SIGTERM` handlers that write the summary before the process exits, so a manually interrupted run still leaves a readable report of what completed.

- [ ] **Step 2: Ignore the manifest output directory**

```bash
printf '\n# Backfill manifests (contain media URLs)\nscripts/out/\n' >> .gitignore
```

The manifest lists media URLs, which are unauthenticated handles to voicemail audio and candidate attachments. It must not be committed.

- [ ] **Step 3: Run the dry run**

```bash
node --env-file=.env scripts/migrate-supabase-to-s3.mjs
```

Expected: a `console.table` with five counters per column — `scanned` / `rewritten` / `skipped` / `failed` / `wrong_bucket`. The gate to proceed requires **all three** of:

- `failed: 0`
- `wrong_bucket: 0`
- `rewritten > 0`

Do not gate on `failed: 0` alone — `wrong_bucket` is a separate counter precisely so a misconfigured `SUPABASE_MEDIA_BUCKET` can't hide inside `failed`. A nonzero `wrong_bucket` means every URL it counted has a Supabase project that matched but a bucket segment that didn't: **stop and fix the `SUPABASE_MEDIA_BUCKET` env var — do not proceed to `--commit`.** And on this first run, `rewritten: 0` does not mean success — it means nothing matched at all (e.g. `SUPABASE_URL` itself is wrong), which is indistinguishable from "there was nothing to migrate" unless you also check that `scanned` is nonzero and roughly matches the row counts you expect.

Read `scripts/out/supabase-to-s3-manifest-dryrun.json` and spot-check that no Telnyx URL appears as an `oldUrl`.

- [ ] **Step 4: Run for real**

```bash
node --env-file=.env scripts/migrate-supabase-to-s3.mjs --commit
```

Expected: the same counts, now with objects in S3.

- [ ] **Step 5: Confirm idempotency**

```bash
node --env-file=.env scripts/migrate-supabase-to-s3.mjs
```

Expected: `rewritten: 0` on every column, everything counted as `skipped`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-supabase-to-s3.mjs .gitignore
git commit -m "feat(scripts): add Supabase to S3 media backfill"
```

---

### Task 11: Verification pass

**Executed by a human against the deployed host.** No code. Spec §12. Do not start Task 12 until every item passes — Task 12 is the point of no return.

- [ ] **Step 1: A migrated voicemail returns audio**

```bash
psql "$DATABASE_URL" -Atc "select recording_url from voicemails where recording_url like '%apt-dialer%' limit 1"
curl -D- -o /dev/null "<that url>"
```

Expected: `200`, with `content-type` `audio/wav` or `audio/mpeg`.

- [ ] **Step 2: Playback works in the UI**

Open the Voicemail tab. Play a migrated voicemail expanded, and confirm a collapsed row shows a duration (that exercises the separate probe element at `apps/web/src/pages/Voicemail.tsx:660`).

- [ ] **Step 3: Telnyx can play a migrated greeting**

Call a DID belonging to a user whose greeting was migrated and let it fall to voicemail. Confirm the custom greeting plays, not the stock one.

```bash
pm2 logs ace-webhooks --lines 100 | grep -i playback
```

- [ ] **Step 4: Telnyx can fetch a new MMS attachment**

Send an MMS with an attachment from the app. Confirm the message reaches `delivered`, not merely that our API returned 200 — Telnyx has to fetch the URL itself.

- [ ] **Step 5: A new voicemail lands in S3**

Leave a voicemail on a Hosted-Voicemail DID.

```bash
aws s3 ls s3://apt-dialer/media/voicemails/ --recursive | tail -5
```

Expected: a fresh object under `media/voicemails/u<id>/<voicemailId>.wav`.

- [ ] **Step 6: Inbound MMS history is intact**

Open an old MMS thread that contains inbound media. Confirm the images still render — those URLs are Telnyx-hosted and must not have been rewritten.

```bash
psql "$DATABASE_URL" -Atc "select count(*) from messages where direction='inbound' and array_length(media_urls,1) > 0 and exists (select 1 from unnest(media_urls) u where u like '%telnyx%')"
```

Expected: the same count as before the migration.

- [ ] **Step 7: No Supabase URLs remain**

```bash
psql "$DATABASE_URL" -Atc "
select 'Voicemail', count(*) from voicemails where recording_url like '%supabase%'
union all select 'User.greeting', count(*) from users where voicemail_greeting_url like '%supabase%'
union all select 'User.busy', count(*) from users where voicemail_busy_greeting_url like '%supabase%'
union all select 'Message', count(*) from messages where array_to_string(media_urls,',') like '%supabase%'
union all select 'Scheduled', count(*) from scheduled_messages where array_to_string(media_urls,',') like '%supabase%'"
```

Expected: `0` on all five rows.

- [ ] **Step 8: The "save attachment to disk" control works against S3**

Send an MMS with an attachment, open the received message, and click the download control on the attachment. Confirm the file saves to disk. This exercises `apps/web/src/pages/Messages.tsx:210`, which fetches the attachment with `mode: 'cors'` — with the bucket CORS rule from Task 1 Step 5 missing or wrong, that fetch fails and the code's `catch` silently falls back to opening the file in a new tab instead. There is no error, toast, or log line on that failure path, so this cannot be verified by reading logs — it must be clicked.

- [ ] **Step 9: Spot-check a migrated object's content-type**

```bash
curl -I "<a migrated recordingUrl or mediaUrl from Task 10's manifest>"
```

Confirm the `content-type` header matches what the file actually is (e.g. `audio/wav` for a `.wav`, `image/jpeg` for a `.jpg`, `audio/mp4` for a legacy `.aac`/`.m4a` greeting) rather than the generic `application/octet-stream`. This is what the content-type fix in Task 10 (preferring Supabase's stored `content-type` header over guessing from the filename) protects — check at least one object whose extension isn't in the common set (a `.aac` or `.webm` greeting, or an `.mp4`/`.mov`/`.heic` MMS attachment) since those are exactly the ones a filename-based guess mislabels.

- [ ] **Step 10: Wait**

Leave the Supabase bucket alive and read-only for ~2 weeks before Task 12. This is the rollback window — the manifest can restore the old URLs only while those objects still exist.

---

### Task 12: Remove Supabase

**Do not start until Task 11 passed and the two-week window has elapsed.** This is irreversible.

**Files:**
- Modify: `apps/api/src/config.ts` (drop the `supabase*` entries)
- Modify: `.env.example` (drop the `SUPABASE_*` block)
- Modify: `apps/web/src/api.ts:729`, `apps/web/src/pages/Settings.tsx:1382`, `:1791` (stale comments)
- Modify: `CLAUDE.md` §3.4, §18.2, §19.2
- Delete: `scripts/migrate-supabase-to-s3.mjs`, `scripts/lib/rewriteMediaUrls.mjs`, `scripts/lib/rewriteMediaUrls.test.mjs`

- [ ] **Step 1: Confirm nothing reads Supabase any more**

```bash
grep -rn "supabase\|SUPABASE" apps/api/src apps/webhooks/src --include='*.ts' | grep -v "^.*://"
```

Expected: only the `config.ts` declarations and the migration script's own references. If an upload path still appears, stop — a task was missed.

- [ ] **Step 2: Drop the config entries**

Remove these four lines from `apps/api/src/config.ts`:

```ts
  // Supabase Storage — retained only until the S3 backfill completes.
  // Read by scripts/migrate-supabase-to-s3.mjs; no upload path uses it.
  supabaseUrl: optional('SUPABASE_URL'),
  supabaseServiceKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseMediaBucket: optional('SUPABASE_MEDIA_BUCKET', 'ace-media'),
```

- [ ] **Step 3: Drop the env template block**

Remove lines 81-83 of `.env.example` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET`).

- [ ] **Step 4: Fix the stale web comments**

The web client never had Supabase code — only comments naming it. Update each to say S3:

- `apps/web/src/api.ts:729` — "Stored in Supabase Storage" → "Stored in S3"
- `apps/web/src/pages/Settings.tsx:1382` — "Store the file in Supabase Storage" → "Store the file in S3"
- `apps/web/src/pages/Settings.tsx:1791` — "in Supabase Storage" → "in S3"

Leave `apps/web/src/data/whatsNew.ts:698` alone — it is a historical changelog entry describing what shipped at the time.

- [ ] **Step 5: Delete the migration script**

```bash
git rm scripts/migrate-supabase-to-s3.mjs scripts/lib/rewriteMediaUrls.mjs scripts/lib/rewriteMediaUrls.test.mjs
```

- [ ] **Step 6: Update CLAUDE.md**

Three edits, each of which currently asserts something now false:

1. **§3.4, last bullet** — replace the "Object storage (transitional)" bullet. It currently says Supabase Storage is "the ONE Supabase dependency still active". New text:

```markdown
- **Object storage.** User-uploaded media (MMS attachments, voicemail greetings) and voicemail **recordings** live in the ApTask-owned S3 bucket `apt-dialer` (`us-east-1`), all under the `media/` prefix — the bucket is shared with an unrelated `updates` prefix. Objects are public-read via a bucket policy scoped to `media/*`; no object ACLs (Block Public Access rejects them). The DB stores the resolved public URL, not the key. A lifecycle rule expires `media/voicemails/` at 30 days to match `VOICEMAIL_RETENTION_DAYS`, because nothing in the codebase deletes stored objects. **Supabase is fully removed.** Note: `Message.mediaUrls` still mixes our S3 URLs with Telnyx-hosted URLs for *inbound* MMS, which we never copy.
```

2. **§18.2 table** — the MMS row says "MMS uploads land in Supabase Storage (`ace-media` bucket)". Change to `apt-dialer` S3 under `media/mms/out/`.

3. **§19.2 + §19.4** — the greeting-storage row says "Supabase Storage `ace-media` bucket"; change to `apt-dialer` S3 under `media/greetings/`. In §19.4, the guardrail claiming recordings are Telnyx-hosted is now wrong: recordings are copied into S3 on **all three** voicemail paths, with the Telnyx URL as the fail-open fallback.

- [ ] **Step 7: Verify the build and tests still pass**

```bash
npm run build -w apps/api && npm run build -w apps/webhooks
npm test -w apps/api && npm test -w apps/webhooks
```

Expected: all exit 0.

- [ ] **Step 8: Remove the env vars from the host**

Delete the `SUPABASE_*` lines from the repo-root `.env` on the app host, then:

```bash
pm2 reload ace-api && pm2 reload ace-webhooks
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: remove Supabase Storage now that media lives in S3"
```

- [ ] **Step 10: Delete the Supabase project**

Only after the commit is deployed and a smoke test passes. Delete the `ace-media` bucket, then the Supabase project itself. There is no rollback past this point.

---

## Appendix: Rollback

Spec §14. Contingency only — not part of the forward path.

**Before Task 10 Step 4 (`--commit`):** nothing was migrated. Revert the deploy; new uploads return to Supabase.

**After Task 10, before Task 12:** replay the manifest in reverse. The Supabase objects still exist — that is what the two-week window in Task 11 Step 10 protects.

```bash
cat > scripts/rollback-s3-to-supabase.mjs <<'EOF'
// Reverse the Supabase → S3 backfill by restoring the old URLs recorded in
// the manifest. Only restores DB columns; the S3 objects are left in place
// (harmless, and the voicemail lifecycle rule expires its own).
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const COMMIT = process.argv.includes('--commit');
// The journal accumulates across every run (dry or --commit) and is never
// truncated, so it is the authoritative record even after an interrupted
// or multi-run migration — unlike the end-of-run summary JSON, which only
// covers whatever completed within the single run that wrote it.
const entries = readFileSync('scripts/out/supabase-to-s3-journal.ndjson', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const prisma = new PrismaClient();

for (const e of entries.filter((x) => x.action === 'copied')) {
  console.log(`${e.table}#${e.id}${e.column ? `.${e.column}` : ''} <- ${e.oldUrl}`);
  if (!COMMIT) continue;
  if (e.table === 'Voicemail') {
    await prisma.voicemail.update({ where: { id: e.id }, data: { recordingUrl: e.oldUrl } });
  } else if (e.table === 'User') {
    await prisma.user.update({ where: { id: e.id }, data: { [e.column]: e.oldUrl } });
  } else {
    // Array columns: swap the new URL back for the old one in place, leaving
    // every other entry (including Telnyx inbound URLs) untouched.
    const model = e.table.startsWith('Scheduled') ? 'scheduledMessage' : 'message';
    const row = await prisma[model].findUnique({ where: { id: e.id }, select: { mediaUrls: true } });
    if (!row) continue;
    const next = row.mediaUrls.map((u) => (u === e.newUrl ? e.oldUrl : u));
    await prisma[model].update({ where: { id: e.id }, data: { mediaUrls: next } });
  }
}
await prisma.$disconnect();
EOF

node --env-file=.env scripts/rollback-s3-to-supabase.mjs            # dry run
node --env-file=.env scripts/rollback-s3-to-supabase.mjs --commit   # writes
```

Then revert the code commits from Tasks 4, 5, 7, and 8 so new uploads go back to Supabase.

**After Task 12:** no rollback. The Supabase project is gone.
