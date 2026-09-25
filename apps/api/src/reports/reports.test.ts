// Reports engine tests.
//
// Run: npm run test -w apps/api
//
// The load-bearing cases are the dedupe ones. The old /admin/reports/*
// endpoints counted every outbound call twice (app row + Telnyx row), and
// the first cut of this engine would have silently merged genuine redials —
// which is the very signal "likely drops" depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeCalls,
  inboundOutcome,
  isConfirmedDrop,
  outboundOutcome,
  type RawCallRow,
} from './canonicalCalls.js';
import { computePeriod, estimateSegments, type ReportData } from './compute.js';
import { addDays, daySpan, etDateKey, etMidnightUtc, etParts, isDateKey } from './etTime.js';

const T0 = Date.UTC(2026, 8, 15, 14, 0, 0); // Tue 15 Sep 2026, 10:00 ET

function row(p: Partial<RawCallRow>): RawCallRow {
  return {
    userId: 1,
    telnyxCallId: `id-${Math.random()}`,
    sessionId: null,
    direction: 'outbound',
    fromNumber: '+17325550100',
    toNumber: '+12125550199',
    status: 'completed',
    startedAt: T0,
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
    hangupCause: null,
    hangupSource: null,
    userDidId: null,
    avgJitterMs: null,
    avgLossPct: null,
    maxLossPct: null,
    avgRttMs: null,
    ...p,
  };
}

// ── Eastern time ────────────────────────────────────────────────────────

test('ET midnight lands on 04:00Z in summer and 05:00Z in winter', () => {
  assert.equal(new Date(etMidnightUtc('2026-07-01')).toISOString(), '2026-07-01T04:00:00.000Z');
  assert.equal(new Date(etMidnightUtc('2026-12-01')).toISOString(), '2026-12-01T05:00:00.000Z');
});

test('ET midnight is right on both DST transition days', () => {
  // 2026: DST starts Sun 8 Mar, ends Sun 1 Nov.
  assert.equal(new Date(etMidnightUtc('2026-03-08')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(etMidnightUtc('2026-03-09')).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(new Date(etMidnightUtc('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(etMidnightUtc('2026-11-02')).toISOString(), '2026-11-02T05:00:00.000Z');
});

test('an 11pm ET call stays on its own ET day, not the next UTC day', () => {
  const lateCall = Date.UTC(2026, 8, 16, 3, 0); // 03:00Z = 23:00 ET on the 15th
  assert.equal(etDateKey(lateCall), '2026-09-15');
  const p = etParts(lateCall);
  assert.equal(p.hour, 23);
  assert.equal(p.dow, 2); // Tuesday
});

test('etParts weekday and minute-of-day', () => {
  const p = etParts(T0);
  assert.deepEqual(p, { date: '2026-09-15', dow: 2, hour: 10, minuteOfDay: 600 });
  assert.equal(etParts(Date.UTC(2026, 8, 20, 16, 0)).dow, 7); // Sunday
});

test('date key helpers', () => {
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('2026-9-1'), false);
  assert.equal(addDays('2026-09-01', -1), '2026-08-31');
  assert.equal(daySpan('2026-08-27', '2026-09-25'), 30);
});

// ── Dedupe ──────────────────────────────────────────────────────────────

test('app row + Telnyx row for one outbound call count once, with talk time from answer', () => {
  const calls = canonicalizeCalls([
    // Telnyx leg: started at dial, answered 15s later, 60s of talk.
    row({ sessionId: 's1', startedAt: T0, answeredAt: T0 + 15_000, endedAt: T0 + 75_000, durationSeconds: 75, hangupCause: 'normal_clearing' }),
    // App row, a few seconds off, carrying the JsSIP reason + quality.
    row({ startedAt: T0 + 3_000, answeredAt: T0 + 16_000, endedAt: T0 + 75_000, durationSeconds: 59, hangupCause: 'Terminated', hangupSource: 'local', avgJitterMs: 12, avgLossPct: 0.4 }),
  ]);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.talkSec, 60, 'ringing must not count as talk');
  assert.equal(c.cause, 'normal_clearing');
  assert.equal(c.clientCause, 'Terminated');
  assert.equal(c.clientOriginator, 'local');
  assert.equal(c.quality?.avgJitterMs, 12);
  assert.equal(c.telnyxCallIds.length, 2);
});

test('two genuine calls to the same number seconds apart are NOT merged', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 's1', startedAt: T0, answeredAt: T0 + 5_000, endedAt: T0 + 20_000 }),
    row({ sessionId: 's2', startedAt: T0 + 30_000, answeredAt: T0 + 35_000, endedAt: T0 + 95_000 }),
  ]);
  assert.equal(calls.length, 2);
});

