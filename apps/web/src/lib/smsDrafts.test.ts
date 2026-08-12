// Compose-draft persistence tests.
//
// Run: npm run test -w apps/web
//
// The failure this feature exists to prevent is losing a user's typing, so the
// cases that matter most here are the ones where a draft must SURVIVE (thread
// isolation, over-limit bodies, unreadable storage) and the two where it must
// NOT (expiry, logout).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getDraft, saveDraft, clearDraft, clearAllDrafts } from './smsDrafts.js';

const KEY = 'ace_sms_drafts';
const DAY_MS = 24 * 60 * 60 * 1000;

// Minimal localStorage stand-in — Node has none, and the module reads it at
// call time rather than at import, so installing it here is enough.
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

let store = installStorage();
beforeEach(() => { store = installStorage(); });

// ── Round trip ──────────────────────────────────────────────────────────

test('a saved draft comes back for the same thread', () => {
  saveDraft('+15551234567', 'Hi Priya, are you free at 2pm?');
  assert.equal(getDraft('+15551234567'), 'Hi Priya, are you free at 2pm?');
});

test('an unknown thread has no draft', () => {
  assert.equal(getDraft('+15550000000'), '');
});

test('drafts do not bleed between threads', () => {
  saveDraft('+15551111111', 'rate is 65/hr');
  saveDraft('+15552222222', 'interview Thursday');
  assert.equal(getDraft('+15551111111'), 'rate is 65/hr');
  assert.equal(getDraft('+15552222222'), 'interview Thursday');
});

test('saving again replaces the previous body', () => {
  saveDraft('+15551234567', 'first');
  saveDraft('+15551234567', 'second');
  assert.equal(getDraft('+15551234567'), 'second');
});

// ── Clearing ────────────────────────────────────────────────────────────

test('clearing removes just that thread', () => {
  saveDraft('+15551111111', 'keep me');
  saveDraft('+15552222222', 'sent already');
  clearDraft('+15552222222');
  assert.equal(getDraft('+15552222222'), '');
  assert.equal(getDraft('+15551111111'), 'keep me');
});

test('emptying the box discards the draft', () => {
  saveDraft('+15551234567', 'typed then deleted');
  saveDraft('+15551234567', '');
  assert.equal(getDraft('+15551234567'), '');
});

test('whitespace-only is treated as empty, not stored', () => {
  saveDraft('+15551234567', '   \n  ');
  assert.equal(getDraft('+15551234567'), '');
});

test('clearAllDrafts wipes everything — a shared machine must not leak', () => {
  saveDraft('+15551111111', 'candidate expects 70/hr');
  saveDraft('+15552222222', 'offer letter Monday');
  clearAllDrafts();
  assert.equal(getDraft('+15551111111'), '');
  assert.equal(getDraft('+15552222222'), '');
});

// ── Preservation guarantees ─────────────────────────────────────────────

test('a body past the 1600-char send limit is stored un-truncated', () => {
  // Send is disabled above the limit, but the text is still the user's work.
  // Truncating here would silently eat the tail of a paste on restore.
  const long = 'x'.repeat(2400);
  saveDraft('+15551234567', long);
  assert.equal(getDraft('+15551234567').length, 2400);
});

test('leading and trailing whitespace inside a real draft is preserved', () => {
  saveDraft('+15551234567', '  Hi Priya  ');
  assert.equal(getDraft('+15551234567'), '  Hi Priya  ');
});

test('newlines and unicode survive the round trip', () => {
  const body = 'Line one\nLine two — em dash, curly ’quote’, emoji 🎯';
  saveDraft('+15551234567', body);
  assert.equal(getDraft('+15551234567'), body);
});

// ── Expiry ──────────────────────────────────────────────────────────────

test('a draft older than 14 days is not returned', () => {
  store.set(KEY, JSON.stringify({
    '+15551234567': { body: 'stale', updatedAt: Date.now() - 15 * DAY_MS },
  }));
  assert.equal(getDraft('+15551234567'), '');
});

test('a 13-day-old draft still survives the weekend rule', () => {
  store.set(KEY, JSON.stringify({
    '+15551234567': { body: 'still good', updatedAt: Date.now() - 13 * DAY_MS },
  }));
  assert.equal(getDraft('+15551234567'), 'still good');
});

// ── Hostile storage ─────────────────────────────────────────────────────

test('corrupt JSON yields no draft rather than throwing', () => {
  store.set(KEY, '{not json');
  assert.equal(getDraft('+15551234567'), '');
});

test('a non-object payload is ignored', () => {
  store.set(KEY, '["unexpected"]');
  assert.equal(getDraft('+15551234567'), '');
});

test('malformed entries are skipped without losing their neighbours', () => {
  store.set(KEY, JSON.stringify({
    '+15551111111': { body: 42, updatedAt: Date.now() },
    '+15552222222': { body: 'intact', updatedAt: Date.now() },
    '+15553333333': null,
  }));
  assert.equal(getDraft('+15551111111'), '');
  assert.equal(getDraft('+15553333333'), '');
  assert.equal(getDraft('+15552222222'), 'intact');
});

test('storage that throws degrades to no-draft instead of breaking compose', () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
  assert.equal(getDraft('+15551234567'), '');
  assert.doesNotThrow(() => saveDraft('+15551234567', 'typed anyway'));
  assert.doesNotThrow(() => clearAllDrafts());
});

test('an empty thread key is a no-op', () => {
  assert.equal(getDraft(''), '');
  assert.doesNotThrow(() => saveDraft('', 'orphan'));
});
