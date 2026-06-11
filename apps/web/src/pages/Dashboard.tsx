import { useEffect, useState } from 'react';
import { PhoneOutgoing, PhoneIncoming, Clock, MessageSquare, Voicemail, Activity, RefreshCcw } from 'lucide-react';
import { type User, getUserStats, type UserStats } from '../api';
import { useSip } from '../contexts/SipContext';

interface Props {
  user: User;
  onLogout: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function Dashboard({ user, onLogout }: Props) {
  const token = sessionStorage.getItem('aptlink_token');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = () => {
    if (!token) return;
    setLoading(true);
    getUserStats(token)
      .then(setStats)
      .catch(err => console.error('Failed to load stats:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStats();
  }, [token]);

  return (
    <div className="dashboard-container animate-fade-in">
      <header className="dashboard-header">
        <div className="header-titles">
          <h1>Welcome back, {user.firstName || user.email.split('@')[0]}</h1>
          <p className="muted">Here is your activity for today.</p>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={loadStats} disabled={loading} title="Refresh Stats">
            <RefreshCcw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        {loading && !stats ? (
          <div className="loading-state">
            <RefreshCcw className="spin" size={24} />
            <p>Loading analytics...</p>
          </div>
        ) : stats ? (
          <div className="stats-grid">
            <div className="stat-card glassmorphism hover-lift glow-blue">
              <div className="stat-icon-wrapper blue">
                <PhoneOutgoing size={24} />
              </div>
              <div className="stat-content">
                <span className="stat-value">{stats.callsOutbound}</span>
                <span className="stat-label">Outbound Calls</span>
              </div>
            </div>

            <div className="stat-card glassmorphism hover-lift glow-green">
              <div className="stat-icon-wrapper green">
                <PhoneIncoming size={24} />
              </div>
              <div className="stat-content">
                <span className="stat-value">{stats.callsInbound}</span>
                <span className="stat-label">Inbound Calls</span>
              </div>
            </div>

            <div className="stat-card glassmorphism hover-lift glow-purple">
              <div className="stat-icon-wrapper purple">
                <Clock size={24} />
              </div>
              <div className="stat-content">
                <span className="stat-value">{formatDuration(stats.totalTalkTime)}</span>
                <span className="stat-label">Total Talk Time</span>
              </div>
            </div>

            <div className="stat-card glassmorphism hover-lift glow-orange">
              <div className="stat-icon-wrapper orange">
                <MessageSquare size={24} />
              </div>
              <div className="stat-content">
                <span className="stat-value">{stats.messages}</span>
                <span className="stat-label">SMS Messages</span>
              </div>
            </div>

            <div className="stat-card glassmorphism hover-lift glow-red">
              <div className="stat-icon-wrapper red">
                <Voicemail size={24} />
              </div>
              <div className="stat-content">
                <span className="stat-value">{stats.unreadVoicemails}</span>
                <span className="stat-label">Unread Voicemails</span>
              </div>
            </div>
          </div>
        ) : null}

        <section className="dashboard-activity glassmorphism">
          <div className="activity-header">
            <Activity size={20} />
            <h2>Quick Actions</h2>
          </div>
          <div className="activity-body">
             <dl className="kv">
                <dt>User ID</dt><dd>{user.id}</dd>
                <dt>Email</dt><dd>{user.email}</dd>
                <dt>Role</dt><dd>{user.isAdmin ? 'Admin' : 'User'}</dd>
             </dl>
             <button className="link" style={{marginTop: 16}} onClick={onLogout}>Sign out</button>
          </div>
        </section>
      </main>
    </div>
  );
}
