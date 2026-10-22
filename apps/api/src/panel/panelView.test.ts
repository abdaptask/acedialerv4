import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameBook, toPanelContacts, toPanelRecent, toPanelThread } from './panelView.js';

const fav = (phone: string, firstName: string | null, lastName: string | null = null, numbers: string[] = []) => ({
  phone,
  firstName,
  lastName,
  label: null,
  numbers: numbers.map((p, i) => ({ phone: p, label: i ? 'Work' : 'Mobile', sortOrder: i * 10 })),
});

const at = (s: string) => new Date(`2026-10-22T${s}Z`);

test('names resolve from every number on a favorite, by last 10 digits', () => {
  const book = nameBook([fav('+17322001305', 'Sarah', 'Chen', ['+17322001305', '+16465550100'])]);
  assert.equal(book.get('7322001305'), 'Sarah Chen');
  assert.equal(book.get('6465550100'), 'Sarah Chen');
});

test('a short code never picks up a contact name', () => {
  assert.equal(nameBook([fav('22000', 'Promo')]).size, 0);
});

test('recents: inbound unanswered is missed, talk time excludes ringing', () => {
  const book = nameBook([fav('+17322001305', 'Sarah', 'Chen')]);
  const missed = toPanelRecent(
    { direction: 'inbound', fromNumber: '+17322001305', toNumber: '+12015550000', status: 'no_answer', startedAt: at('14:00:00'), answeredAt: null, endedAt: at('14:00:25') },
    book,
  );
  assert.deepEqual(missed, {
    number: '+17322001305', name: 'Sarah Chen', direction: 'inbound', outcome: 'missed', at: '2026-10-22T14:00:00.000Z', talkSeconds: null,
  });
  const out = toPanelRecent(
    { direction: 'outbound', fromNumber: '+12015550000', toNumber: '+16465550199', status: 'completed', startedAt: at('15:00:00'), answeredAt: at('15:00:20'), endedAt: at('15:02:20') },
    book,
  );
  assert.equal(out.number, '+16465550199');
  assert.equal(out.outcome, 'answered');
  assert.equal(out.talkSeconds, 120);
  assert.equal(out.name, null);
});

test('recents: blocked stays blocked even with no answer', () => {
  const r = toPanelRecent(
    { direction: 'inbound', fromNumber: '+17322001305', toNumber: '+1', status: 'blocked', startedAt: at('10:00:00'), answeredAt: null, endedAt: null },
    new Map(),
  );
  assert.equal(r.outcome, 'blocked');
});

test('threads carry no text, and flag a failed last send', () => {
  const t = toPanelThread({ threadKey: '+17322001305', direction: 'outbound', status: 'delivery_failed', createdAt: at('09:00:00') }, 0, new Map());
  assert.deepEqual(Object.keys(t).sort(), ['failed', 'lastAt', 'lastDirection', 'name', 'number', 'unread']);
  assert.equal(t.failed, true);
  // Extra columns on the source row must not ride through.
  const leaky = { threadKey: '+1', direction: 'inbound', status: 'received', createdAt: at('09:00:00'), body: 'secret', mediaUrls: ['x'] };
  const out = toPanelThread(leaky, 2, new Map()) as unknown as Record<string, unknown>;
  assert.equal(out.body, undefined);
  assert.equal(out.mediaUrls, undefined);
  assert.equal(out.unread, 2);
});

test('contacts sort by name and keep number order', () => {
  const c = toPanelContacts([
    fav('+16465550100', 'zoe', null, ['+16465550100']),
    fav('+17322001305', 'Adam', 'Lee', ['+17322001305', '+12125550123']),
    fav('+19175550000', null),
  ]);
  assert.deepEqual(c.map((x) => x.name), ['+19175550000', 'Adam Lee', 'zoe']);
  assert.deepEqual(c[1].numbers, [
    { label: 'Mobile', number: '+17322001305' },
    { label: 'Work', number: '+12125550123' },
  ]);
});
