// v0.10.175 — Voicemail tab redesigned as a card list. Each row has
// two lines: avatar+dot+name+timestamp on top, big play+waveform+
// duration+speed+kebab on bottom. Pin (Saved) feature via kebab menu.
// Locked behaviors preserved: B1 fresh-URL, B2 single-click-play,
// v0.10.103 onPlay failsafe, v0.10.67 unreadCountChanged dispatch.
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Phone,
  Trash2,
  RefreshCcw,
  Play,
  Pause,
  Voicemail as VoicemailIcon,
  Search,
  X,
  Circle,
  CheckCircle2,
  CheckSquare,
  Square,
  MessageSquare,
  ArrowLeft,
  MoreHorizontal,
  Bookmark,
  BookmarkX,
} from 'lucide-react';
import {
  getVoicemails,
  markVoicemailListened,
  bulkMarkVoicemails,
  deleteVoicemail,
  getVoicemailRetentionDays,
  getFreshVoicemailUrl,
  pinVoicemail,
  unpinVoicemail,
  type VoicemailRecord,
} from '../api';
import { useSip } from '../contexts/SipContext';
import { useJobDivaContact, getCachedJobDivaName } from '../hooks/useJobDivaContact';
import { formatPhone } from '../lib/phone';
import { getFavoriteName } from '../lib/userPrefs';

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(raw: string): string {
  return formatPhone(raw) || '—';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

// v0.10.175 — decorative SVG waveform. 24 bars, varied heights, indigo
// stroke. Deterministic per-id so the same row always renders the same
// pattern (avoids re-render flicker). Pure presentation; not tied to
// the audio file. Real-audio waveforms can come later behind a flag.
function Waveform({ seed }: { seed: number }) {
  const bars = 28;
  const heights = useMemo(() => {
    const out: number[] = [];
    let v = (seed * 9301 + 49297) % 233280;
    for (let i = 0; i < bars; i++) {
      v = (v * 9301 + 49297) % 233280;
      const t = v / 233280;
      // Bias toward the middle of the row so the waveform looks like
      // speech — taller in the middle, shorter at the edges.
      const taper = 1 - Math.pow(Math.abs(i - bars / 2) / (bars / 2), 1.5);
      out.push(0.25 + 0.75 * t * taper);
    }
    return out;
  }, [seed]);
  return (
    <svg
      className="vm-card-waveform"
      viewBox={`0 0 ${bars * 4} 28`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {heights.map((h, i) => {
        const barH = Math.max(2, h * 26);
        const y = (28 - barH) / 2;
        return (
          <rect
            key={i}
            x={i * 4}
            y={y}
            width={2.4}
            height={barH}
            rx={1.2}
            fill="currentColor"
            opacity={0.5 + 0.5 * h}
          />
        );
      })}
    </svg>
  );
}

type VmFilter = 'all' | 'unread' | 'saved' | 'expiring';
const VM_FILTER_KEY = 'ace.voicemail.filter';
function readSavedVmFilter(): VmFilter {
  try {
    const v = localStorage.getItem(VM_FILTER_KEY);
    if (v === 'all' || v === 'unread' || v === 'saved' || v === 'expiring') return v;
  } catch { /* ignore */ }
  return 'all';
}

export default function Voicemail() {
  const [items, setItems] = useState<VoicemailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [vmFilter, setVmFilter] = useState<VmFilter>(readSavedVmFilter);
  useEffect(() => {
    try { localStorage.setItem(VM_FILTER_KEY, vmFilter); } catch { /* ignore */ }
  }, [vmFilter]);

  const [, setFavTick] = useState(0);
  useEffect(() => {
    const refresh = () => setFavTick((t) => t + 1);
    window.addEventListener('ace:favoritesChanged', refresh);
    return () => window.removeEventListener('ace:favoritesChanged', refresh);
  }, []);

  const [retentionDays, setRetentionDays] = useState(30);
  useEffect(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    getVoicemailRetentionDays(token).then(setRetentionDays).catch(() => undefined);
  }, []);

  const { sipState, call } = useSip();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactFilter = searchParams.get('phone');
  const fromUrl = searchParams.get('from');
  const contactWant = contactFilter ? (contactFilter.replace(/[^\d]/g, '').slice(-10)) : '';

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllFiltered(ids: number[]) { setSelected(new Set(ids)); }
  function clearSelection() { setSelected(new Set()); }
  function exitSelectMode() { setSelectMode(false); setSelected(new Set()); }

  const filtered = useMemo(() => {
    let base = items;
    if (contactWant) {
      base = items.filter((vm) => (vm.fromNumber || '').replace(/[^\d]/g, '').slice(-10) === contactWant);
    }
    if (vmFilter === 'unread') {
      base = base.filter((vm) => !vm.listenedAt);
    } else if (vmFilter === 'saved') {
      base = base.filter((vm) => !!vm.savedAt);
    } else if (vmFilter === 'expiring') {
      const cutoffMs = 7 * 24 * 60 * 60 * 1000;
      base = base.filter((vm) => {
        const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
        return expiresAt - Date.now() <= cutoffMs;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const qDigits = q.replace(/[^\d]/g, '');
    return base.filter((vm) => {
      const digits = (vm.fromNumber || '').replace(/[^\d]/g, '');
      if (qDigits && digits.includes(qDigits)) return true;
      if ((vm.transcription ?? '').toLowerCase().includes(q)) return true;
      const favName = getFavoriteName(vm.fromNumber);
      if (favName && favName.toLowerCase().includes(q)) return true;
      const cachedName = getCachedJobDivaName(vm.fromNumber);
      if (cachedName && cachedName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, search, contactWant, vmFilter, retentionDays]);

  // Live counts for the filter pills.
  const filterCounts = useMemo(() => {
    const expiringCutoff = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let unread = 0, saved = 0, expiring = 0;
    for (const vm of items) {
      if (!vm.listenedAt) unread++;
      if (vm.savedAt) saved++;
      const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
      if (expiresAt - now <= expiringCutoff) expiring++;
    }
    return { all: items.length, unread, saved, expiring };
  }, [items, retentionDays]);

  const contactLabel = contactFilter
    ? getFavoriteName(contactFilter)
      ?? getCachedJobDivaName(contactFilter)
      ?? formatNumber(contactFilter)
    : '';

  function goBack() {
    if (fromUrl) navigate(fromUrl); else navigate('/voicemail');
  }

  const load = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setLoading(true);
    setError(null);
    getVoicemails(token)
      .then(setItems)
      .catch((e) => setError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-poll while any voicemail is missing a transcript. Preserved
  // from the prior implementation (2s interval, 120s timeout).
  useEffect(() => {
    const missing = items.some((vm) => !vm.transcription);
    if (!missing) return;
    let cancelled = false;
    let elapsed = 0;
    const id = window.setInterval(() => {
      elapsed += 2000;
      if (elapsed > 120_000 || cancelled) {
        window.clearInterval(id);
        return;
      }
      const token = sessionStorage.getItem('ace_token');
      if (!token) return;
      getVoicemails(token).then(setItems).catch(() => undefined);
    }, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [items]);

  // Click-outside closes the kebab.
  useEffect(() => {
    if (menuOpenId == null) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.vm-card-kebab-wrap')) return;
      setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  async function handleExpand(vm: VoicemailRecord) {
    const next = expandedId === vm.id ? null : vm.id;
    setExpandedId(next);
    if (next && !vm.listenedAt) {
      const token = sessionStorage.getItem('ace_token');
      if (!token) return;
      try {
        await markVoicemailListened(token, vm.id, true);
        setItems((prev) =>
          prev.map((p) => (p.id === vm.id ? { ...p, listenedAt: new Date().toISOString() } : p)),
        );
        // v0.10.67 — Refresh badge count immediately.
        window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
      } catch { /* ignore */ }
    }
  }

  async function handleDelete(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    if (!confirm('Delete this voicemail?')) return;
    try {
      await deleteVoicemail(token, vm.id);
      setItems((prev) => prev.filter((p) => p.id !== vm.id));
    } catch { /* ignore */ }
  }

  async function handleBulkDelete() {
    const token = sessionStorage.getItem('ace_token');
    if (!token || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} voicemail${selected.size === 1 ? '' : 's'}?`)) return;
    const ids = Array.from(selected);
    setItems((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    await Promise.allSettled(ids.map((id) => deleteVoicemail(token, id)));
  }

  async function handleBulkMark(listened: boolean) {
    const token = sessionStorage.getItem('ace_token');
    if (!token || selected.size === 0) return;
    const ids = Array.from(selected);
    const nowIso = listened ? new Date().toISOString() : null;
    setItems((prev) => prev.map((p) => (selected.has(p.id) ? { ...p, listenedAt: nowIso } : p)));
    setSelected(new Set());
    try {
      await bulkMarkVoicemails(token, ids, listened);
      window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
    } catch { /* ignore */ }
  }

  async function handleToggleUnread(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    const nowListened = !vm.listenedAt;
    try {
      await markVoicemailListened(token, vm.id, nowListened);
      setItems((prev) => prev.map((p) =>
        p.id === vm.id ? { ...p, listenedAt: nowListened ? new Date().toISOString() : null } : p,
      ));
      window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
    } catch { /* ignore */ }
  }

  async function handleTogglePin(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    const wasPinned = !!vm.savedAt;
    // Optimistic UI flip first.
    setItems((prev) => prev.map((p) =>
      p.id === vm.id ? { ...p, savedAt: wasPinned ? null : new Date().toISOString() } : p,
    ));
    try {
      if (wasPinned) await unpinVoicemail(token, vm.id);
      else await pinVoicemail(token, vm.id);
    } catch {
      // Rollback on failure.
      setItems((prev) => prev.map((p) =>
        p.id === vm.id ? { ...p, savedAt: wasPinned ? new Date().toISOString() : null } : p,
      ));
    }
  }

  function handleCallBack(vm: VoicemailRecord) {
    if (!vm.fromNumber) return;
    if (sipState !== 'registered') {
      alert(`SIP not ready (${sipState}). Try again in a moment.`);
      return;
    }
    call(vm.fromNumber);
    navigate('/in-call');
  }
  function handleSendSms(vm: VoicemailRecord) {
    if (!vm.fromNumber) return;
    navigate(`/messages?to=${encodeURIComponent(vm.fromNumber)}`);
  }

  return (
    <div className="voicemail">
      {contactFilter && (
        <button
          type="button"
          className="contact-filter-bar"
          onClick={goBack}
          aria-label={`Back to ${contactLabel || 'previous page'}`}
        >
          <ArrowLeft size={16} />
          <span className="contact-filter-text">
            <span className="contact-filter-tag">Showing voicemails from</span>
            <span className="contact-filter-name">{contactLabel}</span>
          </span>
          <span className="contact-filter-back">← Back</span>
        </button>
      )}
      <div className="voicemail-header">
        <h2>{contactFilter ? 'Voicemails' : 'Voicemail'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!selectMode && items.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSelectMode(true)}
              aria-label="Select"
              title="Select multiple"
            >
              <CheckSquare size={18} />
            </button>
          )}
          {selectMode && (
            <button
              type="button"
              className="icon-btn"
              onClick={exitSelectMode}
              aria-label="Cancel selection"
              title="Cancel"
            >
              <X size={18} />
            </button>
          )}
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCcw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="search-bar">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          className="search-input"
          placeholder="Search voicemails"
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

      {/* v0.10.175 — Filter pills (All / Unread / Saved / Auto-deleting soon). */}
      {!selectMode && (
        <div className="vm-filter-row" role="tablist" aria-label="Voicemail filter">
          {(
            [
              { v: 'all',     label: 'All',                 count: filterCounts.all },
              { v: 'unread',  label: 'Unread',              count: filterCounts.unread },
              { v: 'saved',   label: 'Saved',               count: filterCounts.saved },
              { v: 'expiring',label: 'Auto-deleting soon',  count: filterCounts.expiring },
            ] as Array<{ v: VmFilter; label: string; count: number }>
          ).map((opt) => {
            const active = vmFilter === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                role="tab"
                aria-selected={active}
                className={`vm-filter-chip${active ? ' is-active' : ''}`}
                onClick={() => setVmFilter(opt.v)}
              >
                {opt.label}
                {opt.count > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>({opt.count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="error" style={{ margin: '0 1rem 1rem' }}>{error}</div>}

      {!loading && items.length === 0 && !error && (
        <div className="empty-state">
          <VoicemailIcon size={32} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
          <p>No voicemails yet.</p>
          <p className="muted">Missed-call voicemails will appear here.</p>
        </div>
      )}

      {!loading && items.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <p>No voicemails match the current filter.</p>
        </div>
      )}

      {selectMode && (
        <div className="vm-select-bar">
          <span className="vm-select-count">{selected.size} selected</span>
          <div className="vm-select-actions">
            <button
              type="button"
              className="device-action"
              onClick={() => selectAllFiltered(filtered.map((v) => v.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="device-action"
              onClick={clearSelection}
              disabled={selected.size === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="device-action"
              onClick={() => handleBulkMark(true)}
              disabled={selected.size === 0}
              title="Mark selected as read"
            >
              <CheckCircle2 size={14} /> Mark read
            </button>
            <button
              type="button"
              className="device-action"
              onClick={() => handleBulkMark(false)}
              disabled={selected.size === 0}
              title="Mark selected as unread"
            >
              <Circle size={14} /> Mark unread
            </button>
            <button
              type="button"
              className="device-action primary danger"
              onClick={handleBulkDelete}
              disabled={selected.size === 0}
            >
              <Trash2 size={14} /> Delete ({selected.size})
            </button>
          </div>
        </div>
      )}

      <div className="vm-card-list" role="list">
        {filtered.map((vm) => (
          <VoicemailCard
            key={vm.id}
            vm={vm}
            retentionDays={retentionDays}
            expanded={expandedId === vm.id}
            menuOpen={menuOpenId === vm.id}
            selectMode={selectMode}
            checked={selected.has(vm.id)}
            onToggleSelect={() => toggleSelected(vm.id)}
            onExpand={() => handleExpand(vm)}
            onOpenMenu={() => setMenuOpenId(menuOpenId === vm.id ? null : vm.id)}
            onCloseMenu={() => setMenuOpenId(null)}
            onCallBack={() => handleCallBack(vm)}
            onSendSms={() => handleSendSms(vm)}
            onDelete={() => handleDelete(vm)}
            onToggleUnread={() => handleToggleUnread(vm)}
            onTogglePin={() => handleTogglePin(vm)}
          />
        ))}
      </div>
    </div>
  );
}

function VoicemailCard({
  vm,
  retentionDays,
  expanded,
  menuOpen,
  selectMode,
  checked,
  onToggleSelect,
  onExpand,
  onOpenMenu,
  onCloseMenu,
  onCallBack,
  onSendSms,
  onDelete,
  onToggleUnread,
  onTogglePin,
}: {
  vm: VoicemailRecord;
  retentionDays: number;
  expanded: boolean;
  menuOpen: boolean;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onExpand: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onCallBack: () => void;
  onSendSms: () => void;
  onDelete: () => void;
  onToggleUnread: () => void;
  onTogglePin: () => void;
}) {
  const jd = useJobDivaContact(vm.fromNumber);
  const label = getFavoriteName(vm.fromNumber) ?? jd?.name ?? formatNumber(vm.fromNumber);
  const unread = !vm.listenedAt;
  const pinned = !!vm.savedAt;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [actualDuration, setActualDuration] = useState<number | null>(null);
  // v0.10.163 - <audio src> backing. Defaults to vm.recordingUrl.
  // On row expand we fetch a fresh signed URL via /voicemails/:id/fresh-url.
  const [audioUrl, setAudioUrl] = useState<string>(vm.recordingUrl);
  // Local playing state for the big play/pause button glyph.
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, expanded]);

  // B1 — Fresh URL on expand. Stored Telnyx URLs lapse after 10 min.
  useEffect(() => {
    if (!expanded) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await getFreshVoicemailUrl(token, vm.id);
        if (!cancelled && fresh) setAudioUrl(fresh);
      } catch { /* keep audioUrl = vm.recordingUrl */ }
    })();
    return () => { cancelled = true; };
  }, [expanded, vm.id]);

  // B2 — Single-click-play. Dep array MUST stay [expanded, audioUrl]
  // so when the fresh URL arrives we re-fire play() with the valid src.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;
    const el = audioRef.current;
    const onLoaded = () => {
      if (isFinite(el.duration) && el.duration > 0) setActualDuration(el.duration);
    };
    const onPlayEv = () => setIsPlaying(true);
    const onPauseEv = () => setIsPlaying(false);
    const onEndedEv = () => setIsPlaying(false);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('play', onPlayEv);
    el.addEventListener('pause', onPauseEv);
    el.addEventListener('ended', onEndedEv);
    el.play().catch(() => { /* autoplay may be blocked */ });
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('play', onPlayEv);
      el.removeEventListener('pause', onPauseEv);
      el.removeEventListener('ended', onEndedEv);
    };
  }, [expanded, audioUrl]);

  // Lightweight duration probe for collapsed rows.
  useEffect(() => {
    if (!vm.recordingUrl || actualDuration !== null) return;
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = vm.recordingUrl;
    const onLoaded = () => {
      if (isFinite(probe.duration) && probe.duration > 0) setActualDuration(probe.duration);
    };
    probe.addEventListener('loadedmetadata', onLoaded);
    return () => {
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.src = '';
    };
  }, [vm.recordingUrl, actualDuration]);

  const displaySeconds = actualDuration ?? vm.durationSeconds;

  // Days remaining for auto-delete countdown badge (only renders <= 7).
  const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const msLeft = expiresAt - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  let expiresEl: JSX.Element | null = null;
  if (daysLeft > 0 && daysLeft <= 7) {
    const cls = daysLeft <= 1 ? 'vm-card-expires danger' : 'vm-card-expires warn';
    const text = daysLeft === 1 ? 'Auto-deletes tomorrow' : `Deletes in ${daysLeft}d`;
    expiresEl = <span className={cls}>{text}</span>;
  }

  const lineLabel = vm.userDid?.label || vm.userDid?.didNumber || null;

  // Play button: in collapsed state, clicking expands + auto-plays. In
  // expanded state, clicking toggles play/pause on the audio element.
  function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded) {
      onExpand();
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }

  // Cycle speed: 1 -> 1.5 -> 2 -> 0.5 -> 1
  function cycleSpeed() {
    setPlaybackRate((r) =>
      r === 1 ? 1.5 :
      r === 1.5 ? 2 :
      r === 2 ? 0.5 : 1,
    );
  }

  return (
    <>
      <div
        className={`vm-card${checked ? ' selected' : ''}`}
        role="listitem"
        onClick={selectMode ? onToggleSelect : undefined}
      >
        {/* Top row */}
        <div className="vm-card-top">
          {selectMode ? (
            <span
              className={`vm-card-checkbox${checked ? ' is-checked' : ''}`}
              aria-hidden="true"
            >
              {checked ? <CheckSquare size={18} /> : <Square size={18} />}
            </span>
          ) : (
            <span className="vm-card-avatar" aria-hidden="true">
              {initialsFromLabel(label)}
            </span>
          )}
          {!selectMode && unread && (
            <span className="vm-card-unread-dot" aria-label="Unread" />
          )}
          <span className={`vm-card-name ${unread ? 'is-unread' : 'is-read'}`}>
            {label}
            {pinned && (
              <span className="vm-card-pin-indicator" aria-label="Saved">
                <Bookmark size={13} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
          <span className="vm-card-time">{formatTime(vm.receivedAt)}</span>
        </div>

        {/* Bottom row - hidden in select mode for less visual noise */}
        {!selectMode && (
          <div className="vm-card-bottom" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`vm-card-play${isPlaying ? ' is-playing' : ''}`}
              aria-label={isPlaying ? 'Pause voicemail' : 'Play voicemail'}
              title={isPlaying ? 'Pause' : 'Play'}
              onClick={handlePlayClick}
            >
              {isPlaying
                ? <Pause size={18} fill="currentColor" strokeWidth={0} />
                : <Play size={18} fill="currentColor" strokeWidth={0} />}
            </button>
            <Waveform seed={vm.id} />
            <div className="vm-card-bottom-meta">
              <span className="vm-card-duration">
                {formatDuration(Math.round(displaySeconds || 0))}
              </span>
              <button
                type="button"
                className={`vm-card-speed-chip${playbackRate !== 1 ? ' is-active-rate' : ''}`}
                onClick={cycleSpeed}
                title="Click to cycle playback speed"
                aria-label={`Playback speed ${playbackRate}x. Click to cycle.`}
              >
                {playbackRate}×
              </button>
              {expiresEl}
            </div>
            <div className="vm-card-kebab-wrap">
              <button
                type="button"
                className="vm-card-kebab-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="More actions"
                onClick={onOpenMenu}
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="vm-card-menu" role="menu">
                  {lineLabel && (
                    <div className="vm-card-menu-header">On {lineLabel}</div>
                  )}
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onTogglePin(); }}
                  >
                    {pinned
                      ? <BookmarkX size={15} className="menu-icon" />
                      : <Bookmark size={15} className="menu-icon" />}
                    {pinned ? 'Unpin' : 'Pin (Saved)'}
                  </button>
                  {!pinned && (
                    <div className="vm-card-menu-note">
                      Pinning tags this voicemail so you can find it in the Saved filter.
                      It still auto-deletes after {retentionDays} days.
                    </div>
                  )}
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onToggleUnread(); }}
                  >
                    {unread
                      ? <CheckCircle2 size={15} className="menu-icon" />
                      : <Circle size={15} className="menu-icon" />}
                    {unread ? 'Mark as read' : 'Mark as unread'}
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onCallBack(); }}
                  >
                    <Phone size={15} className="menu-icon" />
                    Call back
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onSendSms(); }}
                  >
                    <MessageSquare size={15} className="menu-icon" />
                    Send message
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item danger"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onDelete(); }}
                  >
                    <Trash2 size={15} className="menu-icon" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {expanded && !selectMode && (
        <div className="vm-card-player">
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            preload="metadata"
            style={{ width: '100%' }}
            onPlay={async () => {
              // v0.10.103 - Failsafe: mark as listened on actual play.
              if (vm.listenedAt) return;
              const token = sessionStorage.getItem('ace_token');
              if (!token) return;
              try {
                await markVoicemailListened(token, vm.id, true);
                window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
                window.dispatchEvent(new CustomEvent('ace:voicemailMarkedListened', { detail: { id: vm.id } }));
              } catch { /* silent */ }
            }}
          />
          {vm.transcription ? (
            <p className="vm-card-transcript">
              <span className="vm-card-transcript-tag">Transcript</span>
              {vm.transcription}
            </p>
          ) : (
            <p className="vm-card-transcript">
              <span className="vm-card-transcript-tag">Transcript</span>
              <em style={{ opacity: 0.7 }}>Transcribing…</em>
            </p>
          )}
        </div>
      )}
    </>
  );
}
