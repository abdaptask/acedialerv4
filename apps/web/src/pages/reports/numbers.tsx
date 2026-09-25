// Activity tab — one person's calls and texts as individual records.
// Person scope only: the server sends callLog/textLog just for a single
// person, never for the team view. Texts are records (when, who, direction,
// delivery, billed parts); the message text is never sent to the browser.

import { useMemo, useState } from 'react';
import { PhoneIncoming, PhoneOutgoing, Search } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import { fmtClockDuration, fmtDateTime, fmtInt, fmtRange, fmtTalk } from './format';
import { Empty, Kpi, KpiGrid, Panel } from './parts';
import { Outcome, TimelineSheet, callTone, textKind, textTone } from './records';
import type { TabProps } from './tabs';
import type { CallLogEntry, CallLogNumber, TextLogEntry, TextThread } from './types';

type CallFilter = 'all' | 'outbound' | 'inbound' | 'unanswered';
type TextFilter = 'all' | 'outbound' | 'inbound' | 'failed' | 'awaiting';
const PAGE = 200;

const digits = (s: string) => s.replace(/\D/g, '');
const numbersLabel = (n: number) => `${fmtInt(n)} ${n === 1 ? 'number' : 'numbers'}`;

function matches(q: string, number: string, name: string | null): boolean {
  if (!q) return true;
  const d = digits(q);
  if (d && digits(number).includes(d)) return true;
  return !!name && name.toLowerCase().includes(q.toLowerCase());
}

