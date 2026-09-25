// GET /reports — the Reports page's single data source.
//
// One endpoint rather than one per tab because every tab is derived from
// the same deduplicated call set; computing it once and letting the client
// slice it makes tab switches instant. The payload is aggregates only:
// message bodies are read to estimate billed segments and never leave this
// file, and transcripts/recordings are never touched.
//
// Scope is enforced here, not in the UI: a non-admin always gets their own
// numbers, whatever userId they send.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import {
  canonicalizeCalls, inboundOutcome, last10, outboundOutcome, type LogicalCall, type RawCallRow,
} from './canonicalCalls.js';
import {
  computePeriod,
  type MessageRow,
  type PersonMetrics,
  type Pricing,
  type ReportData,
} from './compute.js';
import { REPORT_TZ, addDays, daySpan, etDateKey, etMidnightUtc, isDateKey } from './etTime.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

interface ReportsQuery {
  from?: string;
  to?: string;
  userId?: string;
}

const DAY = 86_400_000;
// 92 days ≈ one quarter. Beyond that the two-period load passes ~400k call
// rows and the request stops feeling interactive.
const MAX_SPAN_DAYS = 92;
// A range that ends before today can't change (short of a late webhook), so
// it caches for an hour; one that includes today refreshes every 2 minutes.
const CACHE_TTL_LIVE_MS = 2 * 60_000;
const CACHE_TTL_PAST_MS = 60 * 60_000;
const cache = new Map<string, { at: number; payload: unknown }>();

