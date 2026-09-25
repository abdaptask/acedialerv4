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
  const q = c.quality;
  if (!q) return false;
  return q.avgJitterMs >= 60 || q.avgLossPct >= 5 || (q.avgRttMs != null && q.avgRttMs >= 500);
}
