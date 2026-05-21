// Internal Chat — dialer-user ↔ dialer-user messaging.
//
// Distinct from Messages (which sends SMS to external phone numbers via
// Telnyx). Internal Chat lives entirely in our DB and is intended for short
// notes between teammates ("hop on Acme line", "did you call back X?").
//
// We deliberately mirror Messages.tsx's layout structure so we inherit the
// existing CSS (.messages root, .msg-list pane, .thread-list + .thread-row,
// .thread-detail, .thread-header, .bubble.in/.bubble.out, .compose-row,
// .compose-input, .send-btn). That gives us dark/light theme support for
// free. Only a few extra avatar classes are added to styles.css.
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Send, ArrowLeft, RefreshCcw, Search, X, Users, MessageCircle } from 'lucide-react';
import {
  getInternalChatThreads,
  getInternalChatThread,
  getInternalChatUsers,
  sendInternalChatMessage,
  markInternalChatThreadRead,
  type InternalChatThread,
  type InternalChatMessage,
  type InternalChatUser,
  getMe,
} from '../api';

function displayName(u: InternalChatUser | null | undefined): string {
  if (!u) return 'Unknown user';
  const first = u.firstName ?? '';
  const last = u.lastName ?? '';
  const full = `${first} ${last}`.trim();
  return full || u.email;
}

