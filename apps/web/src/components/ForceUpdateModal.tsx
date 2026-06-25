// v0.10.205 — Blocking force-update modal.
//
// HOW IT FIRES
//   HeartbeatReporter dispatches a CustomEvent 'ace:force-update-required'
//   with { deviceId, requestedAt } in detail when the server-side
//   forceUpdate flag flips on for this device. This component listens
//   for that event and takes over the update flow.
//
// WHAT IT DOES
//   1. Kicks off ace.checkForUpdates() (Electron) to begin background
//      download. Web users skip straight to "reload required."
//   2. Subscribes to ace.onUpdateDownloaded / onUpdateProgress /
//      onUpdateError + ace.getUpdateState() to track download state.
//   3. Renders a full-viewport backdrop (z-index 100000+) so the user
//      cannot use the app until the update lands. Centered modal with
//      live status: "Downloading 67%" -> "Ready to install" -> button
//      "Install & Restart" (auto-clicks after 10s if downloaded).
//   4. DEFERS the install while sipService.calls.size > 0 OR
//      sipService.incomingCallId !== null. Shows a slim banner along
//      the top instead of the full block so the user can keep working
//      the call. The moment the call ends (subscribing to sipService
//      'state' events + polling calls.size as a backstop), the full
//      block surfaces again and install proceeds.
//   5. Before triggering ace.installUpdate(), calls ackForceUpdate()
//      so the server knows this device satisfied the request.
//
// WEB FALLBACK
//   No window.ace? Show the blocking modal with text "Reload required"
//   + a "Reload now" button that calls window.location.reload(). Web
//   users on the freshest Vercel bundle pick up the latest code on
//   the next reload.

import { useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle, RefreshCcw } from 'lucide-react';
import { ackForceUpdate } from '../api';
import { sipService } from '../services/sip';

type ModalState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number; version: string | null }
  | { phase: 'downloaded'; version: string | null }
  | { phase: 'installing' }
  | { phase: 'error'; message: string }
  | { phase: 'web-reload-required' };

const AUTO_INSTALL_AFTER_DOWNLOAD_MS = 10_000;

function hasActiveCall(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = sipService as any;
  try {
    const callCount = svc?.calls?.size ?? 0;
    const incoming = svc?.incomingCallId ?? null;
    return callCount > 0 || incoming !== null;
  } catch {
    return false;
  }
}

