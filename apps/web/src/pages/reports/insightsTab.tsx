// Insights — leadership view. Admin only (the tab is hidden otherwise).

import { formatPhone } from '../../lib/phone';
import { HeatLegend, Heatmap } from './charts';
import { fmtDateTime, fmtHour, fmtInt } from './format';
import { Empty, Kpi, KpiGrid, Panel, Person } from './parts';
import type { TabProps } from './tabs';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Movers need a real baseline, or someone going from 3 calls to 9 tops the list.
const MIN_BASELINE = 50;

export function Insights(p: TabProps) {
  const ins = p.data.insights;
  // A switchboard or client office can be dialled by a dozen people; four
  // names plus a count keeps the row readable.
  const names = (ids: number[]) => {
    const n = ids.map(p.nameOf);
    return n.length <= 4 ? n.join(', ') : `${n.slice(0, 4).join(', ')} and ${n.length - 4} more`;
  };

  // Best time: weekdays, working hours. Rate only where there's a sample.
  const hours = Array.from({ length: 12 }, (_, i) => 8 + i);
  const rate = (d: number, h: number) => {
    const c = ins.bestTime[d][h];
    return c.attempts >= ins.bestTimeMinAttempts ? c.reached / c.attempts : null;
  };
  const cells: Array<{ d: number; h: number; r: number; n: number }> = [];
  for (let d = 0; d < 5; d += 1) for (const h of hours) {
    const r = rate(d, h);
    if (r != null) cells.push({ d, h, r, n: ins.bestTime[d][h].attempts });
  }
  const best = [...cells].sort((a, b) => b.r - a.r).slice(0, 3);
  const worst = [...cells].sort((a, b) => a.r - b.r).slice(0, 2);
  const overall = (() => {
    let a = 0, r = 0;
    for (const row of ins.bestTime) for (const c of row) { a += c.attempts; r += c.reached; }
    return a ? r / a : null;
  })();

  const movers = p.data.people
    .filter((x) => x.prev && x.prev.callsOut >= MIN_BASELINE)
    .map((x) => ({ x, d: (x.callsOut - x.prev!.callsOut) / x.prev!.callsOut }))
    .sort((a, b) => a.d - b.d);
  const down = movers.slice(0, 5).filter((m) => m.d < -0.1);
  const up = movers.slice(-5).reverse().filter((m) => m.d > 0.1);

  const ot = ins.optOutTotals;
  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="Calls that reach someone" value={overall == null ? '—' : `${Math.round(overall * 100)}%`}
          sub="Outbound calls that connected for 30 seconds or more" />
        <Kpi label="Best time to call" value={best[0] ? `${DAYS[best[0].d]} ${fmtHour(best[0].h)}` : '—'}
          sub={best[0] ? `${Math.round(best[0].r * 100)}% reach someone` : 'Not enough calls yet'} />
        <Kpi label="Candidates contacted by 2+ people" value={fmtInt(ins.sharedContactsTotal)} sub="In this period, by call or text" />
        <Kpi label="Opt-outs" value={fmtInt(ot.optOuts)}
          sub={ot.withTextsAfter ? `${fmtInt(ot.withTextsAfter)} were texted afterwards` : 'Nobody was texted after opting out'} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel
          title="When candidates pick up"
          sub={`Share of outbound calls that reached someone (30s+), weekdays, Eastern time. Cells with fewer than ${ins.bestTimeMinAttempts} calls are left blank`}
          right={<HeatLegend maxLabel="Higher reach rate" />}
        >
          {cells.length === 0 ? <Empty>Not enough calls in this period.</Empty> : (
            <>
              <Heatmap
                grid={Array.from({ length: 5 }, (_, d) => hours.map((h) => Math.round((rate(d, h) ?? 0) * 1000)))}
                rowLabels={DAYS.slice(0, 5)}
                colLabels={hours.map(fmtHour)}
                cellTip={(r, c) => {
                  const cell = ins.bestTime[r][hours[c]];
                  const v = rate(r, hours[c]);
                  return {
                    title: `${DAYS[r]} ${fmtHour(hours[c])}–${fmtHour(hours[c] + 1)}`,
                    lines: v == null ? [`${fmtInt(cell.attempts)} calls, too few to rate`] : [`${Math.round(v * 100)}% reached someone`, `${fmtInt(cell.reached)} of ${fmtInt(cell.attempts)} calls`],
                  };
                }}
              />
              <p className="rp-footnote">
                Best: {best.map((b) => `${DAYS[b.d]} ${fmtHour(b.h)} (${Math.round(b.r * 100)}%)`).join(', ')}.
                {worst.length > 0 && <> Worst: {worst.map((b) => `${DAYS[b.d]} ${fmtHour(b.h)} (${Math.round(b.r * 100)}%)`).join(', ')}.</>}
              </p>
            </>
          )}
        </Panel>

        <Panel title="Biggest drops in calling" sub={`Calls out vs the previous ${p.data.range.days} days, people with at least ${MIN_BASELINE} calls before`} span={6} flush>
          {down.length === 0 ? <Empty>No large drops.</Empty> : (
            <MoverList rows={down} open={p.open} />
          )}
        </Panel>
        <Panel title="Biggest increases in calling" sub={`Calls out vs the previous ${p.data.range.days} days`} span={6} flush>
          {up.length === 0 ? <Empty>No large increases.</Empty> : (
            <MoverList rows={up} open={p.open} />
          )}
        </Panel>

        <Panel title="Candidates contacted by more than one person" sub={`${fmtInt(ins.sharedContactsTotal)} in this period. Worth checking nobody is stepping on a colleague’s candidate. Select one to see who did what`} flush>
          {ins.sharedContacts.length === 0 ? <Empty>No overlap in this period.</Empty> : (
            <div className="rp-table-wrap rp-table-scroll">
              <table className="rp-table">
                <thead><tr><th>Number</th><th>Contacted by</th><th className="rp-r">Calls</th><th className="rp-r">Texts</th><th className="rp-r">Last contact</th></tr></thead>
                <tbody>
                  {ins.sharedContacts.map((c) => (
                    <tr key={c.number} tabIndex={0} onClick={() => p.openContact(c.number)} onKeyDown={(e) => { if (e.key === 'Enter') p.openContact(c.number); }}>
                      <td className="rp-num">{formatPhone(c.number)}</td>
                      <td className="rp-wrap">{names(c.userIds)}</td>
                      <td className="rp-r rp-num">{fmtInt(c.calls)}</td>
                      <td className="rp-r rp-num">{fmtInt(c.texts)}</td>
                      <td className="rp-r rp-num">{fmtDateTime(c.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Opt-outs (STOP)" sub="People who texted STOP in this period, and whether anyone texted them again before they opted back in" span={6} flush>
          {ins.optOuts.length === 0 ? <Empty>No opt-outs in this period.</Empty> : (
            <div className="rp-table-wrap rp-table-scroll">
              <table className="rp-table">
                <thead><tr><th>Number</th><th>Person</th><th>Opted out</th><th className="rp-r">Texts after</th></tr></thead>
                <tbody>
                  {ins.optOuts.map((o, i) => (
                    <tr key={i} tabIndex={0} onClick={() => p.openContact(o.number)} onKeyDown={(e) => { if (e.key === 'Enter') p.openContact(o.number); }}>
                      <td className="rp-num">{formatPhone(o.number)}</td>
                      <td>{p.nameOf(o.userId)}</td>
                      <td className="rp-num">{fmtDateTime(o.at)}</td>
                      <td className="rp-r rp-num">{o.sentAfter ? <span className="rp-pill rp-pill-crit">{fmtInt(o.sentAfter)}</span> : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Numbers that keep failing" sub="Dialled two or more times and not found by the carrier. Usually a bad number on the candidate record" span={6} flush>
          {ins.badNumbers.length === 0 ? <Empty>None in this period.</Empty> : (
            <div className="rp-table-wrap rp-table-scroll">
              <table className="rp-table">
                <thead><tr><th>Number</th><th>Dialled by</th><th className="rp-r">Attempts</th><th className="rp-r">Last day</th></tr></thead>
                <tbody>
                  {ins.badNumbers.map((b) => (
                    <tr key={b.number} tabIndex={0} onClick={() => p.openContact(b.number)} onKeyDown={(e) => { if (e.key === 'Enter') p.openContact(b.number); }}>
                      <td className="rp-num">{formatPhone(b.number)}</td>
                      <td className="rp-wrap">{names(b.userIds)}</td>
                      <td className="rp-r rp-num">{fmtInt(b.attempts)}</td>
                      <td className="rp-r rp-num">{fmtDateTime(b.lastAt).replace(/,.*$/, '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <p className="rp-footnote rp-footnote-block">
        Opt-outs are found by reading short incoming texts on the server for STOP, UNSUBSCRIBE, CANCEL, END or QUIT, and START to opt back in. The text itself is never shown or sent to this page.
      </p>
    </>
  );
}

function MoverList({ rows, open }: { rows: Array<{ x: { userId: number; name: string; callsOut: number; prev: { callsOut: number } | null }; d: number }>; open: (id: number) => void }) {
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead><tr><th>Person</th><th className="rp-r">Before</th><th className="rp-r">Now</th><th className="rp-r">Change</th></tr></thead>
        <tbody>
          {rows.map(({ x, d }) => (
            <tr key={x.userId} tabIndex={0} onClick={() => open(x.userId)} onKeyDown={(e) => { if (e.key === 'Enter') open(x.userId); }}>
              <td><Person name={x.name} /></td>
              <td className="rp-r rp-num">{fmtInt(x.prev!.callsOut)}</td>
              <td className="rp-r rp-num">{fmtInt(x.callsOut)}</td>
              <td className="rp-r"><span className={`rp-delta ${d >= 0 ? 'good' : 'bad'}`}>{d >= 0 ? '+' : '−'}{Math.abs(Math.round(d * 100))}%</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
