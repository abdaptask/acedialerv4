import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callIsRed, callLabel, nameBook, toPanelContacts, toPanelHistory, toPanelRecent, toPanelThread } from './panelView.js';

const fav = (phone: string, firstName: string | null, lastName: string | null = null, label: string | null = null) => ({
  phone,
  firstName,
  lastName,
  label,
  numbers: [] as Array<{ phone: string; label: string | null }>,
});

const at = (s: string) => new Date(`2026-10-22T${s}Z`);
const noJobDiva = () => null;
const call = (direction: string, status: string, hangupCause: string | null = null) => ({
  direction, status, hangupCause, fromNumber: '+17322001305', toNumber: '+16465550100', startedAt: at('14:00:00'), durationSeconds: 0,
});

test('labels and red rows match the dialer’s Recents, status by status', () => {
  // [direction, status, hangupCause, label, red] — Recents.tsx statusLabel + isDangerStatus.
  const table: Array<[string, string, string | null, string, boolean]> = [
    ['inbound', 'missed', null, 'Missed', true],
    ['inbound', 'no_answer', null, 'Missed', true],
    ['inbound', 'missed', 'ORIGINATOR_CANCEL', 'Caller canceled', true],
    ['inbound', 'rejected', null, 'Declined', true],
    ['inbound', 'busy', null, 'Busy', true],
    ['inbound', 'failed', null, 'Failed', true],
    ['inbound', 'blocked', null, 'Blocked', true],
    ['inbound', 'forwarded', null, 'Forwarded', false],
    ['inbound', 'answered', null, 'Inbound', false],
    ['inbound', 'completed', null, 'Inbound', false],
    ['outbound', 'completed', null, 'Outgoing', false],
    ['outbound', 'failed', null, 'Outgoing', false],
    ['outbound', 'no_answer', null, 'Outgoing', false],
    ['outbound', 'blocked', null, 'Blocked', true],
  ];
  for (const [d, s, h, label, red] of table) {
    assert.equal(callLabel(call(d, s, h)), label, `${d} ${s} ${h}`);
    assert.equal(callIsRed(call(d, s, h)), red, `${d} ${s} ${h} red`);
  }
});

test('recents rows: other party, the dialer’s duration field, no extras', () => {
  const book = nameBook([fav('+17322001305', 'Sarah', 'Chen')]);
  const r = toPanelRecent({ ...call('inbound', 'completed'), durationSeconds: 125 }, book, noJobDiva);
  assert.deepEqual(r, {
    number: '+17322001305', name: 'Sarah Chen', direction: 'inbound', label: 'Inbound', red: false,
    at: '2026-10-22T14:00:00.000Z', durationSeconds: 125,
  });
  assert.equal(toPanelRecent(call('outbound', 'completed'), book, noJobDiva).number, '+16465550100');
});

test('names: favorite first, then a JobDiva name the dialer already looked up', () => {
  const book = nameBook([fav('+17322001305', 'Sarah', null)]);
  const jd = (p: string) => (p.endsWith('0100') ? 'Raj Patel' : null);
  assert.equal(toPanelRecent(call('inbound', 'completed'), book, jd).name, 'Sarah');
  assert.equal(toPanelRecent(call('outbound', 'completed'), book, jd).name, 'Raj Patel');
});

test('favorite names follow the dialer: first + last, else label; oldest wins a duplicate', () => {
  // GET /favorites order: newest first.
  const book = nameBook([fav('+17322001305', 'Newer', null), fav('7322001305', null, null, 'Older label')]);
  assert.equal(book.get('7322001305'), 'Older label');
});

test('threads carry no text; unread only while their message is last', () => {
  const t = toPanelThread({ threadKey: '+17322001305', direction: 'outbound', status: 'delivery_failed', createdAt: at('09:00:00') }, 3, new Map(), noJobDiva);
  assert.deepEqual(Object.keys(t).sort(), ['failed', 'lastAt', 'lastDirection', 'name', 'number', 'unread']);
  assert.equal(t.failed, true);
  assert.equal(t.unread, 0);
  // Extra columns on the source row must not ride through.
  const leaky = { threadKey: '+1', direction: 'inbound', status: 'received', createdAt: at('09:00:00'), body: 'secret', mediaUrls: ['x'] };
  const out = toPanelThread(leaky, 2, new Map(), noJobDiva) as unknown as Record<string, unknown>;
  assert.equal(out.body, undefined);
  assert.equal(out.mediaUrls, undefined);
  assert.equal(out.unread, 2);
});

test('favorites keep the dialer’s order and each favorite’s number order', () => {
  const c = toPanelContacts([
    { ...fav('+16465550100', 'Zoe'), numbers: [{ phone: '+16465550100', label: 'Mobile' }, { phone: '+12125550123', label: 'Work' }] },
    fav('+19175550000', null),
  ]);
  assert.deepEqual(c.map((x) => x.name), ['Zoe', '+19175550000']);
  assert.deepEqual(c[0].numbers, [
    { label: 'Mobile', number: '+16465550100' },
    { label: 'Work', number: '+12125550123' },
  ]);
  assert.deepEqual(c[1].numbers, [{ label: null, number: '+19175550000' }]);
});

test('history: calls, texts and voicemails newest first, with outcomes and no content', () => {
  const book = nameBook([fav('+17322001305', 'Sarah', 'Chen')]);
  const h = toPanelHistory('+17322001305', 30, {
    calls: [
      { ...call('inbound', 'missed'), startedAt: at('09:40:00') },
      { ...call('outbound', 'completed'), startedAt: at('08:00:00'), durationSeconds: 252 },
    ],
    texts: [
      { direction: 'outbound', status: 'delivered', createdAt: at('08:05:00') },
      { direction: 'outbound', status: 'delivery_failed', createdAt: at('08:06:00') },
      { direction: 'inbound', status: 'received', createdAt: at('09:00:00') },
    ],
    voicemails: [{ receivedAt: at('09:41:00'), durationSeconds: 38 }],
  }, book, noJobDiva);
  assert.equal(h.name, 'Sarah Chen');
  assert.deepEqual(h.items.map((i) => [i.label, i.detail, i.red]), [
    ['Voicemail', '0:38', false],
    ['Missed', '', true],
    ['They texted', '', false],
    ['You texted', 'Didn’t deliver', true],
    ['You texted', 'Delivered', false],
    ['Outgoing', '4:12', false],
  ]);
  for (const i of h.items) assert.deepEqual(Object.keys(i).sort(), ['at', 'detail', 'direction', 'kind', 'label', 'red']);
});

test('history: extra columns on a source row never ride through', () => {
  const leaky = { direction: 'inbound', status: 'received', createdAt: at('09:00:00'), body: 'secret', mediaUrls: ['x'] };
  const vm = { receivedAt: at('09:00:00'), durationSeconds: 5, transcription: 'secret', recordingUrl: 'https://x' };
  const json = JSON.stringify(toPanelHistory('+1', 30, { calls: [], texts: [leaky], voicemails: [vm] }, new Map(), noJobDiva));
  for (const leak of ['secret', 'https://x', 'body', 'mediaUrls', 'transcription', 'recordingUrl']) assert.equal(json.includes(leak), false, leak);
});
