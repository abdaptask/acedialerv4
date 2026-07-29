// Regression tests for the SMS thread-key matching that broke short-code
// conversations (bugs: "thread opens empty despite a preview" and "list
// preview doesn't match the thread's messages").
//
// Run with: npm run test -w apps/api
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadKeyCandidates, matchesStoredKey, toE164 } from './threadKey.js';

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

test('short-code keys are matched verbatim, never E.164-normalized', () => {
  // The core bug: toE164("72524") === "+72524", which matched no stored row.
  assert.deepEqual(threadKeyCandidates('72524'), ['72524']);
  assert.deepEqual(threadKeyCandidates('83356'), ['83356']);
  assert.ok(!threadKeyCandidates('72524').includes('+72524'));
});

test('alphanumeric sender IDs are matched verbatim', () => {
  assert.deepEqual(threadKeyCandidates('AMAZON'), ['AMAZON']);
});

test('real phone numbers gain an E.164 alias for deep links', () => {
  const c1 = threadKeyCandidates('+12672524323');
  assert.ok(c1.includes('+12672524323'));

  // Formatted / raw forms resolve to the same E.164 the number is stored as.
  assert.ok(threadKeyCandidates('(267) 252-4323').includes('+12672524323'));
  assert.ok(threadKeyCandidates('12672524323').includes('+12672524323'));
  assert.ok(threadKeyCandidates('2672524323').includes('+12672524323'));
});

test('empty / whitespace input yields no candidates', () => {
  assert.deepEqual(threadKeyCandidates(''), []);
  assert.deepEqual(threadKeyCandidates('   '), []);
});

// ---------------------------------------------------------------------------
// Bug 1 — conversation opens empty even though a preview exists.
// Stored key "72524"; opening it must resolve to that exact bucket.
// ---------------------------------------------------------------------------

test('Bug 1: opening short-code "72524" matches its stored messages', () => {
  assert.equal(matchesStoredKey('72524', '72524'), true);
});

// ---------------------------------------------------------------------------
// Bug 2 — list preview and thread diverge because "83356" and "+83356" are
// two different buckets. Opening the "83356" row must load ONLY "83356",
// not leak into the unrelated "+83356" bucket.
// ---------------------------------------------------------------------------

test('Bug 2: opening "83356" does not leak into the "+83356" bucket', () => {
  assert.equal(matchesStoredKey('83356', '83356'), true);
  assert.equal(matchesStoredKey('+83356', '83356'), false);
});

// ---------------------------------------------------------------------------
// End-to-end consistency: model the list (group by exact key, latest wins,
// exactly what `DISTINCT ON (thread_key) ORDER BY created_at DESC` does) and
// the detail (filter by candidates). For EVERY conversation the list shows,
// the detail must render >= 1 message AND its latest message must equal the
// list's preview + timestamp.
// ---------------------------------------------------------------------------

interface Row { threadKey: string; body: string; createdAt: number }

function listThreads(rows: Row[]): Array<{ threadKey: string; body: string; createdAt: number }> {
  const latest = new Map<string, Row>();
  for (const r of rows) {
    const cur = latest.get(r.threadKey);
    if (!cur || r.createdAt > cur.createdAt) latest.set(r.threadKey, r);
  }
  return [...latest.values()].map((r) => ({ threadKey: r.threadKey, body: r.body, createdAt: r.createdAt }));
}

function threadDetail(rows: Row[], param: string): Row[] {
  return rows
    .filter((r) => matchesStoredKey(r.threadKey, param))
    .sort((a, b) => a.createdAt - b.createdAt);
}

test('list preview always equals the opened thread\'s latest message', () => {
  // Mirrors the real data: a short-code split across two buckets, a clean
  // short code, and a normal phone number.
  const rows: Row[] = [
    { threadKey: '72524', body: 'DHL first', createdAt: 100 },
    { threadKey: '72524', body: 'DHL 1436914765', createdAt: 300 }, // preview
    { threadKey: '83356', body: 'code 768783', createdAt: 500 },    // preview
    { threadKey: '+83356', body: 'code 581576', createdAt: 200 },
    { threadKey: '+83356', body: 'code 726041', createdAt: 250 },   // preview
    { threadKey: '+12672524323', body: 'hi', createdAt: 400 },
    { threadKey: '+12672524323', body: 'you around?', createdAt: 450 }, // preview
  ];

  for (const preview of listThreads(rows)) {
    const thread = threadDetail(rows, preview.threadKey);
    // (a) every conversation with a preview renders at least one message
    assert.ok(thread.length >= 1, `thread ${preview.threadKey} rendered empty`);
    // (b) preview body + timestamp equal the thread's latest message
    const last = thread[thread.length - 1]!;
    assert.equal(last.body, preview.body, `preview/body mismatch for ${preview.threadKey}`);
    assert.equal(last.createdAt, preview.createdAt, `preview/timestamp mismatch for ${preview.threadKey}`);
  }
});

test('toE164 leaves already-normalized numbers untouched', () => {
  assert.equal(toE164('+12672524323'), '+12672524323');
  assert.equal(toE164('2672524323'), '+12672524323');
  assert.equal(toE164('12672524323'), '+12672524323');
});