test('legs sharing a session collapse to the answered one', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 's1', direction: 'inbound', fromNumber: '+12125550199', toNumber: '+17325550100', status: 'missed' }),
    row({ sessionId: 's1', direction: 'inbound', fromNumber: '+12125550199', toNumber: '+17325550100', answeredAt: T0 + 4_000, endedAt: T0 + 64_000 }),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].answered, true);
});

test('an app row with no Telnyx partner is kept (webhook misconfigured users)', () => {
  const calls = canonicalizeCalls([row({ answeredAt: T0 + 2_000, endedAt: T0 + 32_000 })]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].talkSec, 30);
});

test('rows for different people are never merged', () => {
  const calls = canonicalizeCalls([
    row({ userId: 1, sessionId: 's1' }),
    row({ userId: 2, startedAt: T0 + 1_000 }),
  ]);
  assert.equal(calls.length, 2);
});

test('a stuck call with no end adds no talk time', () => {
  const [c] = canonicalizeCalls([row({ sessionId: 's1', answeredAt: T0 + 1_000, endedAt: null, durationSeconds: 99_999 })]);
  assert.equal(c.talkSec, 0);
});

// ── Outcomes ────────────────────────────────────────────────────────────

test('inbound: caller hanging up while it rings is unanswered, even with a duration', () => {
  const [c] = canonicalizeCalls([row({ sessionId: 's', direction: 'inbound', fromNumber: '+12125550199', status: 'caller_canceled', durationSeconds: 20, hangupCause: 'originator_cancel' })]);
  assert.equal(c.answered, false);
  assert.equal(inboundOutcome(c), 'caller_hung_up');
});

test('inbound: a decline (486 → busy) is "declined"', () => {
  const [c] = canonicalizeCalls([row({ sessionId: 's', direction: 'inbound', status: 'busy', hangupCause: 'user_busy' })]);
  assert.equal(inboundOutcome(c), 'declined');
});

test('outbound: not_found is an invalid number, originator_cancel is no answer', () => {
  const [a] = canonicalizeCalls([row({ sessionId: 'a', status: 'failed', hangupCause: 'not_found' })]);
  const [b] = canonicalizeCalls([row({ sessionId: 'b', status: 'caller_canceled', hangupCause: 'originator_cancel' })]);
  assert.equal(outboundOutcome(a), 'invalid_number');
  assert.equal(outboundOutcome(b), 'no_answer');
});

test('confirmed drop needs a network cause on a connected call', () => {
  const [drop] = canonicalizeCalls([row({ answeredAt: T0 + 1_000, endedAt: T0 + 40_000, hangupCause: 'RTP Timeout' })]);
  const [normal] = canonicalizeCalls([row({ answeredAt: T0 + 1_000, endedAt: T0 + 40_000, hangupCause: 'Terminated' })]);
  const [neverUp] = canonicalizeCalls([row({ hangupCause: 'Connection Error' })]);
  assert.equal(isConfirmedDrop(drop), true);
  assert.equal(isConfirmedDrop(normal), false);
  assert.equal(isConfirmedDrop(neverUp), false);
});

// ── Period metrics ──────────────────────────────────────────────────────

const PRICING = { inboundPerMin: 0.005, outboundPerMin: 0.007, perSms: 0.004, didMonthly: 1 };
const WIN = { startMs: etMidnightUtc('2026-09-15'), endMs: etMidnightUtc('2026-09-16'), days: 1 };

function data(p: Partial<ReportData>): ReportData {
  return {
    calls: [], messages: [], voicemails: [], scheduled: [], campaigns: [], lines: [], favoritesAdded: [],
    pricing: PRICING, ...p,
  };
}

