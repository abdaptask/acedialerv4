// Numbers tab — one person's dialled and incoming numbers plus their full
// call log. Person scope only: the server sends callLog just for a single
// person, never for the team view.

import { useMemo, useState } from 'react';
import { PhoneIncoming, PhoneOutgoing, Search } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import { fmtClockDuration, fmtDateTime, fmtInt, fmtTalk } from './format';
import { Empty, Kpi, KpiGrid, Panel } from './parts';
import type { TabProps } from './tabs';
import type { CallLogEntry, CallLogNumber } from './types';

type Dir = 'all' | 'outbound' | 'inbound' | 'unanswered';
const PAGE = 200;

const OUTCOME_TONE: Record<string, 'good' | 'warn' | 'crit' | null> = {
  answered: 'good', connected: 'good',
  caller_hung_up: 'warn', rang_out: 'warn', declined: 'warn', no_answer: null, busy: null,
  invalid_number: 'crit', rejected: null, failed: 'crit', blocked: null, other: null,
};

const digits = (s: string) => s.replace(/\D/g, '');

function matches(q: string, number: string, name: string | null): boolean {
  if (!q) return true;
  const d = digits(q);
  if (d && digits(number).includes(d)) return true;
  return !!name && name.toLowerCase().includes(q.toLowerCase());
}

