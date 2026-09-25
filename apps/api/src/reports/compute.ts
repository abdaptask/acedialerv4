// Pure report computation. No Prisma, no clock — everything arrives in
// ReportData so the numbers are testable against fixtures.
//
// A "window" is [startMs, endMs). ReportData covers more than the window:
// the previous equal-length period (for trend arrows and "new contact")
// and 24h past the end (so a missed call at 11pm on the last day can still
// be counted as returned).

import {
  type LogicalCall,
  inboundOutcome,
  outboundOutcome,
  isConfirmedDrop,
  isPoorQuality,
  last10,
} from './canonicalCalls.js';
import { etParts, etDateKey } from './etTime.js';

export interface MessageRow {
  userId: number;
  threadKey: string;
  direction: string;
  status: string;
  bodyLength: number;
  isGsm: boolean;
  hasMedia: boolean;
  createdAt: number;
  errorCode: string | null;
  errorTitle: string | null;
  /** Carrier opt-out / opt-in keyword, detected server-side from the body. */
  keyword?: 'stop' | 'start' | null;
}

export interface VoicemailRow {
  userId: number;
  fromNumber: string;
  telnyxCallId: string | null;
  durationSeconds: number;
  receivedAt: number;
  listenedAt: number | null;
}

export interface ScheduledRow {
  id: number;
  userId: number;
  toNumber: string;
  status: string;
  scheduledFor: number;
  sentAt: number | null;
  campaignId: number | null;
}

export interface CampaignRow {
  id: number;
  userId: number;
  createdAt: number;
  totalCount: number;
  skippedCount: number;
}

export interface LineRow {
  id: number;
  userId: number | null;
  didNumber: string;
  label: string;
}

export interface Pricing {
  inboundPerMin: number;
  outboundPerMin: number;
  perSms: number;
  didMonthly: number;
}

export interface ReportData {
  calls: LogicalCall[];
  messages: MessageRow[];
  voicemails: VoicemailRow[];
  scheduled: ScheduledRow[];
  campaigns: CampaignRow[];
  lines: LineRow[];
  favoritesAdded: Array<{ userId: number; addedAt: number }>;
  pricing: Pricing;
}

export interface Window {
  startMs: number;
  endMs: number;
  days: number;
}

const DAY = 86_400_000;
const FOLLOW_UP_MS = DAY;
// Under this, a connected call is almost always a voicemail greeting or a
// wrong number — the "shortest calls" ranking counts these.
export const SHORT_CALL_SEC = 10;
export const CONVERSATION_SEC = 120;
// Redialing the same number this soon after a real call ended is the
// behavioural fingerprint of a drop.
const REDIAL_WINDOW_MS = 120_000;
const REDIAL_MIN_TALK_SEC = 10;

export interface PersonMetrics {
  userId: number;
  callsOut: number;
  /** Different numbers dialled — "unique calls". */
  uniqueDialled: number;
  /** Different numbers dialled that picked up. */
  uniqueConnected: number;
  connectedOut: number;
  callsIn: number;
  answeredIn: number;
  unansweredIn: number;
  declinedIn: number;
  callerHungUpIn: number;
  rangOutIn: number;
  noAnswerOut: number;
  rejectedOut: number;
  otherFailedOut: number;
  talkSec: number;
  avgTalkSec: number;
  medianTalkSec: number;
  connected: number;
  shortCalls: number;
  conversations: number;
  likelyDrops: number;
  confirmedDrops: number;
  qualityMeasured: number;
  poorQuality: number;
  failedDials: number;
  invalidNumbers: number;
  busyOut: number;
  missedReturnable: number;
  missedReturned: number;
  medianCallbackSec: number | null;
  smsSent: number;
  smsReceived: number;
  smsDelivered: number;
  smsFailed: number;
  smsRepliable: number;
  smsReplied: number;
  medianReplySec: number | null;
  mms: number;
  segments: number;
  threads: number;
  scheduledTotal: number;
  scheduledPending: number;
  scheduledSent: number;
  scheduledFailed: number;
  scheduledCanceled: number;
  campaigns: number;
  voicemails: number;
  voicemailsHeard: number;
  voicemailsCalledBack: number;
  medianListenSec: number | null;
  uniqueReached: number;
  newContacts: number;
  multiTouch: number;
  favoritesAdded: number;
  activeDays: number;
  firstCallMin: number | null;
  lastCallMin: number | null;
  billedMinutes: number;
  costVoice: number;
  costSms: number;
  cost: number;
}

