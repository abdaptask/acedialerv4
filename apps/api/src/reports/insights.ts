// Leadership insights computed from the same deduplicated data as the
// rest of /reports. Pure, like compute.ts.

import { type LogicalCall, outboundOutcome } from './canonicalCalls.js';
import type { MessageRow, Window } from './compute.js';
import { last10 } from './canonicalCalls.js';
import { etParts } from './etTime.js';

// A connected call this short is almost always a voicemail greeting, so it
// doesn't count as reaching someone.
const REACHED_SEC = 30;
const MIN_ATTEMPTS_FOR_RATE = 25;

/**
 * Carrier opt-out keywords (CTIA): a text that is ONLY one of these words.
 * Matching the whole message, not a prefix, keeps "Stop by at 3?" from
 * reading as an opt-out.
 */
const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt[\s-]?out|revoke)\s*[.!]*\s*$/i;
const START_RE = /^\s*(start|unstop|opt[\s-]?in)\s*[.!]*\s*$/i;

export function optKeyword(body: string): 'stop' | 'start' | null {
  if (STOP_RE.test(body)) return 'stop';
  if (START_RE.test(body)) return 'start';
  return null;
}

export interface Insights {
  /** [weekday 0=Mon..6][hour] outbound attempts and how many reached a person. */
  bestTime: Array<Array<{ attempts: number; reached: number }>>;
  bestTimeMinAttempts: number;
  sharedContacts: Array<{ number: string; userIds: number[]; calls: number; texts: number; lastAt: string }>;
  sharedContactsTotal: number;
  optOuts: Array<{ userId: number; number: string; at: string; sentAfter: number; lastSentAfter: string | null }>;
  optOutTotals: { optOuts: number; withTextsAfter: number; textsAfter: number };
  badNumbers: Array<{ number: string; userIds: number[]; attempts: number; lastAt: string }>;
}

export function computeInsights(
  win: Window,
  calls: LogicalCall[],
  messages: MessageRow[],
  userIds: number[],
): Insights {
  const scoped = new Set(userIds);
  const inWin = (t: number) => t >= win.startMs && t < win.endMs;

  const bestTime = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ attempts: 0, reached: 0 })));
  const contact = new Map<string, { number: string; users: Set<number>; calls: number; texts: number; lastAt: number }>();
  const bad = new Map<string, { number: string; users: Set<number>; attempts: number; lastAt: number }>();
  const touch = (num: string, raw: string, userId: number, at: number, kind: 'call' | 'text') => {
    if (!num) return;
    const c = contact.get(num) ?? { number: raw, users: new Set<number>(), calls: 0, texts: 0, lastAt: 0 };
    c.users.add(userId);
    if (kind === 'call') c.calls += 1;
    else c.texts += 1;
    c.lastAt = Math.max(c.lastAt, at);
    contact.set(num, c);
  };

  for (const c of calls) {
    if (!scoped.has(c.userId) || !inWin(c.startedAt)) continue;
    touch(c.other, c.number, c.userId, c.startedAt, 'call');
    if (c.direction !== 'outbound') continue;
    const et = etParts(c.startedAt);
    const cell = bestTime[et.dow - 1][et.hour];
    cell.attempts += 1;
    if (c.answered && c.talkSec >= REACHED_SEC) cell.reached += 1;
    if (outboundOutcome(c) === 'invalid_number' && c.other) {
      const b = bad.get(c.other) ?? { number: c.number, users: new Set<number>(), attempts: 0, lastAt: 0 };
      b.users.add(c.userId);
      b.attempts += 1;
      b.lastAt = Math.max(b.lastAt, c.startedAt);
      bad.set(c.other, b);
    }
  }

  // Opt-outs: walk each thread in order. Once they text STOP, every text we
  // send before they text START again is a compliance problem.
  const threads = new Map<string, MessageRow[]>();
  for (const m of messages) {
    if (!scoped.has(m.userId)) continue;
    if (inWin(m.createdAt)) touch(last10(m.threadKey), m.threadKey, m.userId, m.createdAt, 'text');
    const k = `${m.userId}|${m.threadKey}`;
    const l = threads.get(k);
    if (l) l.push(m);
    else threads.set(k, [m]);
  }
  const optOuts: Insights['optOuts'] = [];
  for (const thread of threads.values()) {
    thread.sort((a, b) => a.createdAt - b.createdAt);
    let open: Insights['optOuts'][number] | null = null;
    for (const m of thread) {
      if (m.direction === 'inbound' && m.keyword === 'stop') {
        open = { userId: m.userId, number: m.threadKey, at: new Date(m.createdAt).toISOString(), sentAfter: 0, lastSentAfter: null };
        if (inWin(m.createdAt)) optOuts.push(open);
        else open = null;
      } else if (m.direction === 'inbound' && m.keyword === 'start') {
        open = null;
      } else if (open && m.direction === 'outbound') {
        open.sentAfter += 1;
        open.lastSentAfter = new Date(m.createdAt).toISOString();
      }
    }
  }
  optOuts.sort((a, b) => b.sentAfter - a.sentAfter || b.at.localeCompare(a.at));

  const shared = [...contact.values()].filter((c) => c.users.size >= 2);
  return {
    bestTime,
    bestTimeMinAttempts: MIN_ATTEMPTS_FOR_RATE,
    sharedContacts: shared
      .sort((a, b) => b.users.size - a.users.size || b.calls + b.texts - (a.calls + a.texts))
      .slice(0, 100)
      .map((c) => ({ number: c.number, userIds: [...c.users], calls: c.calls, texts: c.texts, lastAt: new Date(c.lastAt).toISOString() })),
    sharedContactsTotal: shared.length,
    optOuts: optOuts.slice(0, 200),
    optOutTotals: {
      optOuts: optOuts.length,
      withTextsAfter: optOuts.filter((o) => o.sentAfter > 0).length,
      textsAfter: optOuts.reduce((a, o) => a + o.sentAfter, 0),
    },
    badNumbers: [...bad.values()]
      .filter((b) => b.attempts >= 2)
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 100)
      .map((b) => ({ number: b.number, userIds: [...b.users], attempts: b.attempts, lastAt: new Date(b.lastAt).toISOString() })),
  };
}
