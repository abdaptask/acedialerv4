// Phase 5.2: full-screen UI when an inbound call rings, plus OS-level
// notification + Electron window restore so the user never misses a call.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Phone, PhoneOff } from 'lucide-react';
import { useSip } from '../contexts/SipContext';
import { ringtone } from '../services/ringtone';

function formatNumber(n: string | undefined): string {
  if (!n) return 'Unknown';
  const digits = n.replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return n;
}

// Ask permission for OS notifications lazily — most browsers want this off
// a user gesture, but Electron grants it automatically.
let notifPermissionAsked = false;
async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (notifPermissionAsked) return false;
  notifPermissionAsked = true;
  try {
    const p = await Notification.requestPermission();
    return p === 'granted';
  } catch {
    return false;
  }
}

export default function IncomingCall() {
  const { incoming, acceptCall, declineCall } = useSip();
  const location = useLocation();
  const lastNotifiedRef = useRef<string | null>(null);

  // Side-effects when a new incoming call shows up.
  useEffect(() => {
    if (!incoming) return;

    // 1. Ringtone
    ringtone.start();

    // 2. Tell the Electron main process to restore/focus/flash the window.
    //    The preload bridge exposes window.ace.onIncomingCall(...).
    if (window.ace?.onIncomingCall) {
      try {
        window.ace.onIncomingCall(incoming.fromNumber ?? incoming.number);
      } catch (e) {
        console.warn('[incoming] electron bridge failed', e);
      }
    }

    // 3. OS notification (browser toast / Windows action center).
    //    Only fire once per call, and only if the window isn't already focused.
    if (incoming.callId && lastNotifiedRef.current !== incoming.callId) {
      lastNotifiedRef.current = incoming.callId;
      const hidden =
        typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
      if (hidden) {
        void (async () => {
          const ok = await ensureNotificationPermission();
          if (!ok) return;
          try {
            const n = new Notification('Incoming call', {
              body: formatNumber(incoming.fromNumber ?? incoming.number),
              tag: incoming.callId,
              requireInteraction: true,
              silent: true, // we already play our own ring
            });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } catch (e) {
            console.warn('[incoming] Notification failed', e);
          }
        })();
      }
    }

    return () => {
      ringtone.stop();
    };
  }, [incoming]);

  if (!incoming) return null;

  // Electron: always go full-screen. Web: full-screen on idle, banner elsewhere.
  const isElectron =
    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
  const fullScreen =
    isElectron ||
    location.pathname === '/keypad' ||
    location.pathname === '/' ||
    location.pathname === '/login';

  const callerLabel = formatNumber(incoming.fromNumber ?? incoming.number);

  return fullScreen ? (
    <div className="incoming-fullscreen">
      <div className="incoming-fs-inner">
        <div className="incoming-tag">Incoming call</div>
        <div className="incoming-caller">{callerLabel}</div>
        <div className="incoming-subtle">…</div>
        <div className="incoming-actions">
          <button
            className="incoming-btn decline"
            onClick={declineCall}
            aria-label="Decline"
          >
            <PhoneOff size={28} />
          </button>
          <button
            className="incoming-btn accept"
            onClick={acceptCall}
            aria-label="Accept"
          >
            <Phone size={28} />
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="incoming-banner" role="alert">
      <div className="incoming-banner-text">
        <div className="incoming-banner-tag">Incoming call</div>
        <div className="incoming-banner-caller">{callerLabel}</div>
      </div>
      <div className="incoming-banner-actions">
        <button
          className="incoming-btn decline small"
          onClick={declineCall}
          aria-label="Decline"
        >
          <PhoneOff size={20} />
        </button>
        <button
          className="incoming-btn accept small"
          onClick={acceptCall}
          aria-label="Accept"
        >
          <Phone size={20} />
        </button>
      </div>
    </div>
  );
}