function initials(u: InternalChatUser | null | undefined): string {
  if (!u) return '?';
  if (u.firstName) {
    return ((u.firstName[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || 'U';
  }
  return (u.email[0] ?? 'U').toUpperCase();
}

// Deterministic per-user hue so avatar colors are consistent across renders.
function userHue(u: InternalChatUser | null | undefined): number {
  if (!u) return 0;
  const key = (u.email ?? '') + (u.firstName ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function avatarStyle(u: InternalChatUser | null | undefined) {
  const h = userHue(u);
  return {
    background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 30) % 360} 70% 45%))`,
  };
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Thread detail (inner conversation) ──────────────────────────────
interface ThreadDetailProps {
  meId: number | null;
  other: InternalChatUser | null;
  otherId: number;
  onBack: () => void;
  onSent: () => void;
}

function ThreadDetail({ meId, other, otherId, onBack, onSent }: ThreadDetailProps) {
  const [messages, setMessages] = useState<InternalChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setLoading(true);
    setError(null);
    getInternalChatThread(token, otherId)
      .then((rows) => {
        setMessages(rows);
        // Mark as read after a successful load so the badge clears.
        void markInternalChatThreadRead(token, otherId).then(() => {
          window.dispatchEvent(new Event('ace:tabVisited'));
          onSent();
        });
      })
      .catch((e) => setError((e as Error).message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [otherId, onSent]);

  // Initial load + 6s polling for new messages while this thread is open.
  useEffect(() => {
    load();
    const id = window.setInterval(load, 6000);
    return () => window.clearInterval(id);
  }, [load]);

  // Stick scroll to bottom whenever the message list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [messages.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setSending(true);
    try {
      const saved = await sendInternalChatMessage(token, otherId, body);
      // Optimistic append so the bubble lands instantly.
      setMessages((prev) => [...prev, saved]);
      setDraft('');
      onSent();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="thread-detail">
      <div className="thread-header">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back"
          style={{ marginRight: 4 }}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="chat-avatar small" style={avatarStyle(other)}>
          {initials(other)}
        </span>
        <div>
          <div className="thread-header-name">{displayName(other)}</div>
          {other?.email && <div className="thread-header-sub">{other.email}</div>}
        </div>
      </div>

      <div className="msg-list chat-bubble-scroll" ref={scrollRef}>
        {loading && messages.length === 0 && (
          <div className="empty-state muted">Loading…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="empty-state muted">No messages yet — say hi 👋</div>
        )}
        {messages.map((m) => {
          const mine = m.senderId === meId;
          return (
            <div key={m.id} className={`bubble ${mine ? 'out' : 'in'}`}>
              <div className="bubble-text">{m.body}</div>
              <div className="bubble-meta">{formatRelative(m.createdAt)}</div>
            </div>
          );
        })}
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      <div className="compose-row">
        <textarea
          className="compose-input"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter for newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
        />
        <button
          type="button"
          className="send-btn"
          disabled={sending || !draft.trim()}
          onClick={() => void handleSend()}
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Top-level page ──────────────────────────────────────────────────
export default function Chat() {
  const [meId, setMeId] = useState<number | null>(null);
  const [threads, setThreads] = useState<InternalChatThread[]>([]);
  const [users, setUsers] = useState<InternalChatUser[]>([]);
  const [active, setActive] = useState<{ id: number; user: InternalChatUser | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    void getMe(token).then((u) => setMeId(u.id)).catch(() => { /* noop */ });
  }, []);

  const loadThreads = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setLoading(true);
    setError(null);
    getInternalChatThreads(token)
      .then(setThreads)
      .catch((e) => setError((e as Error).message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const loadUsers = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    void getInternalChatUsers(token).then(setUsers).catch(() => { /* noop */ });
  }, []);

  useEffect(() => {
    loadThreads();
    loadUsers();
    // Soft poll while the threads pane is up.
    const id = window.setInterval(loadThreads, 15000);
    return () => window.clearInterval(id);
  }, [loadThreads, loadUsers]);

  const filteredThreads = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter((t) => {
      const name = displayName(t.otherUser).toLowerCase();
      const email = (t.otherUser?.email ?? '').toLowerCase();
      const last = (t.lastMessage ?? '').toLowerCase();
      return name.includes(q) || email.includes(q) || last.includes(q);
    });
  }, [threads, search]);

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter((u) => {
      const name = displayName(u).toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, search]);

  return (
    <div className="messages">
      {!active ? (
        <div className="msg-list">
          <div className="msg-header">
            <h2>Chat</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`icon-btn${showUserPicker ? ' active' : ''}`}
                onClick={() => setShowUserPicker((v) => !v)}
                aria-label="New chat"
                title={showUserPicker ? 'Back to chats' : 'Start new chat'}
              >
                <Users size={18} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={loadThreads}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCcw size={18} className={loading ? 'spin' : ''} />
              </button>
            </div>
          </div>

          <div className="search-bar">
            <Search size={16} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              className="search-input"
              placeholder={showUserPicker ? 'Search teammates' : 'Search chats'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {error && <div className="error" style={{ margin: '0 1rem 1rem' }}>{error}</div>}

          {showUserPicker ? (
            <ul className="thread-list">
              {filteredUsers.length === 0 && (
                <li className="empty-state muted">No teammates found.</li>
              )}
              {filteredUsers.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="thread-row"
                    onClick={() => {
                      setShowUserPicker(false);
                      setSearch('');
                      setActive({ id: u.id, user: u });
                    }}
                  >
                    <span className="chat-avatar" style={avatarStyle(u)}>
                      {initials(u)}
                    </span>
                    <div className="thread-text">
                      <div className="thread-name">{displayName(u)}</div>
                      <div className="thread-preview">{u.email}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              {!loading && threads.length === 0 && !error && (
                <div className="empty-state">
                  <MessageCircle size={36} strokeWidth={1.2} style={{ opacity: 0.4 }} />
                  <p>No chats yet.</p>
                  <p className="muted">Tap the Users icon to start one.</p>
                </div>
              )}

              {!loading && threads.length > 0 && filteredThreads.length === 0 && (
                <div className="empty-state">
                  <p>No chats match “{search}”.</p>
                </div>
              )}

              <ul className="thread-list">
                {filteredThreads.map((t) => {
                  const isUnread = t.unreadCount > 0;
                  return (
                    <li key={t.otherId}>
                      <button
                        type="button"
                        className={`thread-row${isUnread ? ' unread' : ''}`}
                        onClick={() => setActive({ id: t.otherId, user: t.otherUser })}
                      >
                        <span className="chat-avatar" style={avatarStyle(t.otherUser)}>
                          {initials(t.otherUser)}
                        </span>
                        <div className="thread-text">
                          <div className="thread-name">{displayName(t.otherUser)}</div>
                          <div className="thread-preview">
                            {t.lastSenderId === meId ? 'You: ' : ''}
                            {t.lastMessage || (t.mediaUrl ? '📎 attachment' : '…')}
                          </div>
                        </div>
                        <div className="thread-time">{formatRelative(t.lastAt)}</div>
                        {isUnread && <span className="thread-unread-dot" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : (
        <ThreadDetail
          meId={meId}
          other={active.user}
          otherId={active.id}
          onBack={() => {
            setActive(null);
            loadThreads();
          }}
          onSent={loadThreads}
        />
      )}
    </div>
  );
}