export function Numbers(p: TabProps) {
  const log = p.data.callLog;
  const [dir, setDir] = useState<Dir>('all');
  const [q, setQ] = useState('');
  const [numQ, setNumQ] = useState('');
  const [numSort, setNumSort] = useState<'total' | 'out' | 'in' | 'unanswered' | 'talkSec' | 'lastAt'>('total');
  const [shown, setShown] = useState(PAGE);

  const calls = useMemo(() => {
    if (!log) return [] as CallLogEntry[];
    return log.calls.filter((c) => {
      if (dir === 'outbound' && c.direction !== 'outbound') return false;
      if (dir === 'inbound' && c.direction !== 'inbound') return false;
      if (dir === 'unanswered' && (c.direction !== 'inbound' || c.answered || c.outcome === 'blocked')) return false;
      return matches(q, c.number, c.name);
    });
  }, [log, dir, q]);

  const numbers = useMemo(() => {
    if (!log) return [] as CallLogNumber[];
    const val = (n: CallLogNumber) => (numSort === 'total' ? n.out + n.in : numSort === 'lastAt' ? Date.parse(n.lastAt) : n[numSort]);
    return log.numbers.filter((n) => matches(numQ, n.number, n.name)).sort((a, b) => val(b) - val(a));
  }, [log, numQ, numSort]);

  if (!p.person || !log) return <Empty>Pick a person to see the numbers they called and that called them.</Empty>;

  const dialled = log.numbers.filter((n) => n.out > 0).length;
  const callers = log.numbers.filter((n) => n.in > 0).length;
  const out = log.calls.filter((c) => c.direction === 'outbound').length;
  const inn = log.calls.length - out;
  const unanswered = log.calls.filter((c) => c.direction === 'inbound' && !c.answered && c.outcome !== 'blocked').length;

  const openNumber = (n: CallLogNumber) => {
    setQ(digits(n.number).slice(-10) || n.number);
    setDir('all');
    setShown(PAGE);
    document.getElementById('rp-calllog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sortBtn = (key: typeof numSort, label: string) => (
    <button type="button" className={`rp-sort${numSort === key ? ' active' : ''}`} onClick={() => setNumSort(key)}>{label}</button>
  );

  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Numbers dialled" value={fmtInt(dialled)} sub={`${fmtInt(out)} outbound calls`} />
        <Kpi label="Numbers that called in" value={fmtInt(callers)} sub={`${fmtInt(inn)} inbound calls`} />
        <Kpi label="Different numbers" value={fmtInt(log.distinctNumbers)} sub="Called or called in" />
        <Kpi label="Unanswered inbound" value={fmtInt(unanswered)} sub="Select Unanswered below to list them" />
        <Kpi label="Saved contacts reached" value={fmtInt(log.numbers.filter((n) => n.name && n.connected > 0).length)} sub="Numbers with a name, connected" />
      </KpiGrid>
      <div className="rp-grid">
        <Panel
          title="By number"
          sub="Every number called or calling in. Select one to see its calls"
          right={<SearchBox id="rp-num-search" value={numQ} onChange={setNumQ} placeholder="Find a number or name" />}
          flush
        >
          {numbers.length === 0 ? <Empty>No numbers match.</Empty> : (
            <div className="rp-table-wrap rp-table-scroll">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Contact</th>
                    <th className="rp-r">{sortBtn('out', 'Dialled')}</th>
                    <th className="rp-r">{sortBtn('in', 'Called in')}</th>
                    <th className="rp-r">{sortBtn('total', 'Total')}</th>
                    <th className="rp-r">{sortBtn('unanswered', 'Unanswered')}</th>
                    <th className="rp-r">{sortBtn('talkSec', 'Talk time')}</th>
                    <th className="rp-r">{sortBtn('lastAt', 'Last call')}</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.slice(0, 500).map((n) => (
                    <tr key={n.number} onClick={() => openNumber(n)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openNumber(n); }}>
                      <td className="rp-num">{formatPhone(n.number)}</td>
                      <td className={n.name ? undefined : 'rp-muted'}>{n.name ?? 'Not saved'}</td>
                      <td className="rp-r rp-num">{fmtInt(n.out)}</td>
                      <td className="rp-r rp-num">{fmtInt(n.in)}</td>
                      <td className="rp-r rp-num">{fmtInt(n.out + n.in)}</td>
                      <td className="rp-r rp-num">{n.unanswered ? <span className="rp-pill rp-pill-warn">{fmtInt(n.unanswered)}</span> : '0'}</td>
                      <td className="rp-r rp-num">{n.talkSec ? fmtTalk(n.talkSec) : '—'}</td>
                      <td className="rp-r rp-num">{fmtDateTime(n.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {numbers.length > 500 && <p className="rp-footnote rp-pad">Showing the first 500 of {fmtInt(numbers.length)}. Search to find the rest, or export CSV.</p>}
        </Panel>

        <section id="rp-calllog" className="rp-panel rp-span-12 rp-flush">
          <header className="rp-panel-head">
            <div>
              <h3>Call log</h3>
              <p>{fmtInt(calls.length)} of {fmtInt(log.total)} calls{log.truncated ? ` (newest ${fmtInt(log.calls.length)} loaded)` : ''}, newest first, Eastern time</p>
            </div>
            <div className="rp-log-tools">
              <div className="rp-seg" role="group" aria-label="Direction">
                {([['all', 'All'], ['outbound', 'Dialled out'], ['inbound', 'Called in'], ['unanswered', 'Unanswered']] as Array<[Dir, string]>).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={dir === k} onClick={() => { setDir(k); setShown(PAGE); }}>{l}</button>
                ))}
              </div>
              <SearchBox id="rp-log-search" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Filter by number or name" />
            </div>
          </header>
          {calls.length === 0 ? <Empty>No calls match.</Empty> : (
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr><th>When</th><th>Direction</th><th>Number</th><th>Contact</th><th>Outcome</th><th className="rp-r">Talk time</th><th>Line</th></tr>
                </thead>
                <tbody>
                  {calls.slice(0, shown).map((c, i) => {
                    const tone = OUTCOME_TONE[c.outcome] ?? null;
                    return (
                      <tr key={`${c.startedAt}-${i}`} className="rp-static">
                        <td className="rp-num">{fmtDateTime(c.startedAt)}</td>
                        <td>
                          <span className="rp-dir">
                            {c.direction === 'outbound' ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />}
                            {c.direction === 'outbound' ? 'Dialled out' : 'Called in'}
                          </span>
                        </td>
                        <td className="rp-num">
                          <button type="button" className="rp-link" onClick={() => setQ(digits(c.number).slice(-10) || c.number)}>{formatPhone(c.number)}</button>
                        </td>
                        <td className={c.name ? undefined : 'rp-muted'}>{c.name ?? '—'}</td>
                        <td>{tone ? <span className={`rp-pill rp-pill-${tone}`}>{c.outcomeLabel}</span> : <span className="rp-muted">{c.outcomeLabel}</span>}</td>
                        <td className="rp-r rp-num">{c.answered ? fmtClockDuration(c.talkSec) : '—'}</td>
                        <td className="rp-muted">{c.line ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {calls.length > shown && (
            <div className="rp-more">
              <button type="button" className="rp-btn" onClick={() => setShown((s) => s + PAGE)}>
                Show {fmtInt(Math.min(PAGE, calls.length - shown))} more
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SearchBox({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="rp-search" htmlFor={id}>
      <Search size={15} aria-hidden="true" />
      <span className="rp-sr">{placeholder}</span>
      <input id={id} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
