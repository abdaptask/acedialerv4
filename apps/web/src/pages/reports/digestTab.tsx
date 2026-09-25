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
  const [as, setAs] = useState<number | null>(null);
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
    getDigestPreview(token(), date ?? undefined, as ?? undefined)
      .then((d) => { if (live) { setData(d); if (!date) setDate(d.date); } })
      .catch((e: Error) => { if (live) setErr(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [date, as, nonce]);

  const send = async (mode: 'test' | 'everyone') => {
    if (!data) return;
    setBusy(mode);
    setNotice(null);
    try {
      const r = await sendDigest(token(), { date: data.date, mode, expectedCount: data.recipients.length, force });
      const failed = r.failed.length;
      setNotice({
        tone: failed ? 'crit' : 'good',
        text: mode === 'test'
          ? (r.sent ? `Test sent to ${r.to}. Check your inbox.` : `The test didn't send: ${r.failed[0]?.error ?? 'unknown error'}.`)
          : `Sent to ${fmtInt(r.sent)} ${r.sent === 1 ? 'person' : 'people'}${failed ? `. ${failed} failed: ${r.failed.slice(0, 3).map((f) => f.email).join(', ')}` : '.'}`,
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
      <Panel title="Daily performance email" sub={`Goes to the ${fmtInt(n)} active users who called or texted in the last four weeks. Everyone sees the team section; each person's own numbers and follow-ups are only in their copy`} span={5}>
        <div className="rp-digest-form">
          <label className="rp-field" htmlFor="rp-digest-date">
            <span>Day to report on</span>
            <input id="rp-digest-date" type="date" value={date ?? ''} max={yesterday} onChange={(e) => { setDate(e.target.value); setConfirm(false); setNotice(null); }} />
          </label>
          <label className="rp-field" htmlFor="rp-digest-as">
            <span>Preview as</span>
            <select id="rp-digest-as" value={data.previewAs.id} onChange={(e) => setAs(Number(e.target.value))}>
              {!data.recipients.some((r) => r.id === data.previewAs.id) && <option value={data.previewAs.id}>{data.previewAs.name} (you)</option>}
              {data.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>

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
              <b id="rp-confirm-title">Send the email for {longDay(data.date)} to {fmtInt(n)} people?</b>
              <p>Each person gets their own copy. This can’t be undone.</p>
              {data.alreadySent && (
                <label className="rp-check" htmlFor="rp-digest-force">
                  <input id="rp-digest-force" type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  This day was already sent to everyone. Send it again anyway.
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
          {data.alreadySent && !confirm && <p className="rp-footnote">This day has already been sent to everyone.</p>}
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
              Covers the previous working day (Monday’s covers Friday). {data.schedule.lastSentDate ? `Last automatic send: ${data.schedule.lastSentDate}.` : 'No automatic send yet.'}
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

      <Panel title="Preview" sub={`What ${data.previewAs.name} will receive`} span={7} flush>
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
              <thead><tr><th>When</th><th>Day covered</th><th>To</th><th className="rp-r">Delivered to SendGrid</th><th className="rp-r">Failed</th><th>By</th></tr></thead>
              <tbody>
                {data.history.map((h, i) => (
                  <tr key={i} className="rp-static">
                    <td className="rp-num">{fmtDateTime(h.at)}</td>
                    <td className="rp-num">{h.date ? longDay(h.date) : '—'}</td>
                    <td>{h.mode === 'test' ? 'Test to self' : 'Everyone'}</td>
                    <td className="rp-r rp-num">{fmtInt(h.sent)}</td>
                    <td className="rp-r rp-num">{h.failed ? <span className="rp-pill rp-pill-crit">{h.failed}</span> : '0'}</td>
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
