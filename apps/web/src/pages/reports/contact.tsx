// Contact lookup: "has anyone on the team called or texted this number?"
// Admins search the whole team; everyone else searches their own history
// (the server enforces it). Clicking a text or voicemail opens that
// person's whole conversation with the number, message text included.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, Clock, Image as ImageIcon, MessageSquare, Phone, Search, Voicemail, X } from 'lucide-react';
import { getReportContact, searchReportContacts } from '../../api';
import { formatPhone } from '../../lib/phone';
import { fmtClockDuration, fmtDateTime, fmtInt, fmtTalk } from './format';
import { Empty, Person } from './parts';
import type { ContactDetail, ContactSearchResult } from './types';

const token = () => sessionStorage.getItem('ace_token') ?? '';

const DAY_MS = 86_400_000;
/** Past this, a contact has gone cold and the panel says so loudly. */
const STALE_DAYS = 30;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
const dayOf = (iso: string) => fmtDateTime(iso).replace(/,? \d+:\d+.*$/, '');
// The row title already says "Text sent"/"Text received"; keep only what it doesn't.
const rowDetail = (e: { kind: string; detail?: string }) => (e.kind === 'text' ? e.detail?.replace(/^Text( · |$)/, '') : e.detail);
const agoText = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);

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
  // The conversation being read: whose, and which message was clicked.
  const [conv, setConv] = useState<{ userId: number; at: string } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    setConv(null);
    getReportContact(token(), number).then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [number]);
  useEffect(() => {
    // Focus the dialog, not the close button: the panel usually opens from
    // Enter in the search box, which makes a focused X draw a keyboard ring.
    sheetRef.current?.focus();
  }, []);
  useEffect(() => {
    // Escape steps back out of a conversation before it closes the sheet.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (conv) setConv(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, conv]);

  const nameOf = (id: number) => data?.people.find((p) => p.userId === id)?.name ?? 'Unknown';
  const events = data ? data.events.filter((e) => who == null || e.userId === who) : [];
  let lastDay = '';

  return (
    <div className="rp-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={sheetRef} tabIndex={-1} className="rp-sheet rp-sheet-wide" role="dialog" aria-modal="true" aria-labelledby="rp-contact-title">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-eyebrow">{isAdmin ? 'Everyone on the team' : 'Your history'} · last 12 months</div>
            <h2 id="rp-contact-title">{data?.name ?? formatPhone(number)}</h2>
            {data?.name && <div className="rp-sheet-note">{formatPhone(data.number)}</div>}
          </div>
          <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {data && data.events.length > 0 && <LastContact event={data.events[0]} who={isAdmin ? nameOf(data.events[0].userId) : null} />}
        <div className="rp-sheet-scroll">
          {err && <Empty>{err}</Empty>}
          {!data && !err && <Empty>Loading…</Empty>}
          {data && data.people.length === 0 && (
            <Empty>{isAdmin ? 'Nobody on the team has called, texted or had a voicemail from this number in the last 12 months.' : 'You haven’t called or texted this number in the last 12 months.'}</Empty>
          )}
          {data && conv && (
            <Conversation
              events={data.events.filter((e) => e.userId === conv.userId)}
              focusAt={conv.at}
              personName={nameOf(conv.userId)}
              contactName={data.name ?? formatPhone(data.number)}
              onBack={() => setConv(null)}
            />
          )}
          {data && !conv && data.people.length > 0 && (
            <>
              <div className="rp-contact-summary">
                {isAdmin
                  ? <b>{data.people.length === 1 ? '1 person has' : `${data.people.length} people have`} been in touch with this number</b>
                  : <b>Your contact with this number</b>}
                {data.people.some((p) => p.optedOut) && <span className="rp-pill rp-pill-crit">Opted out of texts</span>}
              </div>
              <ul className="rp-contact-people">
                {data.people.map((p) => {
                  const d = daysSince(p.lastAt);
                  return (
                    <li key={p.userId} className={who === p.userId ? 'active' : undefined}>
                      <button type="button" className="rp-cperson" onClick={() => setWho((w) => (w === p.userId ? null : p.userId))} aria-pressed={who === p.userId}>
                        <Person name={p.name} sub={p.savedAs ? `Saved as “${p.savedAs}”` : undefined} />
                        <span className="rp-cperson-stats rp-num">
                          <span>{fmtInt(p.callsOut)} calls out · {fmtInt(p.callsIn)} in{p.connected ? ` · ${fmtTalk(p.talkSec)} talk` : ''}</span>
                          <span>{fmtInt(p.textsSent)} texts sent · {fmtInt(p.textsReceived)} received{p.voicemails ? ` · ${p.voicemails} voicemail${p.voicemails === 1 ? '' : 's'}` : ''}</span>
                        </span>
                        <span className="rp-cperson-when">
                          <span className={d > STALE_DAYS ? 'rp-cold-text' : undefined}>{agoText(d).replace(/^./, (c) => c.toUpperCase())}</span>
                          <span className="rp-muted">since {dayOf(p.firstAt)}</span>
                        </span>
                      </button>
                      {isAdmin && <button type="button" className="rp-link rp-contact-open" onClick={() => onOpenPerson(p.userId)}>Open report</button>}
                    </li>
                  );
                })}
              </ul>
              <div className="rp-sheet-tools">
                <span>{who == null ? `Everything, newest first (${fmtInt(data.totalEvents)})` : `Only ${nameOf(who)} · `}{who != null && <button type="button" className="rp-link" onClick={() => setWho(null)}>Show everyone</button>}</span>
                <span>Select a text or voicemail to read the conversation</span>
              </div>
              <ol className="rp-cevents">
                {events.map((e, i) => {
                  const day = dayOf(e.at);
                  const sep = day !== lastDay;
                  lastDay = day;
                  const Icon = e.kind === 'call' ? Phone : e.kind === 'voicemail' ? Voicemail : e.detail?.startsWith('Picture') ? ImageIcon : MessageSquare;
                  const readable = e.kind !== 'call';
                  const Row = readable ? 'button' : 'div';
                  return (
                    <li key={i}>
                      {sep && <div className="rp-tl-day">{day}</div>}
                      <Row
                        className={`rp-cevent${readable ? ' rp-cevent-btn' : ''}`}
                        {...(readable ? { type: 'button' as const, onClick: () => setConv({ userId: e.userId, at: e.at }) } : {})}
                      >
                        <span className={`rp-rec-icon ${e.direction === 'outbound' ? 'out' : 'in'}`} aria-hidden="true"><Icon size={14} /></span>
                        <span className="rp-rec-main">
                          <span className="rp-rec-who">
                            {e.kind === 'call' ? (e.direction === 'outbound' ? 'Call out' : 'Call in') : e.kind === 'voicemail' ? 'Voicemail' : e.direction === 'outbound' ? 'Text sent' : 'Text received'}
                            {e.talkSec != null ? ` · ${fmtClockDuration(e.talkSec)}` : ''}
                          </span>
                          <span className="rp-rec-sub">{isAdmin ? `${nameOf(e.userId)} · ` : ''}{fmtDateTime(e.at).replace(/^.*?, /, '')}{rowDetail(e) ? ` · ${rowDetail(e)}` : ''}</span>
                          {readable && (e.body
                            ? <span className="rp-cevent-body">{e.body}</span>
                            : e.kind === 'voicemail' && <span className="rp-cevent-body rp-muted">No transcript</span>)}
                        </span>
                        <span className="rp-rec-out">
                          {e.tone ? <span className={`rp-pill rp-pill-${e.tone}`}>{e.label}</span> : <span className="rp-muted">{e.label}</span>}
                        </span>
                      </Row>
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

type ContactEvent = ContactDetail['events'][number];

/**
 * One person's whole history with the number, oldest first, laid out like
 * a phone's message thread: theirs on the left, ours on the right. Calls
 * stay in the thread so a text reads in the context that prompted it.
 */
function Conversation({ events, focusAt, personName, contactName, onBack }: {
  events: ContactEvent[];
  focusAt: string;
  personName: string;
  contactName: string;
  onBack: () => void;
}) {
  const focusRef = useRef<HTMLLIElement>(null);
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center' }); }, [focusAt]);
  let lastDay = '';
  return (
    <>
      <div className="rp-sheet-tools">
        <button type="button" className="rp-link rp-conv-back" onClick={onBack}><ChevronLeft size={15} /> All activity</button>
        <span>{personName} and {contactName}, oldest first</span>
      </div>
      <ol className="rp-timeline">
        {ordered.map((e, i) => {
          const day = dayOf(e.at);
          const sep = day !== lastDay;
          lastDay = day;
          const time = fmtDateTime(e.at).replace(/^.*?, /, '');
          const out = e.direction === 'outbound';
          const focused = e.at === focusAt;
          return (
            <li key={i} ref={focused ? focusRef : undefined}>
              {sep && <div className="rp-tl-day">{day}</div>}
              <div className={`rp-tl-row ${out ? 'out' : 'in'}`}>
                <div className={`rp-tl-bubble rp-tl-${e.kind}${focused ? ' focused' : ''}`}>
                  {e.kind === 'call' && (
                    <span className="rp-tl-kind"><Phone size={13} /> {out ? 'Call out' : 'Call in'}{e.talkSec != null ? ` · ${fmtClockDuration(e.talkSec)}` : ''}</span>
                  )}
                  {e.kind === 'voicemail' && (
                    <span className="rp-tl-kind"><Voicemail size={13} /> Voicemail · {e.detail}</span>
                  )}
                  {e.kind !== 'call' && e.body && <span className="rp-tl-text">{e.body}</span>}
                  {e.kind === 'voicemail' && !e.body && <span className="rp-tl-meta">No transcript</span>}
                  {e.mediaUrls?.map((u, j) => (
                    <a key={j} className="rp-tl-media" href={u} target="_blank" rel="noreferrer"><ImageIcon size={13} /> Picture {e.mediaUrls!.length > 1 ? j + 1 : ''}</a>
                  ))}
                  <span className="rp-tl-meta">
                    {time} · {e.kind === 'text' ? e.label : e.kind === 'call' ? (e.detail ?? e.label) : e.label}
                    {e.kind === 'text' && e.tone === 'crit' && e.detail ? ` · ${e.detail.replace(/^(Text|Picture message) · /, '')}` : ''}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** How long since anyone on this panel last touched the number. Events
 *  arrive newest first, so the first one is the last contact. */
function LastContact({ event, who }: { event: ContactEvent; who: string | null }) {
  const d = daysSince(event.at);
  const what = event.kind === 'call'
    ? (event.direction === 'outbound' ? 'call out' : 'call in')
    : event.kind === 'voicemail' ? 'voicemail' : event.direction === 'outbound' ? 'text sent' : 'text received';
  const line = `${fmtDateTime(event.at)} · ${what}${who ? ` · ${who}` : ''}`;
  if (d > STALE_DAYS) {
    return (
      <div className="rp-cold" role="status">
        <AlertTriangle size={24} aria-hidden="true" />
        <div>
          <b>No contact in {d} days</b>
          <span>Last contact {line}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rp-recent">
      <Clock size={15} aria-hidden="true" />
      <span><b>Last contact {agoText(d)}</b> · {line}</span>
    </div>
  );
}