export interface DailyPoint {
  date: string;
  outbound: number;
  inbound: number;
  connected: number;
  answeredIn: number;
  talkSec: number;
  smsSent: number;
  smsReceived: number;
}

export interface PeriodResult {
  totals: PersonMetrics;
  people: Map<number, PersonMetrics>;
  daily: DailyPoint[];
  heatmap: number[][];
  callLength: Array<{ label: string; minSec: number; count: number }>;
  longestCalls: Array<{ userId: number; direction: string; lastFour: string; talkSec: number; startedAt: string }>;
  inbound: {
    total: number;
    answered: number;
    callerHungUp: number;
    rangOut: number;
    declined: number;
    blocked: number;
    other: number;
    wentToVoicemail: number;
    byHour: Array<{ hour: number; total: number; unanswered: number }>;
    repeatUnreached: Array<{ userId: number; number: string; attempts: number; lastAt: string }>;
  };
  outbound: {
    total: number;
    connected: number;
    noAnswer: number;
    busy: number;
    invalidNumber: number;
    rejected: number;
    failed: number;
  };
  quality: {
    endReasons: Array<{ reason: string; count: number }>;
  };
  sms: {
    failureReasons: Array<{ code: string; title: string; count: number }>;
    byHour: number[];
  };
  scheduledUpcoming: Array<{ id: number; userId: number; toNumber: string; scheduledFor: string; campaignId: number | null }>;
  campaigns: Array<{ id: number; userId: number; createdAt: string; total: number; sent: number; failed: number; pending: number; canceled: number; skipped: number }>;
  lines: Array<{ lineId: number; userId: number | null; didNumber: string; label: string; calls: number; minutes: number; cost: number }>;
  didCost: number;
  ownedLines: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function emptyPerson(userId: number): PersonMetrics {
  return {
    userId,
    callsOut: 0, uniqueDialled: 0, uniqueConnected: 0, connectedOut: 0, callsIn: 0, answeredIn: 0, unansweredIn: 0, declinedIn: 0,
    callerHungUpIn: 0, rangOutIn: 0, noAnswerOut: 0, rejectedOut: 0, otherFailedOut: 0,
    talkSec: 0, avgTalkSec: 0, medianTalkSec: 0, connected: 0, shortCalls: 0, conversations: 0,
    likelyDrops: 0, confirmedDrops: 0, qualityMeasured: 0, poorQuality: 0,
    failedDials: 0, invalidNumbers: 0, busyOut: 0,
    missedReturnable: 0, missedReturned: 0, medianCallbackSec: null,
    smsSent: 0, smsReceived: 0, smsDelivered: 0, smsFailed: 0, smsRepliable: 0, smsReplied: 0,
    medianReplySec: null, mms: 0, segments: 0, threads: 0,
    scheduledTotal: 0, scheduledPending: 0, scheduledSent: 0, scheduledFailed: 0, scheduledCanceled: 0, campaigns: 0,
    voicemails: 0, voicemailsHeard: 0, voicemailsCalledBack: 0, medianListenSec: null,
    uniqueReached: 0, newContacts: 0, multiTouch: 0, favoritesAdded: 0,
    activeDays: 0, firstCallMin: null, lastCallMin: null,
    billedMinutes: 0, costVoice: 0, costSms: 0, cost: 0,
  };
}

const FAILED_SMS = new Set(['delivery_failed', 'failed', 'undelivered', 'sending_failed']);

/** GSM-7: 160/153 per segment. UCS-2 (any emoji, curly quote, em dash): 70/67. */
export function estimateSegments(len: number, isGsm: boolean): number {
  if (len <= 0) return 1;
  if (isGsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/** First index i with sorted[i] > t. */
function upperBound(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const LENGTH_BUCKETS: Array<{ label: string; minSec: number }> = [
  { label: '<10s', minSec: 1 },
  { label: '10–30s', minSec: 10 },
  { label: '30s–1m', minSec: 30 },
  { label: '1–2m', minSec: 60 },
  { label: '2–5m', minSec: 120 },
  { label: '5–10m', minSec: 300 },
  { label: '10–30m', minSec: 600 },
  { label: '30m+', minSec: 1800 },
];

export function computePeriod(win: Window, data: ReportData, userIds: number[]): PeriodResult {
  const inWin = (t: number) => t >= win.startMs && t < win.endMs;
  const people = new Map<number, PersonMetrics>();
  for (const id of userIds) people.set(id, emptyPerson(id));
  const scoped = new Set(userIds);
  const personOf = (id: number): PersonMetrics | null => people.get(id) ?? null;

  const talkByUser = new Map<number, number[]>();
  const teamTalk: number[] = [];
  const callbackByUser = new Map<number, number[]>();
  const teamCallback: number[] = [];

  // Outbound attempt times per user|number across the whole data span,
  // for callbacks and redial detection.
  const outboundTimes = new Map<string, number[]>();
  // Anything that counts as "we talked to them" per user|number.
  const reachedTimes = new Map<string, number[]>();
  for (const c of data.calls) {
    if (!scoped.has(c.userId) || !c.other) continue;
    const k = `${c.userId}|${c.other}`;
    if (c.direction === 'outbound') {
      const l = outboundTimes.get(k);
      if (l) l.push(c.startedAt);
      else outboundTimes.set(k, [c.startedAt]);
    }
    if (c.answered) {
      const l = reachedTimes.get(k);
      if (l) l.push(c.startedAt);
      else reachedTimes.set(k, [c.startedAt]);
    }
  }
  for (const l of outboundTimes.values()) l.sort((a, b) => a - b);
  for (const l of reachedTimes.values()) l.sort((a, b) => a - b);

  // Earlier-period contacts per user, for "new contact".
  const priorContacts = new Map<number, Set<string>>();
  const priorStart = win.startMs - win.days * DAY;
  const noteContact = (map: Map<number, Set<string>>, userId: number, num: string) => {
    if (!num) return;
    let s = map.get(userId);
    if (!s) map.set(userId, (s = new Set()));
    s.add(num);
  };

  const days = new Map<string, DailyPoint>();
  const dayOf = (t: number): DailyPoint => {
    const key = etDateKey(t);
    let d = days.get(key);
    if (!d) {
      d = { date: key, outbound: 0, inbound: 0, connected: 0, answeredIn: 0, talkSec: 0, smsSent: 0, smsReceived: 0 };
      days.set(key, d);
    }
    return d;
  };
  for (let t = win.startMs; t < win.endMs; t += DAY) dayOf(t + DAY / 2);

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const lengthCounts = new Array<number>(LENGTH_BUCKETS.length).fill(0);
  const longest: PeriodResult['longestCalls'] = [];
  const inbound = {
    total: 0, answered: 0, callerHungUp: 0, rangOut: 0, declined: 0, blocked: 0, other: 0, wentToVoicemail: 0,
  };
  const inboundByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, unanswered: 0 }));
  const outbound = { total: 0, connected: 0, noAnswer: 0, busy: 0, invalidNumber: 0, rejected: 0, failed: 0 };
  const endReasons = new Map<string, number>();
  const unreached = new Map<string, { userId: number; number: string; attempts: number; firstAt: number; lastAt: number }>();
  const activeDaysByUser = new Map<number, Set<string>>();
  const dayFirstLast = new Map<string, { userId: number; first: number; last: number }>();
  const reachedByUser = new Map<number, Set<string>>();
  const dialledByUser = new Map<number, Set<string>>();
  const dialledConnectedByUser = new Map<number, Set<string>>();
  const calledByUser = new Map<number, Set<string>>();
  const textedByUser = new Map<number, Set<string>>();
  const vmCallIds = new Set<string>();
  for (const v of data.voicemails) if (v.telnyxCallId) vmCallIds.add(v.telnyxCallId);

  const lineAgg = new Map<number, { calls: number; minutes: number; cost: number }>();

  for (const c of data.calls) {
    if (!scoped.has(c.userId)) continue;
    if (c.startedAt >= priorStart && c.startedAt < win.startMs) {
      noteContact(priorContacts, c.userId, c.other);
      continue;
    }
    if (!inWin(c.startedAt)) continue;
    const p = personOf(c.userId)!;
    const et = etParts(c.startedAt);
    const day = dayOf(c.startedAt);
    heatmap[et.dow - 1][et.hour] += 1;

    let ad = activeDaysByUser.get(c.userId);
    if (!ad) activeDaysByUser.set(c.userId, (ad = new Set()));
    ad.add(et.date);
    const fk = `${c.userId}|${et.date}`;
    const fl = dayFirstLast.get(fk);
    if (!fl) dayFirstLast.set(fk, { userId: c.userId, first: et.minuteOfDay, last: et.minuteOfDay });
    else {
      fl.first = Math.min(fl.first, et.minuteOfDay);
      fl.last = Math.max(fl.last, et.minuteOfDay);
    }

    if (c.answered) {
      p.connected += 1;
      p.talkSec += c.talkSec;
      day.talkSec += c.talkSec;
      const tl = talkByUser.get(c.userId);
      if (tl) tl.push(c.talkSec);
      else talkByUser.set(c.userId, [c.talkSec]);
      teamTalk.push(c.talkSec);
      if (c.talkSec > 0) {
        let b = LENGTH_BUCKETS.length - 1;
        while (b > 0 && c.talkSec < LENGTH_BUCKETS[b].minSec) b -= 1;
        lengthCounts[b] += 1;
      }
      if (c.talkSec < SHORT_CALL_SEC) p.shortCalls += 1;
      if (c.talkSec >= CONVERSATION_SEC) p.conversations += 1;
      if (isConfirmedDrop(c)) p.confirmedDrops += 1;
      if (c.quality) {
        p.qualityMeasured += 1;
        if (isPoorQuality(c)) p.poorQuality += 1;
      }
      if (c.other) {
        noteContact(reachedByUser, c.userId, c.other);
        noteContact(calledByUser, c.userId, c.other);
      }
      longest.push({
        userId: c.userId,
        direction: c.direction,
        lastFour: c.other ? c.other.slice(-4) : '',
        talkSec: c.talkSec,
        startedAt: new Date(c.startedAt).toISOString(),
      });
      // Likely drop: the same number is dialed again right after a real call.
      if (c.other && c.talkSec >= REDIAL_MIN_TALK_SEC && c.endedAt) {
        const times = outboundTimes.get(`${c.userId}|${c.other}`) ?? [];
        const i = upperBound(times, c.startedAt);
        if (i < times.length && times[i] - c.endedAt <= REDIAL_WINDOW_MS && times[i] >= c.endedAt - 5_000) {
          p.likelyDrops += 1;
        }
      }
      const minutes = c.talkSec > 0 ? Math.ceil(c.talkSec / 60) : 0;
      const rate = c.direction === 'inbound' ? data.pricing.inboundPerMin : data.pricing.outboundPerMin;
      p.billedMinutes += minutes;
      p.costVoice += minutes * rate;
      if (c.userDidId != null) {
        const la = lineAgg.get(c.userDidId) ?? { calls: 0, minutes: 0, cost: 0 };
        la.calls += 1;
        la.minutes += minutes;
        la.cost += minutes * rate;
        lineAgg.set(c.userDidId, la);
      }
    }

    if (c.answered) {
      // The client's JsSIP reason is more specific than Telnyx's
      // normal_clearing, so prefer it when a client row was matched.
      const reason = c.clientCause ?? c.cause ?? 'unknown';
      endReasons.set(reason, (endReasons.get(reason) ?? 0) + 1);
    }

    if (c.direction === 'outbound') {
      p.callsOut += 1;
      day.outbound += 1;
      if (c.other) {
        noteContact(dialledByUser, c.userId, c.other);
        if (c.answered) noteContact(dialledConnectedByUser, c.userId, c.other);
      }
      outbound.total += 1;
      const o = outboundOutcome(c);
      if (o === 'connected') {
        p.connectedOut += 1;
        day.connected += 1;
        outbound.connected += 1;
      } else if (o === 'no_answer') { outbound.noAnswer += 1; p.noAnswerOut += 1; }
      else {
        p.failedDials += 1;
        if (o === 'busy') { outbound.busy += 1; p.busyOut += 1; }
        else if (o === 'invalid_number') { outbound.invalidNumber += 1; p.invalidNumbers += 1; }
        else if (o === 'rejected') { outbound.rejected += 1; p.rejectedOut += 1; }
        else { outbound.failed += 1; p.otherFailedOut += 1; }
      }
    } else {
      p.callsIn += 1;
      day.inbound += 1;
      const o = inboundOutcome(c);
      if (o === 'blocked') {
        inbound.blocked += 1;
        continue;
      }
      inbound.total += 1;
      inboundByHour[et.hour].total += 1;
      if (o === 'answered') {
        inbound.answered += 1;
        p.answeredIn += 1;
        day.answeredIn += 1;
        continue;
      }
      p.unansweredIn += 1;
      inboundByHour[et.hour].unanswered += 1;
      if (o === 'caller_hung_up') { inbound.callerHungUp += 1; p.callerHungUpIn += 1; }
      else if (o === 'rang_out') { inbound.rangOut += 1; p.rangOutIn += 1; }
      else if (o === 'declined') { inbound.declined += 1; p.declinedIn += 1; }
      else inbound.other += 1;
      if (c.telnyxCallIds.some((id) => vmCallIds.has(id))) inbound.wentToVoicemail += 1;
      if (!c.other) continue;
      // Returned: an outbound call to the same number within 24h.
      p.missedReturnable += 1;
      const times = outboundTimes.get(`${c.userId}|${c.other}`) ?? [];
      const i = upperBound(times, c.startedAt);
      if (i < times.length && times[i] - c.startedAt <= FOLLOW_UP_MS) {
        p.missedReturned += 1;
        const sec = Math.round((times[i] - c.startedAt) / 1000);
        const cl = callbackByUser.get(c.userId);
        if (cl) cl.push(sec);
        else callbackByUser.set(c.userId, [sec]);
        teamCallback.push(sec);
      }
      const uk = `${c.userId}|${c.other}`;
      const u = unreached.get(uk);
      if (u) {
        u.attempts += 1;
        u.lastAt = Math.max(u.lastAt, c.startedAt);
      } else {
        unreached.set(uk, { userId: c.userId, number: c.other, attempts: 1, firstAt: c.startedAt, lastAt: c.startedAt });
      }
    }
  }

  // ── Messages ──
  const replyByUser = new Map<number, number[]>();
  const teamReply: number[] = [];
  const failureReasons = new Map<string, { code: string; title: string; count: number }>();
  const smsByHour = new Array<number>(24).fill(0);
  const threadsByUser = new Map<number, Set<string>>();
  const byThread = new Map<string, MessageRow[]>();
  for (const m of data.messages) {
    if (!scoped.has(m.userId)) continue;
    const k = `${m.userId}|${m.threadKey}`;
    const l = byThread.get(k);
    if (l) l.push(m);
    else byThread.set(k, [m]);
  }
  for (const [, thread] of byThread) {
    thread.sort((a, b) => a.createdAt - b.createdAt);
    // nextOut[i] = the first outbound message after i, filled right-to-left
    // so a long thread stays linear.
    const nextOut = new Array<MessageRow | null>(thread.length).fill(null);
    for (let i = thread.length - 2; i >= 0; i -= 1) {
      nextOut[i] = thread[i + 1].direction === 'outbound' ? thread[i + 1] : nextOut[i + 1];
    }
    for (let i = 0; i < thread.length; i += 1) {
      const m = thread[i];
      const num = last10(m.threadKey);
      if (m.createdAt >= priorStart && m.createdAt < win.startMs) {
        noteContact(priorContacts, m.userId, num);
        continue;
      }
      if (!inWin(m.createdAt)) continue;
      const p = personOf(m.userId)!;
      const day = dayOf(m.createdAt);
      noteContact(threadsByUser, m.userId, m.threadKey);
      if (num) {
        noteContact(reachedByUser, m.userId, num);
        noteContact(textedByUser, m.userId, num);
      }
      if (m.direction === 'outbound') {
        p.smsSent += 1;
        day.smsSent += 1;
        smsByHour[etParts(m.createdAt).hour] += 1;
        const segs = estimateSegments(m.bodyLength, m.isGsm);
        p.segments += segs;
        p.costSms += segs * data.pricing.perSms;
        if (m.hasMedia) p.mms += 1;
        if (m.status === 'delivered') p.smsDelivered += 1;
        if (FAILED_SMS.has(m.status)) {
          p.smsFailed += 1;
          const code = m.errorCode ?? 'unknown';
          const fr = failureReasons.get(code) ?? { code, title: m.errorTitle ?? 'No reason given', count: 0 };
          fr.count += 1;
          failureReasons.set(code, fr);
        }
      } else {
        p.smsReceived += 1;
        day.smsReceived += 1;
        p.costSms += data.pricing.perSms;
        if (m.hasMedia) p.mms += 1;
        // Only the first text of an inbound run needs a reply; a candidate
        // sending three texts in a row is one turn, not three unanswered.
        const prev = thread[i - 1];
        if (prev && prev.direction === 'inbound') continue;
        p.smsRepliable += 1;
        const reply = nextOut[i];
        if (reply && reply.createdAt - m.createdAt <= FOLLOW_UP_MS) {
          p.smsReplied += 1;
          const sec = Math.round((reply.createdAt - m.createdAt) / 1000);
          const rl = replyByUser.get(m.userId);
          if (rl) rl.push(sec);
          else replyByUser.set(m.userId, [sec]);
          teamReply.push(sec);
        }
      }
    }
  }

  // ── Voicemail ──
  const listenByUser = new Map<number, number[]>();
  const teamListen: number[] = [];
  for (const v of data.voicemails) {
    if (!scoped.has(v.userId) || !inWin(v.receivedAt)) continue;
    const p = personOf(v.userId)!;
    p.voicemails += 1;
    if (v.listenedAt != null) {
      p.voicemailsHeard += 1;
      const sec = Math.max(0, Math.round((v.listenedAt - v.receivedAt) / 1000));
      const ll = listenByUser.get(v.userId);
      if (ll) ll.push(sec);
      else listenByUser.set(v.userId, [sec]);
      teamListen.push(sec);
    }
    const num = last10(v.fromNumber);
    if (num) {
      const times = outboundTimes.get(`${v.userId}|${num}`) ?? [];
      const i = upperBound(times, v.receivedAt);
      if (i < times.length && times[i] - v.receivedAt <= FOLLOW_UP_MS) p.voicemailsCalledBack += 1;
    }
  }

  // ── Scheduled + campaigns ──
  const upcoming: PeriodResult['scheduledUpcoming'] = [];
  const campaignAgg = new Map<number, { sent: number; failed: number; pending: number; canceled: number }>();
  for (const s of data.scheduled) {
    if (!scoped.has(s.userId)) continue;
    if (s.campaignId != null) {
      const a = campaignAgg.get(s.campaignId) ?? { sent: 0, failed: 0, pending: 0, canceled: 0 };
      if (s.status === 'sent') a.sent += 1;
      else if (s.status === 'failed') a.failed += 1;
      else if (s.status === 'canceled') a.canceled += 1;
      else a.pending += 1;
      campaignAgg.set(s.campaignId, a);
    }
    if (s.status === 'pending' || s.status === 'sending') {
      upcoming.push({
        id: s.id,
        userId: s.userId,
        toNumber: s.toNumber,
        scheduledFor: new Date(s.scheduledFor).toISOString(),
        campaignId: s.campaignId,
      });
    }
    if (!inWin(s.scheduledFor)) continue;
    const p = personOf(s.userId)!;
    p.scheduledTotal += 1;
    if (s.status === 'sent') p.scheduledSent += 1;
    else if (s.status === 'failed') p.scheduledFailed += 1;
    else if (s.status === 'canceled') p.scheduledCanceled += 1;
    else p.scheduledPending += 1;
  }
  upcoming.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const campaigns: PeriodResult['campaigns'] = [];
  for (const c of data.campaigns) {
    if (!scoped.has(c.userId) || !inWin(c.createdAt)) continue;
    personOf(c.userId)!.campaigns += 1;
    const a = campaignAgg.get(c.id) ?? { sent: 0, failed: 0, pending: 0, canceled: 0 };
    campaigns.push({
      id: c.id,
      userId: c.userId,
      createdAt: new Date(c.createdAt).toISOString(),
      total: c.totalCount,
      skipped: c.skippedCount,
      ...a,
    });
  }
  campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const f of data.favoritesAdded) {
    if (scoped.has(f.userId) && inWin(f.addedAt)) personOf(f.userId)!.favoritesAdded += 1;
  }

