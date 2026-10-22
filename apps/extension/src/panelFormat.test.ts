// Follow-ups panel wording.
//
// Run: npm run test -w apps/extension

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, canDial, detail, formatNumber, keypadValue, recentDetail, subtitle, talkTime, threadDetail, when } from './panelFormat.js';
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

test('talk time reads like a phone', () => {
  assert.equal(talkTime(45), '0:45');
  assert.equal(talkTime(125), '2:05');
  assert.equal(talkTime(3723), '1:02:03');
});

test('recents times: clock today, Yesterday, weekday, then a date', () => {
  const now = Date.parse('2026-10-22T19:00:00Z'); // Thu 3:00 PM Eastern
  const tz = 'America/New_York';
  assert.equal(when('2026-10-22T18:14:00Z', now, tz), '2:14 PM');
  assert.equal(when('2026-10-21T22:00:00Z', now, tz), 'Yesterday');
  assert.equal(when('2026-10-19T15:00:00Z', now, tz), 'Monday');
  assert.equal(when('2026-10-01T15:00:00Z', now, tz), '10/1/26');
  // 11pm Eastern on the 21st is already the 22nd in UTC — must still say Yesterday.
  assert.equal(when('2026-10-22T03:00:00Z', now, tz), 'Yesterday');
});

test('recents and thread lines never need the message text', () => {
  const r = { number: '+1', name: null, at: '', talkSeconds: null } as const;
  assert.equal(recentDetail({ ...r, direction: 'inbound', outcome: 'missed' }), 'Missed');
  assert.equal(recentDetail({ ...r, direction: 'outbound', outcome: 'answered', talkSeconds: 125 }), 'Outgoing · 2:05');
  assert.equal(recentDetail({ ...r, direction: 'outbound', outcome: 'no_answer' }), 'No answer');
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