// GSM-7 basic set plus the extension table. Anything outside it forces the
// whole message into UCS-2 and cuts a segment from 160 to 70 characters.
const GSM_RE = /^[\n\r\x20-\x5F\x61-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/;

// Same env knobs as /admin/reports/cost so one change retunes both.
// The host's .env declares these keys with EMPTY values, and
// parseFloat('') is NaN — which serialises as null and blanks every cost.
// An empty or junk value falls back to the default instead.
function envRate(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function pricing(): Pricing {
  return {
    inboundPerMin: envRate('TELNYX_COST_INBOUND_PER_MIN', 0.005),
    outboundPerMin: envRate('TELNYX_COST_OUTBOUND_PER_MIN', 0.007),
    perSms: envRate('TELNYX_COST_PER_SMS', 0.004),
    didMonthly: envRate('TELNYX_COST_PER_DID_MONTHLY', 1.0),
  };
}

// Raw SQL on purpose. A team-wide 30-day report loads two periods, ~137k
// call rows, and Prisma's engine costs ~15µs per result cell:
// prisma.call.findMany took 5.7s, $queryRaw of the same 19 columns 4.5s.
// Packing each row into ONE delimited text cell takes it to ~1.4s. The
// fields are ids, enums, digits and numbers — none can contain the unit
// separator (0x1F) we split on. Parameterised via the tagged template.
async function loadCalls(since: Date, until: Date, userId: number | null): Promise<RawCallRow[]> {
  const rows = userId !== null
    ? await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT concat_ws(chr(31), user_id, telnyx_call_id, coalesce(session_id, ''), direction, status,
          coalesce(hangup_cause, ''), coalesce(hangup_source, ''), coalesce(user_did_id::text, ''),
          from_number, to_number,
          (extract(epoch from started_at) * 1000)::bigint,
          coalesce(((extract(epoch from answered_at) * 1000)::bigint)::text, ''),
          coalesce(((extract(epoch from ended_at) * 1000)::bigint)::text, ''),
          duration_seconds,
          coalesce(avg_jitter_ms::text, ''), coalesce(avg_loss_pct::text, ''),
          coalesce(max_loss_pct::text, ''), coalesce(avg_rtt_ms::text, '')) AS r
        FROM calls
        WHERE started_at >= ${since} AND started_at < ${until} AND user_id = ${userId}`
    : await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT concat_ws(chr(31), user_id, telnyx_call_id, coalesce(session_id, ''), direction, status,
          coalesce(hangup_cause, ''), coalesce(hangup_source, ''), coalesce(user_did_id::text, ''),
          from_number, to_number,
          (extract(epoch from started_at) * 1000)::bigint,
          coalesce(((extract(epoch from answered_at) * 1000)::bigint)::text, ''),
          coalesce(((extract(epoch from ended_at) * 1000)::bigint)::text, ''),
          duration_seconds,
          coalesce(avg_jitter_ms::text, ''), coalesce(avg_loss_pct::text, ''),
          coalesce(max_loss_pct::text, ''), coalesce(avg_rtt_ms::text, '')) AS r
        FROM calls
        WHERE started_at >= ${since} AND started_at < ${until}`;
  const str = (v: string) => (v === '' ? null : v);
  const num = (v: string) => (v === '' ? null : Number(v));
  return rows.map(({ r }) => {
    const f = r.split('\x1f');
    return {
      userId: Number(f[0]),
      telnyxCallId: f[1],
      sessionId: str(f[2]),
      direction: f[3],
      status: f[4],
      hangupCause: str(f[5]),
      hangupSource: str(f[6]),
      userDidId: num(f[7]),
      fromNumber: f[8],
      toNumber: f[9],
      startedAt: Number(f[10]),
      answeredAt: num(f[11]),
      endedAt: num(f[12]),
      durationSeconds: Number(f[13]),
      avgJitterMs: num(f[14]),
      avgLossPct: num(f[15]),
      maxLossPct: num(f[16]),
      avgRttMs: num(f[17]),
    };
  });
}

function displayName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const n = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return n || u.email;
}

function firstError(errs: unknown): { code: string | null; title: string | null } {
  const first = Array.isArray(errs) ? errs[0] : errs;
  if (!first || typeof first !== 'object') return { code: null, title: null };
  const o = first as Record<string, unknown>;
  const code = typeof o.code === 'string' || typeof o.code === 'number' ? String(o.code) : null;
  const title = typeof o.title === 'string' ? o.title : null;
  return { code, title };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const PREV_KEYS = [
  'callsOut', 'connected', 'talkSec', 'avgTalkSec', 'shortCalls', 'likelyDrops', 'confirmedDrops',
  'callsIn', 'answeredIn', 'unansweredIn', 'missedReturnable', 'missedReturned',
  'smsSent', 'smsReceived', 'smsFailed', 'smsReplied', 'smsRepliable', 'voicemails', 'voicemailsHeard',
  'uniqueReached', 'conversations', 'cost',
] as const;

function prevSubset(p: PersonMetrics | undefined): Record<string, number> | null {
  if (!p) return null;
  const o: Record<string, number> = {};
  for (const k of PREV_KEYS) o[k] = p[k] as number;
  return o;
}

export async function reportsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: ReportsQuery }>(
    '/reports',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest<{ Querystring: ReportsQuery }>, reply: FastifyReply) => {
      const me = request.user as JwtPayload;
      const now = Date.now();
      const today = etDateKey(now);

      const to = request.query.to ?? today;
      const from = request.query.from ?? addDays(to, -29);
      if (!isDateKey(from) || !isDateKey(to)) {
        return reply.code(400).send({ error: 'Dates must be in YYYY-MM-DD format.' });
      }
      if (from > to) return reply.code(400).send({ error: 'The start date is after the end date.' });
      if (to > today) return reply.code(400).send({ error: 'The end date is in the future.' });
      const days = daySpan(from, to);
      if (days > MAX_SPAN_DAYS) {
        return reply.code(400).send({ error: `Pick a range of ${MAX_SPAN_DAYS} days or fewer.` });
      }

      let scopeUserId: number | null = null;
      if (request.query.userId !== undefined && request.query.userId !== '') {
        const n = Number(request.query.userId);
        if (!Number.isInteger(n) || n <= 0) return reply.code(400).send({ error: 'userId must be a number.' });
        scopeUserId = n;
      }
      if (!me.isAdmin) {
        if (scopeUserId !== null && scopeUserId !== me.sub) {
          return reply.code(403).send({ error: 'You can only view your own report.' });
        }
        scopeUserId = me.sub;
      }

      const cacheKey = `${from}|${to}|${scopeUserId ?? 'all'}`;
      const ttl = to >= today ? CACHE_TTL_LIVE_MS : CACHE_TTL_PAST_MS;
      const hit = cache.get(cacheKey);
      if (hit && now - hit.at < ttl) return hit.payload;

      const timings: Record<string, number> = {};
      let mark = Date.now();
      const lap = (k: string) => { const t = Date.now(); timings[k] = t - mark; mark = t; };
      const startMs = etMidnightUtc(from);
      const endMs = etMidnightUtc(addDays(to, 1));
      const prevFrom = addDays(from, -days);
      const prevTo = addDays(from, -1);
      const loadStart = etMidnightUtc(prevFrom);
      const loadEnd = new Date(Math.min(now, endMs + DAY));
      const loadStartDate = new Date(loadStart);

      const userRows = await prisma.user.findMany({
        where: {
          email: { not: { endsWith: '@deleted.ace.local' } },
          ...(scopeUserId !== null ? { id: scopeUserId } : {}),
        },
        select: {
          id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true,
          forwardingEnabled: true, voicemailGreetingUrl: true, voicemailGreetingText: true,
        },
      });
      if (scopeUserId !== null && userRows.length === 0) {
        return reply.code(404).send({ error: 'That person was not found.' });
      }
      const userIds = userRows.map((u) => u.id);
      const userFilter = scopeUserId !== null ? { userId: scopeUserId } : { userId: { in: userIds } };

      const [calls, messages, voicemails, scheduled, campaigns, lines, favorites] = await Promise.all([
        loadCalls(loadStartDate, loadEnd, scopeUserId),
        prisma.message.findMany({
          where: { ...userFilter, createdAt: { gte: loadStartDate, lt: loadEnd } },
          select: {
            userId: true, threadKey: true, direction: true, status: true, body: true,
            mediaUrls: true, createdAt: true, errors: true,
          },
        }),
        prisma.voicemail.findMany({
          where: { ...userFilter, receivedAt: { gte: loadStartDate, lt: loadEnd } },
          select: {
            userId: true, fromNumber: true, telnyxCallId: true, durationSeconds: true,
            receivedAt: true, listenedAt: true,
          },
        }),
        prisma.scheduledMessage.findMany({
          where: {
            ...userFilter,
            OR: [
              { scheduledFor: { gte: loadStartDate, lt: loadEnd } },
              { status: { in: ['pending', 'sending'] } },
            ],
          },
          select: {
            id: true, userId: true, toNumber: true, status: true, scheduledFor: true,
            sentAt: true, campaignId: true,
          },
        }),
        prisma.smsCampaign.findMany({
          where: { ...userFilter, createdAt: { gte: new Date(startMs), lt: new Date(endMs) } },
          select: { id: true, userId: true, createdAt: true, totalCount: true, skipped: true },
        }),
        prisma.userDid.findMany({
          where: scopeUserId !== null ? { userId: scopeUserId } : {},
          select: { id: true, userId: true, didNumber: true, label: true },
        }),
        prisma.favorite.findMany({
          where: { ...userFilter, addedAt: { gte: new Date(startMs), lt: new Date(endMs) } },
          select: { userId: true, addedAt: true },
        }),
      ]);

      lap('load');
      const msgRows: MessageRow[] = messages.map((m) => {
        const err = firstError(m.errors);
        return {
          userId: m.userId,
          threadKey: m.threadKey,
          direction: m.direction,
          status: (m.status ?? '').toLowerCase(),
          bodyLength: [...(m.body ?? '')].length,
          isGsm: GSM_RE.test(m.body ?? ''),
          hasMedia: (m.mediaUrls?.length ?? 0) > 0,
          createdAt: m.createdAt.getTime(),
          errorCode: err.code,
          errorTitle: err.title,
        };
      });

      const data: ReportData = {
        calls: canonicalizeCalls(calls),
        messages: msgRows,
        voicemails: voicemails.map((v) => ({
          userId: v.userId,
          fromNumber: v.fromNumber,
          telnyxCallId: v.telnyxCallId,
          durationSeconds: v.durationSeconds,
          receivedAt: v.receivedAt.getTime(),
          listenedAt: v.listenedAt ? v.listenedAt.getTime() : null,
        })),
        scheduled: scheduled.map((s) => ({
          id: s.id,
          userId: s.userId,
          toNumber: s.toNumber,
          status: s.status,
          scheduledFor: s.scheduledFor.getTime(),
          sentAt: s.sentAt ? s.sentAt.getTime() : null,
          campaignId: s.campaignId,
        })),
        campaigns: campaigns.map((c) => ({
          id: c.id,
          userId: c.userId,
          createdAt: c.createdAt.getTime(),
          totalCount: c.totalCount,
          skippedCount: Array.isArray(c.skipped) ? c.skipped.length : 0,
        })),
        lines,
        favoritesAdded: favorites.map((f) => ({ userId: f.userId, addedAt: f.addedAt.getTime() })),
        pricing: pricing(),
      };

      lap('prepare');
      const cur = computePeriod({ startMs, endMs, days }, data, userIds);
      const prev = computePeriod({ startMs: loadStart, endMs: startMs, days }, data, userIds);

      lap('compute');
      const hasActivity = (p: PersonMetrics) =>
        p.callsOut + p.callsIn + p.smsSent + p.smsReceived + p.voicemails + p.scheduledTotal > 0;
      const shown = userRows.filter((u) => u.isActive || hasActivity(cur.people.get(u.id)!));

      // Call log + numbers — only for one person's report. A team-wide list
      // of every candidate's number is exactly what "aggregates only" rules
      // out; one person's own log (or an admin looking at one person) is the
      // same thing Recents already shows them.
      const callLog = scopeUserId !== null
        ? await buildCallLog(scopeUserId, data.calls.filter((c) => c.startedAt >= startMs && c.startedAt < endMs), lines)
        : null;

      const adoption = await loadAdoption(shown.map((u) => u.id), userRows, startMs, endMs);

      lap('adoption');
      request.log.info({ from, to, scopeUserId, timings }, '[reports] computed');
      const payload = {
        range: { from, to, days, prevFrom, prevTo, tz: REPORT_TZ },
        generatedAt: new Date(now).toISOString(),
        scope: { userId: scopeUserId, isAdmin: me.isAdmin },
        users: shown
          .map((u) => ({ id: u.id, name: displayName(u), email: u.email, isActive: u.isActive }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        totals: cur.totals,
        prevTotals: prev.totals,
        people: shown.map((u) => ({
          ...cur.people.get(u.id)!,
          name: displayName(u),
          email: u.email,
          isActive: u.isActive,
          prev: prevSubset(prev.people.get(u.id)),
        })),
        daily: cur.daily,
        heatmap: cur.heatmap,
        callLength: cur.callLength,
        longestCalls: cur.longestCalls,
        inbound: cur.inbound,
        outbound: cur.outbound,
        quality: {
          endReasons: cur.quality.endReasons,
          measuredCalls: cur.totals.qualityMeasured,
        },
        sms: cur.sms,
        scheduledUpcoming: cur.scheduledUpcoming,
        campaigns: cur.campaigns,
        cost: {
          pricing: data.pricing,
          voice: cur.totals.costVoice,
          sms: cur.totals.costSms,
          lines: cur.didCost,
          total: cur.totals.cost,
          ownedLines: cur.ownedLines,
          projectedMonthly: Math.round((cur.totals.cost / days) * 30 * 100) / 100,
          byLine: cur.lines,
        },
        adoption,
        callLog,
      };

      if (cache.size > 50) cache.clear();
      cache.set(cacheKey, { at: now, payload });
      return payload;
    },
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Answered',
  caller_hung_up: 'Caller hung up',
  rang_out: 'Rang out',
  declined: 'Declined',
  blocked: 'Blocked',
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  invalid_number: 'Number not found',
  rejected: 'Rejected',
  failed: 'Failed',
  other: 'Other',
};
// Newest calls first; a heavy dialer makes ~1,400 calls a month, so this
// covers a full 92-day range for everyone but a handful of outliers.
const CALL_LOG_LIMIT = 5000;

async function buildCallLog(
  userId: number,
  calls: LogicalCall[],
  lines: Array<{ id: number; didNumber: string; label: string }>,
) {
  // Same resolution order as the Teams cards (apps/webhooks/src/contactName.ts):
  // the person's own favorites, then a coworker's line. Mirrored rather than
  // imported — apps may not share modules (CLAUDE.md §1.4).
  const [favs, dids] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId },
      select: { phone: true, firstName: true, lastName: true, label: true, numbers: { select: { phone: true } } },
    }),
    prisma.userDid.findMany({
      where: { userId: { not: null } },
      select: { didNumber: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);
  const names = new Map<string, string>();
  for (const d of dids) {
    if (!d.user || d.user.id === userId) continue;
    const k = last10(d.didNumber);
    if (k) names.set(k, `${displayName(d.user)} (coworker)`);
  }
  for (const f of favs) {
    // Some favorites carry the full name in BOTH fields ("Dennis Crist" /
    // "Dennis Crist"); don't print it twice.
    const first = (f.firstName ?? '').trim();
    const last = (f.lastName ?? '').trim();
    const joined = first && last && first.toLowerCase().includes(last.toLowerCase()) ? first : `${first} ${last}`.trim();
    const n = joined || (f.label ?? '').trim();
    if (!n) continue;
    for (const ph of [f.phone, ...f.numbers.map((x) => x.phone)]) {
      const k = last10(ph);
      if (k) names.set(k, n);
    }
  }
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const byNumber = new Map<string, {
    number: string; name: string | null; out: number; in: number; connected: number;
    unanswered: number; talkSec: number; lastAt: number;
  }>();
  for (const c of calls) {
    const key = c.other || c.number || 'unknown';
    const n = byNumber.get(key) ?? {
      number: c.number, name: c.other ? names.get(c.other) ?? null : null,
      out: 0, in: 0, connected: 0, unanswered: 0, talkSec: 0, lastAt: 0,
    };
    if (c.direction === 'outbound') n.out += 1;
    else n.in += 1;
    if (c.answered) { n.connected += 1; n.talkSec += c.talkSec; }
    else if (c.direction === 'inbound' && inboundOutcome(c) !== 'blocked') n.unanswered += 1;
    n.lastAt = Math.max(n.lastAt, c.startedAt);
    byNumber.set(key, n);
  }

  const newest = [...calls].sort((a, b) => b.startedAt - a.startedAt);
  return {
    total: calls.length,
    truncated: calls.length > CALL_LOG_LIMIT,
    calls: newest.slice(0, CALL_LOG_LIMIT).map((c) => {
      const outcome = c.direction === 'inbound' ? inboundOutcome(c) : outboundOutcome(c);
      const line = c.userDidId != null ? lineById.get(c.userDidId) : undefined;
      return {
        startedAt: new Date(c.startedAt).toISOString(),
        direction: c.direction,
        number: c.number,
        name: c.other ? names.get(c.other) ?? null : null,
        outcome,
        outcomeLabel: OUTCOME_LABELS[outcome] ?? outcome,
        answered: c.answered,
        talkSec: c.talkSec,
        line: line ? line.label : null,
      };
    }),
    numbers: [...byNumber.values()]
      .sort((a, b) => b.out + b.in - (a.out + a.in) || b.lastAt - a.lastAt)
      .slice(0, 1000)
      .map((n) => ({ ...n, lastAt: new Date(n.lastAt).toISOString() })),
    distinctNumbers: byNumber.size,
  };
}

async function loadAdoption(
  userIds: number[],
  users: Array<{
    id: number; lastLoginAt: Date | null; forwardingEnabled: boolean;
    voicemailGreetingUrl: string | null; voicemailGreetingText: string | null;
  }>,
  startMs: number,
  endMs: number,
) {
  const recent = new Date(Date.now() - 30 * DAY);
  const inRange = { gte: new Date(startMs), lt: new Date(endMs) };
  const [devices, audits, templates, blocked, sched, favs] = await Promise.all([
    prisma.userDevice.findMany({
      where: { userId: { in: userIds }, lastSeenAt: { gte: recent } },
      select: { userId: true, platform: true, appVersion: true, lastSeenAt: true },
    }),
    prisma.auditLog.findMany({
      where: {
        actorUserId: { in: userIds },
        action: { in: ['sms.voice_transcribed', 'sms.ai_rewrite'] },
        createdAt: inRange,
      },
      select: { actorUserId: true, action: true },
      distinct: ['actorUserId', 'action'],
    }),
    prisma.smsTemplate.findMany({
      where: { ownerUserId: { in: userIds }, isActive: true },
      select: { ownerUserId: true },
      distinct: ['ownerUserId'],
    }),
    prisma.blockedNumber.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.scheduledMessage.findMany({
      where: { userId: { in: userIds }, createdAt: inRange },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.favorite.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  // Latest device per person is "their" version — an old laptop they
  // stopped opening shouldn't flag them as out of date.
  const latestDevice = new Map<number, (typeof devices)[number]>();
  for (const d of devices) {
    const cur = latestDevice.get(d.userId);
    if (!cur || d.lastSeenAt > cur.lastSeenAt) latestDevice.set(d.userId, d);
  }
  const latestVersion = devices
    .map((d) => d.appVersion)
    .reduce<string | null>((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), null);

  const versionCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  for (const d of latestDevice.values()) {
    versionCounts.set(d.appVersion, (versionCounts.get(d.appVersion) ?? 0) + 1);
    platformCounts.set(d.platform, (platformCounts.get(d.platform) ?? 0) + 1);
  }

  const idSet = (rows: Array<{ userId?: number | null; actorUserId?: number | null; ownerUserId?: number | null }>) =>
    new Set(rows.map((r) => r.userId ?? r.actorUserId ?? r.ownerUserId).filter((x): x is number => x != null));
  const dictation = idSet(audits.filter((a) => a.action === 'sms.voice_transcribed'));
  const rewrite = idSet(audits.filter((a) => a.action === 'sms.ai_rewrite'));
  const templateUsers = idSet(templates);
  const blockedUsers = idSet(blocked);
  const schedUsers = idSet(sched);
  const favUsers = idSet(favs);
  const scoped = new Set(userIds);
  const inScope = users.filter((u) => scoped.has(u.id));
  const forwarding = new Set(inScope.filter((u) => u.forwardingEnabled).map((u) => u.id));
  const greeting = new Set(
    inScope.filter((u) => u.voicemailGreetingUrl || u.voicemailGreetingText).map((u) => u.id),
  );

  const featureSets: Array<[string, string, Set<number>]> = [
    ['favorites', 'Saved favorites', favUsers],
    ['scheduled', 'Scheduled texts', schedUsers],
    ['greeting', 'Custom voicemail greeting', greeting],
    ['templates', 'Personal text templates', templateUsers],
    ['dictation', 'Voice dictation', dictation],
    ['rewrite', 'AI rewrite', rewrite],
    ['blocked', 'Blocked numbers', blockedUsers],
    ['forwarding', 'Call forwarding', forwarding],
  ];

  return {
    latestVersion,
    versions: [...versionCounts.entries()]
      .map(([version, users]) => ({ version, users }))
      .sort((a, b) => compareVersions(b.version, a.version)),
    platforms: [...platformCounts.entries()]
      .map(([platform, users]) => ({ platform, users }))
      .sort((a, b) => b.users - a.users),
    features: featureSets.map(([key, label, set]) => ({ key, label, users: set.size })),
    people: inScope.map((u) => {
      const d = latestDevice.get(u.id);
      return {
        userId: u.id,
        appVersion: d?.appVersion ?? null,
        platform: d?.platform ?? null,
        lastSeenAt: d ? d.lastSeenAt.toISOString() : null,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        onLatest: !!(d && latestVersion && compareVersions(d.appVersion, latestVersion) >= 0),
        features: featureSets.filter(([, , set]) => set.has(u.id)).map(([key]) => key),
      };
    }),
  };
}
