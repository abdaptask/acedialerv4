// v0.10.26 — Background poller for new voicemail desktop notifications.
//
// Mounted globally in Layout (alongside SmsNotifier) so it runs on every
// page after login. Every 30s it polls the voicemail list, compares against
// the last-seen state, and fires a toast + desktop notification for any
// newly-arrived voicemail.
//
// Why a separate component (instead of folding into SmsNotifier):
//   - Different data source (/voicemails)
//   - Slower poll cadence (voicemails are lower-volume than SMS)
//   - Separate user pref (voicemailNotification)
//   - Different click target (/voicemail/:id/play)

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mic, X } from 'lucide-react';
import { getVoicemails, type VoicemailRecord } from '../api';
import { getNotificationPrefs } from '../lib/userPrefs';
import { notify } from '../lib/notify';
import { getCachedJobDivaName } from '../hooks/useJobDivaContact';
import { formatPhone } from '../lib/phone';

const POLL_MS = 30_000;

interface ToastEvent {
  id: string;
  contactLabel: string;
  preview: string;
  voicemailId: number;
}

function formatNumber(n: string | undefined | null): string {
  return formatPhone(n ?? '');
}

export default function VoicemailNotifier() {
  // Track each voicemail id we've already seen so we don't re-fire on every
  // poll. Seeded on first poll to suppress noise for pre-existing rows.
  const seenIdsRef = useRef<Set<number> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  // Don't fire while user is already on the voicemail page.
  const onVoicemailPage = location.pathname.startsWith('/voicemail');

  useEffect(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;

    let cancelled = false;

    async function pollOnce() {
      if (cancelled) return;
      try {
        const list = await getVoicemails(token!);
        const ids = new Set(list.map((v) => v.id));

        const prev = seenIdsRef.current;
        if (!prev) {
          // First poll — record state, no notifications.
          seenIdsRef.current = ids;
          return;
        }

        // Find newly-arrived voicemails (id not seen before, AND not listened).
        const newOnes: VoicemailRecord[] = [];
        for (const v of list) {
          if (!prev.has(v.id) && !v.listenedAt) newOnes.push(v);
        }
        seenIdsRef.current = ids;

        if (newOnes.length === 0) return;
        const prefs = getNotificationPrefs();
        if (!prefs.voicemailNotification) return;

        for (const v of newOnes) {
          if (onVoicemailPage) continue; // already viewing the list

          const label = getCachedJobDivaName(v.fromNumber) ?? formatNumber(v.fromNumber);
          const preview = v.transcription
            ? (v.transcription.length > 80
                ? v.transcription.slice(0, 80) + '…'
                : v.transcription)
            : `${v.durationSeconds}s voicemail`;

          setToasts((cur) => [
            { id: `vm-${v.id}-${Date.now()}`, contactLabel: label, preview, voicemailId: v.id },
            ...cur,
          ].slice(0, 4));

          void notify({
            title: `New voicemail from ${label}`,
            body: preview,
            tag: `vm-${v.id}`,
            prefKey: 'voicemailNotification',
            onClick: () => navigate(`/voicemail/${v.id}/play`),
          });
        }
      } catch {
        // ignore poll errors silently
      }
    }

    void pollOnce();
    const id = window.setInterval(pollOnce, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(id: string) {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }
  function open(t: ToastEvent) {
    navigate(`/voicemail/${t.voicemailId}/play`);
    dismiss(t.id);
  }

  // Auto-dismiss each toast after 8s (slightly longer than SMS for VM).
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), 8_000),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="sms-toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="sms-toast vm-toast" role="status">
          <button type="button" className="sms-toast-body" onClick={() => open(t)}>
            <span className="sms-toast-icon"><Mic size={16} /></span>
            <span className="sms-toast-text">
              <span className="sms-toast-name">{t.contactLabel}</span>
              <span className="sms-toast-preview">{t.preview}</span>
            </span>
          </button>
          <button
            type="button"
            className="sms-toast-close"
            onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