  // ── Per-person finishing ──
  const firstByUser = new Map<number, number[]>();
  const lastByUser = new Map<number, number[]>();
  for (const fl of dayFirstLast.values()) {
    (firstByUser.get(fl.userId) ?? firstByUser.set(fl.userId, []).get(fl.userId)!).push(fl.first);
    (lastByUser.get(fl.userId) ?? lastByUser.set(fl.userId, []).get(fl.userId)!).push(fl.last);
  }
  const teamReached = new Set<string>();
  const teamPrior = new Set<string>();
  for (const set of priorContacts.values()) for (const n of set) teamPrior.add(n);
  let teamMultiTouch = 0;
  for (const p of people.values()) {
    const tl = talkByUser.get(p.userId) ?? [];
    p.avgTalkSec = tl.length ? Math.round(p.talkSec / tl.length) : 0;
    p.medianTalkSec = median(tl) ?? 0;
    p.medianCallbackSec = median(callbackByUser.get(p.userId) ?? []);
    p.medianReplySec = median(replyByUser.get(p.userId) ?? []);
    p.medianListenSec = median(listenByUser.get(p.userId) ?? []);
    p.threads = threadsByUser.get(p.userId)?.size ?? 0;
    p.uniqueDialled = dialledByUser.get(p.userId)?.size ?? 0;
    p.uniqueConnected = dialledConnectedByUser.get(p.userId)?.size ?? 0;
    p.activeDays = activeDaysByUser.get(p.userId)?.size ?? 0;
    p.firstCallMin = median(firstByUser.get(p.userId) ?? []);
    p.lastCallMin = median(lastByUser.get(p.userId) ?? []);
    const reached = reachedByUser.get(p.userId) ?? new Set<string>();
    const prior = priorContacts.get(p.userId) ?? new Set<string>();
    const called = calledByUser.get(p.userId) ?? new Set<string>();
    const texted = textedByUser.get(p.userId) ?? new Set<string>();
    p.uniqueReached = reached.size;
    for (const n of reached) {
      teamReached.add(n);
      if (!prior.has(n)) p.newContacts += 1;
      if (called.has(n) && texted.has(n)) p.multiTouch += 1;
    }
    teamMultiTouch += p.multiTouch;
    p.costVoice = round2(p.costVoice);
    p.costSms = round2(p.costSms);
    p.cost = round2(p.costVoice + p.costSms);
  }

