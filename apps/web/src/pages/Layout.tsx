import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Clock, User as UserIcon, Grid3x3, Voicemail, LogOut, Settings as SettingsIcon } from 'lucide-react';
import type { User } from '../api';
import { getUnreadVoicemailCount } from '../api';
import IncomingCall from '../components/IncomingCall';
import { useSip } from '../contexts/SipContext';

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { callState } = useSip();
  const [unreadVoicemails, setUnreadVoicemails] = useState(0);
  const isElectron =
    typeof navigator !== 'undefined' &&
    /electron/i.test(navigator.userAgent);

  // Auto-navigate to the InCall screen when a call first connects (covers
  // both outbound dials and inbound calls accepted via the floating ringer).
  // Only fires on the transition into 'connected' — NOT every render — so
  // navigating away (e.g. tapping Add Call → /keypad) doesn't bounce us back.
  const prevCallStateRef = useRef(callState.state);
  useEffect(() => {
    const prev = prevCallStateRef.current;
    const next = callState.state;
    prevCallStateRef.current = next;
    if (prev !== 'connected' && next === 'connected' && location.pathname !== '/in-call') {
      navigate('/in-call');
    }
  }, [callState.state, location.pathname, navigate]);

  // Voicemail unread badge — poll once on mount + whenever we leave /voicemail
  // (the page itself marks items as read on expand).
  useEffect(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    let cancelled = false;
    getUnreadVoicemailCount(token).then((n) => { if (!cancelled) setUnreadVoicemails(n); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <IncomingCall />

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
          {unreadVoicemails > 0 && (
            <span className="tab-badge">{unreadVoicemails > 99 ? '99+' : unreadVoicemails}</span>
          )}
        </NavLink>
      </nav>
    </div>
  );
}
