// The eight report tabs. Each measure is defined once as a Col, and that
// one definition drives the team table, the person-vs-team comparison, and
// the CSV export — so the three can never disagree about a number.

import type { ReactNode } from 'react';
import { formatPhone } from '../../lib/phone';
import { Numbers } from './numbers';
import { FollowUps } from './followups';
import { Insights } from './insightsTab';
import {
  BarList, Columns, Heatmap, HeatLegend, Meter, StackedColumns, toneFor,
} from './charts';
import {
  fmtAgo, fmtClockDuration, fmtDateTime, fmtDay, fmtHour, fmtInt, fmtMoney, fmtPct, fmtTalk,
  fmtTimeOfDay, fmtWait, pct,
} from './format';
import {
  CompareTable, Empty, Kpi, KpiGrid, Legend, Panel, PeopleTable, Person, teamAverage,
  type Col, type DrillSpec, type RowLike,
} from './parts';
import type { CallLogEntry, DailyPoint, PersonMetrics, PersonRow, PrevMetrics, ReportsPayload, TextLogEntry } from './types';

export interface TabProps {
  data: ReportsPayload;
  /** The whole-team payload for the same range, when viewing one person as an admin. */
  team: ReportsPayload | null;
  person: PersonRow | null;
  open: (userId: number) => void;
  nameOf: (userId: number) => string;
  /** Open the drill-down sheet for a number. */
  drill: (spec: DrillSpec) => void;
  /** Re-open the report for a single day. */
  openDay: (date: string) => void;
  /** Open everything the team (or this person) has had with a number. */
  openContact: (number: string) => void;
}

export interface TabDef {
  key: string;
  label: string;
  render: (p: TabProps) => ReactNode;
  /** The table this tab exports as CSV. */
  csv: { cols: Col[]; filename: string };
  /** Only offered on one person's report (e.g. their call log). */
  personOnly?: boolean;
  /** Only offered to admins (spend, leadership insights). */
  adminOnly?: boolean;
}

const S1 = 'var(--rp-s1)';
const S2 = 'var(--rp-s2)';
const dash = '—';

// ── Column builders ─────────────────────────────────────────────────────

type NumKey = {
  [K in keyof PersonMetrics]-?: PersonMetrics[K] extends number | null ? K : never;
}[keyof PersonMetrics];

const count = (key: NumKey, label: string, extra: Partial<Col> = {}): Col => ({
  key, label,
  value: (r) => (r[key] as number | undefined) ?? null,
  fmt: (v) => (v == null ? dash : fmtInt(v)),
  ...extra,
});

// minDen: below this many calls a rate is noise (1 redial out of 2 calls is
// a "50% drop rate"), so it shows "—" and sorts to the bottom instead of
// topping the table. Applied per person only; the team rate always shows.
const ratio = (key: string, label: string, num: (r: RowLike) => number, den: (r: RowLike) => number, extra: Partial<Col> & { minDen?: number } = {}): Col => ({
  key, label,
  value: (r) => { const d = den(r); return d && d >= (r.userId === 0 ? 1 : extra.minDen ?? 1) ? num(r) / d : null; },
  fmt: (v) => (v == null ? dash : `${Math.round(v * 100)}%`),
  csv: (v) => (v == null ? '' : +(v * 100).toFixed(1)),
  ...extra,
});

const secs = (key: NumKey, label: string, fmt: (s: number) => string, extra: Partial<Col> = {}): Col => ({
  key, label,
  value: (r) => (r[key] as number | null | undefined) ?? null,
  fmt: (v) => (v == null ? dash : fmt(v)),
  ...extra,
});

const money = (key: NumKey, label: string, extra: Partial<Col> = {}): Col => ({
  key, label,
  value: (r) => (r[key] as number | undefined) ?? null,
  fmt: (v) => (v == null ? dash : fmtMoney(v)),
  ...extra,
});

// Short-call and drop shares are flagged when they're well above normal
// for this team (measured Sep 2026: ~25% of connected calls under 10s,
// ~6% likely drops). The pill draws the eye; the number stays exact.
const shortShare = ratio('shortShare', 'Under 10s', (r) => r.shortCalls, (r) => r.connected, {
  better: 'down', minDen: 20, flag: (v) => (v != null && v >= 0.4 ? 'crit' : v != null && v >= 0.32 ? 'warn' : null),
});
const dropShare = ratio('dropShare', 'Drop rate', (r) => r.likelyDrops, (r) => r.connected, {
  better: 'down', minDen: 20, flag: (v) => (v != null && v >= 0.12 ? 'crit' : v != null && v >= 0.09 ? 'warn' : null),
});
const answerRate = ratio('answerRate', 'Answer rate', (r) => r.answeredIn, (r) => r.answeredIn + r.unansweredIn, {
  better: 'up', minDen: 10, flag: (v) => (v != null && v < 0.25 ? 'crit' : null),
});
const returnRate = ratio('returnRate', 'Return rate', (r) => r.missedReturned, (r) => r.missedReturnable, {
  better: 'up', minDen: 10, flag: (v) => (v != null && v < 0.15 ? 'crit' : null),
});
const replyRate = ratio('replyRate', 'Reply rate', (r) => r.smsReplied, (r) => r.smsRepliable, { better: 'up' });
const heardRate = ratio('heardRate', 'Heard', (r) => r.voicemailsHeard, (r) => r.voicemails, { better: 'up' });
const deliveredRate = ratio('deliveredRate', 'Delivered', (r) => r.smsDelivered, (r) => r.smsSent, { better: 'up' });
const connectRate = ratio('connectRate', 'Connected', (r) => r.connectedOut, (r) => r.callsOut, { better: 'up', minDen: 20 });
const inboundTotal: Col = { key: 'inboundTotal', label: 'Inbound', value: (r) => r.answeredIn + r.unansweredIn, fmt: (v) => (v == null ? dash : fmtInt(v)), bar: true };
const talkCol = secs('talkSec', 'Talk time', fmtTalk, { better: 'up', csv: (v) => (v == null ? '' : Math.round(v / 60)) });
const avgLenCol = secs('avgTalkSec', 'Avg length', fmtClockDuration, { better: 'up' });
const allConnected: Col = { key: 'connected', label: 'Connected', value: (r) => r.connected, fmt: (v) => (v == null ? dash : fmtInt(v)) };

// Which records make up a number, for a person's drill-down.
const isOut = (c: CallLogEntry) => c.direction === 'outbound';
const isIn = (c: CallLogEntry) => c.direction === 'inbound';
const isConnected = (c: CallLogEntry) => c.answered;
const isUnanswered = (c: CallLogEntry) => c.direction === 'inbound' && !c.answered && c.outcome !== 'blocked';
const isFailedDial = (c: CallLogEntry) => c.direction === 'outbound' && ['busy', 'invalid_number', 'rejected', 'failed'].includes(c.outcome);
const sentText = (m: TextLogEntry) => m.direction === 'outbound';
const receivedText = (m: TextLogEntry) => m.direction === 'inbound';
const anyText = () => true;

