// Individual call and text records, plus the per-number timeline.
// Text records are metadata only (when, who, direction, delivery, billed
// parts) — the server never sends message text, and nothing here asks.

import { useEffect, useRef } from 'react';
import { Image as ImageIcon, MessageSquare, Phone, PhoneIncoming, PhoneOutgoing, X } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import { fmtClockDuration, fmtDateTime } from './format';
import type { CallLogEntry, TextLogEntry } from './types';

export const last10 = (n: string) => n.replace(/\D/g, '').slice(-10);
export const sameNumber = (a: string, b: string) => {
  const x = last10(a);
  return x.length === 10 ? x === last10(b) : a === b;
};

const CALL_TONE: Record<string, 'good' | 'warn' | 'crit' | null> = {
  answered: 'good', connected: 'good',
  caller_hung_up: 'warn', rang_out: 'warn', declined: 'warn',
  invalid_number: 'crit', failed: 'crit',
};
const TEXT_TONE: Record<string, 'good' | 'warn' | 'crit' | null> = {
  delivered: 'good', received: null, sent: 'warn', failed: 'crit',
};

export function Outcome({ label, tone }: { label: string; tone: 'good' | 'warn' | 'crit' | null }) {
  return tone ? <span className={`rp-pill rp-pill-${tone}`}>{label}</span> : <span className="rp-muted">{label}</span>;
}

export function callTone(c: CallLogEntry) {
  return CALL_TONE[c.outcome] ?? null;
}
export function textTone(m: TextLogEntry) {
  return TEXT_TONE[m.status] ?? null;
}

export function textKind(m: TextLogEntry): string {
  if (m.hasMedia) return 'Picture message';
  if (m.parts && m.parts > 1) return `Text · ${m.parts} parts`;
  return 'Text';
}

/** One row in a record list: a call or a text, clickable to its timeline. */
export function RecordRow({ item, onOpen }: {
  item: { kind: 'call'; c: CallLogEntry } | { kind: 'text'; m: TextLogEntry };
  onOpen: (number: string, name: string | null) => void;
}) {
  const out = item.kind === 'call' ? item.c.direction === 'outbound' : item.m.direction === 'outbound';
  const number = item.kind === 'call' ? item.c.number : item.m.number;
  const name = item.kind === 'call' ? item.c.name : item.m.name;
  const when = item.kind === 'call' ? item.c.startedAt : item.m.at;
  return (
    <li className="rp-rec">
      <button type="button" onClick={() => onOpen(number, name)}>
        <span className={`rp-rec-icon ${out ? 'out' : 'in'}`} aria-hidden="true">
          {item.kind === 'call'
            ? (out ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />)
            : (item.m.hasMedia ? <ImageIcon size={14} /> : <MessageSquare size={14} />)}
        </span>
        <span className="rp-rec-main">
          <span className="rp-rec-who">{name ?? formatPhone(number)}</span>
          <span className="rp-rec-sub">
            {name ? `${formatPhone(number)} · ` : ''}
            {out ? (item.kind === 'call' ? 'Dialled out' : 'Sent') : (item.kind === 'call' ? 'Called in' : 'Received')}
            {item.kind === 'text' ? ` · ${textKind(item.m)}` : ''}
          </span>
          {item.kind === 'call' && (
            <span className={`rp-rec-why${item.c.noAudio || item.c.endReason === 'dropped' ? ' bad' : ''}`}>{item.c.endLabel}</span>
          )}
          {item.kind === 'text' && item.m.status !== 'delivered' && item.m.why && (
            <span className={`rp-rec-why${item.m.status === 'failed' ? ' bad' : ''}`}>{item.m.why}</span>
          )}
        </span>
        <span className="rp-rec-when rp-num">{fmtDateTime(when)}</span>
        <span className="rp-rec-out">
          {item.kind === 'call'
            ? <><Outcome label={item.c.outcomeLabel} tone={callTone(item.c)} />{item.c.answered && <b className="rp-num">{fmtClockDuration(item.c.talkSec)}</b>}</>
            : <Outcome label={item.m.statusLabel} tone={textTone(item.m)} />}
        </span>
      </button>
    </li>
  );
}

/**
 * Everything between this person and one number, oldest first, laid out
 * like a conversation: ours on the right, theirs on the left.
 */
export function Timeline({ number, calls, texts }: { number: string; calls: CallLogEntry[]; texts: TextLogEntry[] }) {
  type Ev = { at: string; out: boolean; kind: 'call' | 'text'; c?: CallLogEntry; m?: TextLogEntry };
  const evs: Ev[] = [
    ...calls.filter((c) => sameNumber(c.number, number)).map((c) => ({ at: c.startedAt, out: c.direction === 'outbound', kind: 'call' as const, c })),
    ...texts.filter((m) => sameNumber(m.number, number)).map((m) => ({ at: m.at, out: m.direction === 'outbound', kind: 'text' as const, m })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (evs.length === 0) return <div className="rp-empty">No calls or texts with this number in this period.</div>;
  const nCalls = evs.filter((e) => e.kind === 'call').length;
  const nTexts = evs.length - nCalls;
  let lastDay = '';
  return (
    <>
      <div className="rp-sheet-tools">
        <span>{nCalls} {nCalls === 1 ? 'call' : 'calls'} · {nTexts} {nTexts === 1 ? 'text' : 'texts'}, oldest first</span>
        <span>Message text is never shown</span>
      </div>
      <ol className="rp-timeline">
        {evs.map((e, i) => {
          const day = fmtDateTime(e.at).replace(/,? \d+:\d+.*$/, '');
          const sep = day !== lastDay;
          lastDay = day;
          const time = fmtDateTime(e.at).replace(/^.*?, /, '');
          return (
            <li key={i}>
              {sep && <div className="rp-tl-day">{day}</div>}
              <div className={`rp-tl-row ${e.out ? 'out' : 'in'}`}>
                <div className={`rp-tl-bubble ${e.kind}`}>
                  <span className="rp-tl-kind">
                    {e.kind === 'call'
                      ? <><Phone size={13} /> {e.out ? 'Call out' : 'Call in'}{e.c!.answered ? ` · ${fmtClockDuration(e.c!.talkSec)}` : ''}</>
                      : <>{e.m!.hasMedia ? <ImageIcon size={13} /> : <MessageSquare size={13} />} {textKind(e.m!)}</>}
                  </span>
                  <span className="rp-tl-meta">
                    {time} · {e.kind === 'call' ? e.c!.endLabel : e.m!.statusLabel}
                    {e.kind === 'text' && e.m!.status !== 'delivered' && e.m!.why ? ` · ${e.m!.why}` : ''}
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

/** A standalone sheet showing one number's timeline (used from the Activity tab). */
export function TimelineSheet({ number, name, personName, rangeLabel, calls, texts, onClose }: {
  number: string;
  name: string | null;
  personName: string;
  rangeLabel: string;
  calls: CallLogEntry[];
  texts: TextLogEntry[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="rp-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="rp-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-tl-title">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-eyebrow">{personName} · {rangeLabel}</div>
            <h2 id="rp-tl-title">{name ?? formatPhone(number)}</h2>
            {name && <div className="rp-sheet-note">{formatPhone(number)}</div>}
          </div>
          <button ref={closeRef} type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="rp-sheet-scroll"><Timeline number={number} calls={calls} texts={texts} /></div>
        <footer className="rp-sheet-foot">Every call and text with this number in the period, in order.</footer>
      </aside>
    </div>
  );
}
