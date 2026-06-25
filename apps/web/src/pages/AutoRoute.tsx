// v0.10.2 Pillar 2 / Task 10 — Universal-action redirect pages.
//
// These routes are the targets of action buttons in Teams Adaptive
// Cards (Call back / Send text / Reply). They unify desktop + web
// behaviour:
//
//   1. Try to launch the desktop ACE Dialer via the custom protocol
//      ace-dialer://call?to=... (or ...sms?to=...). On the user's
//      desktop the protocol handler (Electron main process — see
//      apps/desktop/src/main.ts) catches this and focuses the app
//      with the recipient pre-filled.
//
//   2. After ~1.2s — long enough for the OS to launch the protocol
//      handler if it exists — fall back to the in-browser dialer.
//      Navigate to /keypad?to=... or /messages?to=... so the user
//      can act from the web app instead. This also covers mobile,
//      where there's no desktop app.
//
// If the user IS logged in, navigation to /keypad / /messages uses
// the existing Dialpad / Messages pages (their query-param handlers
// already accept `?to=`). If NOT logged in, App.tsx's route guard
// stashes the requested URL in ace_return_to and bounces to /login;
// after SSO the user lands back here and the auto-flow completes.
//
// Visible UI is a tiny holding screen — "Opening ACE Dialer…" with a
// fallback button — so the user understands what's happening if the
// protocol launch is blocked or slow.

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';

interface AutoRouteProps {
  /** 'call' for /auto/call, 'sms' for /auto/sms, 'voicemail' for
   *  /auto/voicemail (v0.10.156). Drives the protocol scheme suffix
   *  + the eventual web route the fallback navigates to. */
  action: 'call' | 'sms' | 'voicemail';
}

export default function AutoRoute({ action }: AutoRouteProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // v0.10.156 - call/sms carry a 'to' phone number; voicemail carries
  // an 'id' (DB row id of the voicemail to play). Read the right param
  // based on action so the rest of the component is action-agnostic.
  const to = action === 'voicemail'
    ? (params.get('id') ?? '')
    : (params.get('to') ?? '');
  const [protocolTried, setProtocolTried] = useState(false);

  useEffect(() => {
    if (!to) {
      // Missing required param — bounce to a sensible fallback page.
      const missingFallback =
        action === 'call' ? '/keypad' :
        action === 'sms' ? '/messages' :
        '/voicemail';
      navigate(missingFallback, { replace: true });
      return;
    }

    // v0.10.67 — If we're ALREADY inside the Electron desktop app, skip
    // the protocol launch entirely. Trying ace-dialer:// from inside
    // Electron either does nothing (if the protocol handler defers to
    // the running instance) or bounces the user out to a "no handler"
    // browser dialog. Just navigate directly to the destination route
    // inside this same Electron window.
    const inElectron = typeof window !== 'undefined' && !!(window as { ace?: unknown }).ace;
    if (inElectron) {
      const webRoute =
        action === 'call' ? `/keypad?to=${encodeURIComponent(to)}` :
        action === 'sms'  ? `/messages?to=${encodeURIComponent(to)}` :
                            `/voicemail/${encodeURIComponent(to)}/play`;
      navigate(webRoute, { replace: true });
      return;
    }

    // v0.10.6 — switched from a hidden-iframe protocol launch to
    // window.location.href. Modern Chrome / Edge block iframe-driven
    // custom-protocol launches as a silent-redirect security measure,
    // which made the previous implementation always fall back to web
    // even when the desktop app was installed.
    //
    // v0.10.156 - voicemail action uses ?id= query param to match the
    // Electron protocol-handler's parsing (see apps/desktop/src/main.ts
    // routeProtocolUrl).
    const url = action === 'voicemail'
      ? `ace-dialer://voicemail?id=${encodeURIComponent(to)}`
      : `ace-dialer://${action}?to=${encodeURIComponent(to)}`;
    // v0.10.208 - Telemetry. Lets us confirm in diagnostic logs that the
    // browser tab actually fired the protocol launch when a user reports
    // "I clicked the Teams Reply button and nothing happened."
    console.info('[autoroute] firing protocol url:', url);
    try {
      window.location.href = url;
    } catch (e) {
      console.warn('[autoroute] window.location.href threw', e);
    }
    setProtocolTried(true);

    // v0.10.71 — After firing the protocol launch, try to close the tab
    // so the user isn't left staring at "Opening the composer…" forever
    // in a leftover browser tab while Electron has already focused.
    // window.close() is rejected by browsers for tabs that weren't
    // script-opened, BUT it succeeds in many cases when the tab was
    // opened from an external app (Teams). Worth trying. If it fails,
    // the page stays put with the "Open in browser composer" fallback
    // button so the user can recover if Electron didn't open.
    //
    // We also DROPPED the auto-navigate to /messages after 8s. Previously
    // the page silently bounced unauthenticated browser sessions through
    // /login → /messages, which was alarming when the user just wanted
    // the desktop app. Now the page stays on AutoRoute showing the
    // explicit "Open in browser composer" button — user-driven fallback
    // only, no surprise redirects.
    const closeTimer = setTimeout(() => {
      try {
        window.close();
      } catch {
        /* harmless — fallback UI already shown */
      }
    }, 1500);

    return () => clearTimeout(closeTimer);
  }, [to, action, navigate]);

  // v0.10.156 - voicemail variant gets its own label + fallback.
  const label =
    action === 'call' ? 'Opening the dialer' :
    action === 'sms'  ? 'Opening the composer' :
                        'Opening voicemail';
  const fallbackText =
    action === 'call' ? 'Open in browser dialer' :
    action === 'sms'  ? 'Open in browser composer' :
                        'Open voicemail in browser';
  const fallbackRoute =
    action === 'call' ? `/keypad?to=${encodeURIComponent(to)}` :
    action === 'sms'  ? `/messages?to=${encodeURIComponent(to)}` :
                        `/voicemail/${encodeURIComponent(to)}/play`;

  return (
    <div className="auto-route-page">
      <div className="auto-route-card">
        <Loader2 size={28} className="spin" />
        <h2>{label}…</h2>
        <p className="muted">
          {protocolTried
            ? 'ACE Dialer should be opening on your desktop. You can close this tab — or use the button below if you want to use the browser instead.'
            : 'Launching ACE Dialer…'}
        </p>
        <button
          type="button"
          className="settings-btn"
          onClick={() => navigate(fallbackRoute, { replace: true })}
        >
          {fallbackText} <ArrowRight size={14} />
        </button>
        {/* v0.10.71 — Explicit "close this tab" button. window.close() is
            attempted automatically 1.5s after page mount, but browsers
            often reject it for tabs they didn't open via window.open().
            This button gives the user a one-click way to dismiss the tab
            once Electron is up — at minimum it tries window.close() and
            in browsers that allow it, the tab vanishes; in browsers that
            don't, nothing happens and the user closes the tab manually. */}
        <button
          type="button"
          className="settings-btn"
          style={{ marginTop: 8, background: 'transparent' }}
          onClick={() => {
            try { window.close(); } catch { /* noop */ }
          }}
        >
          Close this tab
        </button>
      </div>
    </div>
  );
}
