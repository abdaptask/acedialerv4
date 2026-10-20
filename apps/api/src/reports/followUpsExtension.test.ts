// The extension's follow-up payload.
//
// Run: npm run test -w apps/api

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toExtensionFollowUps } from './lookup.js';

type F = Parameters<typeof toExtensionFollowUps>[0];

const sample = {
  generatedAt: '2026-10-20T15:00:00.000Z',
  days: 14,
  totals: { missedCalls: 1, texts: 1, voicemails: 1 },
  people: [{ userId: 7, name: 'Pat Lee', missedCalls: 1, texts: 1, voicemails: 1, oldest: '2026-10-19T10:00:00.000Z' }],
  items: [
    { kind: 'missed_call', userId: 7, number: '+17322001305', name: 'Sarah Chen', count: 2, since: '2026-10-19T10:00:00.000Z', lastAt: '2026-10-19T11:00:00.000Z', voicemails: 1, personName: 'Pat Lee' },
    { kind: 'text', userId: 7, number: '+17325550100', name: null, count: 3, since: '2026-10-20T09:00:00.000Z', lastAt: '2026-10-20T09:05:00.000Z', personName: 'Pat Lee' },
    { kind: 'voicemail', userId: 7, number: '+17325550111', name: null, count: 1, since: '2026-10-20T12:00:00.000Z', lastAt: '2026-10-20T12:00:00.000Z', personName: 'Pat Lee' },
  ],
} as unknown as F;

test('count equals the items the panel will list', () => {
  const out = toExtensionFollowUps(sample);
  assert.equal(out.count, 3);
  assert.equal(out.items.length, out.count);
});

test('carries who/what/how long, and nothing that identifies the dialer user or holds content', () => {
  const out = toExtensionFollowUps(sample);
  assert.deepEqual(Object.keys(out.items[0]).sort(), ['count', 'kind', 'lastAt', 'name', 'number', 'since', 'voicemails']);
  assert.equal(out.items[0].voicemails, 1);
  assert.equal(out.items[1].voicemails, 0);
  assert.equal('people' in out, false);
  const json = JSON.stringify(out);
  for (const leak of ['userId', 'personName', 'Pat Lee', 'body']) assert.equal(json.includes(leak), false, leak);
});
