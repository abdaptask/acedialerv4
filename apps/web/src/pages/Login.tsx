import { useEffect, useState } from 'react';
import { login, type User } from '../api';

interface Props {
  onSuccess: (token: string, user: User) => void;
}

// Reads (and clears) the logout reason that App.tsx stashes in sessionStorage
// before redirecting to /login. Lets us show the user a one-line explanation
// for why they're back here instead of dropping them on an unexplained form.
function consumeLogoutReason(): 'jwt_expired' | 'sip_failed' | null {
  try {
    const v = sessionStorage.getItem('ace_logout_reason');
    if (v) sessionStorage.removeItem('ace_logout_reason');
    if (v === 'jwt_expired' || v === 'sip_failed') return v;
  } catch { /* noop */ }
  return null;
}

export default function Login({ onSuccess }: Props) {
  const [email, setEmail] = useState('abdulla@aptask.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);

  // Only read once on mount — we don't want the notice re-appearing if the
  // user navigates back to the form (e.g., after a failed login attempt).
  useEffect(() => {
    const reason = consumeLogoutReason();
    if (reason === 'jwt_expired') {
      setLogoutNotice('Your session expired. Please sign in again.');
    } else if (reason === 'sip_failed') {
      setLogoutNotice('Lost connection to the calling service. Please sign in again.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token, user } = await login(email, password);
      onSuccess(token, user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>ACE Dialer</h1>
        <p className="subtitle">Sign in to continue</p>

        {logoutNotice && (
          <div
            role="alert"
            style={{
              background: 'rgba(245, 158, 11, 0.10)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: '#b45309',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {logoutNotice}
          </div>
        )}

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

        <p className="hint">Phase 1 — pilot only</p>
      </form>
    </div>
  );
}