test('a missed call returned within 24h counts as returned, with the wait', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 'in', direction: 'inbound', fromNumber: '+12125550199', status: 'missed' }),
    row({ sessionId: 'out', startedAt: T0 + 600_000 }),
  ]);
  const r = computePeriod(WIN, data({ calls }), [1]);
  assert.equal(r.totals.missedReturnable, 1);
  assert.equal(r.totals.missedReturned, 1);
  assert.equal(r.totals.medianCallbackSec, 600);
});

test('a missed call returned after 24h does not count', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 'in', direction: 'inbound', fromNumber: '+12125550199', status: 'missed' }),
    row({ sessionId: 'out', startedAt: T0 + 25 * 3600_000 }),
  ]);
  const r = computePeriod(WIN, data({ calls }), [1]);
  assert.equal(r.totals.missedReturned, 0);
});

test('redialing the same number within 2 minutes of a real call is a likely drop', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 'a', answeredAt: T0 + 5_000, endedAt: T0 + 65_000 }),
    row({ sessionId: 'b', startedAt: T0 + 90_000 }),
  ]);
  const r = computePeriod(WIN, data({ calls }), [1]);
  assert.equal(r.totals.likelyDrops, 1);
});

test('a short connected call followed by a redial is not a likely drop', () => {
  const calls = canonicalizeCalls([
    row({ sessionId: 'a', answeredAt: T0 + 5_000, endedAt: T0 + 9_000 }),
    row({ sessionId: 'b', startedAt: T0 + 20_000 }),
  ]);
  const r = computePeriod(WIN, data({ calls }), [1]);
  assert.equal(r.totals.likelyDrops, 0);
  assert.equal(r.totals.shortCalls, 1);
});

test('SMS reply rate counts an inbound run once and ignores bodies entirely', () => {
  const m = (direction: string, offsetMin: number) => ({
    userId: 1, threadKey: '+12125550199', direction, status: direction === 'inbound' ? 'received' : 'delivered',
    bodyLength: 20, isGsm: true, hasMedia: false, createdAt: T0 + offsetMin * 60_000, errorCode: null, errorTitle: null,
  });
  const r = computePeriod(WIN, data({ messages: [m('inbound', 0), m('inbound', 1), m('inbound', 2), m('outbound', 5)] }), [1]);
  assert.equal(r.totals.smsReceived, 3);
  assert.equal(r.totals.smsRepliable, 1, 'three texts in a row are one turn');
  assert.equal(r.totals.smsReplied, 1);
  assert.equal(r.totals.medianReplySec, 300);
});

test('delivery_failed is a failure (the old Quality report missed these)', () => {
  const r = computePeriod(WIN, data({
    messages: [{
      userId: 1, threadKey: '+1', direction: 'outbound', status: 'delivery_failed', bodyLength: 10, isGsm: true,
      hasMedia: false, createdAt: T0, errorCode: '40010', errorTitle: 'Not 10DLC registered',
    }],
  }), [1]);
  assert.equal(r.totals.smsFailed, 1);
  assert.deepEqual(r.sms.failureReasons, [{ code: '40010', title: 'Not 10DLC registered', count: 1 }]);
});

test('people outside the scope never leak into totals', () => {
  const calls = canonicalizeCalls([row({ userId: 1, sessionId: 'a' }), row({ userId: 2, sessionId: 'b' })]);
  const r = computePeriod(WIN, data({ calls }), [1]);
  assert.equal(r.totals.callsOut, 1);
  assert.equal(r.people.has(2), false);
});

test('team "new contacts" counts a number once even if two people reached it', () => {
  const calls = canonicalizeCalls([
    row({ userId: 1, sessionId: 'a', answeredAt: T0 + 1_000, endedAt: T0 + 30_000 }),
    row({ userId: 2, sessionId: 'b', answeredAt: T0 + 1_000, endedAt: T0 + 30_000 }),
  ]);
  const r = computePeriod(WIN, data({ calls }), [1, 2]);
  assert.equal(r.totals.uniqueReached, 1);
  assert.equal(r.totals.newContacts, 1);
  assert.equal(r.people.get(1)!.newContacts, 1);
});

test('segments: GSM 160/153, UCS-2 70/67', () => {
  assert.equal(estimateSegments(160, true), 1);
  assert.equal(estimateSegments(161, true), 2);
  assert.equal(estimateSegments(70, false), 1);
  assert.equal(estimateSegments(71, false), 2);
  assert.equal(estimateSegments(135, false), 3);
});
