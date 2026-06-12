// Post-decline reply modal — surfaces a quick-reply sheet AFTER an inbound
// call has been declined via the "Reply" button on IncomingCall.
//
// Mounted ONCE in Layout (outside IncomingCall) so it survives the
// IncomingCall component unmounting the instant declineCall() flips
// `incoming` to null. Listens for the `ace:reply-after-decline` window
// event dispatched from IncomingCall.tsx, opens a sheet, sends the SMS,
// then auto-closes after a brief success state.

import { useEffect, useState } from 'react';
import { MessageSquare, X, Send, Check } from 'lucide-react';
import { getQuickReplies } from '../lib/userPrefs';
import { sendMessage } from '../api';
import { formatPhone } from '../lib/phone';

interface ReplyEvent {
  number: string;
  label: string;
}
type Phase = 'idle' | 'open' | 'sending' | 'sent' | 'error';

export default function PostDeclineReply() {
  const [event, setEvent] = useState<ReplyEvent | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<string[]>(() => getQuickReplies());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ReplyEvent>).detail;
      if (!detail?.number) return;
      setEvent(detail);
      setPhase('open');
      setError(null);
      setCustom('');
      setReplies(getQuickReplies());
    };
    window.addEventListener('ace:reply-after-decline', handler);
    return () => window.removeEventListener('ace:reply-after-decline', handler);
  }, []);

  useEffect(() => {
    const refresh = () => setReplies(getQuickReplies());
    window.addEventListener('ace:quickRepliesChanged', refresh);
    return () => window.removeEventListener('ace:quickRepliesChanged', refresh);
  }, []);

  if (!event || phase === 'idle') return null;

  async function handleSend(body: string) {
    const text = body.trim();
    if (!text || !event) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) {
      setError('Not signed in.');
      setPhase('error');
      return;
    }
    setPhase('sending');
    setError(null);
    try {
      await sendMessage(token, { to: event.number, body: text });
      setPhase('sent');
      setTimeout(() => {
        setEvent(null);
        setPhase('idle');
      }, 1400);
    } catch (err) {
      setError((err as Error).message || 'Could not send.');
      setPhase('error');
    }
  }

  function handleClose() {
    setEvent(null);
    setPhase('idle');
  }

  return (
    <div className="post-decline-overlay" onClick={handleClose}>
      <div
        className="post-decline-sheet"
        role="dialog"
        aria-labelledby="post-decline-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="post-decline-header">
          <div className="post-decline-header-text">
            <div className="post-decline-tag">Call declined</div>
            <h3 id="post-decline-title" className="post-decline-title">
              Reply to {event.label || formatPhone(event.number)}
            </h3>
          </div>
          <button
            type="button"
            className="post-decline-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {phase === 'sent' ? (
          <div className="post-decline-success">
            <div className="post-decline-success-icon">
              <Check size={24} />
            </div>
            <div>
              <strong>Message sent</strong>
              <div className="muted small">They\u2019ll get a text from your number.</div>
            </div>
          </div>
        ) : (
          <>
            {replies.length === 0 ? (
              <div className="post-decline-empty">
                <MessageSquare size={20} style={{ opacity: 0.55 }} />
                <div>
                  No quick replies set up yet.{' '}
                  <span className="muted small">
                    Add some in Settings &rarr; Quick replies, or type a custom message below.
                  </span>
                </div>
              </div>
            ) : (
              <ul className="post-decline-replies">
                {replies.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="post-decline-reply-item"
                      disabled={phase === 'sending'}
                      onClick={() => void handleSend(r)}
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="post-decline-custom">
              <input
                type="text"
                placeholder="Or type a custom message\u2026"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && custom.trim()) {
                    void handleSend(custom);
                  }
                }}
                disabled={phase === 'sending'}
                autoFocus
              />
              <button
                type="button"
                className="post-decline-send"
                disabled={!custom.trim() || phase === 'sending'}
                onClick={() => void handleSend(custom)}
                aria-label="Send"
              >
                <Send size={14} />
                {phase === 'sending' ? 'Sending\u2026' : 'Send'}
              </button>
            </div>

            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}

            <div className="post-decline-skip">
              <button type="button" className="post-decline-skip-btn" onClick={handleClose}>
                Skip \u2014 don\u2019t send anything
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