export default function ForceUpdateModal() {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<ModalState>({ phase: 'idle' });
  const [onCall, setOnCall] = useState(false);
  const deviceIdRef = useRef<string | null>(null);
  const installAckedRef = useRef(false);
  const autoInstallTimerRef = useRef<number | null>(null);

  // Listen for the trigger event from HeartbeatReporter.
  useEffect(() => {
    const onTrigger = (e: Event) => {
      const detail = (e as CustomEvent).detail as { deviceId?: string } | null;
      const deviceId = detail?.deviceId ?? null;
      if (!deviceId) return;
      if (active) return; // already running
      deviceIdRef.current = deviceId;
      setActive(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const ace = w.ace;
      if (!ace?.isElectron || typeof ace.checkForUpdates !== 'function') {
        // Web fallback — no Electron auto-updater. The user will need
        // to reload to pick up a new Vercel bundle.
        setState({ phase: 'web-reload-required' });
        return;
      }

      setState({ phase: 'checking' });
      // Kick off the silent background download. Errors come back via
      // the onUpdateError subscription below.
      ace.checkForUpdates().catch(() => undefined);

      // Rehydrate from main-process state-mirror in case the download
      // already completed in a prior heartbeat cycle.
      if (typeof ace.getUpdateState === 'function') {
        void ace.getUpdateState().then((s: { phase?: string; version?: string | null; percent?: number; message?: string } | null) => {
          if (!s) return;
          if (s.phase === 'downloaded') {
            setState({ phase: 'downloaded', version: s.version ?? null });
          } else if (s.phase === 'downloading') {
            setState({ phase: 'downloading', percent: s.percent ?? 0, version: s.version ?? null });
          } else if (s.phase === 'error') {
            setState({ phase: 'error', message: s.message ?? 'Update failed' });
          }
        }).catch(() => undefined);
      }
    };
    window.addEventListener('ace:force-update-required', onTrigger as EventListener);
    return () => window.removeEventListener('ace:force-update-required', onTrigger as EventListener);
  }, [active]);

  // Subscribe to autoUpdater events once we're active.
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.isElectron) return;

    const unsubProg = ace.onUpdateProgress?.((info: { percent?: number; version?: string | null }) => {
      setState({ phase: 'downloading', percent: info.percent ?? 0, version: info.version ?? null });
    });
    const unsubDone = ace.onUpdateDownloaded?.((info: { version?: string | null }) => {
      setState({ phase: 'downloaded', version: info.version ?? null });
    });
    const unsubErr = ace.onUpdateError?.((info: { message?: string }) => {
      setState({ phase: 'error', message: info.message ?? 'Update failed' });
    });

    return () => {
      unsubProg?.();
      unsubDone?.();
      unsubErr?.();
    };
  }, [active]);

  // Watch active-call state — both via the sipService 'state' event
  // (fires synchronously on call lifecycle changes) and a 1s polling
  // backstop in case the event misses an edge.
  useEffect(() => {
    if (!active) return;
    const tick = () => setOnCall(hasActiveCall());
    tick();
    const id = window.setInterval(tick, 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = sipService as any;
    let off: (() => void) | undefined;
    try {
      if (typeof svc?.on === 'function') {
        off = svc.on('state', tick);
        if (typeof off !== 'function') off = undefined;
      }
    } catch { /* noop */ }
    return () => {
      window.clearInterval(id);
      off?.();
    };
  }, [active]);

  // Auto-install 10s after download completes, but ONLY if we're not
  // on a call. If we are, hold off — the next call-ended tick will
  // re-evaluate and fire install.
  useEffect(() => {
    if (state.phase !== 'downloaded') {
      if (autoInstallTimerRef.current !== null) {
        window.clearTimeout(autoInstallTimerRef.current);
        autoInstallTimerRef.current = null;
      }
      return;
    }
    if (onCall) return;
    if (autoInstallTimerRef.current !== null) return;
    autoInstallTimerRef.current = window.setTimeout(() => {
      autoInstallTimerRef.current = null;
      void handleInstall();
    }, AUTO_INSTALL_AFTER_DOWNLOAD_MS);
    return () => {
      if (autoInstallTimerRef.current !== null) {
        window.clearTimeout(autoInstallTimerRef.current);
        autoInstallTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, onCall]);

  async function handleInstall() {
    if (state.phase === 'installing') return;
    setState({ phase: 'installing' });
    // Ack BEFORE quit so the server records satisfaction even if the
    // OS kills us mid-install. Best-effort — we proceed even if ack
    // fails.
    if (!installAckedRef.current) {
      installAckedRef.current = true;
      const token = sessionStorage.getItem('ace_token');
      const deviceId = deviceIdRef.current;
      if (token && deviceId) {
        try { await ackForceUpdate(token, deviceId); } catch { /* noop */ }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.isElectron || typeof ace.installUpdate !== 'function') {
      // Web fallback — reload picks up the latest Vercel bundle.
      window.location.reload();
      return;
    }
    void ace.installUpdate().catch((e: unknown) => {
      setState({ phase: 'error', message: (e as Error)?.message ?? 'Install failed' });
    });
  }

  function handleRetry() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.checkForUpdates) return;
    setState({ phase: 'checking' });
    void ace.checkForUpdates().catch(() => undefined);
  }

  if (!active) return null;

  // -------- Render --------
  const statusText = (() => {
    if (state.phase === 'checking') return 'Preparing the update…';
    if (state.phase === 'downloading') return `Downloading update… ${Math.round(state.percent)}%`;
    if (state.phase === 'downloaded') return onCall ? 'Ready — installing when your call ends' : 'Ready to install';
    if (state.phase === 'installing') return 'Installing — the app will restart momentarily…';
    if (state.phase === 'error') return state.message;
    if (state.phase === 'web-reload-required') return 'Reload to pick up the latest version.';
    return '';
  })();

  const showInstallButton =
    state.phase === 'downloaded' ||
    state.phase === 'error' ||
    state.phase === 'web-reload-required';
  const installLabel =
    state.phase === 'web-reload-required' ? 'Reload now'
    : state.phase === 'error' ? 'Try again'
    : 'Install & Restart now';
  const onInstallClick =
    state.phase === 'error' ? handleRetry
    : state.phase === 'web-reload-required' ? () => window.location.reload()
    : handleInstall;

  // ------- Active-call slim banner (does not block the UI) ---------
  if (onCall && state.phase !== 'installing') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99998,
          background: 'linear-gradient(180deg, #b45309, #92400e)',
          color: '#fff',
          padding: '10px 16px',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}
      >
        <Download size={14} aria-hidden="true" />
        <strong style={{ marginRight: 6 }}>Required update —</strong>
        <span>will install automatically when your current call ends.</span>
      </div>
    );
  }

  // ------- Full blocking modal -----------------------------------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ace-force-update-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated, #1c1c1e)',
          color: 'var(--text, #fff)',
          borderRadius: 14,
          maxWidth: 440,
          width: '100%',
          padding: '28px 28px 24px',
          boxShadow: '0 25px 60px -12px rgba(0,0,0,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: state.phase === 'error' ? 'rgba(220,38,38,0.15)' : 'rgba(59,130,246,0.15)',
            color: state.phase === 'error' ? '#dc2626' : '#3b82f6',
            display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}
          aria-hidden="true"
        >
          {state.phase === 'error'
            ? <AlertTriangle size={28} />
            : state.phase === 'installing'
              ? <RefreshCcw size={28} />
              : <Download size={28} />}
        </div>
        <h2
          id="ace-force-update-title"
          style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}
        >
          {state.phase === 'error' ? 'Update failed' : 'Required update'}
        </h2>
        <p
          style={{
            margin: '10px 0 18px',
            color: 'var(--text-dim, rgba(235,235,245,0.7))',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {state.phase === 'error'
            ? 'The update could not be downloaded or installed. You can try again.'
            : 'Your administrator has required all dialer clients to update to the latest version. The dialer will install and restart automatically.'}
        </p>
        {state.phase === 'downloading' && (
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
              marginBottom: 12,
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: `${Math.max(2, Math.min(100, state.percent))}%`,
                height: '100%',
                background: '#3b82f6',
                transition: 'width 240ms ease-out',
              }}
            />
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-muted, rgba(235,235,245,0.5))',
            marginBottom: 18,
            minHeight: 18,
          }}
          aria-live="polite"
        >
          {statusText}
        </div>
        {showInstallButton && (
          <button
            type="button"
            onClick={onInstallClick}
            style={{
              appearance: 'none',
              border: 'none',
              background: state.phase === 'error' ? '#dc2626' : '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              padding: '11px 22px',
              borderRadius: 999,
              cursor: 'pointer',
              minWidth: 200,
            }}
          >
            {installLabel}
          </button>
        )}
        {state.phase === 'downloaded' && !onCall && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--text-muted, rgba(235,235,245,0.45))',
            }}
          >
            Installing automatically in a few seconds…
          </div>
        )}
      </div>
    </div>
  );
}