const perDay = (value: (d: DailyPoint) => number, fmt: (v: number) => string = fmtInt) => ({ value, fmt });
const dayRate = (num: (d: DailyPoint) => number, den: (d: DailyPoint) => number) =>
  perDay((d) => (den(d) ? num(d) / den(d) : 0), (v) => `${Math.round(v * 100)}%`);

/**
 * onOpen handler for a number: the team view ranks it by person; a person's
 * view breaks it down by day, which only exists for some measures — those
 * without a daily series simply aren't clickable there.
 */
/** A breakdown bar (one call outcome) opened by person. Team view only. */
function outcome(p: TabProps, title: string, total: number, key: NumKey) {
  return p.person ? undefined : () => p.drill({ title, value: fmtInt(total), col: count(key, title), additive: true });
}

function drillTo(p: TabProps, title: string, value: string, col: Col, opts: Partial<DrillSpec> = {}) {
  if (p.person && !opts.daily && !opts.calls && !opts.texts) return undefined;
  return () => p.drill({ title, value, col, ...opts });
}

// ── Shared renderers ────────────────────────────────────────────────────

function Scope({ p, cols, defaultSort, delta, title, sub }: {
  p: TabProps; cols: Col[]; defaultSort: string; title: string; sub: string;
  delta?: { key: keyof PrevMetrics; label: string; better?: 'up' | 'down' };
}) {
  if (p.person) {
    return (
      <Panel title={title === 'Team scorecard' ? 'Compared with the team' : title} sub={p.team ? 'Compared with the average across people who were active in this period' : 'Compared with the previous period'} flush>
        <CompareTable person={p.person} team={p.team ? teamAverage(p.team.people) : null} cols={cols} />
      </Panel>
    );
  }
  return (
    <Panel title={title} sub={sub} flush>
      <PeopleTable rows={p.data.people} cols={cols} defaultSort={defaultSort} onOpen={p.open} showDelta={delta} />
    </Panel>
  );
}

function DailyVolume({ data, openDay }: { data: ReportsPayload; openDay: (date: string) => void }) {
  return (
    <Panel
      title="Daily call volume"
      sub={data.daily.length > 1 ? 'Calls per day, Eastern time. Select a day to open it' : 'Calls per day, Eastern time'}
      right={<Legend items={[{ name: 'Outbound', color: S1 }, { name: 'Inbound', color: S2 }]} />}
    >
      <StackedColumns
        data={data.daily.map((d) => ({ label: fmtDay(d.date), values: [d.outbound, d.inbound] }))}
        series={[{ key: 'out', name: 'Outbound', color: S1 }, { key: 'in', name: 'Inbound', color: S2 }]}
        onSelect={data.daily.length > 1 ? (i) => openDay(data.daily[i].date) : undefined}
        tooltip={(i) => {
          const d = data.daily[i];
          return {
            title: fmtDay(d.date),
            lines: [
              `Outbound ${fmtInt(d.outbound)} · ${fmtInt(d.connected)} connected`,
              `Inbound ${fmtInt(d.inbound)} · ${fmtInt(d.answeredIn)} answered`,
              `Talk time ${fmtTalk(d.talkSec)}`,
            ],
          };
        }}
      />
    </Panel>
  );
}

function ActivityHeatmap({ data }: { data: ReportsPayload }) {
  const flat = data.heatmap.flat();
  const total = flat.reduce((a, b) => a + b, 0);
  // Trim to the hours anyone actually works, with a floor of 8a–7p so a
  // quiet week doesn't collapse the grid.
  let lo = 8;
  let hi = 18;
  for (let h = 0; h < 24; h += 1) {
    const col = data.heatmap.reduce((a, row) => a + row[h], 0);
    if (col >= Math.max(3, total * 0.002)) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  }
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const max = Math.max(0, ...flat);
  return (
    <Panel title="When calls happen" sub="Calls by weekday and hour, Eastern time" right={<HeatLegend maxLabel={`${fmtInt(max)} calls`} />}>
      {total === 0 ? <Empty>No calls in this period.</Empty> : (
        <Heatmap
          grid={data.heatmap.map((row) => hours.map((h) => row[h]))}
          rowLabels={days}
          colLabels={hours.map(fmtHour)}
          cellTip={(r, c, v) => ({ title: `${days[r]} ${fmtHour(hours[c])}–${fmtHour((hours[c] + 1) % 24)}`, lines: [`${fmtInt(v)} calls`] })}
        />
      )}
    </Panel>
  );
}

