// Contact lookup + follow-ups.
//
//   GET /reports/contact/search?q=   → numbers matching digits or a saved name
//   GET /reports/contact?number=     → who on the team called / texted that
//                                      number, and every call + text with it
//   GET /reports/follow-ups?userId=  → what's waiting on someone right now
//
// Same scope rule as /reports: admins see everyone, anyone else only their
// own history. Texts are records only; bodies are read solely to spot STOP /
// START and never leave this file.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { canonicalizeCalls, endReason, inboundOutcome, last10, outboundOutcome, type LogicalCall, type RawCallRow } from './canonicalCalls.js';
import { textFailureReason } from './textReasons.js';
import { optKeyword } from './insights.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

const DAY = 86_400_000;
const LOOKBACK_DAYS = 365;
const FOLLOW_UP_DAYS = 14;

const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Answered', caller_hung_up: 'Caller hung up', rang_out: 'Rang out', declined: 'Declined',
  blocked: 'Blocked', connected: 'Connected', no_answer: 'No answer', busy: 'Busy',
  invalid_number: 'Number not found', rejected: 'Rejected', failed: 'Failed', other: 'Other',
};
const FAILED_TEXT = new Set(['delivery_failed', 'failed', 'undelivered', 'sending_failed']);

function displayName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  // Tombstoned accounts keep their rows for history but have no name.
  if (u.email.endsWith('@deleted.ace.local')) return 'Former user';
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
}

function favoriteName(f: { firstName: string | null; lastName: string | null; label: string | null }): string {
  const first = (f.firstName ?? '').trim();
  const last = (f.lastName ?? '').trim();
  const joined = first && last && first.toLowerCase().includes(last.toLowerCase()) ? first : `${first} ${last}`.trim();
  return joined || (f.label ?? '').trim();
}

/** Scope for a request: null = everyone (admin without userId). */
function scopeOf(request: FastifyRequest, reply: FastifyReply, raw?: string): number | null | undefined {
  const me = request.user as JwtPayload;
  let userId: number | null = null;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) { reply.code(400).send({ error: 'userId must be a number.' }); return undefined; }
    userId = n;
  }
  if (!me.isAdmin) {
    if (userId !== null && userId !== me.sub) { reply.code(403).send({ error: 'You can only view your own report.' }); return undefined; }
    userId = me.sub;
  }
  return userId;
}

