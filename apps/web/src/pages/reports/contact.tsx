// Contact lookup: "has anyone on the team called or texted this number?"
// Admins search the whole team; everyone else searches their own history
// (the server enforces it). Texts are records only — no message text.

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, MessageSquare, Phone, Search, Voicemail, X } from 'lucide-react';
import { getReportContact, searchReportContacts } from '../../api';
import { formatPhone } from '../../lib/phone';
import { fmtClockDuration, fmtDateTime, fmtInt, fmtTalk } from './format';
import { Empty, Person } from './parts';
import type { ContactDetail, ContactSearchResult } from './types';

const token = () => sessionStorage.getItem('ace_token') ?? '';

export function ContactSearch({ onPick, isAdmin }: { onPick: (number: string) => void; isAdmin: boolean }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ContactSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const digits = term.replace(/\D/g, '');
    if (digits.length < 4 && (digits.length > 0 || term.length < 2)) { setRes(null); setErr(null); return; }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      setBusy(true);
      searchReportContacts(token(), term)
        .then((r) => { if (id === reqId.current) { setRes(r); setErr(null); } })
        .catch((e: Error) => { if (id === reqId.current) setErr(e.message); })
        .finally(() => { if (id === reqId.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (n: string) => { setOpen(false); onPick(n); };
  const digits = q.replace(/\D/g, '');

  return (
    <div className="rp-csearch" ref={boxRef}>
      <label className="rp-search rp-search-wide" htmlFor="rp-contact-search">
        <Search size={15} aria-hidden="true" />
        <span className="rp-sr">Search a phone number or candidate name</span>
        <input
          id="rp-contact-search"
          type="search"
          value={q}
          placeholder={isAdmin ? 'Has anyone contacted… (number or name)' : 'Search your calls and texts (number or name)'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (res?.results[0]) pick(res.results[0].number);
              else if (digits.length >= 10) pick(digits);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          autoComplete="off"
        />
      </label>
      {open && (res || busy || err) && (
        <div className="rp-csearch-pop" role="listbox" aria-label="Matching numbers">
          {err && <div className="rp-csearch-msg rp-crit-text">{err}</div>}
          {busy && !res && <div className="rp-csearch-msg">Searching…</div>}
          {res && res.results.length === 0 && (
            <div className="rp-csearch-msg">
              {isAdmin ? 'Nobody on the team has called or texted a matching number in the last 12 months.' : 'You haven’t called or texted a matching number in the last 12 months.'}
            </div>
          )}
          {res?.results.map((r) => (
            <button key={r.number} type="button" role="option" aria-selected="false" className="rp-csearch-row" onClick={() => pick(r.number)}>
              <span>
                <b>{r.name ?? formatPhone(r.number)}</b>
                {r.name && <span className="rp-muted"> · {formatPhone(r.number)}</span>}
              </span>
              <span className="rp-muted rp-num">
                {fmtInt(r.calls)} calls · {fmtInt(r.texts)} texts{isAdmin ? ` · ${r.people} ${r.people === 1 ? 'person' : 'people'}` : ''} · last {fmtDateTime(r.lastAt)}
              </span>
            </button>
          ))}
          {res && res.results.length > 0 && <div className="rp-csearch-foot">Last 12 months. Select one to see every call and text with it.</div>}
        </div>
      )}
    </div>
  );
}

export function ContactSheet({ number, onClose, onOpenPerson, isAdmin }: {
  number: string;
  onClose: () => void;
  onOpenPerson: (userId: number) => void;
  isAdmin: boolean;
}) {
  const [data, setData] = useState<ContactDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    getReportContact(token(), number).then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [number]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nameOf = (id: number) => data?.people.find((p) => p.userId === id)?.name ?? 'Unknown';
  const events = data ? data.events.filter((e) => who == null || e.userId === who) : [];
  let lastDay = '';

  return (
    <div className="rp-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="rp-sheet rp-sheet-wide" role="dialog" aria-modal="true" aria-labelledby="rp-contact-title">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-eyebrow">{isAdmin ? 'Everyone on the team' : 'Your history'} · last 12 months</div>
            <h2 id="rp-contact-title">{data?.name ?? formatPhone(number)}</h2>
            {data?.name && <div className="rp-sheet-note">{formatPhone(data.number)}</div>}
          </div>
          <button ref={closeRef} type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="rp-sheet-scroll">
          {err && <Empty>{err}</Empty>}
          {!data && !err && <Empty>Loading…</Empty>}
          {data && data.people.length === 0 && (
            <Empty>{isAdmin ? 'Nobody on the team has called, texted or had a voicemail from this number in the last 12 months.' : 'You haven’t called or texted this number in the last 12 months.'}</Empty>
          )}
          {data && data.people.length > 0 && (
            <>
              <div className="rp-contact-summary">
                {isAdmin
                  ? <b>{data.people.length === 1 ? '1 person has' : `${data.people.length} people have`} been in touch with this number</b>
                  : <b>Your contact with this number</b>}
                {data.people.some((p) => p.optedOut) && <span className="rp-pill rp-pill-crit">Opted out of texts</span>}
              </div>
              <ul className="rp-contact-people">
                {data.people.map((p) => (
                  <li key={p.userId} className={who === p.userId ? 'active' : undefined}>
                    <button type="button" onClick={() => setWho((w) => (w === p.userId ? null : p.userId))} aria-pressed={who === p.userId}>
                      <Person name={p.name} sub={p.savedAs ? `Saved as “${p.savedAs}”` : undefined} />
                      <span className="rp-contact-stats rp-num">
                        <span>{fmtInt(p.callsOut)} out · {fmtInt(p.callsIn)} in{p.connected ? ` · ${fmtTalk(p.talkSec)} talk` : ''}</span>
                        <span>{fmtInt(p.textsSent)} texts sent · {fmtInt(p.textsReceived)} received{p.voicemails ? ` · ${p.voicemails} voicemail${p.voicemails === 1 ? '' : 's'}` : ''}</span>
                        <span className="rp-muted">First {fmtDateTime(p.firstAt)} · last {fmtDateTime(p.lastAt)}</span>
                      </span>
                    </button>
                    {isAdmin && <button type="button" className="rp-link rp-contact-open" onClick={() => onOpenPerson(p.userId)}>Open report</button>}
                  </li>
                ))}
              </ul>
              <div className="rp-sheet-tools">
                <span>{who == null ? `Everything, newest first (${fmtInt(data.totalEvents)})` : `Only ${nameOf(who)} · `}{who != null && <button type="button" className="rp-link" onClick={() => setWho(null)}>Show everyone</button>}</span>
                <span>Message text is never shown</span>
              </div>
              <ol className="rp-cevents">
                {events.map((e, i) => {
                  const day = fmtDateTime(e.at).replace(/,? \d+:\d+.*$/, '');
                  const sep = day !== lastDay;
                  lastDay = day;
                  const Icon = e.kind === 'call' ? Phone : e.kind === 'voicemail' ? Voicemail : e.detail?.startsWith('Picture') ? ImageIcon : MessageSquare;
                  return (
                    <li key={i}>
                      {sep && <div className="rp-tl-day">{day}</div>}
                      <div className="rp-cevent">
                        <span className={`rp-rec-icon ${e.direction === 'outbound' ? 'out' : 'in'}`} aria-hidden="true"><Icon size={14} /></span>
                        <span className="rp-rec-main">
                          <span className="rp-rec-who">
                            {e.kind === 'call' ? (e.direction === 'outbound' ? 'Call out' : 'Call in') : e.kind === 'voicemail' ? 'Voicemail' : e.direction === 'outbound' ? 'Text sent' : 'Text received'}
                            {e.talkSec != null ? ` · ${fmtClockDuration(e.talkSec)}` : ''}
                          </span>
                          <span className="rp-rec-sub">{isAdmin ? `${nameOf(e.userId)} · ` : ''}{fmtDateTime(e.at).replace(/^.*?, /, '')}{e.detail ? ` · ${e.detail}` : ''}</span>
                        </span>
                        <span className="rp-rec-out">
                          {e.tone ? <span className={`rp-pill rp-pill-${e.tone}`}>{e.label}</span> : <span className="rp-muted">{e.label}</span>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