function List({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'rp-r' : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="rp-static">{r.map((c, j) => <td key={j} className={j ? 'rp-r rp-num' : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function personCell(p: TabProps, userId: number): ReactNode {
  if (p.person) return p.nameOf(userId);
  return (
    <button type="button" className="rp-link" onClick={() => p.open(userId)}>{p.nameOf(userId)}</button>
  );
}

// ── Overview ────────────────────────────────────────────────────────────

const overviewCols: Col[] = [
  count('callsOut', 'Calls out', { bar: true, better: 'up' }),
  count('uniqueDialled', 'Unique numbers', { better: 'up' }),
  count('connectedOut', 'Connected', { better: 'up' }),
  secs('talkSec', 'Talk time', fmtTalk, { better: 'up', csv: (v) => (v == null ? '' : Math.round(v / 60)) }),
  secs('avgTalkSec', 'Avg length', fmtClockDuration, { better: 'up' }),
  shortShare,
  count('likelyDrops', 'Likely drops', { better: 'down' }),
  answerRate,
  returnRate,
  count('smsSent', 'Texts sent', { better: 'up' }),
  replyRate,
];

function Overview(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  const spark = (f: (d: ReportsPayload['daily'][number]) => number) => p.data.daily.map(f);
  const answered = pct(t.answeredIn, t.answeredIn + t.unansweredIn);
  const returned = pct(t.missedReturned, t.missedReturnable);
  const replied = pct(t.smsReplied, t.smsRepliable);
  const heard = pct(t.voicemailsHeard, t.voicemails);
  return (
    <>
      <KpiGrid>
        <Kpi label="Outbound calls" value={fmtInt(t.callsOut)} cur={t.callsOut} prev={pv.callsOut} spark={spark((d) => d.outbound)}
          sub={`${fmtInt(t.uniqueDialled)} different numbers · ${fmtInt(t.connectedOut)} connected`} 
          onOpen={drillTo(p, 'Outbound calls', fmtInt(t.callsOut), count('callsOut', 'Calls out'), { calls: isOut, additive: true, daily: perDay((d) => d.outbound) })} />
        <Kpi label="Talk time" value={fmtTalk(t.talkSec)} cur={t.talkSec} prev={pv.talkSec} spark={spark((d) => d.talkSec)}
          sub="All connected calls" 
          onOpen={drillTo(p, 'Talk time', fmtTalk(t.talkSec), talkCol, { calls: isConnected, additive: true, daily: perDay((d) => d.talkSec, fmtTalk) })} />
        <Kpi label="Average call length" value={fmtClockDuration(t.avgTalkSec)} cur={t.avgTalkSec} prev={pv.avgTalkSec}
          sub={`Median ${fmtClockDuration(t.medianTalkSec)}`} 
          onOpen={drillTo(p, 'Average call length', fmtClockDuration(t.avgTalkSec), avgLenCol, { calls: isConnected })} />
        <Kpi label="Inbound answered" value={fmtPct(t.answeredIn, t.answeredIn + t.unansweredIn)}
          points cur={answered} prev={pct(pv.answeredIn, pv.answeredIn + pv.unansweredIn)}
          sub={`${fmtInt(t.unansweredIn)} of ${fmtInt(t.answeredIn + t.unansweredIn)} unanswered`} 
          onOpen={drillTo(p, 'Inbound calls answered', fmtPct(t.answeredIn, t.answeredIn + t.unansweredIn), answerRate, { calls: (c) => isIn(c) && c.outcome !== 'blocked', note: 'People with fewer than 10 inbound calls are left out of the ranking.', daily: dayRate((d) => d.answeredIn, (d) => d.inbound) })} />
        <Kpi label="Missed calls returned" value={fmtPct(t.missedReturned, t.missedReturnable)}
          points cur={returned} prev={pct(pv.missedReturned, pv.missedReturnable)}
          sub={`within 24h · median ${fmtWait(t.medianCallbackSec)}`} 
          onOpen={drillTo(p, 'Missed calls returned within 24h', fmtPct(t.missedReturned, t.missedReturnable), returnRate, { calls: isUnanswered,  note: 'People with fewer than 10 missed calls are left out of the ranking.' })} />
        <Kpi label="Texts sent" value={fmtInt(t.smsSent)} cur={t.smsSent} prev={pv.smsSent} spark={spark((d) => d.smsSent)}
          sub={`${fmtInt(t.smsReceived)} received`} 
          onOpen={drillTo(p, 'Texts sent', fmtInt(t.smsSent), count('smsSent', 'Texts sent'), { texts: sentText, additive: true, daily: perDay((d) => d.smsSent) })} />
        <Kpi label="Texts replied to" value={fmtPct(t.smsReplied, t.smsRepliable)} points cur={replied} prev={pct(pv.smsReplied, pv.smsRepliable)}
          sub={`within 24h · median ${fmtWait(t.medianReplySec)}`} 
          onOpen={drillTo(p, 'Texts replied to within 24h', fmtPct(t.smsReplied, t.smsRepliable), replyRate, { texts: receivedText })} />
        <Kpi label="Voicemails heard" value={fmtPct(t.voicemailsHeard, t.voicemails)} points cur={heard} prev={pct(pv.voicemailsHeard, pv.voicemails)}
          sub={t.voicemailsHeard ? `of ${fmtInt(t.voicemails)} · median ${fmtWait(t.medianListenSec)} to listen` : `None of ${fmtInt(t.voicemails)} heard yet`} 
          onOpen={drillTo(p, 'Voicemails heard', fmtPct(t.voicemailsHeard, t.voicemails), heardRate)} />
      </KpiGrid>
      <div className="rp-grid">
        <DailyVolume data={p.data} openDay={p.openDay} />
        <Panel title="Responsiveness" sub="Share of contacts that got a response" span={5}>
          <div className="rp-meters">
            <Meter label="Inbound calls answered" ratio={answered} display={fmtPct(t.answeredIn, t.answeredIn + t.unansweredIn)} tone={toneFor(answered, 0.7, 0.5)}
              foot={`${fmtInt(t.unansweredIn)} went unanswered, ${fmtInt(p.data.inbound.wentToVoicemail)} to voicemail`} />
            <Meter label="Missed calls returned within 24h" ratio={returned} display={fmtPct(t.missedReturned, t.missedReturnable)} tone={toneFor(returned, 0.7, 0.45)}
              foot={`${fmtInt(t.missedReturned)} of ${fmtInt(t.missedReturnable)} · median wait ${fmtWait(t.medianCallbackSec)}`} />
            <Meter label="Texts replied within 24h" ratio={replied} display={fmtPct(t.smsReplied, t.smsRepliable)} tone={toneFor(replied, 0.7, 0.45)}
              foot={`${fmtInt(t.smsReplied)} of ${fmtInt(t.smsRepliable)} · median reply ${fmtWait(t.medianReplySec)}`} />
            <Meter label="Voicemails listened to" ratio={heard} display={fmtPct(t.voicemailsHeard, t.voicemails)} tone={toneFor(heard, 0.7, 0.45)}
              foot={`${fmtInt(t.voicemailsHeard)} of ${fmtInt(t.voicemails)} · ${fmtInt(t.voicemailsCalledBack)} called back`} />
          </div>
        </Panel>
        <Panel title="Call length" sub="Connected calls by talk time" span={7}>
          <CallLengthChart data={p.data} />
        </Panel>
        <Scope p={p} cols={overviewCols} defaultSort="callsOut" title="Team scorecard"
          sub="Select a person to see their full report" delta={{ key: 'callsOut', label: 'Calls vs prior' }} />
      </div>
    </>
  );
}

function CallLengthChart({ data }: { data: ReportsPayload }) {
  const total = data.callLength.reduce((a, b) => a + b.count, 0);
  if (total === 0) return <Empty>No connected calls in this period.</Empty>;
  const share = (v: number) => {
    const s = Math.round((v / total) * 100);
    return v > 0 && s === 0 ? '<1%' : `${s}%`;
  };
  return (
    <Columns
      data={data.callLength.map((b) => ({ label: b.label, value: b.count }))}
      highlight={(i) => (i === 0 ? S2 : null)}
      valueLabel={(v) => share(v)}
      tooltip={(i) => ({
        title: data.callLength[i].label,
        lines: [`${fmtInt(data.callLength[i].count)} calls · ${share(data.callLength[i].count)}`, ...(i === 0 ? ['Usually a voicemail greeting or a wrong number'] : [])],
      })}
    />
  );
}

// ── Calls ───────────────────────────────────────────────────────────────

const callCols: Col[] = [
  count('callsOut', 'Calls out', { better: 'up' }),
  count('uniqueDialled', 'Unique numbers', { better: 'up' }),
  count('connected', 'Connected (in + out)', { bar: true, better: 'up' }),
  secs('avgTalkSec', 'Avg length', fmtClockDuration, { better: 'up' }),
  secs('medianTalkSec', 'Median', fmtClockDuration, { better: 'up' }),
  count('shortCalls', 'Calls <10s', { better: 'down' }),
  shortShare,
  count('conversations', 'Over 2 min', { better: 'up' }),
  secs('talkSec', 'Talk time', fmtTalk, { better: 'up', csv: (v) => (v == null ? '' : Math.round(v / 60)) }),
  count('activeDays', 'Active days', { better: 'up' }),
  { key: 'firstCallMin', label: 'First call', value: (r) => r.firstCallMin ?? null, fmt: (v) => fmtTimeOfDay(v), csv: (v) => fmtTimeOfDay(v) },
  { key: 'lastCallMin', label: 'Last call', value: (r) => r.lastCallMin ?? null, fmt: (v) => fmtTimeOfDay(v), csv: (v) => fmtTimeOfDay(v) },
];

function Calls(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  const idle = p.person ? [] : p.data.people.filter((r) => r.isActive && r.callsOut + r.callsIn + r.smsSent === 0);
  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="Unique numbers dialled" value={fmtInt(t.uniqueDialled)} cur={t.uniqueDialled} prev={pv.uniqueDialled}
          sub={`from ${fmtInt(t.callsOut)} outbound calls · ${fmtInt(t.uniqueConnected)} picked up`}
          onOpen={drillTo(p, 'Unique numbers dialled', fmtInt(t.uniqueDialled), count('uniqueDialled', 'Unique numbers'), { calls: isOut, note: 'Different phone numbers each person dialled. Team-wide, a number two people dialled counts once, so these add up to more than the team total.' })} />
        <Kpi label="Connected calls" value={fmtInt(t.connected)} cur={t.connected} prev={pv.connected} 
          onOpen={drillTo(p, 'Connected calls', fmtInt(t.connected), allConnected, { calls: isConnected, additive: true, daily: perDay((d) => d.connected + d.answeredIn) })} />
        <Kpi label="Average length" value={fmtClockDuration(t.avgTalkSec)} cur={t.avgTalkSec} prev={pv.avgTalkSec} sub={`Median ${fmtClockDuration(t.medianTalkSec)}`} 
          onOpen={drillTo(p, 'Average call length', fmtClockDuration(t.avgTalkSec), avgLenCol, { calls: isConnected })} />
        <Kpi label="Calls under 10 seconds" value={fmtPct(t.shortCalls, t.connected)} points cur={pct(t.shortCalls, t.connected)} prev={pct(pv.shortCalls, pv.connected)} better="down"
          sub={`${fmtInt(t.shortCalls)} calls`} 
          onOpen={drillTo(p, 'Calls under 10 seconds', fmtPct(t.shortCalls, t.connected), shortShare, { calls: (c) => c.answered && c.talkSec < 10, note: 'Share of each person\'s connected calls. People with fewer than 20 connected calls are left out.' })} />
        <Kpi label="Conversations over 2 min" value={fmtInt(t.conversations)} cur={t.conversations} prev={pv.conversations}
          sub={`${fmtPct(t.conversations, t.connected)} of connected`} 
          onOpen={drillTo(p, 'Conversations over 2 minutes', fmtInt(t.conversations), count('conversations', 'Over 2 min'), { calls: (c) => c.answered && c.talkSec >= 120, additive: true })} />
        <Kpi label="Typical day" value={fmtTimeOfDay(t.firstCallMin)} sub={`to ${fmtTimeOfDay(t.lastCallMin)} · median first and last call`} 
          onOpen={drillTo(p, 'First call of the day', fmtTimeOfDay(t.firstCallMin), callCols.find((c) => c.key === 'firstCallMin')!, { note: 'Median time of each person\'s first call, Eastern time.' })} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel title="Call length distribution" sub="Connected calls by talk time. Orange marks the shortest bucket" span={7}>
          <CallLengthChart data={p.data} />
        </Panel>
        <Panel title="Longest conversations" sub="Top connected calls in this period" span={5} flush>
          <List
            head={['Person', 'Number', 'Length', 'When']}
            empty="No connected calls."
            rows={p.data.longestCalls.map((c) => [
              personCell(p, c.userId),
              c.lastFour ? `•••• ${c.lastFour}` : dash,
              fmtClockDuration(c.talkSec),
              fmtDateTime(c.startedAt),
            ])}
          />
        </Panel>
        <ActivityHeatmap data={p.data} />
        <Scope p={p} cols={callCols} defaultSort="shortShare" title="Call length by person"
          sub="Sorted by share of calls under 10 seconds. Select a column to re-sort" />
        {idle.length > 0 && (
          <Panel title="Accounts with no activity" sub="Active accounts with no calls or texts in this period" flush>
            <List head={['Person', 'Email']} empty="" rows={idle.map((r) => [personCell(p, r.userId), r.email])} />
          </Panel>
        )}
      </div>
    </>
  );
}

// ── Responsiveness (missed calls + voicemail) ───────────────────────────

const respCols: Col[] = [
  { key: 'inboundTotal', label: 'Inbound', value: (r) => r.answeredIn + r.unansweredIn, fmt: (v) => (v == null ? dash : fmtInt(v)), bar: true },
  count('answeredIn', 'Answered', { better: 'up' }),
  answerRate,
  count('unansweredIn', 'Unanswered', { better: 'down' }),
  count('declinedIn', 'Declined', { better: 'down' }),
  count('missedReturned', 'Called back', { better: 'up' }),
  returnRate,
  secs('medianCallbackSec', 'Median wait', fmtWait, { better: 'down' }),
  count('voicemails', 'Voicemails'),
  ratio('heardRate', 'Heard', (r) => r.voicemailsHeard, (r) => r.voicemails, { better: 'up' }),
  secs('medianListenSec', 'Time to listen', fmtWait, { better: 'down' }),
];

function Responsiveness(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  const ib = p.data.inbound;
  const hours = ib.byHour.filter((h) => h.hour >= 7 && h.hour <= 20);
  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Inbound calls" value={fmtInt(ib.total)} cur={t.answeredIn + t.unansweredIn} prev={pv.answeredIn + pv.unansweredIn} better="none"
          sub={ib.blocked ? `${fmtInt(ib.blocked)} blocked, not counted` : 'Blocked callers excluded'} 
          onOpen={drillTo(p, 'Inbound calls', fmtInt(ib.total), inboundTotal, { calls: (c) => isIn(c) && c.outcome !== 'blocked', additive: true, daily: perDay((d) => d.inbound) })} />
        <Kpi label="Answered" value={fmtPct(ib.answered, ib.total)} points cur={pct(t.answeredIn, t.answeredIn + t.unansweredIn)} prev={pct(pv.answeredIn, pv.answeredIn + pv.unansweredIn)}
          sub={`${fmtInt(ib.answered)} calls`} 
          onOpen={drillTo(p, 'Inbound calls answered', fmtPct(ib.answered, ib.total), answerRate, { calls: (c) => isIn(c) && c.outcome !== 'blocked', note: 'People with fewer than 10 inbound calls are left out of the ranking.', daily: dayRate((d) => d.answeredIn, (d) => d.inbound) })} />
        <Kpi label="Returned within 24h" value={fmtPct(t.missedReturned, t.missedReturnable)} points cur={pct(t.missedReturned, t.missedReturnable)} prev={pct(pv.missedReturned, pv.missedReturnable)}
          sub={`${fmtInt(t.missedReturned)} of ${fmtInt(t.missedReturnable)} missed`} 
          onOpen={drillTo(p, 'Missed calls returned within 24h', fmtPct(t.missedReturned, t.missedReturnable), returnRate, { calls: isUnanswered })} />
        <Kpi label="Median wait for a callback" value={fmtWait(t.medianCallbackSec)} sub="When the call was returned" 
          onOpen={drillTo(p, 'Median wait for a callback', fmtWait(t.medianCallbackSec), secs('medianCallbackSec', 'Median wait', fmtWait), { calls: isUnanswered })} />
        <Kpi label="Voicemails heard" value={fmtPct(t.voicemailsHeard, t.voicemails)} points cur={pct(t.voicemailsHeard, t.voicemails)} prev={pct(pv.voicemailsHeard, pv.voicemails)}
          sub={`${fmtInt(t.voicemails - t.voicemailsHeard)} still unheard`} 
          onOpen={drillTo(p, 'Voicemails heard', fmtPct(t.voicemailsHeard, t.voicemails), heardRate)} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel title="What happened to inbound calls" sub="Every inbound call, by outcome" span={5}>
          <BarList
            format={fmtInt}
            items={[
              { label: 'Answered', value: ib.answered, color: 'var(--rp-good)', onClick: outcome(p, 'Inbound calls answered', ib.answered, 'answeredIn') },
              { label: 'Caller hung up while it rang', value: ib.callerHungUp, color: S2, onClick: outcome(p, 'Caller hung up while it rang', ib.callerHungUp, 'callerHungUpIn') },
              { label: 'Rang out (usually to voicemail)', value: ib.rangOut, color: S2, onClick: outcome(p, 'Rang out', ib.rangOut, 'rangOutIn') },
              { label: 'Declined or busy', value: ib.declined, color: S2, onClick: outcome(p, 'Declined or busy', ib.declined, 'declinedIn') },
              ...(ib.other ? [{ label: 'Other', value: ib.other, color: 'var(--rp-muted-bar)' }] : []),
            ]}
          />
          <p className="rp-footnote">{fmtInt(ib.wentToVoicemail)} unanswered calls left a voicemail.</p>
        </Panel>
        <Panel title="Unanswered calls by hour" sub="Inbound calls, Eastern time" span={7}
          right={<Legend items={[{ name: 'Answered', color: S1 }, { name: 'Unanswered', color: S2 }]} />}>
          <StackedColumns
            data={hours.map((h) => ({ label: fmtHour(h.hour), values: [h.total - h.unanswered, h.unanswered] }))}
            series={[{ key: 'a', name: 'Answered', color: S1 }, { key: 'u', name: 'Unanswered', color: S2 }]}
            labelEvery={1}
            tooltip={(i) => ({
              title: `${fmtHour(hours[i].hour)}–${fmtHour(hours[i].hour + 1)}`,
              lines: [`${fmtInt(hours[i].total)} calls`, `${fmtInt(hours[i].unanswered)} unanswered (${fmtPct(hours[i].unanswered, hours[i].total)})`],
            })}
          />
        </Panel>
        <Scope p={p} cols={respCols} defaultSort="unansweredIn" title="Missed calls and voicemail by person"
          sub="Returned means an outbound call to the same number within 24 hours" />
        <Panel title="Callers who never got through" sub="Called two or more times, never answered or called back in this period" flush>
          <List
            head={['Caller', 'Trying to reach', 'Attempts', 'Last attempt']}
            empty="Nobody called repeatedly without getting through."
            rows={ib.repeatUnreached.map((u) => [
              <button key="n" type="button" className="rp-link" onClick={() => p.openContact(u.number)}>{formatPhone(u.number)}</button>,
              personCell(p, u.userId), fmtInt(u.attempts), fmtDateTime(u.lastAt),
            ])}
          />
        </Panel>
      </div>
    </>
  );
}

// ── Messaging (SMS + scheduled + campaigns) ─────────────────────────────

const smsCols: Col[] = [
  count('smsSent', 'Sent', { bar: true, better: 'up' }),
  count('smsReceived', 'Received'),
  ratio('deliveredRate', 'Delivered', (r) => r.smsDelivered, (r) => r.smsSent, { better: 'up' }),
  count('smsFailed', 'Failed', { better: 'down', flag: (v, r) => (v && r.smsSent && v / r.smsSent >= 0.05 ? 'crit' : null) }),
  replyRate,
  secs('medianReplySec', 'Median reply', fmtWait, { better: 'down' }),
  count('threads', 'Conversations'),
  count('mms', 'Pictures'),
  count('segments', 'Billed parts'),
];

const schedCols: Col[] = [
  count('scheduledTotal', 'Scheduled', { bar: true }),
  count('scheduledPending', 'Waiting'),
  count('scheduledSent', 'Sent'),
  count('scheduledFailed', 'Failed', { better: 'down' }),
  count('scheduledCanceled', 'Canceled'),
  count('campaigns', 'Bulk sends'),
];

function Messaging(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  const schedPeople = p.data.people.filter((r) => r.scheduledTotal > 0 || r.campaigns > 0);
  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Texts sent" value={fmtInt(t.smsSent)} cur={t.smsSent} prev={pv.smsSent} spark={p.data.daily.map((d) => d.smsSent)} sub={`${fmtInt(t.smsReceived)} received`} 
          onOpen={drillTo(p, 'Texts sent', fmtInt(t.smsSent), count('smsSent', 'Texts sent'), { texts: sentText, additive: true, daily: perDay((d) => d.smsSent) })} />
        <Kpi label="Delivered" value={fmtPct(t.smsDelivered, t.smsSent, 1)} sub={`${fmtInt(t.smsFailed)} failed`} 
          onOpen={drillTo(p, 'Texts delivered', fmtPct(t.smsDelivered, t.smsSent, 1), deliveredRate, { texts: sentText })} />
        <Kpi label="Replied within 24h" value={fmtPct(t.smsReplied, t.smsRepliable)} points cur={pct(t.smsReplied, t.smsRepliable)} prev={pct(pv.smsReplied, pv.smsRepliable)}
          sub={`median ${fmtWait(t.medianReplySec)}`} 
          onOpen={drillTo(p, 'Texts replied to within 24h', fmtPct(t.smsReplied, t.smsRepliable), replyRate, { texts: receivedText })} />
        <Kpi label="Conversations" value={fmtInt(t.threads)} sub={`${fmtInt(t.mms)} picture messages`} 
          onOpen={drillTo(p, 'Text conversations', fmtInt(t.threads), count('threads', 'Conversations'), { texts: anyText, additive: true })} />
        {p.data.scope.isAdmin && <Kpi label="Billed message parts" value={fmtInt(t.segments)} sub="Estimated from length and characters" 
          onOpen={drillTo(p, 'Billed message parts', fmtInt(t.segments), count('segments', 'Billed parts'), { texts: sentText, additive: true })} />}
      </KpiGrid>
      <div className="rp-grid">
        <Panel title="Texts per day" sub="Eastern time" span={8}
          right={<Legend items={[{ name: 'Sent', color: S1 }, { name: 'Received', color: S2 }]} />}>
          <StackedColumns
            data={p.data.daily.map((d) => ({ label: fmtDay(d.date), values: [d.smsSent, d.smsReceived] }))}
            series={[{ key: 's', name: 'Sent', color: S1 }, { key: 'r', name: 'Received', color: S2 }]}
            onSelect={p.data.daily.length > 1 ? (i) => p.openDay(p.data.daily[i].date) : undefined}
            tooltip={(i) => ({ title: fmtDay(p.data.daily[i].date), lines: [`Sent ${fmtInt(p.data.daily[i].smsSent)}`, `Received ${fmtInt(p.data.daily[i].smsReceived)}`] })}
          />
        </Panel>
        <Panel title="Why texts failed" sub="Carrier reason for each failed text" span={4}>
          {p.data.sms.failureReasons.length === 0 ? <Empty>No failed texts.</Empty> : (
            <BarList format={fmtInt} color="var(--rp-crit)"
              items={p.data.sms.failureReasons.slice(0, 6).map((f) => ({ label: f.title, value: f.count, hint: `Carrier code ${f.code}` }))} />
          )}
        </Panel>
        <Scope p={p} cols={p.data.scope.isAdmin ? smsCols : smsCols.filter((c) => c.key !== 'segments')} defaultSort="smsSent" title="Texting by person"
          sub="A reply counts once per incoming run of texts" delta={{ key: 'smsSent', label: 'Sent vs prior' }} />
        {(p.person ? p.person.scheduledTotal + p.person.campaigns > 0 : schedPeople.length > 0) ? (
          p.person
            ? <Scope p={p} cols={schedCols} defaultSort="scheduledTotal" title="Scheduled texts" sub="" />
            : (
              <Panel title="Scheduled texts by person" sub="Texts set to send later, by what happened to them" flush>
                <PeopleTable rows={schedPeople} cols={schedCols} defaultSort="scheduledTotal" onOpen={p.open} />
              </Panel>
            )
        ) : (
          <Panel title="Scheduled texts" sub="Texts set to send later"><Empty>No texts were scheduled in this period.</Empty></Panel>
        )}
        <Panel title="Waiting to send" sub="Scheduled texts that haven't gone out yet" span={6} flush>
          <List
            head={['Person', 'To', 'Sends']}
            empty="Nothing is waiting to send."
            rows={p.data.scheduledUpcoming.map((s) => [personCell(p, s.userId), formatPhone(s.toNumber), fmtDateTime(s.scheduledFor)])}
          />
        </Panel>
        <Panel title="Bulk sends" sub="Texts sent to several favorites at once" span={6} flush>
          <List
            head={['Person', 'Started', 'Recipients', 'Sent', 'Failed', 'Skipped']}
            empty="No bulk sends in this period."
            rows={p.data.campaigns.map((c) => [
              personCell(p, c.userId), fmtDateTime(c.createdAt), fmtInt(c.total), fmtInt(c.sent),
              c.failed ? <span className="rp-pill rp-pill-crit">{fmtInt(c.failed)}</span> : '0', fmtInt(c.skipped),
            ])}
          />
        </Panel>
      </div>
    </>
  );
}

// ── Quality (failed + dropped calls) ────────────────────────────────────

const END_REASON_LABELS: Record<string, string> = {
  terminated: 'Hung up normally',
  normal_clearing: 'Hung up normally',
  canceled: 'Canceled',
  originator_cancel: 'Canceled',
  'connection error': 'Connection lost',
  'request timeout': 'Network timeout',
  'rtp timeout': 'Audio stopped arriving',
  'internal error': 'App error',
  state_desync: 'App error',
  unspecified: 'Ended by the network',
  busy: 'Busy',
  user_busy: 'Busy',
  rejected: 'Rejected',
  'not found': 'Number not found',
  unknown: 'Not recorded',
};
const endLabel = (r: string) => END_REASON_LABELS[r.toLowerCase()] ?? r;

const qualityCols: Col[] = [
  count('callsOut', 'Calls out', { bar: true }),
  ratio('connectRate', 'Connected', (r) => r.connectedOut, (r) => r.callsOut, { better: 'up' }),
  count('failedDials', 'Failed dials', { better: 'down' }),
  count('invalidNumbers', 'Bad numbers', { better: 'down' }),
  count('busyOut', 'Busy', { better: 'down' }),
  count('likelyDrops', 'Likely drops', { better: 'down' }),
  dropShare,
  count('confirmedDrops', 'Confirmed drops', { better: 'down' }),
  { key: 'silentCalls', label: 'No audio', value: (r) => (r.audioMeasured ? r.silentCalls : null), fmt: (v, r) => (v == null ? dash : `${fmtInt(v)} of ${fmtInt(r.audioMeasured)}`), csv: (v) => v, better: 'down', flag: (v) => (v ? 'crit' : null) },
  { key: 'poorQuality', label: 'Poor audio', value: (r) => (r.qualityMeasured ? r.poorQuality : null), fmt: (v, r) => (v == null ? dash : `${fmtInt(v)} of ${fmtInt(r.qualityMeasured)}`), csv: (v) => v, better: 'down' },
];

function Quality(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  const ob = p.data.outbound;
  const merged = new Map<string, number>();
  for (const r of p.data.quality.endReasons) merged.set(endLabel(r.reason), (merged.get(endLabel(r.reason)) ?? 0) + r.count);
  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="Outbound connected" value={fmtPct(ob.connected, ob.total)} sub={`${fmtInt(ob.connected)} of ${fmtInt(ob.total)}`} 
          onOpen={drillTo(p, 'Outbound calls connected', fmtPct(ob.connected, ob.total), connectRate, { calls: isOut })} />
        <Kpi label="Failed dials" value={fmtInt(t.failedDials)} cur={t.failedDials} prev={null} better="down" sub={`${fmtInt(t.invalidNumbers)} to bad numbers`} 
          onOpen={drillTo(p, 'Failed dials', fmtInt(t.failedDials), count('failedDials', 'Failed dials'), { calls: isFailedDial, additive: true })} />
        <Kpi label="Likely drops" value={fmtPct(t.likelyDrops, t.connected, 1)} points cur={pct(t.likelyDrops, t.connected)} prev={pct(pv.likelyDrops, pv.connected)} better="down"
          sub={`${fmtInt(t.likelyDrops)} redialed within 2 min`} 
          onOpen={drillTo(p, 'Likely drop rate', fmtPct(t.likelyDrops, t.connected, 1), dropShare, { note: 'Same number called again within 2 minutes of a call that lasted 10 seconds or more. An estimate. People with fewer than 20 connected calls are left out.' })} />
        <Kpi label="Connected, no audio" value={t.audioMeasured ? fmtInt(t.silentCalls) : dash}
          sub={t.audioMeasured ? `of ${fmtInt(t.audioMeasured)} measured calls: the other side's audio never arrived` : 'Measured from app 0.10.232'}
          onOpen={t.audioMeasured ? drillTo(p, 'Connected, but no audio', fmtInt(t.silentCalls), count('silentCalls', 'No audio'), { additive: true, calls: (c) => c.noAudio }) : undefined} />
        <Kpi label="Confirmed drops" value={fmtInt(t.confirmedDrops)} cur={t.confirmedDrops} prev={pv.confirmedDrops} better="down" sub="Ended by a network fault" 
          onOpen={drillTo(p, 'Confirmed drops', fmtInt(t.confirmedDrops), count('confirmedDrops', 'Confirmed drops'), { additive: true })} />
        <Kpi label="Poor audio" value={t.qualityMeasured ? fmtPct(t.poorQuality, t.qualityMeasured) : dash}
          sub={t.qualityMeasured ? `of ${fmtInt(t.qualityMeasured)} measured calls` : 'Measured from app 0.10.232'} 
          onOpen={drillTo(p, 'Calls with poor audio', fmtInt(t.poorQuality), count('poorQuality', 'Poor audio'), { additive: true })} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel title="What happened to outbound calls" sub="Every call placed, by outcome" span={6}>
          <BarList
            format={fmtInt}
            items={[
              { label: 'Connected', value: ob.connected, color: 'var(--rp-good)', onClick: outcome(p, 'Outbound calls connected', ob.connected, 'connectedOut') },
              { label: 'No answer', value: ob.noAnswer, color: S2, onClick: outcome(p, 'Outbound calls not answered', ob.noAnswer, 'noAnswerOut') },
              { label: 'Number not found', value: ob.invalidNumber, color: 'var(--rp-crit)', hint: 'Usually a bad number on the candidate record', onClick: outcome(p, 'Calls to numbers not found', ob.invalidNumber, 'invalidNumbers') },
              { label: 'Busy', value: ob.busy, color: S2, onClick: outcome(p, 'Calls that got a busy signal', ob.busy, 'busyOut') },
              { label: 'Rejected by the other side', value: ob.rejected, color: S2, onClick: outcome(p, 'Calls rejected by the other side', ob.rejected, 'rejectedOut') },
              { label: 'Failed', value: ob.failed, color: 'var(--rp-crit)', onClick: outcome(p, 'Calls that failed', ob.failed, 'otherFailedOut') },
            ]}
          />
        </Panel>
        <Panel title="How connected calls ended" sub="End reason recorded for each connected call" span={6}>
          {merged.size === 0 ? <Empty>No connected calls.</Empty> : (
            <BarList format={fmtInt} items={[...merged.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
          )}
        </Panel>
        <Scope p={p} cols={qualityCols} defaultSort="dropShare" title="Call quality by person"
          sub="A likely drop is the same number called again within 2 minutes of a call that lasted 10 seconds or more. It's an estimate" />
      </div>
      <p className="rp-footnote rp-footnote-block">
        Confirmed drops and audio quality come from the app. Calls made on versions before 0.10.232 show here as hung up normally, so these figures grow as people update.
      </p>
    </>
  );
}

// ── Outreach ────────────────────────────────────────────────────────────

const outreachCols: Col[] = [
  count('uniqueDialled', 'Unique numbers', { better: 'up' }),
  count('uniqueReached', 'People reached', { bar: true, better: 'up' }),
  count('newContacts', 'New contacts', { better: 'up' }),
  count('conversations', 'Over 2 min', { better: 'up' }),
  count('multiTouch', 'Call and text', { better: 'up' }),
  count('favoritesAdded', 'Saved', { better: 'up' }),
  count('callsOut', 'Calls out'),
  count('smsSent', 'Texts sent'),
];

function Outreach(p: TabProps) {
  const t = p.data.totals;
  const pv = p.data.prevTotals;
  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="People reached" value={fmtInt(t.uniqueReached)} cur={t.uniqueReached} prev={pv.uniqueReached} sub="Connected call or text, counted once" 
          onOpen={drillTo(p, 'People reached', fmtInt(t.uniqueReached), count('uniqueReached', 'People reached'), { note: 'Two recruiters reaching the same person each count it, so these add up to more than the team total.' })} />
        <Kpi label="New contacts" value={fmtInt(t.newContacts)} sub={`Not contacted in the previous ${p.data.range.days} days`} 
          onOpen={drillTo(p, 'New contacts', fmtInt(t.newContacts), count('newContacts', 'New contacts'))} />
        <Kpi label="Conversations over 2 min" value={fmtInt(t.conversations)} cur={t.conversations} prev={pv.conversations} 
          onOpen={drillTo(p, 'Conversations over 2 minutes', fmtInt(t.conversations), count('conversations', 'Over 2 min'), { calls: (c) => c.answered && c.talkSec >= 120, additive: true })} />
        <Kpi label="Reached by call and text" value={fmtInt(t.multiTouch)} sub={`${fmtPct(t.multiTouch, t.uniqueReached)} of people reached`} 
          onOpen={drillTo(p, 'Reached by call and text', fmtInt(t.multiTouch), count('multiTouch', 'Call and text'), { additive: true })} />
        <Kpi label="Contacts saved" value={fmtInt(t.favoritesAdded)} sub="Added to favorites" 
          onOpen={drillTo(p, 'Contacts saved', fmtInt(t.favoritesAdded), count('favoritesAdded', 'Saved'), { additive: true })} />
      </KpiGrid>
      <div className="rp-grid">
        <Scope p={p} cols={outreachCols} defaultSort="uniqueReached" title="Outreach by person"
          sub="Team totals count a person once, even when two people reached them" delta={{ key: 'uniqueReached', label: 'Reach vs prior' }} />
      </div>
    </>
  );
}

// ── Cost ────────────────────────────────────────────────────────────────

const costCols: Col[] = [
  count('billedMinutes', 'Billed minutes', { bar: true }),
  money('costVoice', 'Calls'),
  money('costSms', 'Texts'),
  money('cost', 'Total', { better: 'down' }),
];

function Cost(p: TabProps) {
  const cost = p.data.cost;
  if (!cost) return <Empty>Spend is only shown to admins.</Empty>;
  const c = cost;
  const pr = c.pricing;
  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Total spend" value={fmtMoney(c.total)} cur={c.total} prev={p.data.prevTotals.cost || null} better="none" sub={`${p.data.range.days} days`} 
          onOpen={drillTo(p, 'Spend on calls and texts', fmtMoney(c.voice + c.sms), money('cost', 'Spend'), { additive: true, note: 'Phone line rental isn\'t split by person.' })} />
        <Kpi label="Calls" value={fmtMoney(c.voice)} sub={`${fmtInt(p.data.totals.billedMinutes)} billed minutes`} 
          onOpen={drillTo(p, 'Spend on calls', fmtMoney(c.voice), money('costVoice', 'Calls'), { calls: isConnected, additive: true })} />
        <Kpi label="Texts" value={fmtMoney(c.sms)} sub={`${fmtInt(p.data.totals.segments)} parts sent`} 
          onOpen={drillTo(p, 'Spend on texts', fmtMoney(c.sms), money('costSms', 'Texts'), { texts: anyText, additive: true })} />
        <Kpi label="Phone lines" value={fmtMoney(c.lines)} sub={`${fmtInt(c.ownedLines)} lines`} />
        <Kpi label="Projected monthly" value={fmtMoney(c.projectedMonthly)} sub="At this period's pace" />
      </KpiGrid>
      <div className="rp-grid">
        <Scope p={p} cols={costCols} defaultSort="cost" title="Spend by person" sub="Estimated from billed minutes and message parts" />
        <Panel title="Spend by phone line" sub="Connected minutes on each line" flush>
          <List
            head={['Line', 'Label', 'Person', 'Calls', 'Minutes', 'Cost']}
            empty="No calls on assigned lines."
            rows={c.byLine.slice(0, 50).map((l) => [
              formatPhone(l.didNumber), l.label, l.userId ? personCell(p, l.userId) : dash, fmtInt(l.calls), fmtInt(l.minutes), fmtMoney(l.cost),
            ])}
          />
        </Panel>
      </div>
      <p className="rp-footnote rp-footnote-block">
        Estimates at {fmtMoney(pr.outboundPerMin)}/min outbound, {fmtMoney(pr.inboundPerMin)}/min inbound, {fmtMoney(pr.perSms)} per message part and {fmtMoney(pr.didMonthly)} per line per month. Check the Telnyx invoice for exact charges.
      </p>
    </>
  );
}

// ── Adoption ────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = { 'electron-win': 'Windows app', 'electron-mac': 'Mac app', web: 'Web browser' };

function Adoption(p: TabProps) {
  const a = p.data.adoption;
  const withDevice = a.people.filter((x) => x.appVersion);
  const onLatest = withDevice.filter((x) => x.onLatest).length;
  const nPeople = a.people.length;
  const byId = new Map(a.people.map((x) => [x.userId, x]));
  const rows = [...a.people].sort((x, y) => Number(x.onLatest) - Number(y.onLatest) || (y.lastSeenAt ?? '').localeCompare(x.lastSeenAt ?? ''));
  const featureLabel = new Map(a.features.map((f) => [f.key, f.label]));
  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="On the latest version" value={fmtPct(onLatest, withDevice.length)} sub={`${fmtInt(onLatest)} of ${fmtInt(withDevice.length)} people · ${a.latestVersion ?? dash}`} />
        <Kpi label="Behind" value={fmtInt(withDevice.length - onLatest)} sub="People on an older version" />
        <Kpi label="Not seen in 30 days" value={fmtInt(nPeople - withDevice.length)} sub="No app open recently" />
        <Kpi label="Most used" value={PLATFORM_LABELS[a.platforms[0]?.platform ?? ''] ?? dash} sub={a.platforms[0] ? `${fmtInt(a.platforms[0].users)} people` : undefined} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel title="App versions" sub="Each person's most recent device" span={4}>
          <BarList format={fmtInt} items={a.versions.map((v) => ({ label: v.version === a.latestVersion ? `${v.version} (latest)` : v.version, value: v.users, color: v.version === a.latestVersion ? 'var(--rp-good)' : S1 }))} />
        </Panel>
        <Panel title="Where people use it" sub="Each person's most recent device" span={4}>
          <BarList format={fmtInt} items={a.platforms.map((x) => ({ label: PLATFORM_LABELS[x.platform] ?? x.platform, value: x.users }))} />
        </Panel>
        <Panel title="Feature use" sub={`People using each feature, of ${fmtInt(nPeople)}`} span={4}>
          <BarList format={(v) => `${fmtInt(v)} · ${fmtPct(v, nPeople)}`} items={a.features.map((f) => ({ label: f.label, value: f.users }))} />
        </Panel>
        <Panel title={p.person ? 'Device and features' : 'By person'} sub="Oldest version first" flush>
          <List
            head={['Person', 'Version', 'App', 'Last opened', 'Last sign-in', 'Features used']}
            empty="No devices seen."
            rows={rows.map((x) => [
              personCell(p, x.userId),
              x.appVersion ? <span className={`rp-pill ${x.onLatest ? 'rp-pill-good' : 'rp-pill-warn'}`}>{x.appVersion}</span> : dash,
              x.platform ? PLATFORM_LABELS[x.platform] ?? x.platform : dash,
              fmtAgo(x.lastSeenAt),
              fmtAgo(x.lastLoginAt),
              byId.get(x.userId)?.features.map((k) => featureLabel.get(k) ?? k).join(', ') || dash,
            ])}
          />
        </Panel>
      </div>
    </>
  );
}

