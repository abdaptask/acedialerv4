// v0.10.216 — "Rewrite with AI" review sheet.
//
// Shows the original and the suggestion side by side and makes the user choose.
// The four actions are the whole point of this component:
//
//   Use this      → replaces the draft. Does NOT send.
//   Edit this     → replaces the draft and returns focus to the compose box.
//   Keep original → closes, changing nothing.
//   Regenerate    → asks again (capped, see MAX_REGENERATIONS).
//
// ── Nothing here can send a message ────────────────────────────────────
// This component has no access to the send path. Every action's most extreme
// outcome is "the text in the compose box changed" — the user still has to
// press Send afterwards. That's a deliberate structural guarantee rather than a
// policy: there is no code path from an AI suggestion to an outbound SMS that
// doesn't pass through the user's own Send click.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';

import { rewriteSmsDraft } from '../api';
import { formatSmsLength, measureSms } from '../lib/smsSegments';

/**
 * Each regeneration is a paid API call, and a user who hasn't liked three
 * suggestions is better served by editing than by rolling again.
 */
const MAX_REGENERATIONS = 3;

export default function SmsRewriteSheet({
  original,
  onUse,
  onEdit,
  onClose,
}: {
  original: string;
  /** Replace the draft and close. */
  onUse: (text: string) => void;
  /** Replace the draft, close, and focus the compose box. */
  onEdit: (text: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [verify, setVerify] = useState<string[]>([]);
  const [unchanged, setUnchanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  async function run() {
    const token = sessionStorage.getItem('ace_token');
    if (!token) {
      setError('Your session expired. Sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAttempts((n) => n + 1);

    const res = await rewriteSmsDraft(token, original);
    setLoading(false);

    if (res.ok && res.rewritten) {
      setRewritten(res.rewritten);
      setWarnings(res.warnings ?? []);
      setVerify(res.verify ?? []);
      setUnchanged(Boolean(res.unchanged));
    } else {
      setError(res.error ?? "Couldn't rewrite this message.");
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRegenerate = attempts < MAX_REGENERATIONS && !loading;
  const measure = rewritten ? measureSms(rewritten) : null;

  return (
    <div className="compose-modal" onClick={loading ? undefined : onClose}>
      <div
        className="fav-modal sms-rewrite-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sms-rewrite-title"
        style={{ maxWidth: 620 }}
      >
        <div className="fav-modal-header">
          <Sparkles size={18} className="fav-modal-icon" />
          <h3 id="sms-rewrite-title">Rewrite with AI</h3>
        </div>

        <div className="sms-rewrite-block">
          <div className="sms-rewrite-label">Original</div>
          <div className="sms-rewrite-text is-original">{original}</div>
        </div>

        <div className="sms-rewrite-block">
          <div className="sms-rewrite-label">Suggested</div>
          {loading ? (
            <div className="sms-rewrite-text is-loading">Rewriting…</div>
          ) : error ? (
            <div className="error small">{error}</div>
          ) : (
            <>
              <div className="sms-rewrite-text is-suggested">{rewritten}</div>
              {measure && (
                <div className="muted small" style={{ marginTop: 6 }}>
                  {formatSmsLength(measure)}
                </div>
              )}
            </>
          )}
        </div>

        {unchanged && !loading && !error && (
          <div className="muted small sms-rewrite-note">
            No changes suggested — your message already reads well.
          </div>
        )}

        {/* Directed review. "Please proofread" is a weak instruction — people
            read for whether text sounds right, not for whether it still says
            what they meant. Naming the exact tokens to check turns the review
            the user is already doing into a targeted one, which is what makes
            relying on human review reasonable in the first place. */}
        {verify.length > 0 && !loading && !error && (
          <div className="sms-rewrite-verify">
            <span className="sms-rewrite-verify-label">Verify</span>
            {verify.map((f) => (
              <code key={f} className="sms-rewrite-verify-item">
                {f}
              </code>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="sms-rewrite-warnings">
            {warnings.map((w) => (
              <div key={w} className="sms-rewrite-warning">
                <AlertTriangle size={14} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="sms-rewrite-actions">
          {/* Keep original is always available and always safe — it's first in
              tab order after the destructive-free actions for that reason. */}
          <button type="button" className="device-action" onClick={onClose}>
            <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Keep original
          </button>
          <button
            type="button"
            className="device-action"
            onClick={() => void run()}
            disabled={!canRegenerate}
            title={
              attempts >= MAX_REGENERATIONS
                ? `Regeneration limit reached (${MAX_REGENERATIONS}). Edit the suggestion instead.`
                : undefined
            }
          >
            <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Regenerate
          </button>
          <button
            type="button"
            className="device-action"
            onClick={() => rewritten && onEdit(rewritten)}
            disabled={loading || !rewritten}
          >
            <Pencil size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Edit this
          </button>
          <button
            type="button"
            className="device-action primary"
            onClick={() => rewritten && onUse(rewritten)}
            disabled={loading || !rewritten}
          >
            <Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Use this
          </button>
        </div>

        <p className="muted small sms-rewrite-footnote">
          Nothing is sent until you press Send.
        </p>
      </div>
    </div>
  );
}
