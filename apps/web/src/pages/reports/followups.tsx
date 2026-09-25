// Follow-ups — what's waiting on someone right now (last 14 days, live,
// independent of the date range picker): missed calls nobody returned,
// text conversations where the candidate's text was the last one, and
// voicemails with no callback. Oldest first, because oldest is most urgent.

import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, PhoneMissed, Voicemail } from 'lucide-react';
import { getReportFollowUps } from '../../api';
import { formatPhone } from '../../lib/phone';
import { fmtAgo, fmtDateTime, fmtInt } from './format';
import { Empty, Kpi, KpiGrid, Panel, Person } from './parts';
import type { TabProps } from './tabs';
import type { FollowUpItem, FollowUps as FollowUpsData } from './types';

type Kind = 'all' | FollowUpItem['kind'];
const PAGE = 200;

const KIND_LABEL: Record<FollowUpItem['kind'], string> = {
  missed_call: 'Missed call',
  text: 'Text waiting',
  voicemail: 'Voicemail',
};

export function FollowUps(p: TabProps) {
  const [data, setData] = useState<FollowUpsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [shown, setShown] = useState(PAGE);
  const userId = p.person?.userId ?? null;

  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    getReportFollowUps(sessionStorage.getItem('ace_token') ?? '', userId)
      .then((d) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [userId]);

  const items = useMemo(() => (data ? data.items.filter((i) => kind === 'all' || i.kind === kind) : []), [data, kind]);

  if (err) return <Empty>{err}</Empty>;
  if (!data) return <Empty>Loading follow-ups…</Empty>;

  const t = data.totals;
  const team = !p.person;
  return (
    <>
      <p className="rp-footnote rp-footnote-top">
        Live, for the last {data.days} days, whatever date range is picked above. An item clears as soon as someone calls or texts that number back.
      </p>
      <KpiGrid cols={4}>
        <Kpi label="Missed calls not returned" value={fmtInt(t.missedCalls)} sub="No call or text back since" onOpen={() => setKind('missed_call')} />
        <Kpi label="Texts waiting on a reply" value={fmtInt(t.texts)} sub="Their text was the last one" onOpen={() => setKind('text')} />
        <Kpi label="Voicemails not returned" value={fmtInt(t.voicemails)} sub="Not already counted as a missed call" onOpen={() => setKind('voicemail')} />
        <Kpi label="Oldest waiting" value={data.items[0] ? fmtAgo(data.items[0].since) : '—'} sub={data.items[0] ? `${data.items[0].personName} · ${KIND_LABEL[data.items[0].kind].toLowerCase()}` : 'Nothing waiting'} />
      </KpiGrid>
      <div className="rp-grid">
        {team && (
          <Panel title="By person" sub="Select a person to see their list" flush>
            {data.people.length === 0 ? <Empty>Nobody has anything waiting.</Empty> : (
              <div className="rp-table-wrap rp-table-scroll">
                <table className="rp-table">
                  <thead>
                    <tr><th>Person</th><th className="rp-r">Missed calls</th><th className="rp-r">Texts</th><th className="rp-r">Voicemails</th><th className="rp-r">Total</th><th className="rp-r">Oldest</th></tr>
                  </thead>
                  <tbody>
                    {data.people.map((r) => (
                      <tr key={r.userId} tabIndex={0} onClick={() => p.open(r.userId)} onKeyDown={(e) => { if (e.key === 'Enter') p.open(r.userId); }}>
                        <td><Person name={r.name} /></td>
                        <td className="rp-r rp-num">{fmtInt(r.missedCalls)}</td>
                        <td className="rp-r rp-num">{fmtInt(r.texts)}</td>
                        <td className="rp-r rp-num">{fmtInt(r.voicemails)}</td>
                        <td className="rp-r rp-num"><b>{fmtInt(r.missedCalls + r.texts + r.voicemails)}</b></td>
                        <td className="rp-r rp-num">{fmtAgo(r.oldest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
        <section className="rp-panel rp-span-12 rp-flush">
          <header className="rp-panel-head">
            <div>
              <h3>Waiting now</h3>
              <p>{fmtInt(items.length)} items, oldest first. Select one to see everything with that number</p>
            </div>
            <div className="rp-seg" role="group" aria-label="Show">
              {([['all', 'All'], ['missed_call', 'Missed calls'], ['text', 'Texts'], ['voicemail', 'Voicemails']] as Array<[Kind, string]>).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setShown(PAGE); }}>{l}</button>
              ))}
            </div>
          </header>
          {items.length === 0 ? <Empty>Nothing waiting. Good.</Empty> : (
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr><th>Waiting since</th><th>What</th><th>Number</th><th>Contact</th>{team && <th>Person</th>}<th className="rp-r">Last attempt</th></tr>
                </thead>
                <tbody>
                  {items.slice(0, shown).map((i, n) => {
                    const Icon = i.kind === 'missed_call' ? PhoneMissed : i.kind === 'text' ? MessageSquare : Voicemail;
                    const what = i.kind === 'missed_call'
                      ? `${i.count > 1 ? `${i.count} missed calls` : 'Missed call'}${i.voicemails ? `, left ${i.voicemails > 1 ? `${i.voicemails} voicemails` : 'a voicemail'}` : ''}`
                      : i.kind === 'text'
                        ? `${i.count > 1 ? `${i.count} texts` : '1 text'} waiting on a reply`
                        : 'Voicemail, not returned';
                    return (
                      <tr key={`${i.kind}-${i.userId}-${i.number}-${n}`} tabIndex={0} onClick={() => p.openContact(i.number)} onKeyDown={(e) => { if (e.key === 'Enter') p.openContact(i.number); }}>
                        <td className="rp-num"><span className={`rp-age${Date.now() - Date.parse(i.since) > 2 * 86_400_000 ? ' old' : ''}`}>{fmtAgo(i.since)}</span></td>
                        <td><span className="rp-dir"><Icon size={14} /> {what}</span></td>
                        <td className="rp-num">{formatPhone(i.number)}</td>
                        <td className={i.name ? undefined : 'rp-muted'}>{i.name ?? '—'}</td>
                        {team && <td>{i.personName}</td>}
                        <td className="rp-r rp-num">{fmtDateTime(i.lastAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {items.length > shown && (
            <div className="rp-more"><button type="button" className="rp-btn" onClick={() => setShown((s) => s + PAGE)}>Show more</button></div>
          )}
        </section>
      </div>
    </>
  );
}
