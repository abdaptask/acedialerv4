import { NavLink, Outlet } from 'react-router-dom';
import { Star, Clock, User as UserIcon, Grid3x3, Voicemail, LogOut } from 'lucide-react';
import type { User } from '../api';

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: Props) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">ACE Dialer</span>
        <span className="who">
          {user.firstName ?? user.email}
        </span>
        <button className="logout-btn" onClick={onLogout} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="tab-bar">
        <NavLink to="/favorites" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Star size={22} />
          <span>Favorites</span>
        </NavLink>
        <NavLink to="/recents" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Clock size={22} />
          <span>Recents</span>
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <UserIcon size={22} />
          <span>Contacts</span>
        </NavLink>
        <NavLink to="/keypad" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Grid3x3 size={22} />
          <span>Keypad</span>
        </NavLink>
        <NavLink to="/voicemail" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <Voicemail size={22} />
          <span>Voicemail</span>
        </NavLink>
      </nav>
    </div>
  );
}
