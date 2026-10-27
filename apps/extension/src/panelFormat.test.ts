// Follow-ups panel wording.
//
// Run: npm run test -w apps/extension

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, callLength, canDial, detail, formatNumber, initials, keypadValue, recentDetail, subtitle, threadDetail, when } from './panelFormat.js';
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

test('call length matches the dialer, minutes never rolled into hours', () => {
  assert.equal(callLength(0), '');
  assert.equal(callLength(45), '0:45');
  assert.equal(callLength(125), '2:05');
  assert.equal(callLength(3725), '62:05');
});

test('times match the dialer: clock today, "Yesterday, …", then "Oct 5, …"', () => {
  // The dialer decides the day by the computer's calendar; pin it for the test.
  process.env.TZ = 'America/New_York';
  const now = new Date('2026-10-22T19:00:00Z'); // Thu 3:00 PM Eastern
  assert.equal(when('2026-10-22T18:14:00Z', now), '2:14 PM');
  assert.equal(when('2026-10-21T22:00:00Z', now), 'Yesterday, 6:00 PM');
  assert.equal(when('2026-10-05T15:07:00Z', now), 'Oct 5, 11:07 AM');
  assert.equal(when('', now), '');
});

test('recents and thread lines never need the message text', () => {
  const r = { number: '+1', name: null, direction: 'inbound', red: true, at: '' } as const;
  assert.equal(recentDetail({ ...r, label: 'Missed', durationSeconds: 0 }), 'Missed');
  assert.equal(recentDetail({ ...r, label: 'Outgoing', durationSeconds: 125 }), 'Outgoing · 2:05');
  const t = { number: '+1', name: null, lastAt: '', lastDirection: 'inbound', unread: 0, failed: false } as const;
  assert.equal(threadDetail({ ...t, unread: 2 }), '2 new texts');
  assert.equal(threadDetail({ ...t, lastDirection: 'outbound', failed: true }), 'Your last text didn’t deliver');
  assert.equal(threadDetail(t), 'They texted last');
});

test('keypad keeps only what can be dialled', () => {
  assert.equal(keypadValue('(732) 200-1305'), '7322001305');
  assert.equal(keypadValue('+1 732 200 1305 ext 12'), '+17322001305,12');
  assert.equal(keypadValue('732-200-1305 x4'), '7322001305,4');
  assert.equal(keypadValue('5551234567,,802'), '5551234567,,802');
  assert.equal(keypadValue('1+2'), '12');
  assert.equal(canDial('91'), false);
  assert.equal(canDial('911'), true);
});

test('initials: first and last word of a name, # for a number', () => {
  assert.equal(initials('Sarah Chen'), 'SC');
  assert.equal(initials('Maya'), 'M');
  assert.equal(initials('Ana María de la Cruz'), 'AC');
  assert.equal(initials('élodie roux'), 'ÉR');
  assert.equal(initials(null), '#');
  assert.equal(initials('+19175550000'), '#');
  assert.equal(initials('  '), '#');
});