// ── Registry ────────────────────────────────────────────────────────────

export const TABS: TabDef[] = [
  { key: 'overview', label: 'Overview', render: Overview, csv: { cols: overviewCols, filename: 'scorecard' } },
  { key: 'follow-ups', label: 'Follow-ups', render: FollowUps, csv: { cols: [], filename: 'follow-ups' } },
  { key: 'calls', label: 'Calls', render: Calls, csv: { cols: callCols, filename: 'calls' } },
  { key: 'responsiveness', label: 'Missed & voicemail', render: Responsiveness, csv: { cols: respCols, filename: 'missed-calls-voicemail' } },
  { key: 'messaging', label: 'Texts', render: Messaging, csv: { cols: [...smsCols, ...schedCols], filename: 'texts' } },
  { key: 'quality', label: 'Call quality', render: Quality, csv: { cols: qualityCols, filename: 'call-quality' } },
  { key: 'outreach', label: 'Outreach', render: Outreach, csv: { cols: outreachCols, filename: 'outreach' } },
  { key: 'insights', label: 'Insights', render: Insights, csv: { cols: [], filename: 'insights' }, adminOnly: true },
  { key: 'cost', label: 'Cost', render: Cost, csv: { cols: costCols, filename: 'cost' }, adminOnly: true },
  { key: 'adoption', label: 'Adoption', render: Adoption, csv: { cols: [], filename: 'adoption' } },
  { key: 'activity', label: 'Activity', render: Numbers, csv: { cols: [], filename: 'activity' }, personOnly: true },
];

export function csvFor(tab: TabDef, rows: PersonRow[]): { header: string[]; rows: Array<Array<string | number | null>> } {
  const cols = tab.csv.cols;
  return {
    header: ['Person', 'Email', ...cols.map((c) => c.label)],
    rows: rows.map((r) => [
      r.name,
      r.email,
      ...cols.map((c) => {
        const v = c.value(r);
        return c.csv ? c.csv(v, r) : v == null ? '' : Math.round(v * 100) / 100;
      }),
    ]),
  };
}

export { Person };
