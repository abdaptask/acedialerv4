import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Clock, User as UserIcon, Grid3x3, Voicemail, LogOut, Settings as SettingsIcon, Phone } from 'lucide-react';
import type { User } from '../api';
import IncomingCall from '../components/IncomingCall';
import { useSip } from '../contexts/SipContext';

function formatNumberShort(n: string | undefined | null): string {
  if (!n) return '';
  const d = n.replace(/[^\d]/g, '');
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return n;
}

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { callState } = useSip();
  const isElectron =
    typeof navigator !== 'undefined' &&
    /electron/i.test(navigator.userAgent);

  // Auto-navigate to InCall only on the *transition* into 'connected'
  // (otherwise we'd fight Add-Call → keypad navigation).
  const prevStateRef = useRef(callState.state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = callState.state;
    if (callState.state === 'connected' && prev !== 'connected' && location.pathname !== '/in-call') {
      navigate('/in-call');
    }
  }, [callState.state, location.pathname, navigate]);

  // Show a "return to call" banner whenever we're not on /in-call but
  // there's still an active call in progress.
  const hasActiveCall =
    (callState.state === 'calling' ||
      callState.state === 'ringing' ||
      callState.state === 'connected') &&
    location.pathname !== '/in-call';
  const activeOther =
    callState.direction === 'inbound'
      ? callState.fromNumber ?? callState.number
      : callState.toNumber ?? callState.number;

  return (
    <div className="app-shell">
      <IncomingCall />

      {hasActiveCall && (
        <button
          type="button"
          className="return-to-call-banner"
          onClick={() => navigate('/in-call')}
          aria-label="Return to active call"
        >
          <span className="rtc-icon">
            <Phone size={14} />
          </span>
          <span className="rtc-text">
            <span className="rtc-tag">On call</span>
            <span className="rtc-num">{formatNumberShort(activeOther) || 'Active call'}</span>
          </span>
          <span className="rtc-back">Tap to return</span>
        </button>
      )}

      <header className="app-header">
        <span className="brand">ACE Dialer</span>
        <span className="version">v{__APP_VERSION__}{isElectron ? ' · Desktop' : ' · Web'}</span>
        <span className="who">{user.firstName ?? user.email}</span>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">
            <SettingsIcon size={18} />
          </button>
          <button className="icon-btn" onClick={onLogout} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="tab-bar">
        <NavLink to="/messages" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <MessageSquare size={22} /><span>Messages</span>
        </NavLink>
        <NavLink to="/recents" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Clock size={22} /><span>Recents</span>
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <UserIcon size={22} /><span>Contacts</span>
        </NavLink>
        <NavLink to="/keypad" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Grid3x3 size={22} /><span>Keypad</span>
        </NavLink>
        <NavLink to="/voicemail" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Voicemail size={22} /><span>Voicemail</span>
        </NavLink>
      </nav>
    </div>
  );
}
