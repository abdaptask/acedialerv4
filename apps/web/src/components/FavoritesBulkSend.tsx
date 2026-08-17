// Multi-select send: pick favorites, write one message, send once.
//
// Four steps — Pick → Write → Review → Progress — and the split between Write
// and Review is the whole design. Review is the last point at which N texts
// are still recallable, and it shows the EXACT string each person will receive
// rather than the template, because a placeholder that resolved wrong is
// invisible until you see it rendered against a real name.
//
// ── What this component is careful about ───────────────────────────────
// * ONE ENTRY PER FAVORITE, using the primary number. A contact carrying Cell
//   + Home + Work must never receive three texts. The server enforces this too
//   (smsCampaignAudience.ts), but the UI must not ask for it in the first place.
// * NO `maxLength` ON THE TEXTAREA. It silently truncates a paste (§18.4);
//   Send is disabled with an explanation instead.
// * SEGMENTS, NOT CHARACTERS, are what the carrier bills, and one em dash
//   flips GSM-7 → UCS-2 and halves the per-segment capacity. At 60 recipients
//   that mistake is multiplied by 60, so the total is shown before sending.
// * A REFUSED RECIPIENT IS NAMED. The server returns a sentence per exclusion;
//   showing a count without the reasons would read as "bulk send is broken".
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  createSmsCampaign,
  getSmsCampaign,
  getSmsPlaceholders,
  listMySmsTemplates,
  type CampaignDetail,
  type CampaignSkipped,
  type SmsPlaceholder,
  type SmsTemplate,
} from '../api';
import { fillTemplateBody, remainingPlaceholders } from '../lib/smsPlaceholderFill';
import { formatSmsLength, measureSms } from '../lib/smsSegments';
import { getFavorites, type FavoriteContact } from '../lib/userPrefs';
import { getCachedJobDivaName } from '../hooks/useJobDivaContact';
import { formatPhone } from '../lib/phone';

/** Mirrors MAX_SMS_BODY_CHARS on the server, which stays authoritative. */
const MAX_BODY = 1600;
/** Mirrors MAX_CAMPAIGN_RECIPIENTS. */
const MAX_RECIPIENTS = 200;

type Step = 'pick' | 'write' | 'review' | 'progress';

interface Recipient {
  favoriteId: number;
  phone: string;
  name: string;
  /** The exact text this person receives. */
  body: string;
  /** Placeholders that didn't resolve for this contact. */
  unresolved: string[];
}

function displayName(f: FavoriteContact): string {
  const joined = [f.firstName, f.lastName].filter(Boolean).join(' ').trim();
  return joined || f.label || getCachedJobDivaName(f.phone) || formatPhone(f.phone);
}

/**
 * The single number a send targets for one favorite.
 *
 * Mirrors pickPrimaryPhone on the server. Explicit primary, then first listed,
 * then the legacy Favorite.phone mirror.
 */
function primaryPhoneOf(f: FavoriteContact): string {
  return f.numbers?.find((n) => n.isPrimary)?.phone ?? f.numbers?.[0]?.phone ?? f.phone;
}