  // ── Team totals: sums, but medians over every call, not medians of medians ──
  const totals = emptyPerson(0);
  const SUM_KEYS: Array<keyof PersonMetrics> = [
    'callsOut', 'connectedOut', 'callsIn', 'answeredIn', 'unansweredIn', 'declinedIn', 'talkSec', 'connected',
    'callerHungUpIn', 'rangOutIn', 'noAnswerOut', 'rejectedOut', 'otherFailedOut',
    'shortCalls', 'conversations', 'likelyDrops', 'confirmedDrops', 'qualityMeasured', 'poorQuality',
    'failedDials', 'invalidNumbers', 'busyOut', 'missedReturnable', 'missedReturned',
    'smsSent', 'smsReceived', 'smsDelivered', 'smsFailed', 'smsRepliable', 'smsReplied', 'mms', 'segments', 'threads',
    'scheduledTotal', 'scheduledPending', 'scheduledSent', 'scheduledFailed', 'scheduledCanceled', 'campaigns',
    'voicemails', 'voicemailsHeard', 'voicemailsCalledBack', 'favoritesAdded', 'billedMinutes', 'costVoice', 'costSms',
  ];
  for (const p of people.values()) {
    for (const k of SUM_KEYS) (totals[k] as number) += p[k] as number;
  }
  totals.avgTalkSec = teamTalk.length ? Math.round(totals.talkSec / teamTalk.length) : 0;
  totals.medianTalkSec = median(teamTalk) ?? 0;
  totals.medianCallbackSec = median(teamCallback);
  totals.medianReplySec = median(teamReply);
  totals.medianListenSec = median(teamListen);
  totals.uniqueReached = teamReached.size;
  totals.uniqueDialled = new Set([...dialledByUser.values()].flatMap((x) => [...x])).size;
  totals.uniqueConnected = new Set([...dialledConnectedByUser.values()].flatMap((x) => [...x])).size;
  // Team-wide, a number two recruiters both reached is one person, and it
  // is only "new" if nobody on the team contacted it last period.
  totals.newContacts = [...teamReached].filter((n) => !teamPrior.has(n)).length;
  totals.multiTouch = teamMultiTouch;
  totals.activeDays = new Set([...activeDaysByUser.values()].flatMap((s) => [...s])).size;
  totals.firstCallMin = median([...dayFirstLast.values()].map((d) => d.first));
  totals.lastCallMin = median([...dayFirstLast.values()].map((d) => d.last));
  totals.costVoice = round2(totals.costVoice);
  totals.costSms = round2(totals.costSms);