/** Names for numbers, per person: their favorites, then coworkers' lines. */
async function loadNames(userIds: number[] | null) {
  const [favs, dids] = await Promise.all([
    prisma.favorite.findMany({
      where: userIds ? { userId: { in: userIds } } : {},
      select: { userId: true, phone: true, firstName: true, lastName: true, label: true, numbers: { select: { phone: true } } },
    }),
    prisma.userDid.findMany({
      where: { userId: { not: null } },
      select: { didNumber: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);
  const byUser = new Map<string, string>();
  const any = new Map<string, string>();
  for (const d of dids) {
    const k = last10(d.didNumber);
    if (k && d.user) any.set(k, `${displayName(d.user)} (coworker)`);
  }
  for (const f of favs) {
    const n = favoriteName(f);
    if (!n) continue;
    for (const ph of [f.phone, ...f.numbers.map((x) => x.phone)]) {
      const k = last10(ph);
      if (!k) continue;
      byUser.set(`${f.userId}|${k}`, n);
      if (!any.has(k) || any.get(k)!.endsWith('(coworker)')) any.set(k, n);
    }
  }
  return {
    forUser: (userId: number, num: string) => {
      const k = last10(num);
      return k ? byUser.get(`${userId}|${k}`) ?? any.get(k) ?? null : null;
    },
    any: (num: string) => {
      const k = last10(num);
      return k ? any.get(k) ?? null : null;
    },
  };
}

async function userNames(): Promise<Map<number, string>> {
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, email: true } });
  return new Map(users.map((u) => [u.id, displayName(u)]));
}

// Raw SQL: the digits-only last-10 compare can't be expressed in a Prisma
// where (CLAUDE.md §30.3 makes the same call). One pass over ~260k rows.
async function loadCallsFor(sinceMs: number, userId: number | null, digitsExact: string | null): Promise<RawCallRow[]> {
  const since = new Date(sinceMs);
  const rows = await prisma.$queryRaw<Array<{ r: string }>>`
    SELECT concat_ws(chr(31), user_id, telnyx_call_id, coalesce(session_id, ''), direction, status,
      coalesce(hangup_cause, ''), coalesce(hangup_source, ''), coalesce(user_did_id::text, ''),
      from_number, to_number,
      (extract(epoch from started_at) * 1000)::bigint,
      coalesce(((extract(epoch from answered_at) * 1000)::bigint)::text, ''),
      coalesce(((extract(epoch from ended_at) * 1000)::bigint)::text, ''),
      duration_seconds, '', '', '', '', coalesce(rx_packets::text, ''), coalesce(sip_hangup_cause, ''),
      coalesce(carrier_stats->'inbound'->>'packet_count', '')) AS r
    FROM calls
    WHERE started_at >= ${since}
      AND (${userId}::int IS NULL OR user_id = ${userId}::int)
      AND (${digitsExact}::text IS NULL OR right(regexp_replace(
            CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END, '\\D', '', 'g'), 10) = ${digitsExact}::text)`;
  const str = (v: string) => (v === '' ? null : v);
  const num = (v: string) => (v === '' ? null : Number(v));
  return rows.map(({ r }) => {
    const f = r.split('\x1f');
    return {
      userId: Number(f[0]), telnyxCallId: f[1], sessionId: str(f[2]), direction: f[3], status: f[4],
      hangupCause: str(f[5]), hangupSource: str(f[6]), userDidId: num(f[7]), fromNumber: f[8], toNumber: f[9],
      startedAt: Number(f[10]), answeredAt: num(f[11]), endedAt: num(f[12]), durationSeconds: Number(f[13]),
      avgJitterMs: null, avgLossPct: null, maxLossPct: null, avgRttMs: null,
      rxPackets: num(f[18]), sipHangupCause: str(f[19]), carrierRxPackets: num(f[20]),
    };
  });
}

function callOutcome(c: LogicalCall): string {
  return c.direction === 'inbound' ? inboundOutcome(c) : outboundOutcome(c);
}

export async function lookupRoutes(app: FastifyInstance) {
  // ── Search ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>('/reports/contact/search', { onRequest: [app.authenticate] }, async (request, reply) => {
    const scope = scopeOf(request, reply);
    if (scope === undefined) return;
    const q = (request.query.q ?? '').trim();
    const digits = q.replace(/\D/g, '');
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);

    let keys: string[] = [];
    if (digits.length >= 4) {
      const like = `%${digits.slice(-10)}%`;
      const rows = await prisma.$queryRaw<Array<{ k: string }>>`
        SELECT k FROM (
          SELECT right(regexp_replace(CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END, '\\D', '', 'g'), 10) AS k,
                 started_at AS at
          FROM calls WHERE started_at >= ${since} AND (${scope}::int IS NULL OR user_id = ${scope}::int)
          UNION ALL
          SELECT right(regexp_replace(thread_key, '\\D', '', 'g'), 10), created_at
          FROM messages WHERE created_at >= ${since} AND (${scope}::int IS NULL OR user_id = ${scope}::int)
        ) x
        WHERE length(k) = 10 AND k LIKE ${like}
        GROUP BY k ORDER BY max(at) DESC LIMIT 20`;
      keys = rows.map((r) => r.k);
    } else if (q.length >= 2) {
      const favs = await prisma.favorite.findMany({
        where: {
          ...(scope !== null ? { userId: scope } : {}),
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { label: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { phone: true, numbers: { select: { phone: true } } },
        take: 50,
      });
      keys = [...new Set(favs.flatMap((f) => [f.phone, ...f.numbers.map((n) => n.phone)]).map(last10).filter(Boolean))].slice(0, 20);
    } else {
      return { query: q, results: [] };
    }
    if (keys.length === 0) return { query: q, results: [] };

    const stats = await prisma.$queryRaw<Array<{ k: string; calls: bigint; texts: bigint; people: bigint; last_at: Date }>>`
      SELECT k, sum(calls)::bigint AS calls, sum(texts)::bigint AS texts, count(DISTINCT user_id)::bigint AS people, max(at) AS last_at FROM (
        SELECT right(regexp_replace(CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END, '\\D', '', 'g'), 10) AS k,
               user_id, 1 AS calls, 0 AS texts, started_at AS at
        FROM calls WHERE started_at >= ${since} AND session_id IS NOT NULL AND (${scope}::int IS NULL OR user_id = ${scope}::int)
        UNION ALL
        SELECT right(regexp_replace(thread_key, '\\D', '', 'g'), 10), user_id, 0, 1, created_at
        FROM messages WHERE created_at >= ${since} AND (${scope}::int IS NULL OR user_id = ${scope}::int)
      ) x WHERE k = ANY(${keys}) GROUP BY k ORDER BY max(at) DESC`;
    const names = await loadNames(scope !== null ? [scope] : null);
    return {
      query: q,
      results: stats.map((s) => ({
        number: `+1${s.k}`,
        name: names.any(s.k),
        calls: Number(s.calls),
        texts: Number(s.texts),
        people: Number(s.people),
        lastAt: s.last_at.toISOString(),
      })),
    };
  });

  // ── One contact across the team ─────────────────────────────────────
  app.get<{ Querystring: { number?: string; userId?: string } }>('/reports/contact', { onRequest: [app.authenticate] }, async (request, reply) => {
    const scope = scopeOf(request, reply, request.query.userId);
    if (scope === undefined) return;
    const key = last10(request.query.number);
    if (!key) return reply.code(400).send({ error: 'Enter a full 10-digit phone number.' });
    const sinceMs = Date.now() - LOOKBACK_DAYS * DAY;

    const [rawCalls, msgs, vms, names, people] = await Promise.all([
      loadCallsFor(sinceMs, scope, key),
      prisma.$queryRaw<Array<{ user_id: number; direction: string; status: string; body: string; media: number; created_at: Date; errors: unknown }>>`
        SELECT user_id, direction, status, body, cardinality(media_urls) AS media, created_at, errors
        FROM messages
        WHERE created_at >= ${new Date(sinceMs)} AND (${scope}::int IS NULL OR user_id = ${scope}::int)
          AND right(regexp_replace(thread_key, '\\D', '', 'g'), 10) = ${key}`,
      prisma.$queryRaw<Array<{ user_id: number; received_at: Date; listened_at: Date | null; duration_seconds: number }>>`
        SELECT user_id, received_at, listened_at, duration_seconds FROM voicemails
        WHERE received_at >= ${new Date(sinceMs)} AND (${scope}::int IS NULL OR user_id = ${scope}::int)
          AND right(regexp_replace(from_number, '\\D', '', 'g'), 10) = ${key}`,
      loadNames(scope !== null ? [scope] : null),
      userNames(),
    ]);
    const calls = canonicalizeCalls(rawCalls);

    type Ev = {
      at: string; userId: number; kind: 'call' | 'text' | 'voicemail'; direction: 'inbound' | 'outbound';
      label: string; tone: 'good' | 'warn' | 'crit' | null; talkSec?: number; detail?: string;
    };
    const events: Ev[] = [];
    const per = new Map<number, {
      userId: number; callsOut: number; callsIn: number; connected: number; talkSec: number;
      textsSent: number; textsReceived: number; voicemails: number; firstAt: number; lastAt: number; optedOut: boolean;
    }>();
    const row = (userId: number, at: number) => {
      const r = per.get(userId) ?? {
        userId, callsOut: 0, callsIn: 0, connected: 0, talkSec: 0, textsSent: 0, textsReceived: 0,
        voicemails: 0, firstAt: at, lastAt: at, optedOut: false,
      };
      r.firstAt = Math.min(r.firstAt, at);
      r.lastAt = Math.max(r.lastAt, at);
      per.set(userId, r);
      return r;
    };
    for (const c of calls) {
      const r = row(c.userId, c.startedAt);
      if (c.direction === 'outbound') r.callsOut += 1;
      else r.callsIn += 1;
      if (c.answered) { r.connected += 1; r.talkSec += c.talkSec; }
      const o = callOutcome(c);
      const end = endReason(c);
      events.push({
        at: new Date(c.startedAt).toISOString(), userId: c.userId, kind: 'call', direction: c.direction,
        label: OUTCOME_LABELS[o] ?? o,
        tone: end.key === 'no_audio' || end.key === 'dropped' ? 'crit' : c.answered ? 'good' : o === 'invalid_number' || o === 'failed' ? 'crit' : o === 'caller_hung_up' || o === 'rang_out' ? 'warn' : null,
        talkSec: c.answered ? c.talkSec : undefined,
        detail: end.label,
      });
    }
    for (const m of [...msgs].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
      const at = m.created_at.getTime();
      const r = row(m.user_id, at);
      const inbound = m.direction === 'inbound';
      if (inbound) r.textsReceived += 1;
      else r.textsSent += 1;
      const kw = inbound ? optKeyword(m.body ?? '') : null;
      if (kw === 'stop') r.optedOut = true;
      if (kw === 'start') r.optedOut = false;
      const failed = !inbound && FAILED_TEXT.has((m.status ?? '').toLowerCase());
      const first = Array.isArray(m.errors) ? (m.errors[0] as { title?: string; code?: string | number } | undefined) : undefined;
      events.push({
        at: m.created_at.toISOString(), userId: m.user_id, kind: 'text', direction: inbound ? 'inbound' : 'outbound',
        label: kw === 'stop' ? 'Opted out (STOP)' : kw === 'start' ? 'Opted back in' : inbound ? 'Received' : failed ? 'Failed' : m.status === 'delivered' ? 'Delivered' : 'Sent, not confirmed',
        tone: kw === 'stop' || failed ? 'crit' : !inbound && m.status === 'delivered' ? 'good' : null,
        detail: [
          m.media > 0 ? 'Picture message' : 'Text',
          failed ? textFailureReason(first?.code != null ? String(first.code) : null, first?.title ?? null) : null,
          !inbound && !failed && m.status !== 'delivered' ? 'delivery not confirmed by the carrier' : null,
        ].filter(Boolean).join(' · '),
      });
    }
    for (const v of vms) {
      const r = row(v.user_id, v.received_at.getTime());
      r.voicemails += 1;
      events.push({
        at: v.received_at.toISOString(), userId: v.user_id, kind: 'voicemail', direction: 'inbound',
        label: v.listened_at ? 'Voicemail, heard' : 'Voicemail, not heard', tone: v.listened_at ? null : 'warn',
        detail: `${Math.round(v.duration_seconds)}s`,
      });
    }
    events.sort((a, b) => b.at.localeCompare(a.at));

    return {
      number: `+1${key}`,
      name: names.any(key),
      lookbackDays: LOOKBACK_DAYS,
      people: [...per.values()]
        .sort((a, b) => b.lastAt - a.lastAt)
        .map((r) => ({
          ...r,
          name: people.get(r.userId) ?? 'Unknown',
          savedAs: names.forUser(r.userId, key),
          firstAt: new Date(r.firstAt).toISOString(),
          lastAt: new Date(r.lastAt).toISOString(),
        })),
      events: events.slice(0, 1500),
      totalEvents: events.length,
    };
  });

  // ── Follow-ups: what's waiting on someone right now ─────────────────
  app.get<{ Querystring: { userId?: string } }>('/reports/follow-ups', { onRequest: [app.authenticate] }, async (request, reply) => {
    const scope = scopeOf(request, reply, request.query.userId);
    if (scope === undefined) return;
    const now = Date.now();
    const sinceMs = now - FOLLOW_UP_DAYS * DAY;

    const [rawCalls, msgs, vms, names, people] = await Promise.all([
      loadCallsFor(sinceMs, scope, null),
      prisma.message.findMany({
        where: { createdAt: { gte: new Date(sinceMs) }, ...(scope !== null ? { userId: scope } : {}) },
        select: { userId: true, threadKey: true, direction: true, body: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.voicemail.findMany({
        where: { receivedAt: { gte: new Date(sinceMs) }, listenedAt: null, ...(scope !== null ? { userId: scope } : {}) },
        select: { userId: true, fromNumber: true, receivedAt: true, durationSeconds: true },
      }),
      loadNames(scope !== null ? [scope] : null),
      userNames(),
    ]);
    const calls = canonicalizeCalls(rawCalls);

    // Anything we did toward a number after time t counts as following up.
    const lastTouch = new Map<string, number>();
    const touch = (userId: number, num: string, at: number) => {
      const k = `${userId}|${last10(num)}`;
      lastTouch.set(k, Math.max(lastTouch.get(k) ?? 0, at));
    };
    for (const c of calls) if (c.direction === 'outbound' || c.answered) touch(c.userId, c.number, c.startedAt);
    for (const m of msgs) if (m.direction === 'outbound') touch(m.userId, m.threadKey, m.createdAt.getTime());

    const missed = new Map<string, { userId: number; number: string; attempts: number; firstAt: number; lastAt: number }>();
    for (const c of calls) {
      if (c.direction !== 'inbound' || c.answered || !c.other) continue;
      const o = inboundOutcome(c);
      if (o === 'blocked') continue;
      const k = `${c.userId}|${c.other}`;
      if ((lastTouch.get(k) ?? 0) > c.startedAt) continue;
      const m = missed.get(k) ?? { userId: c.userId, number: c.number, attempts: 0, firstAt: c.startedAt, lastAt: c.startedAt };
      m.attempts += 1;
      m.firstAt = Math.min(m.firstAt, c.startedAt);
      m.lastAt = Math.max(m.lastAt, c.startedAt);
      missed.set(k, m);
    }
    // A missed call is only open if nothing happened after its LAST attempt.
    for (const [k, m] of missed) if ((lastTouch.get(k) ?? 0) > m.lastAt) missed.delete(k);

    const threads = new Map<string, { userId: number; number: string; waiting: number; since: number; lastAt: number; optedOut: boolean }>();
    for (const m of msgs) {
      const k = `${m.userId}|${m.threadKey}`;
      const t = threads.get(k) ?? { userId: m.userId, number: m.threadKey, waiting: 0, since: 0, lastAt: 0, optedOut: false };
      if (m.direction === 'inbound') {
        const kw = optKeyword(m.body ?? '');
        if (kw === 'stop') t.optedOut = true;
        if (kw === 'start') t.optedOut = false;
        if (t.waiting === 0) t.since = m.createdAt.getTime();
        t.waiting += 1;
      } else {
        t.waiting = 0;
      }
      t.lastAt = m.createdAt.getTime();
      threads.set(k, t);
    }

    const label = (userId: number, num: string) => names.forUser(userId, num);
    // A caller who rang out and left a voicemail is ONE thing to follow up
    // on, not two — fold the voicemail into the missed-call item.
    const openVms = vms.filter((v) => (lastTouch.get(`${v.userId}|${last10(v.fromNumber)}`) ?? 0) <= v.receivedAt.getTime());
    const vmByKey = new Map<string, number>();
    for (const v of openVms) {
      const k = `${v.userId}|${last10(v.fromNumber)}`;
      vmByKey.set(k, (vmByKey.get(k) ?? 0) + 1);
    }
    const items = [
      ...[...missed.entries()].map(([k, m]) => ({
        kind: 'missed_call' as const, userId: m.userId, number: m.number, name: label(m.userId, m.number),
        count: m.attempts, since: new Date(m.firstAt).toISOString(), lastAt: new Date(m.lastAt).toISOString(),
        voicemails: vmByKey.get(k) ?? 0,
      })),
      ...[...threads.values()]
        // A STOP is an answer, not a question — replying to it is the opposite of what's wanted.
        .filter((t) => t.waiting > 0 && !t.optedOut)
        .map((t) => ({
          kind: 'text' as const, userId: t.userId, number: t.number, name: label(t.userId, t.number),
          count: t.waiting, since: new Date(t.since).toISOString(), lastAt: new Date(t.lastAt).toISOString(),
        })),
      // A voicemail is open only if nobody has called or texted the caller
      // since. "Heard" alone isn't reliable (listening from a Teams card or
      // email may not set listenedAt), and a returned call is what matters.
      ...openVms
        .filter((v) => !missed.has(`${v.userId}|${last10(v.fromNumber)}`))
        .map((v) => ({
          kind: 'voicemail' as const, userId: v.userId, number: v.fromNumber, name: label(v.userId, v.fromNumber),
          count: 1, since: v.receivedAt.toISOString(), lastAt: v.receivedAt.toISOString(),
        })),
    ].sort((a, b) => a.since.localeCompare(b.since));

    const byPerson = new Map<number, { userId: number; name: string; missedCalls: number; texts: number; voicemails: number; oldest: string }>();
    for (const it of items) {
      const p = byPerson.get(it.userId) ?? { userId: it.userId, name: people.get(it.userId) ?? 'Unknown', missedCalls: 0, texts: 0, voicemails: 0, oldest: it.since };
      if (it.kind === 'missed_call') p.missedCalls += 1;
      else if (it.kind === 'text') p.texts += 1;
      else p.voicemails += 1;
      if (it.since < p.oldest) p.oldest = it.since;
      byPerson.set(it.userId, p);
    }
    return {
      generatedAt: new Date(now).toISOString(),
      days: FOLLOW_UP_DAYS,
      totals: {
        missedCalls: items.filter((i) => i.kind === 'missed_call').length,
        texts: items.filter((i) => i.kind === 'text').length,
        voicemails: items.filter((i) => i.kind === 'voicemail').length,
      },
      people: [...byPerson.values()].sort((a, b) => b.missedCalls + b.texts + b.voicemails - (a.missedCalls + a.texts + a.voicemails)),
      items: items.slice(0, 3000).map((it) => ({ ...it, personName: people.get(it.userId) ?? 'Unknown' })),
    };
  });
}
