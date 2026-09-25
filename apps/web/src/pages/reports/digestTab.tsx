// Daily email — admin only, team view only. Preview exactly what each person
// receives, send a test to yourself, send to everyone, or turn on the
// weekday schedule. Sending to everyone is confirmed in the page (no
// browser dialog) and the server re-checks the recipient count, so a stale
// page can't mail a different list.

import { useEffect, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { getDigestPreview, saveDigestSchedule, sendDigest, type DigestPreview } from '../../api';
import { fmtDateTime, fmtDay, fmtInt, todayEt, addDays } from './format';
import { Empty, Panel } from './parts';
import type { TabProps } from './tabs';

const token = () => sessionStorage.getItem('ace_token') ?? '';
const HOURS = [5, 6, 7, 8, 9, 10, 11, 12];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDay = (key: string) => `${WEEKDAYS[new Date(`${key}T12:00:00Z`).getUTCDay()]}, ${fmtDay(key)}`;
const hourLabel = (h: number) => (h === 12 ? '12:00 PM' : `${h}:00 AM`);

export function DailyEmail(_p: TabProps) {
  const [date, setDate] = useState<string | null>(null);
  const [kind, setKind] = useState<'day' | 'week' | null>(null);
  const [data, setData] = useState<DigestPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<'test' | 'everyone' | 'schedule' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'crit'; text: string } | null>(null);
  const [showRecipients, setShowRecipients] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    getDigestPreview(token(), kind ?? undefined, date ?? undefined)
      .then((d) => {
        if (!live) return;
        setData(d);
        if (!kind) setKind(d.period.kind);
        if (!date) setDate(d.period.from);
      })
      .catch((e: Error) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [date, kind, nonce]);

  const send = async (mode: 'test' | 'everyone') => {
    if (!data) return;
    setBusy(mode);
    setNotice(null);
    try {
      const r = await sendDigest(token(), { kind: data.period.kind, date: data.period.from, mode, expectedCount: data.recipients.length, force });
      setNotice({
        tone: 'good',
        text: mode === 'test'
          ? `Test sent to ${r.to}. Check your inbox.`
          : `Sent: one email to ${fmtInt(Number(r.to))} ${Number(r.to) === 1 ? 'person' : 'people'} on To and ${fmtInt(r.bcc ?? 0)} on BCC.`,
      });
      setConfirm(false);
      setForce(false);
      setNonce((n) => n + 1);
    } catch (e) {
      setNotice({ tone: 'crit', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const saveSchedule = async (enabled: boolean, hour: number) => {
    setBusy('schedule');
    try {
      const s = await saveDigestSchedule(token(), { enabled, hour });
      setData((d) => (d ? { ...d, schedule: s } : d));
      setNotice({ tone: 'good', text: enabled ? `It will go out every weekday at ${hourLabel(hour)} Eastern, covering the previous working day.` : 'Automatic sending is off.' });
    } catch (e) {
      setNotice({ tone: 'crit', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (err && !data) return <Empty>{err}</Empty>;
  if (!data) return <Empty>Preparing the email…</Empty>;
  const yesterday = addDays(todayEt(), -1);
  const n = data.recipients.length;

  return (
    <div className="rp-grid">
      <Panel title="Performance email" sub={`One email to the ${fmtInt(n)} active users who called or texted in the last four weeks: the people in the shout-outs on To, everyone else on BCC`} span={5}>
        <div className="rp-digest-form">
          <div className="rp-seg" role="group" aria-label="Email type">
            <button type="button" aria-pressed={data.period.kind === 'day'} onClick={() => { setKind('day'); setDate(null); setConfirm(false); setNotice(null); }}>Daily</button>
            <button type="button" aria-pressed={data.period.kind === 'week'} onClick={() => { setKind('week'); setDate(null); setConfirm(false); setNotice(null); }}>Weekly recap</button>
          </div>
          <label className="rp-field" htmlFor="rp-digest-date">
            <span>{data.period.kind === 'week' ? `Week (${longDay(data.period.from)} to ${longDay(data.period.to)})` : 'Day to report on'}</span>
            <input id="rp-digest-date" type="date" value={date ?? ''} max={yesterday} onChange={(e) => { setDate(e.target.value); setConfirm(false); setNotice(null); }} />
            {data.period.kind === 'week' && <span className="rp-muted">Pick any day in the week; the recap covers Monday to Friday.</span>}
          </label>
          <div className="rp-field">
            <span>To ({fmtInt(data.to.length)}, from the shout-outs)</span>
            <div className="rp-to">{data.to.length ? data.to.map((r) => <span key={r.id} className="rp-chip">{r.name}</span>) : <span className="rp-muted">No shout-outs this day, so everyone goes on BCC</span>}</div>
            <span className="rp-muted">BCC: {fmtInt(data.bccCount)} other {data.bccCount === 1 ? 'person' : 'people'}. They won’t see each other’s addresses.</span>
          </div>

          <div className="rp-digest-actions">
            <button type="button" className="rp-btn" disabled={!!busy || loading} onClick={() => void send('test')}>
              <Mail size={15} /> {busy === 'test' ? 'Sending…' : 'Send a test to me'}
            </button>
            {!confirm && (
              <button type="button" className="rp-btn rp-btn-primary" disabled={!!busy || loading || n === 0} onClick={() => setConfirm(true)}>
                <Send size={15} /> Send to everyone ({fmtInt(n)})
              </button>
            )}
          </div>

          {confirm && (
            <div className="rp-confirm" role="alertdialog" aria-labelledby="rp-confirm-title">
              <b id="rp-confirm-title">Send the {data.period.kind === 'week' ? `weekly recap for ${longDay(data.period.from)} to ${longDay(data.period.to)}` : `email for ${longDay(data.period.from)}`} to {fmtInt(n)} people?</b>
              <p>One email: {fmtInt(data.to.length)} on To, {fmtInt(data.bccCount)} on BCC. This can’t be undone.</p>
              {data.alreadySent && (
                <label className="rp-check" htmlFor="rp-digest-force">
                  <input id="rp-digest-force" type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  This was already sent to everyone. Send it again anyway.
                </label>
              )}
              <div className="rp-digest-actions">
                <button type="button" className="rp-btn rp-btn-primary" disabled={!!busy || (data.alreadySent && !force)} onClick={() => void send('everyone')}>
                  {busy === 'everyone' ? `Sending to ${fmtInt(n)}…` : 'Send now'}
                </button>
                <button type="button" className="rp-btn" disabled={!!busy} onClick={() => { setConfirm(false); setForce(false); }}>Cancel</button>
              </div>
            </div>
          )}
          {data.alreadySent && !confirm && <p className="rp-footnote">This has already been sent to everyone.</p>}
          {notice && <p className={`rp-notice ${notice.tone}`} role="status">{notice.text}</p>}

          <div className="rp-digest-schedule">
            <label className="rp-check" htmlFor="rp-digest-auto">
              <input id="rp-digest-auto" type="checkbox" checked={data.schedule.enabled} disabled={busy === 'schedule'}
                onChange={(e) => void saveSchedule(e.target.checked, data.schedule.hour)} />
              Send automatically every weekday
            </label>
            <label className="rp-field rp-field-inline" htmlFor="rp-digest-hour">
              <span>at</span>
              <select id="rp-digest-hour" value={data.schedule.hour} disabled={busy === 'schedule'}
                onChange={(e) => void saveSchedule(data.schedule.enabled, Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span>Eastern</span>
            </label>
            <p className="rp-footnote">
              Tuesday to Friday it covers the previous day. Monday it sends the weekly recap for the week before. {data.schedule.lastSentDate ? `Last automatic send: ${data.schedule.lastSentDate}.` : 'No automatic send yet.'}
            </p>
          </div>

          <button type="button" className="rp-link" onClick={() => setShowRecipients((s) => !s)}>
            {showRecipients ? 'Hide' : 'Show'} the {fmtInt(n)} recipients
          </button>
          {showRecipients && (
            <ul className="rp-recipients">
              {data.recipients.map((r) => <li key={r.id}><span>{r.name}</span><span className="rp-muted">{r.email}</span></li>)}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title="Preview" sub="Everyone receives this same email" span={7} flush>
        <div className="rp-mail-head">
          <div><span className="rp-muted">From</span> ACE Dialer</div>
          <div><span className="rp-muted">Subject</span> <b>{data.subject}</b></div>
        </div>
        <div className={`rp-mail-frame${loading ? ' rp-stale' : ''}`}>
          {/* Sandboxed with no permissions: the preview can't run script or navigate. */}
          <iframe title="Email preview" sandbox="" srcDoc={data.html} />
        </div>
      </Panel>

      <Panel title="Sent" sub="The last 20 sends" flush>
        {data.history.length === 0 ? <Empty>Nothing sent yet.</Empty> : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th>When</th><th>Day covered</th><th>Sent to</th><th className="rp-r">People</th><th>By</th></tr></thead>
              <tbody>
                {data.history.map((h, i) => (
                  <tr key={i} className="rp-static">
                    <td className="rp-num">{fmtDateTime(h.at)}</td>
                    <td className="rp-num">{!h.date ? '—' : h.date.includes('..') ? `Week of ${longDay(h.date.split('..')[0])}` : longDay(h.date)}</td>
                    <td>{h.mode === 'test' ? 'Test to self' : h.to != null ? `Everyone (${h.to} To, ${h.bcc ?? 0} BCC)` : 'Everyone'}</td>
                    <td className="rp-r rp-num">{h.failed ? <span className="rp-pill rp-pill-crit">failed</span> : fmtInt(h.sent)}</td>
                    <td>{h.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