export default function FavoritesBulkSend({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick');
  const [favorites] = useState<FavoriteContact[]>(() => getFavorites());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [template, setTemplate] = useState('');
  const [registry, setRegistry] = useState<SmsPlaceholder[]>([]);
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<CampaignSkipped[]>([]);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);

  const token = sessionStorage.getItem('ace_token');
  const recruiterFirstName = sessionStorage.getItem('ace_first_name');

  useEffect(() => {
    if (!token) return;
    void getSmsPlaceholders(token).then((r) => setRegistry(r.placeholders));
    void listMySmsTemplates(token).then(setTemplates);
  }, [token]);

  // Only favorites with a server id can be sent to — the id is how the server
  // attributes the recipient. A purely-local row (added while offline and not
  // yet synced) is excluded rather than silently dropped later.
  const sendable = useMemo(
    () => favorites.filter((f): f is FavoriteContact & { id: number } => typeof f.id === 'number'),
    [favorites],
  );

  // One entry per FAVORITE, on the primary number.
  const recipients = useMemo<Recipient[]>(() => {
    const out: Recipient[] = [];
    for (const f of sendable) {
      if (!selected.has(f.id)) continue;
      const phone = primaryPhoneOf(f);
      const body = fillTemplateBody(
        template,
        {
          displayName: displayName(f),
          jobDiva: null,
          recruiterFirstName,
        },
        registry,
      );
      out.push({
        favoriteId: f.id,
        phone,
        name: displayName(f),
        body,
        unresolved: remainingPlaceholders(body, registry),
      });
    }
    return out;
  }, [sendable, selected, template, registry, recruiterFirstName]);

  const withUnresolved = recipients.filter((r) => r.unresolved.length > 0);
  const tooLong = recipients.filter((r) => r.body.length > MAX_BODY);
  const measure = measureSms(template);
  const totalSegments = recipients.reduce((n, r) => n + measureSms(r.body).segments, 0);

  const blockedReason =
    recipients.length === 0
      ? 'Pick at least one contact.'
      : template.trim() === ''
        ? 'Write a message first.'
        : withUnresolved.length > 0
          ? `${withUnresolved.length} message${withUnresolved.length === 1 ? '' : 's'} still contain a placeholder that didn't fill in.`
          : tooLong.length > 0
            ? `${tooLong.length} message${tooLong.length === 1 ? '' : 's'} exceed ${MAX_BODY} characters.`
            : null;

  async function handleSend() {
    if (!token || blockedReason) return;
    setSending(true);
    setError(null);
    const res = await createSmsCampaign(token, {
      templateBody: template,
      recipients: recipients.map(({ favoriteId, phone, body }) => ({ favoriteId, phone, body })),
    });
    setSending(false);
    if (!res.ok) {
      setError(res.message ?? res.error);
      setRefusals(res.skipped ?? []);
      return;
    }
    setRefusals(res.skipped);
    setCampaignId(res.campaign.id);
    setStep('progress');
  }

  // Poll while the send drains. 4s roughly matches the worker's 1 msg/s pacing
  // and 30s tick; polling stops the moment the server says it's finished so a
  // parked tab isn't hitting the API forever.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (step !== 'progress' || campaignId === null || !token) return;
    let alive = true;
    const load = async () => {
      const d = await getSmsCampaign(token, campaignId);
      if (!alive || !d) return;
      setDetail(d);
      if (d.campaign.status !== 'sending' && pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    void load();
    pollRef.current = window.setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [step, campaignId, token]);

  const allSelected = selected.size === sendable.length && sendable.length > 0;

  return (
    <div className="bulk-overlay" role="dialog" aria-modal="true" aria-label="Send to favorites">
      <div className="bulk-sheet">
        <header className="bulk-head">
          {step === 'write' || step === 'review' ? (
            <button
              className="bulk-icon-btn"
              onClick={() => setStep(step === 'review' ? 'write' : 'pick')}
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>
          ) : (
            <span className="bulk-icon-spacer" />
          )}
          <h2>
            {step === 'pick' && 'Send to favorites'}
            {step === 'write' && 'Write message'}
            {step === 'review' && 'Review before sending'}
            {step === 'progress' && 'Sending'}
          </h2>
          <button className="bulk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        {/* ── Step 1: pick ─────────────────────────────────────────────── */}
        {step === 'pick' && (
          <>
            <div className="bulk-body">
              {sendable.length === 0 ? (
                <div className="bulk-empty">
                  <Users size={28} />
                  <p>No favorites yet. Star a few contacts and they'll show up here.</p>
                </div>
              ) : (
                <>
                  <div className="bulk-subhead">
                    <span>
                      {selected.size} of {sendable.length} selected
                    </span>
                    <button
                      className="bulk-link-btn"
                      onClick={() =>
                        setSelected(allSelected ? new Set() : new Set(sendable.map((f) => f.id)))
                      }
                    >
                      {allSelected ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <ul className="bulk-list">
                    {sendable.map((f) => {
                      const on = selected.has(f.id);
                      const extra = (f.numbers?.length ?? 0) - 1;
                      return (
                        <li key={f.id}>
                          <button
                            className={`bulk-row ${on ? 'on' : ''}`}
                            aria-pressed={on}
                            onClick={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(f.id)) next.delete(f.id);
                                else next.add(f.id);
                                return next;
                              })
                            }
                          >
                            <span className={`bulk-check ${on ? 'on' : ''}`}>
                              {on && <Check size={14} strokeWidth={3} />}
                            </span>
                            <span className="bulk-row-text">
                              <span className="bulk-row-name">{displayName(f)}</span>
                              <span className="bulk-row-sub">
                                {formatPhone(primaryPhoneOf(f))}
                                {extra > 0 && ` · +${extra} other number${extra === 1 ? '' : 's'}`}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Only the primary number is used, and a contact with several
                      numbers gets ONE text — say so rather than let the user
                      wonder which line it went to. */}
                  {sendable.some((f) => (f.numbers?.length ?? 0) > 1) && (
                    <p className="bulk-note">
                      Contacts with more than one number get a single text, on their primary number.
                    </p>
                  )}
                </>
              )}
            </div>
            <footer className="bulk-foot">
              <button
                className="bulk-primary"
                disabled={selected.size === 0 || selected.size > MAX_RECIPIENTS}
                onClick={() => setStep('write')}
              >
                {selected.size > MAX_RECIPIENTS
                  ? `Too many — ${MAX_RECIPIENTS} max`
                  : `Continue with ${selected.size}`}
              </button>
            </footer>
          </>
        )}

        {/* ── Step 2: write ────────────────────────────────────────────── */}
        {step === 'write' && (
          <>
            <div className="bulk-body">
              {templates.length > 0 && (
                <div className="bulk-templates">
                  <label htmlFor="bulk-template-pick">Start from a template</label>
                  <select
                    id="bulk-template-pick"
                    defaultValue=""
                    onChange={(e) => {
                      const t = templates.find((x) => String(x.id) === e.target.value);
                      if (t) setTemplate(t.body);
                    }}
                  >
                    <option value="">Write from scratch</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.scope === 'personal' ? ' (yours)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* No maxLength — a paste must not be silently truncated. */}
              <textarea
                className="bulk-compose"
                rows={7}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="Hi {firstName}, just checking in — are you still open to new roles?"
                autoFocus
              />
              <div className={`bulk-meter ${template.length > MAX_BODY ? 'over' : ''}`}>
                <span>{formatSmsLength(measure) || 'Empty'}</span>
                {recipients.length > 0 && measure.segments > 0 && (
                  <span className="bulk-meter-total">
                    ≈{totalSegments} segment{totalSegments === 1 ? '' : 's'} billed across{' '}
                    {recipients.length}
                  </span>
                )}
              </div>
              {template.length > MAX_BODY && (
                <p className="bulk-warn">
                  <AlertCircle size={15} />
                  {template.length} characters — the limit is {MAX_BODY}. Shorten it or send in two
                  messages.
                </p>
              )}
              {measure.encoding === 'UCS-2' && measure.segments > 0 && (
                <p className="bulk-note">
                  A special character (emoji, curly quote, or em dash) puts this in UCS-2, which
                  holds {measure.perSegment} characters per segment instead of 160.
                </p>
              )}
            </div>
            <footer className="bulk-foot">
              <button
                className="bulk-primary"
                disabled={template.trim() === '' || template.length > MAX_BODY}
                onClick={() => setStep('review')}
              >
                Review {recipients.length} message{recipients.length === 1 ? '' : 's'}
              </button>
            </footer>
          </>
        )}

        {/* ── Step 3: review ───────────────────────────────────────────── */}
        {step === 'review' && (
          <>
            <div className="bulk-body">
              {withUnresolved.length > 0 && (
                <p className="bulk-warn">
                  <AlertCircle size={15} />
                  {withUnresolved.length} message{withUnresolved.length === 1 ? '' : 's'} still
                  contain a placeholder we couldn't fill. Remove it from the text or deselect those
                  contacts — it would be sent literally.
                </p>
              )}
              {error && (
                <p className="bulk-warn">
                  <AlertCircle size={15} />
                  {error}
                </p>
              )}
              {refusals.length > 0 && (
                <ul className="bulk-refusals">
                  {refusals.map((s, i) => (
                    <li key={`${s.phone}-${i}`}>
                      <strong>{formatPhone(s.phone)}</strong> {s.detail}
                    </li>
                  ))}
                </ul>
              )}
              {/* Every rendered message, verbatim. This is the last point at
                  which any of this can be called back. */}
              <ul className="bulk-preview">
                {recipients.map((r) => (
                  <li key={r.favoriteId} className={r.unresolved.length > 0 ? 'bad' : ''}>
                    <div className="bulk-preview-to">
                      {r.name} <span>{formatPhone(r.phone)}</span>
                    </div>
                    <div className="bulk-preview-body">{r.body}</div>
                    {r.unresolved.length > 0 && (
                      <div className="bulk-preview-err">
                        Didn't fill in: {r.unresolved.map((k) => `{${k}}`).join(' ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <footer className="bulk-foot">
              {blockedReason && <p className="bulk-blocked">{blockedReason}</p>}
              <button
                className="bulk-primary bulk-send"
                disabled={blockedReason !== null || sending}
                onClick={handleSend}
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="bulk-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send size={16} /> Send to {recipients.length}
                  </>
                )}
              </button>
            </footer>
          </>
        )}

        {/* ── Step 4: progress ─────────────────────────────────────────── */}
        {step === 'progress' && (
          <>
            <div className="bulk-body">
              {detail === null ? (
                <div className="bulk-empty">
                  <Loader2 size={24} className="bulk-spin" />
                  <p>Starting…</p>
                </div>
              ) : (
                <>
                  <div className="bulk-counts">
                    <span>
                      <strong>{detail.counts.delivered ?? 0}</strong> delivered
                    </span>
                    <span>
                      <strong>{detail.counts.sent}</strong> sent
                    </span>
                    {detail.counts.pending > 0 && (
                      <span>
                        <strong>{detail.counts.pending}</strong> waiting
                      </span>
                    )}
                    {(detail.counts.failed > 0 || (detail.counts.carrierFailed ?? 0) > 0) && (
                      <span className="bad">
                        <strong>
                          {detail.counts.failed + (detail.counts.carrierFailed ?? 0)}
                        </strong>{' '}
                        failed
                      </span>
                    )}
                  </div>
                  {detail.campaign.status === 'sending' && (
                    <p className="bulk-note">
                      <Clock size={14} /> Messages go out about one per second to protect
                      deliverability, so this takes roughly {Math.max(1, Math.ceil(detail.counts.pending / 60))}{' '}
                      minute{detail.counts.pending > 60 ? 's' : ''}. You can close this — it keeps
                      sending.
                    </p>
                  )}
                  {refusals.length > 0 && (
                    <ul className="bulk-refusals">
                      {refusals.map((s, i) => (
                        <li key={`${s.phone}-${i}`}>
                          <strong>{formatPhone(s.phone)}</strong> {s.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="bulk-progress">
                    {detail.recipients.map((r) => {
                      const done = r.carrierStatus === 'delivered';
                      const failed = r.status === 'failed' || r.carrierStatus === 'failed';
                      return (
                        <li key={r.id} className={failed ? 'bad' : ''}>
                          <span className="bulk-progress-icon">
                            {failed ? (
                              <XCircle size={16} />
                            ) : done ? (
                              <CheckCircle2 size={16} />
                            ) : r.status === 'sent' ? (
                              <Check size={16} />
                            ) : (
                              <Clock size={16} />
                            )}
                          </span>
                          <span className="bulk-progress-text">
                            <span className="bulk-progress-name">
                              {r.name ?? formatPhone(r.toNumber)}
                            </span>
                            <span className="bulk-progress-state">
                              {failed
                                ? (r.lastError ?? 'Carrier rejected it')
                                : done
                                  ? 'Delivered'
                                  : r.status === 'sent'
                                    ? 'Sent'
                                    : r.status === 'canceled'
                                      ? 'Canceled'
                                      : 'Waiting'}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <footer className="bulk-foot">
              <button className="bulk-primary" onClick={onClose}>
                Done
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
