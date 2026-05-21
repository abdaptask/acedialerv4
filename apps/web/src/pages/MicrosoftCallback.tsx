// Phase 7 — Microsoft OAuth callback page.
//
// Microsoft redirects the user's browser here after they sign in. The URL
// looks like /auth/microsoft/callback?code=...&state=...
//
// We:
//   1. Read code + state from the URL.
//   2. Verify state matches what we stashed in sessionStorage (CSRF check).
//   3. POST { code, redirectUri, codeVerifier } to the backend's
//      /auth/microsoft/exchange — backend validates the auth code with
//      Microsoft and returns our own JWT.
//   4. On success, hand the JWT + user to App.tsx and navigate to /keypad.
//   5. On failure, stash the error and bounce back to /login where it
//      displays.
//
// We run this as a "headless" page: just a spinner. The whole thing
// completes in <1 second usually.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { consumeOAuthState } from '../lib/oauth';
import { exchangeMicrosoftCode, type User } from '../api';

interface Props {
  onSuccess: (token: string, user: User) => void;
}

export default function MicrosoftCallback({ onSuccess }: Props) {
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    const oauthError = params.get('error');
    const oauthErrorDesc = params.get('error_description');

    // If Microsoft itself rejected the request (e.g. user cancelled),
    // surface that and bounce to /login.
    if (oauthError) {
      const msg = oauthErrorDesc || oauthError;
      sessionStorage.setItem('ace_sso_error', `Microsoft sign-in failed: ${msg}`);
      navigate('/login');
      return;
    }

    if (!code || !returnedState) {
      setStatus('error');
      setErrorMsg('Missing code or state in the callback URL.');
      return;
    }

    const { state: expectedState, codeVerifier } = consumeOAuthState();
    if (!expectedState || expectedState !== returnedState) {
      setStatus('error');
      setErrorMsg('OAuth state mismatch — please try signing in again.');
      return;
    }
    if (!codeVerifier) {
      setStatus('error');
      setErrorMsg('Missing PKCE verifier — please try signing in again.');
      return;
    }

    // redirectUri must match EXACTLY what we sent to Microsoft on /authorize
    // AND what's registered in the Azure app. We use window.location.origin
    // so it auto-adapts to dev/staging/prod URLs.
    const redirectUri = `${window.location.origin}/auth/microsoft/callback`;

    void exchangeMicrosoftCode(code, redirectUri, codeVerifier)
      .then(({ token, user }) => {
        onSuccess(token, user);
        // Use navigate (SPA) instead of window.location so we don't lose
        // the JWT we just set in App state.
        navigate('/keypad');
      })
      .catch((err: Error & { code?: string }) => {
        // Friendly message for the "not invited" case.
        const friendly =
          err.code === 'not_invited'
            ? "Your ApTask account hasn't been invited to the dialer yet. Ask your admin."
            : err.code === 'account_disabled'
              ? 'Your dialer account has been deactivated. Contact your admin.'
              : err.message;
        sessionStorage.setItem('ace_sso_error', friendly);
        navigate('/login');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>
          {status === 'working' ? 'Signing you in…' : 'Sign-in problem'}
        </h2>
        {status === 'working' ? (
          <p style={{ opacity: 0.7 }}>Verifying with Microsoft, hold on…</p>
        ) : (
          <>
            <p className="error" style={{ margin: '12px 0' }}>{errorMsg}</p>
            <button type="button" onClick={() => navigate('/login')}>
              Back to sign-in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
