// Phase 7 — Login page is now primarily a "Sign in with Microsoft" landing.
//
// The flow:
//   1. On mount, fetch /auth/microsoft/config to see whether SSO is wired up
//      on the backend. If yes, render the big Microsoft button.
//   2. Clicking Microsoft → generate PKCE codeVerifier + state, stash both
//      in sessionStorage, navigate to Microsoft's authorize endpoint.
//   3. Microsoft redirects back to /auth/microsoft/callback (handled by
//      MicrosoftCallback.tsx) with ?code=...&state=...
//
// We keep a small "Sign in with password" disclosure for break-glass admin
// access in case Entra ID is down. SSO-only users will see "Invalid
// credentials" if they try local login (their passwordHash is NULL).
import { useEffect, useState } from 'react';
import { login, getMicrosoftConfig, type User, type MicrosoftConfig } from '../api';
import { startOAuthFlow, buildMicrosoftAuthUrl } from '../lib/oauth';

interface Props {
  onSuccess: (token: string, user: User) => void;
}

function consumeLogoutReason(): 'jwt_expired' | 'sip_failed' | null {
  try {
    const v = sessionStorage.getItem('ace_logout_reason');
    if (v) sessionStorage.removeItem('ace_logout_reason');
    if (v === 'jwt_expired' || v === 'sip_failed') return v;
  } catch { /* noop */ }
  return null;
}

// Read an SSO error stashed by the callback page so we can show a friendly
// message after a failed SSO sign-in (e.g. "Your account hasn't been
// invited yet"). One-shot read — clears after display.
function consumeSsoError(): string | null {
  try {
    const v = sessionStorage.getItem('ace_sso_error');
    if (v) sessionStorage.removeItem('ace_sso_error');
    return v;
  } catch { return null; }
}

export default function Login({ onSuccess }: Props) {
  const [config, setConfig] = useState<MicrosoftConfig | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [email, setEmail] = useState('abdulla@aptask.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startingSso, setStartingSso] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);

  useEffect(() => {
    const reason = consumeLogoutReason();
    if (reason === 'jwt_expired') {
      setLogoutNotice('Your session expired. Please sign in again.');
    } else if (reason === 'sip_failed') {
      setLogoutNotice('Lost connection to the calling service. Please sign in again.');
    }
    setSsoError(consumeSsoError());

    void getMicrosoftConfig().then(setConfig);
  }, []);

  // Begin the Microsoft OAuth dance. We generate state + PKCE here and
  // store them in sessionStorage; the callback page reads them after
  // Microsoft redirects back.
  async function handleMicrosoftSignIn() {
    if (!config?.enabled || !config.clientId || !config.tenantId) return;
    setStartingSso(true);
    setError(null);
    try {
      const { state, codeChallenge } = await startOAuthFlow();
      const redirectUri = `${window.location.origin}/auth/microsoft/callback`;
      const url = buildMicrosoftAuthUrl({
        tenantId: config.tenantId,
        clientId: config.clientId,
        redirectUri,
        state,
        codeChallenge,
      });
      // Full-page navigate (NOT pushState) so the browser leaves our SPA
      // for Microsoft's domain. Microsoft redirects back via window.location,
      // landing us at /auth/microsoft/callback.
      window.location.assign(url);
    } catch (e) {
      setStartingSso(false);
      setError((e as Error).message || 'Could not start Microsoft sign-in');
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token, user } = await login(email, password);
      onSuccess(token, user);
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>ACE Dialer</h1>
        <p className="subtitle">Sign in with your ApTask account</p>

        {logoutNotice && (
          <div role="alert" className="auth-banner auth-banner-warn">
            {logoutNotice}
          </div>
        )}

        {ssoError && (
          <div role="alert" className="auth-banner auth-banner-error">
            {ssoError}
          </div>
        )}

        {/* Primary action: Microsoft SSO */}
        {config?.enabled ? (
          <button
            type="button"
            className="ms-signin-btn"
            disabled={startingSso}
            onClick={handleMicrosoftSignIn}
          >
            {/* Tiny inline Microsoft 4-color logo */}
            <svg width="20" height="20" viewBox="0 0 23 23" aria-hidden="true">
              <rect x="1" y="1" width="10" height="10" fill="#F25022" />
              <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
              <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
              <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
            </svg>
            <span>{startingSso ? 'Redirecting…' : 'Sign in with Microsoft'}</span>
          </button>
        ) : (
          <div className="auth-banner auth-banner-warn">
            Single sign-on is not configured. Ask your admin.
          </div>
        )}

        {/* Break-glass: local password (small, secondary) */}
        <button
          type="button"
          className="auth-disclosure-btn"
          onClick={() => setShowPasswordForm((v) => !v)}
        >
          {showPasswordForm ? 'Hide password sign-in' : 'Sign in with password (admin only)'}
        </button>

        {showPasswordForm && (
          <form onSubmit={handlePasswordSubmit} className="auth-pwd-form">
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="hint">Pilot — single tenant SSO (Entra ID)</p>
      </div>
    </div>
  );
}
