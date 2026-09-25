// One logical call per physical call, for reporting.
//
// A single call produces up to two kinds of rows:
//   - webhook rows (sessionId set): written by apps/webhooks from Telnyx
//     events. Authoritative for status and timing. Several can share one
//     sessionId (forked / multi-leg delivery).
//   - client rows (sessionId null): written by the renderer via POST /calls.
//     The only source of the JsSIP end reason, who hung up, and audio
//     quality — none of which Telnyx reports.
// Counting both roughly doubles outbound volume (measured Sep 2026:
// 52,789 rows for 26,658 calls in 30 days), which is what the old
// /admin/reports/* endpoints did.
//
// Why not reuse dedupeCallLegs() from Recents: its second pass merges ANY
// two rows to the same number within 60s, including two webhook rows. For a
// display list that's fine; for reporting it swallows a genuine redial,
// which is exactly the signal "likely drops" is built on. Here a client row
// may only merge INTO a webhook row, never webhook+webhook or client+client.
//
// Why talk time isn't durationSeconds: on webhook rows durationSeconds runs
// from call start, so it includes ringing (avg 98s vs 84s answered→ended).
// A caller who hangs up during ringing gets ~20s of "duration" and would
// otherwise look like an answered call.

// Timestamps are epoch ms, not Date: a team report builds ~137k of these
// and the Date allocations alone cost ~0.8s in GC.
export interface RawCallRow {
  userId: number;
  telnyxCallId: string;
  sessionId: string | null;
  direction: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  durationSeconds: number;
  hangupCause: string | null;
  hangupSource: string | null;
  userDidId: number | null;
  avgJitterMs: number | null;
  avgLossPct: number | null;
  maxLossPct: number | null;
  avgRttMs: number | null;
  rxPackets?: number | null;
  txPackets?: number | null;
  sipHangupCause?: string | null;
  /** Telnyx's inbound (far end → Telnyx) packet count from call_quality_stats. */
  carrierRxPackets?: number | null;
  /** Telnyx's MOS for audio arriving from the far end (1–5). */
  carrierMos?: number | null;
}

export interface CallQualitySummary {
  avgJitterMs: number;
  avgLossPct: number;
  maxLossPct: number;
  avgRttMs: number | null;
}

export interface LogicalCall {
  userId: number;
  direction: 'inbound' | 'outbound';
  /** Last 10 digits of the other party; '' when withheld/short. */
  other: string;
  /** The other party's number as recorded (E.164 or carrier format). */
  number: string;
  startedAt: number;
  endedAt: number | null;
  answered: boolean;
  talkSec: number;
  status: string;
  /** Telnyx hangup_cause (webhook) or the client's cause when unmatched. */
  cause: string | null;
  source: string | null;
  /** JsSIP end reason from the client row, when one was matched. */
  clientCause: string | null;
  /** 'local' | 'remote' | 'system' from JsSIP, when recorded. */
  clientOriginator: string | null;
  quality: CallQualitySummary | null;
  /** Audio packets the app received; 0 on a connected call = one-way audio. */
  rxPackets: number | null;
  sipCause: string | null;
  carrierRxPackets: number | null;
  carrierMos: number | null;
  /** Seconds from dial/ring start to answer, or to hang-up when never answered. */
  ringSec: number;
  userDidId: number | null;
  /** Every telnyxCallId folded into this call — voicemails join on these. */
  telnyxCallIds: string[];
}

const PAIR_WINDOW_MS = 60_000;
// A stuck row (no hang-up webhook) must not add hours of phantom talk.
const MAX_TALK_SEC = 4 * 3600;

