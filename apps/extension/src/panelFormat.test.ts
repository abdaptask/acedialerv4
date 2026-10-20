// Follow-ups panel wording.
//
// Run: npm run test -w apps/extension

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, detail, formatNumber, subtitle } from './panelFormat.js';
import { badgeText } from './badge.js';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

test('numbers: NANP formatted, international left as stored', () => {
  assert.equal(formatNumber('+17322001305'), '(732) 200-1305');
  assert.equal(formatNumber('7322001305'), '(732) 200-1305');
  assert.equal(formatNumber('+442079460958'), '+442079460958');
});

test('ages read like a person would say them', () => {
  assert.equal(ago(at(0), NOW), 'just now');
  assert.equal(ago(at(12), NOW), '12 min ago');
  assert.equal(ago(at(180), NOW), '3 hr ago');
  assert.equal(ago(at(60 * 30), NOW), 'yesterday');
  assert.equal(ago(at(60 * 24 * 4), NOW), '4 days ago');
});

test('each kind says what happened and how long ago', () => {
  const base = { number: '+17322001305', name: null, voicemails: 0, since: at(240), lastAt: at(60) };
  assert.equal(detail({ ...base, kind: 'missed_call', count: 1 }, NOW), 'Missed call · 1 hr ago');
  assert.equal(detail({ ...base, kind: 'missed_call', count: 3, voicemails: 1 }, NOW), 'Called 3 times · left a voicemail · 1 hr ago');
  assert.equal(detail({ ...base, kind: 'text', count: 1 }, NOW), '1 text waiting · 4 hr ago');
  assert.equal(detail({ ...base, kind: 'text', count: 2 }, NOW), '2 texts waiting · 4 hr ago');
  assert.equal(detail({ ...base, kind: 'voicemail', count: 1 }, NOW), 'Voicemail · 4 hr ago');
});

test('badge and subtitle', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(140), '99+');
  assert.equal(subtitle(0), 'Nothing waiting');
  assert.equal(subtitle(1), '1 waiting on you');
  assert.equal(subtitle(4), '4 waiting on you');
});
