// Tests for the Telnyx error classification that drives scheduled-send retry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyTelnyxError } from './telnyxErrorClass.js';

// ── Shape parsing ───────────────────────────────────────────────────────

test('classifies a bare code string', () => {
  assert.equal(classifyTelnyxError('30004').kind, 'permanent');
  assert.equal(classifyTelnyxError('30004').code, '30004');
});

test('classifies a bare code number', () => {
  assert.equal(classifyTelnyxError(30005).kind, 'permanent');
});

test('classifies the full Telnyx envelope', () => {
  const envelope = { errors: [{ code: '30007', title: 'Carrier violation', detail: '…' }] };
  const got = classifyTelnyxError(envelope);
  assert.equal(got.kind, 'permanent');
  assert.equal(got.code, '30007');
});

// This is the shape sendMessageImmediate actually produces — it assigns
// `detail: json.errors`, i.e. the ARRAY, not the object wrapping it. The web
// blurb parser tests `obj.errors` and so silently misses this case, falling
// through to its generic text. Regression test for the reason this module
// parses arrays first.
test('classifies a bare errors ARRAY (the SendMessageErr.detail shape)', () => {
  const detail = [{ code: '30004', title: 'Message blocked', detail: '…' }];
  const got = classifyTelnyxError(detail);
  assert.equal(got.code, '30004', 'must find the code inside a bare array');
  assert.equal(got.kind, 'permanent');
  assert.equal(got.short, 'Recipient blocked you');
});

test('skips array entries with no code and finds a later one', () => {
  const got = classifyTelnyxError([{ title: 'no code here' }, { code: 30003 }]);
  assert.equal(got.code, '30003');
  assert.equal(got.kind, 'transient');
});

// ── The decisions that matter ───────────────────────────────────────────

test('an opted-out recipient is permanent — retrying can never succeed', () => {
  assert.equal(classifyTelnyxError('30004').kind, 'permanent');
});

test('a disconnected number is permanent', () => {
  assert.equal(classifyTelnyxError('30005').kind, 'permanent');
});

test('a landline is permanent', () => {
  assert.equal(classifyTelnyxError('30006').kind, 'permanent');
});

test('carrier spam filtering is permanent — it is DID-sticky, not transient', () => {
  assert.equal(classifyTelnyxError('30007').kind, 'permanent');
});

// 30001 is the whole reason the rate_limited kind exists: it's about our
// volume, not this recipient, so it must not consume a retry attempt.
test('queue overflow is rate_limited, not transient', () => {
  assert.equal(classifyTelnyxError('30001').kind, 'rate_limited');
});

test('handset off is transient — genuinely worth another try', () => {
  assert.equal(classifyTelnyxError('30003').kind, 'transient');
});

test('unexplained carrier reject stays transient rather than dropping a message', () => {
  assert.equal(classifyTelnyxError('30008').kind, 'transient');
});

// ── Fallback behaviour ──────────────────────────────────────────────────

test('an unknown code is transient and preserves the code for diagnostics', () => {
  const got = classifyTelnyxError('39999');
  assert.equal(got.kind, 'transient', 'unknown codes must not be guessed permanent');
  assert.equal(got.code, '39999');
  assert.match(got.short, /39999/);
});

test('null / undefined / junk never throw and never claim permanence', () => {
  for (const input of [null, undefined, {}, [], 'delivery_failed', 'failed', 0]) {
    const got = classifyTelnyxError(input);
    assert.notEqual(got.kind, 'permanent', `${JSON.stringify(input)} must not be permanent`);
    assert.ok(got.short.length > 0);
  }
});

// ── Drift guard against the web presentation half ───────────────────────
//
// The two files are deliberately separate (CLAUDE.md §1.4 forbids cross-app
// TS imports), and the header of each says "add a code here, add it there
// too". This test enforces that note instead of trusting it: every code the
// web blurb table knows about must be classified here, or the worker will
// spend all five attempts on an error we could have judged instantly.
//
// Reading the sibling as TEXT rather than importing it keeps the apps
// decoupled at build time — this is a test-only file read, not a dependency.
test('every code in the web BLURBS table is classified here', () => {
  const webBlurbPath = new URL('../../../web/src/lib/telnyxErrorBlurb.ts', import.meta.url);
  const source = readFileSync(webBlurbPath, 'utf8');

  // Match the table entries: a quoted all-digit key followed by a colon and
  // an object literal.
  const codes = [...source.matchAll(/^\s*'(\d+)':\s*\{/gm)].map((m) => m[1]);
  assert.ok(codes.length >= 14, `expected to find the blurb table, found ${codes.length} codes`);

  const unclassified = codes.filter((code) => classifyTelnyxError(code).code === null
    || classifyTelnyxError(code).short.startsWith('Telnyx error '));

  assert.deepEqual(
    unclassified,
    [],
    `these Telnyx codes have web blurbs but no classification: ${unclassified.join(', ')}`,
  );
});