export function last10(n: string | null | undefined): string {
  const d = (n ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function talkOf(r: RawCallRow): number {
  if (r.answeredAt == null) return 0;
  if (r.endedAt != null) {
    const s = Math.round((r.endedAt - r.answeredAt) / 1000);
    return Math.min(MAX_TALK_SEC, Math.max(0, s));
  }
  return 0;
}

function toLogical(r: RawCallRow): LogicalCall {
  const direction = r.direction === 'inbound' ? 'inbound' : 'outbound';
  const isClient = !r.sessionId;
  return {
    userId: r.userId,
    direction,
    other: last10(direction === 'inbound' ? r.fromNumber : r.toNumber),
    number: direction === 'inbound' ? r.fromNumber : r.toNumber,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    answered: r.answeredAt != null,
    talkSec: talkOf(r),
    status: r.status,
    cause: r.hangupCause,
    source: r.hangupSource,
    clientCause: isClient ? r.hangupCause : null,
    clientOriginator: isClient ? r.hangupSource : null,
    quality: qualityOf(r),
    rxPackets: isClient ? r.rxPackets ?? null : null,
    sipCause: r.sipHangupCause ?? null,
    carrierRxPackets: r.carrierRxPackets ?? null,
    carrierMos: r.carrierMos ?? null,
    ringSec: Math.max(0, Math.round((((r.answeredAt ?? r.endedAt) ?? r.startedAt) - r.startedAt) / 1000)),
    userDidId: r.userDidId,
    telnyxCallIds: [r.telnyxCallId],
  };
}

function qualityOf(r: RawCallRow): CallQualitySummary | null {
  if (r.avgJitterMs == null || r.avgLossPct == null) return null;
  return {
    avgJitterMs: r.avgJitterMs,
    avgLossPct: r.avgLossPct,
    maxLossPct: r.maxLossPct ?? r.avgLossPct,
    avgRttMs: r.avgRttMs,
  };
}

/** Prefer the leg that was answered, then the longer talk, then the later start. */
function better(a: LogicalCall, b: LogicalCall): LogicalCall {
  if (a.answered !== b.answered) return a.answered ? a : b;
  if (a.talkSec !== b.talkSec) return a.talkSec > b.talkSec ? a : b;
  return b.startedAt > a.startedAt ? b : a;
}

export function canonicalizeCalls(rows: RawCallRow[]): LogicalCall[] {
  const byUser = new Map<number, RawCallRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }

  const out: LogicalCall[] = [];
  for (const userRows of byUser.values()) {
    const sessions = new Map<string, LogicalCall>();
    const clientRows: RawCallRow[] = [];
    for (const r of userRows) {
      if (!r.sessionId) {
        clientRows.push(r);
        continue;
      }
      const lc = toLogical(r);
      const prev = sessions.get(r.sessionId);
      if (!prev) {
        sessions.set(r.sessionId, lc);
      } else {
        const win = better(prev, lc);
        win.telnyxCallIds = [...new Set([...prev.telnyxCallIds, ...lc.telnyxCallIds])];
        sessions.set(r.sessionId, win);
      }
    }

    // Index webhook calls by (direction, other) for the client pairing pass.
    const index = new Map<string, LogicalCall[]>();
    for (const lc of sessions.values()) {
      if (!lc.other) continue;
      const k = `${lc.direction}|${lc.other}`;
      const list = index.get(k);
      if (list) list.push(lc);
      else index.set(k, [lc]);
    }
    const paired = new Set<LogicalCall>();

    for (const r of clientRows) {
      const client = toLogical(r);
      const candidates = client.other ? index.get(`${client.direction}|${client.other}`) : undefined;
      let match: LogicalCall | null = null;
      let bestGap = Infinity;
      for (const c of candidates ?? []) {
        if (paired.has(c)) continue;
        const gap = Math.abs(c.startedAt - client.startedAt);
        if (gap <= PAIR_WINDOW_MS && gap < bestGap) {
          bestGap = gap;
          match = c;
        }
      }
      if (match) {
        paired.add(match);
        match.clientCause = client.clientCause;
        match.clientOriginator = client.clientOriginator;
        match.quality = client.quality;
        match.rxPackets = client.rxPackets;
        match.telnyxCallIds.push(...client.telnyxCallIds);
      } else {
        // No webhook leg — e.g. a user whose Telnyx webhook pointed at the
        // dead Render host. The client row is the only record, so keep it.
        out.push(client);
      }
    }
    out.push(...sessions.values());
  }
  out.sort((a, b) => a.startedAt - b.startedAt);
  return out;
}

// ── Outcome classification ────────────────────────────────────────────

export type InboundOutcome =
  | 'answered'
  | 'caller_hung_up'
  | 'rang_out'
  | 'declined'
  | 'blocked'
  | 'other';

export function inboundOutcome(c: LogicalCall): InboundOutcome {
  if (c.status === 'blocked') return 'blocked';
  if (c.answered) return 'answered';
  const s = c.status;
  const cause = (c.cause ?? '').toLowerCase();
  if (s === 'caller_canceled' || cause === 'originator_cancel') return 'caller_hung_up';
  if (s === 'missed' || s === 'no_answer') return 'rang_out';
  // Declining sends 486 Busy Here, which Telnyx reports back as busy.
  if (s === 'busy' || s === 'rejected') return 'declined';
  return 'other';
}

export type OutboundOutcome =
  | 'connected'
  | 'no_answer'
  | 'busy'
  | 'invalid_number'
  | 'rejected'
  | 'failed';

export function outboundOutcome(c: LogicalCall): OutboundOutcome {
  if (c.answered) return 'connected';
  const s = c.status;
  const cause = (c.cause ?? '').toLowerCase();
  if (cause === 'not_found' || cause === 'not found') return 'invalid_number';
  if (s === 'busy' || cause === 'user_busy' || cause === 'busy') return 'busy';
  if (s === 'rejected' || cause === 'call_rejected' || cause === 'rejected') return 'rejected';
  if (s === 'caller_canceled' || s === 'missed' || s === 'no_answer' || cause === 'originator_cancel' || cause === 'canceled') return 'no_answer';
  return 'failed';
}

// JsSIP causes that mean the transport or media died under a connected
// call, as opposed to someone pressing hang up.
const CLIENT_DROP_CAUSES = new Set([
  'connection error',
  'request timeout',
  'rtp timeout',
  'internal error',
  'sip failure code',
  'state_desync',
]);
// Telnyx causes that end an answered call without either party hanging up.
const CARRIER_DROP_CAUSES = new Set([
  'unspecified',
  'recovery_on_timer_expire',
  'media_timeout',
  'network_out_of_order',
  'destination_out_of_order',
  'normal_temporary_failure',
]);

/** A connected call that ended for a network/media reason, per recorded causes. */
export function isConfirmedDrop(c: LogicalCall): boolean {
  if (!c.answered) return false;
  const client = (c.clientCause ?? '').toLowerCase();
  if (CLIENT_DROP_CAUSES.has(client)) return true;
  const carrier = (c.cause ?? '').toLowerCase();
  return CARRIER_DROP_CAUSES.has(carrier);
}

/** Same thresholds as the in-call quality badge (sip.ts pollQualityOnce). */
export function isPoorQuality(c: LogicalCall): boolean {
  // Telnyx MOS under 3.5 is where listeners start to complain.
  if (c.carrierMos != null && c.carrierMos > 0 && c.carrierMos < 3.5) return true;
  const q = c.quality;
  if (!q) return false;
  return q.avgJitterMs >= 60 || q.avgLossPct >= 5 || (q.avgRttMs != null && q.avgRttMs >= 500);
}

// ── End reason ────────────────────────────────────────────────────────
//
// One plain-language answer to "why did this call end?", from the most
// specific evidence available: the app's own packet counts and JsSIP
// originator (client row), then Telnyx's hang-up source/cause.

export type EndReasonKey =
  | 'no_audio' | 'no_audio_far' | 'dropped' | 'you_hung_up' | 'they_hung_up' | 'ended'
  | 'you_canceled' | 'no_answer' | 'busy' | 'not_found' | 'rejected' | 'failed'
  | 'caller_hung_up' | 'rang_out' | 'declined' | 'blocked';

export interface EndReason {
  key: EndReasonKey;
  label: string;
  /** Who ended it, when that's known. */
  by: 'you' | 'them' | 'network' | null;
}

// A connected call that ran this long with zero packets from the far end is
// silent, not just short.
const SILENT_MIN_SEC = 5;

/**
 * Silence has two different causes, and they need different fixes:
 *  - far: Telnyx itself received nothing from the other side (their phone,
 *    their carrier, a screener that never spoke) — measured on every call.
 *  - near: Telnyx did get audio but the app received none — our media path
 *    (NAT/TURN), measured only on app 0.10.232+.
 */
export function silence(c: LogicalCall): 'far' | 'near' | null {
  if (!c.answered || c.talkSec < SILENT_MIN_SEC) return null;
  if (c.carrierRxPackets === 0) return 'far';
  if (c.rxPackets === 0) return 'near';
  return null;
}

export function isSilent(c: LogicalCall): boolean {
  return silence(c) !== null;
}

/** Audio was measured on this call by the app or by Telnyx. */
export function audioMeasured(c: LogicalCall): boolean {
  return c.rxPackets != null || c.carrierRxPackets != null;
}

export function endReason(c: LogicalCall): EndReason {
  const sip = c.sipCause && /^\d{3}$/.test(c.sipCause) ? ` (SIP ${c.sipCause})` : '';
  if (c.answered) {
    const quiet = silence(c);
    if (quiet === 'far') return { key: 'no_audio_far', label: 'Connected, but the other side sent no audio', by: null };
    if (quiet === 'near') return { key: 'no_audio', label: 'Connected, but their audio never reached you', by: null };
    if (isConfirmedDrop(c)) return { key: 'dropped', label: 'Call dropped by the network', by: 'network' };
    const origin = (c.clientOriginator ?? '').toLowerCase();
    if (origin === 'local') return { key: 'you_hung_up', label: 'You hung up', by: 'you' };
    if (origin === 'remote') return { key: 'they_hung_up', label: 'They hung up', by: 'them' };
    const src = (c.source ?? '').toLowerCase();
    // Telnyx names the legs from the call's point of view: on an outbound
    // call we are the caller; on an inbound call they are.
    const us = c.direction === 'outbound' ? 'caller' : 'callee';
    const them = c.direction === 'outbound' ? 'callee' : 'caller';
    if (src === us) return { key: 'you_hung_up', label: 'You hung up', by: 'you' };
    if (src === them) return { key: 'they_hung_up', label: 'They hung up', by: 'them' };
    return { key: 'ended', label: 'Call ended', by: null };
  }
  // Under 3s the carrier's timestamps say more about signalling than ringing.
  const ring = c.ringSec >= 3 ? ` after ${c.ringSec}s` : '';
  if (c.direction === 'outbound') {
    const o = outboundOutcome(c);
    const s = c.status;
    const cause = (c.cause ?? '').toLowerCase();
    if (o === 'no_answer') {
      if (s === 'caller_canceled' || cause === 'originator_cancel' || cause === 'canceled') {
        return { key: 'you_canceled', label: `You hung up before they answered${ring}`, by: 'you' };
      }
      return { key: 'no_answer', label: `No answer${ring}`, by: 'them' };
    }
    if (o === 'busy') return { key: 'busy', label: `Busy${sip}`, by: 'them' };
    if (o === 'invalid_number') return { key: 'not_found', label: `Number not in service or not found${sip}`, by: 'network' };
    if (o === 'rejected') return { key: 'rejected', label: `Declined or blocked by the other side${sip}`, by: 'them' };
    return { key: 'failed', label: `Couldn't connect${sip || (c.cause ? ` (${c.cause})` : '')}`, by: 'network' };
  }
  const o = inboundOutcome(c);
  if (o === 'blocked') return { key: 'blocked', label: 'Blocked number', by: null };
  if (o === 'caller_hung_up') return { key: 'caller_hung_up', label: `Caller hung up while it rang${ring}`, by: 'them' };
  if (o === 'rang_out') return { key: 'rang_out', label: `Nobody answered${ring}`, by: null };
  if (o === 'declined') return { key: 'declined', label: 'You declined (or were busy)', by: 'you' };
  return { key: 'failed', label: `Didn't connect${sip}`, by: 'network' };
}