  const scopedLines = data.lines.filter((l) => l.userId != null && scoped.has(l.userId));
  const didCost = round2(scopedLines.length * data.pricing.didMonthly * (win.days / 30));
  totals.cost = round2(totals.costVoice + totals.costSms + didCost);

  longest.sort((a, b) => b.talkSec - a.talkSec);
  const repeatUnreached = [...unreached.values()]
    .filter((u) => {
      if (u.attempts < 2) return false;
      const reached = reachedTimes.get(`${u.userId}|${u.number}`) ?? [];
      return upperBound(reached, u.firstAt) >= reached.length;
    })
    .sort((a, b) => b.attempts - a.attempts || b.lastAt - a.lastAt)
    .slice(0, 25)
    .map((u) => ({ userId: u.userId, number: u.number, attempts: u.attempts, lastAt: new Date(u.lastAt).toISOString() }));

  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const lines = [...lineAgg.entries()]
    .map(([lineId, a]) => {
      const l = lineById.get(lineId);
      return {
        lineId,
        userId: l?.userId ?? null,
        didNumber: l?.didNumber ?? '',
        label: l?.label ?? 'Line',
        calls: a.calls,
        minutes: a.minutes,
        cost: round2(a.cost),
      };
    })
    .filter((l) => l.userId == null || scoped.has(l.userId))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totals,
    people,
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    heatmap,
    callLength: LENGTH_BUCKETS.map((b, i) => ({ label: b.label, minSec: b.minSec, count: lengthCounts[i] })),
    longestCalls: longest.slice(0, 10),
    inbound: { ...inbound, byHour: inboundByHour, repeatUnreached },
    outbound,
    quality: {
      endReasons: [...endReasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
    },
    sms: {
      failureReasons: [...failureReasons.values()].sort((a, b) => b.count - a.count),
      byHour: smsByHour,
    },
    scheduledUpcoming: upcoming.slice(0, 50),
    campaigns: campaigns.slice(0, 50),
    lines,
    didCost,
    ownedLines: scopedLines.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
