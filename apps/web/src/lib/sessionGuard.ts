// Phase 6.4 — session guard.
//
// Two scenarios where the user is effectively logged out but the UI
// doesn't know it yet:
//
//   1. JWT expired or revoked → next API call returns 401. Without
//      intervention the user sees an empty screen, no Recents, etc.,
//      and has to know to refresh.
//   2. SIP registration has been failing for a long time (Telnyx
//      credentials changed, network died, etc.). The dialer status
//      shows red but the user can stay on Recents/Messages forever
//      without realising they can't take or make calls.
//
// This module installs a window.fetch interceptor that surfaces (1) as
// a global 'ace:session-expired' CustomEvent the App component listens
// for. It also exposes a startSipWatchdog() helper that fires the same
// event when SipContext has reported 'failed' for too long.
//
// Why event-bus + interceptor instead of refactoring every fetch in
// api.ts: the API surface is ~30 functions, and a centralized fetch
// wrap covers them all (plus future ones) without changing signatures.

const SESSION_EVENT = 'ace:session-expired' as const;
const TOKEN_KEY = 'ace_token';

/** How long SIP can stay 'failed' before we treat it as a session loss
 *  and ask the user to log back in. 30s is enough to ride out a brief
 *  network hiccup but short enough that the user isn't stuck staring
 *  at a dead dialer for minutes. */
// v0.10.10 — extended from 30s to 90s. Network blips on India-US
// connections (the majority of our users) can run 30-60s during ISP
// route flaps; the previous 30s threshold was kicking users to
// /login during recoverable transients. With the v0.10.10 SIP retry
// covering ~2min of attempts, 90s here gives the retry path enough
// time to succeed before we declare the session dead.
const SIP_FAILED_GRACE_MS = 90_000;

let installed = false;

/** Fire-and-forget broadcast — App listens. */
function emitExpired(reason: 'jwt_expired' | 'sip_failed'): void {
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason } }));
  } catch {
    /* noop */
  }
}

/**
 * Wrap window.fetch once so every 401 from our API (regardless of which
 * helper made the call) routes to the same logout flow.
 *
 * Safety guards:
 *   - Only fires when the user IS holding a token (otherwise a 401 is
 *     just "login failed", which is expected and handled by Login.tsx).
 *   - Only fires for requests against the API base URL — third-party
 *     fetches (Telnyx media, JobDiva, etc.) are passed through unchanged.
 *   - Idempotent: a second install() call is a no-op so dev HMR doesn't
 *     stack interceptors.
 */
export function installSessionGuard(): void {
  if (installed) return;
  installed = true;

  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const isApi = apiBase && url.startsWith(apiBase);
      const hasToken = !!sessionStorage.getItem(TOKEN_KEY);
      if (res.status === 401 && isApi && hasToken) {
        emitExpired('jwt_expired');
      }
    } catch {
      /* never let the guard break the original fetch result */
    }
    return res;
  };
}

/**
 * Subscribe to session-expired events. Returns an unsubscribe fn.
 * The handler receives the reason ('jwt_expired' or 'sip_failed') so
 * the UI can show an appropriate toast.
 */
export function onSessionExpired(
  handler: (reason: 'jwt_expired' | 'sip_failed') => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ reason: 'jwt_expired' | 'sip_failed' }>).detail;
    handler(detail?.reason ?? 'jwt_expired');
  };
  window.addEventListener(SESSION_EVENT, listener);
  return () => window.removeEventListener(SESSION_EVENT, listener);
}

/**
 * Watch SipContext's state. If it stays 'failed' for SIP_FAILED_GRACE_MS
 * and the user is supposed to be logged in (has a token), trigger the
 * same session-expired flow. Returns a function the caller MUST invoke
 * on every state change to feed the watchdog.
 *
 * v0.10.60 — Parameter widened to accept all SipState values (including the
 * new 'reconnecting' beta state). Only 'failed' triggers the countdown;
 * every other state — including 'reconnecting' — clears it, so the
 * behavior is unchanged for non-beta users.
 */
export function createSipWatchdog(): {
  report: (state: 'disconnected' | 'connecting' | 'registered' | 'reconnecting' | 'failed') => void;
  stop: () => void;
} {
  let firstFailedAt: number | null = null;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  return {
    report(state) {
      if (state === 'failed') {
        if (firstFailedAt === null) {
          firstFailedAt = Date.now();
          clearTimer();
          timer = window.setTimeout(() => {
            // Re-check before firing — the user may have logged out
            // entirely in the meantime.
            if (!sessionStorage.getItem(TOKEN_KEY)) return;
            emitExpired('sip_failed');
          }, SIP_FAILED_GRACE_MS);
        }
      } else {
        // Any non-failed state cancels the countdown — even 'connecting'
        // (it might still recover).
        firstFailedAt = null;
        clearTimer();
      }
    },
    stop() {
      firstFailedAt = null;
      clearTimer();
    },
  };
}