export function Numbers(p: TabProps) {
  const [mode, setMode] = useState<'calls' | 'texts'>('calls');
  const [open, setOpen] = useState<{ number: string; name: string | null } | null>(null);
  const log = p.data.callLog;
  const texts = p.data.textLog;
  if (!p.person || !log || !texts) return <Empty>Pick a person to see each of their calls and texts.</Empty>;

  return (
    <>
      <div className="rp-mode">
        <div className="rp-seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={mode === 'calls'} onClick={() => setMode('calls')}>Calls · {fmtInt(log.total)}</button>
          <button type="button" aria-pressed={mode === 'texts'} onClick={() => setMode('texts')}>Texts · {fmtInt(texts.total)}</button>
        </div>
        <span className="rp-muted">Select any call, text or number to see the whole conversation with that number.</span>
      </div>
      {mode === 'calls'
        ? <CallsView p={p} onOpen={(number, name) => setOpen({ number, name })} />
        : <TextsView p={p} onOpen={(number, name) => setOpen({ number, name })} />}
      {open && (
        <TimelineSheet
          number={open.number}
          name={open.name}
          personName={p.person.name}
          rangeLabel={fmtRange(p.data.range.from, p.data.range.to)}
          calls={log.calls}
          texts={texts.messages}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

type Opener = (number: string, name: string | null) => void;

function CallsView({ p, onOpen }: { p: TabProps; onOpen: Opener }) {
  const log = p.data.callLog!;
  const [dir, setDir] = useState<CallFilter>('all');
  const [reason, setReason] = useState<string>('');
  const [q, setQ] = useState('');
  const [numQ, setNumQ] = useState('');
  const [numSort, setNumSort] = useState<'total' | 'out' | 'in' | 'unanswered' | 'talkSec' | 'lastAt'>('total');
  const [shown, setShown] = useState(PAGE);

  const calls = useMemo(() => log.calls.filter((c: CallLogEntry) => {
    if (dir === 'outbound' && c.direction !== 'outbound') return false;
    if (dir === 'inbound' && c.direction !== 'inbound') return false;
    if (dir === 'unanswered' && (c.direction !== 'inbound' || c.answered || c.outcome === 'blocked')) return false;
    if (reason && c.endReason !== reason) return false;
    return matches(q, c.number, c.name);
  }), [log, dir, q, reason]);
  // Reasons present in this log, most common first, for the filter.
  const reasons = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const c of log.calls) {
      const r = m.get(c.endReason) ?? { label: c.endLabel.replace(/ after \d+s$/, ''), n: 0 };
      r.n += 1;
      m.set(c.endReason, r);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [log]);
  const silent = log.calls.filter((c) => c.noAudio).length;

  const numbers = useMemo(() => {
    const val = (n: CallLogNumber) => (numSort === 'total' ? n.out + n.in : numSort === 'lastAt' ? Date.parse(n.lastAt) : n[numSort]);
    return log.numbers.filter((n) => matches(numQ, n.number, n.name)).sort((a, b) => val(b) - val(a));
  }, [log, numQ, numSort]);

  const out = log.calls.filter((c) => c.direction === 'outbound');
  const inn = log.calls.length - out.length;
  const connected = log.calls.filter((c) => c.answered).length;
  const unanswered = log.calls.filter((c) => c.direction === 'inbound' && !c.answered && c.outcome !== 'blocked').length;

  const sortBtn = (key: typeof numSort, label: string) => (
    <button type="button" className={`rp-sort${numSort === key ? ' active' : ''}`} onClick={() => setNumSort(key)}>{label}</button>
  );

  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Calls dialled out" value={fmtInt(out.length)} sub={`to ${numbersLabel(log.numbers.filter((n) => n.out > 0).length)}`} onOpen={() => { setDir('outbound'); setQ(''); }} />
        <Kpi label="Calls in" value={fmtInt(inn)} sub={`from ${numbersLabel(log.numbers.filter((n) => n.in > 0).length)}`} onOpen={() => { setDir('inbound'); setQ(''); }} />
        <Kpi label="Connected" value={fmtInt(connected)} sub={`${fmtTalk(log.calls.reduce((a, c) => a + c.talkSec, 0))} talk time`} />
        <Kpi label="Unanswered inbound" value={fmtInt(unanswered)} sub="Select to list them" onOpen={() => { setDir('unanswered'); setQ(''); }} />
        <Kpi label="Different numbers" value={fmtInt(log.distinctNumbers)} sub="Called or called in" />
      </KpiGrid>
      <div className="rp-grid">
        <section id="rp-calllog" className="rp-panel rp-span-12 rp-flush">
          <header className="rp-panel-head">
            <div>
              <h3>Every call</h3>
              <p>{fmtInt(calls.length)} of {fmtInt(log.total)} calls{log.truncated ? ` (newest ${fmtInt(log.calls.length)} loaded)` : ''}, newest first, Eastern time. Select a call to see the conversation</p>
            </div>
            <div className="rp-log-tools">
              <div className="rp-seg" role="group" aria-label="Direction">
                {([['all', 'All'], ['outbound', 'Dialled out'], ['inbound', 'Called in'], ['unanswered', 'Unanswered']] as Array<[CallFilter, string]>).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={dir === k} onClick={() => { setDir(k); setShown(PAGE); }}>{l}</button>
                ))}
              </div>
              <label className="rp-select">
                <span className="rp-sr">Why it ended</span>
                <select id="rp-reason" value={reason} onChange={(e) => { setReason(e.target.value); setShown(PAGE); }}>
                  <option value="">Any end reason</option>
                  {reasons.map(([k, r]) => <option key={k} value={k}>{r.label} ({r.n})</option>)}
                </select>
              </label>
              <SearchBox id="rp-log-search" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Filter by number or name" />
            </div>
          </header>
          {silent > 0 && (
            <p className="rp-alert">
              {silent} connected {silent === 1 ? 'call' : 'calls'} had no audio from the other side, which is what a caller hearing nothing looks like.{' '}
              <button type="button" className="rp-link" onClick={() => setReason('no_audio')}>Show them</button>
            </p>
          )}
          {calls.length === 0 ? <Empty>No calls match.</Empty> : (
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr><th>When</th><th>Direction</th><th>Number</th><th>Contact</th><th>Outcome</th><th>Why it ended</th><th className="rp-r">Rang</th><th className="rp-r">Talk time</th><th>Line</th></tr>
                </thead>
                <tbody>
                  {calls.slice(0, shown).map((c, i) => (
                    <tr key={`${c.startedAt}-${i}`} tabIndex={0} onClick={() => onOpen(c.number, c.name)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c.number, c.name); }}>
                      <td className="rp-num">{fmtDateTime(c.startedAt)}</td>
                      <td>
                        <span className="rp-dir">
                          {c.direction === 'outbound' ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />}
                          {c.direction === 'outbound' ? 'Dialled out' : 'Called in'}
                        </span>
                      </td>
                      <td className="rp-num">{formatPhone(c.number)}</td>
                      <td className={c.name ? undefined : 'rp-muted'}>{c.name ?? '—'}</td>
                      <td><Outcome label={c.outcomeLabel} tone={callTone(c)} /></td>
                      <td className={`rp-wrap rp-why${c.noAudio || c.endReason === 'dropped' ? ' bad' : ''}`}>{c.endLabel.replace(/ after \d+s$/, '')}</td>
                      <td className="rp-r rp-num">{c.ringSec ? `${c.ringSec}s` : '—'}</td>
                      <td className="rp-r rp-num">{c.answered ? fmtClockDuration(c.talkSec) : '—'}</td>
                      <td className="rp-muted">{c.line ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {calls.length > shown && (
            <div className="rp-more">
              <button type="button" className="rp-btn" onClick={() => setShown((s) => s + PAGE)}>Show {fmtInt(Math.min(PAGE, calls.length - shown))} more</button>
            </div>
          )}
        </section>

        <Panel
          title="By number"
          sub="Every number called or calling in. Select one to see the conversation"
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
                    <tr key={n.number} onClick={() => onOpen(n.number, n.name)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(n.number, n.name); }}>
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
      </div>
    </>
  );
}

function TextsView({ p, onOpen }: { p: TabProps; onOpen: Opener }) {
  const log = p.data.textLog!;
  const [filter, setFilter] = useState<TextFilter>('all');
  const [q, setQ] = useState('');
  const [threadQ, setThreadQ] = useState('');
  const [shown, setShown] = useState(PAGE);

  const awaiting = useMemo(() => new Set(log.threads.filter((t) => t.awaitingReply).map((t) => t.number)), [log]);
  const messages = useMemo(() => log.messages.filter((m: TextLogEntry) => {
    if (filter === 'outbound' && m.direction !== 'outbound') return false;
    if (filter === 'inbound' && m.direction !== 'inbound') return false;
    if (filter === 'failed' && m.status !== 'failed') return false;
    if (filter === 'awaiting' && !awaiting.has(m.number)) return false;
    return matches(q, m.number, m.name);
  }), [log, filter, q, awaiting]);
  const threads = useMemo(
    () => log.threads.filter((t: TextThread) => matches(threadQ, t.number, t.name)),
    [log, threadQ],
  );

  const sent = log.messages.filter((m) => m.direction === 'outbound').length;
  const failed = log.messages.filter((m) => m.status === 'failed').length;

  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="Texts sent" value={fmtInt(sent)} sub={`to ${numbersLabel(log.threads.filter((t) => t.sent > 0).length)}`} onOpen={() => { setFilter('outbound'); setQ(''); }} />
        <Kpi label="Texts received" value={fmtInt(log.total - sent)} sub={`from ${numbersLabel(log.threads.filter((t) => t.received > 0).length)}`} onOpen={() => { setFilter('inbound'); setQ(''); }} />
        <Kpi label="Conversations" value={fmtInt(log.threads.length)} sub="Different numbers texted" />
        <Kpi label="Waiting on a reply" value={fmtInt(awaiting.size)} sub="Their text was the last one" onOpen={() => { setFilter('awaiting'); setQ(''); }} />
        <Kpi label="Failed" value={fmtInt(failed)} sub="Not delivered by the carrier" onOpen={() => { setFilter('failed'); setQ(''); }} />
      </KpiGrid>
      <div className="rp-grid">
        <Panel
          title="Conversations"
          sub="One row per number. Select one to see the back-and-forth"
          right={<SearchBox id="rp-thread-search" value={threadQ} onChange={setThreadQ} placeholder="Find a number or name" />}
          flush
        >
          {threads.length === 0 ? <Empty>No conversations match.</Empty> : (
            <div className="rp-table-wrap rp-table-scroll">
              <table className="rp-table">
                <thead>
                  <tr><th>Number</th><th>Contact</th><th className="rp-r">Sent</th><th className="rp-r">Received</th><th className="rp-r">Failed</th><th>Status</th><th className="rp-r">Last text</th></tr>
                </thead>
                <tbody>
                  {threads.slice(0, 500).map((t) => (
                    <tr key={t.number} tabIndex={0} onClick={() => onOpen(t.number, t.name)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.number, t.name); }}>
                      <td className="rp-num">{formatPhone(t.number)}</td>
                      <td className={t.name ? undefined : 'rp-muted'}>{t.name ?? 'Not saved'}</td>
                      <td className="rp-r rp-num">{fmtInt(t.sent)}</td>
                      <td className="rp-r rp-num">{fmtInt(t.received)}</td>
                      <td className="rp-r rp-num">{t.failed ? <span className="rp-pill rp-pill-crit">{fmtInt(t.failed)}</span> : '0'}</td>
                      <td>{t.awaitingReply ? <span className="rp-pill rp-pill-warn">Waiting on reply</span> : <span className="rp-muted">{t.received ? 'Last text was ours' : 'No reply yet'}</span>}</td>
                      <td className="rp-r rp-num">{fmtDateTime(t.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <section className="rp-panel rp-span-12 rp-flush">
          <header className="rp-panel-head">
            <div>
              <h3>Every text</h3>
              <p>{fmtInt(messages.length)} of {fmtInt(log.total)} texts{log.truncated ? ` (newest ${fmtInt(log.messages.length)} loaded)` : ''}, newest first. Records only; message text is never shown</p>
            </div>
            <div className="rp-log-tools">
              <div className="rp-seg" role="group" aria-label="Filter texts">
                {([['all', 'All'], ['outbound', 'Sent'], ['inbound', 'Received'], ['awaiting', 'Waiting on reply'], ['failed', 'Failed']] as Array<[TextFilter, string]>).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}>{l}</button>
                ))}
              </div>
              <SearchBox id="rp-text-search" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Filter by number or name" />
            </div>
          </header>
          {messages.length === 0 ? <Empty>No texts match.</Empty> : (
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr><th>When</th><th>Direction</th><th>Number</th><th>Contact</th><th>Type</th><th>Status</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {messages.slice(0, shown).map((m, i) => (
                    <tr key={`${m.at}-${i}`} tabIndex={0} onClick={() => onOpen(m.number, m.name)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.number, m.name); }}>
                      <td className="rp-num">{fmtDateTime(m.at)}</td>
                      <td><span className="rp-dir">{m.direction === 'outbound' ? 'Sent' : 'Received'}</span></td>
                      <td className="rp-num">{formatPhone(m.number)}</td>
                      <td className={m.name ? undefined : 'rp-muted'}>{m.name ?? '—'}</td>
                      <td className="rp-muted">{textKind(m)}</td>
                      <td>
                        <Outcome label={m.statusLabel} tone={textTone(m)} />
                      </td>
                      <td className={`rp-wrap rp-why${m.status === 'failed' ? ' bad' : ''}`}>{m.status === 'delivered' || m.direction === 'inbound' ? (m.why ?? '—') : m.why}{m.errorCode ? <span className="rp-muted"> · code {m.errorCode}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {messages.length > shown && (
            <div className="rp-more">
              <button type="button" className="rp-btn" onClick={() => setShown((s) => s + PAGE)}>Show {fmtInt(Math.min(PAGE, messages.length - shown))} more</button>
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
