// v0.10.205 — Admin "Force Update" Settings pane.
//
// Lists every active user with their latest device + version + last
// seen. Admin can select rows (or "select all") and push a force-update.
// All targeted devices show a blocking modal that downloads + installs
// the latest version (deferred during active calls).
//
// Backed by 3 endpoints added in v0.10.205:
//   GET  /admin/devices/overview         — table data
//   POST /admin/force-update/all         — every UserDevice
//   POST /admin/force-update/users       — { userIds:number[] }

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  getDevicesOverview,
  forceUpdateAllDevices,
  forceUpdateUserDevices,
  type DevicesOverviewRow,
} from '../../api';

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  return day + 'd ago';
}

function displayName(r: DevicesOverviewRow): string {
  const composed = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
  return composed || r.email;
}

export default function ForceUpdateAdminSection() {
  const [rows, setRows] = useState<DevicesOverviewRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'all' | 'selected' | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const token = sessionStorage.getItem('ace_token');
      if (!token) { setError('Sign in again.'); return; }
      const list = await getDevicesOverview(token);
      setRows(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [] as DevicesOverviewRow[];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = displayName(r).toLowerCase();
      return name.includes(q) || r.email.toLowerCase().includes(q);
    });
  }, [rows, query]);

  const allSelectedInView =
    filtered.length > 0 && filtered.every((r) => selected.has(r.userId));

  function toggleOne(userId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }
  function toggleAllInView() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedInView) {
        for (const r of filtered) next.delete(r.userId);
      } else {
        for (const r of filtered) next.add(r.userId);
      }
      return next;
    });
  }

  async function runPush(mode: 'all' | 'selected') {
    setError(null);
    setOkMsg(null);
    setBusy(true);
    try {
      const token = sessionStorage.getItem('ace_token');
      if (!token) { setError('Sign in again.'); return; }
      if (mode === 'all') {
        const r = await forceUpdateAllDevices(token);
        setOkMsg(`Force-update requested on ${r.devicesUpdated} device(s) across all users. Clients will see the blocking modal within ~60 seconds.`);
      } else {
        const ids = Array.from(selected);
        if (ids.length === 0) {
          setError('No users selected.');
          return;
        }
        const r = await forceUpdateUserDevices(token, ids);
        setOkMsg(`Force-update requested on ${r.devicesUpdated} device(s) across ${ids.length} user(s). Clients will see the blocking modal within ~60 seconds.`);
        setSelected(new Set());
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const selectedCount = selected.size;
  const targetedDevices = rows
    ? Array.from(selected).reduce((sum, uid) => {
        const r = rows.find((x) => x.userId === uid);
        return sum + (r?.deviceCount ?? 0);
      }, 0)
    : 0;

  return (
    <div className="settings-section">
      <p className="muted small" style={{ marginTop: 0 }}>
        Push the latest dialer version to users immediately. Each targeted
        client shows a full-screen blocking modal that downloads and installs
        the update. During an active call, install is deferred until the call
        ends, then runs automatically.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          margin: '16px 0',
        }}
      >
        <button
          type="button"
          onClick={() => setConfirm('all')}
          disabled={busy || loading || !rows || rows.length === 0}
          style={{
            appearance: 'none',
            border: 'none',
            background: '#dc2626',
            color: '#fff',
            fontWeight: 600,
            fontSize: 13,
            padding: '8px 14px',
            borderRadius: 8,
            cursor: busy ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Push the latest version to every active user's devices"
        >
          <Zap size={14} />
          Force update ALL users
        </button>
        <button
          type="button"
          onClick={() => setConfirm('selected')}
          disabled={busy || selectedCount === 0}
          style={{
            appearance: 'none',
            border: '1px solid var(--border, #cbd5e1)',
            background: 'transparent',
            color: 'var(--text, inherit)',
            fontWeight: 600,
            fontSize: 13,
            padding: '8px 14px',
            borderRadius: 8,
            cursor: busy || selectedCount === 0 ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: selectedCount === 0 ? 0.5 : 1,
          }}
        >
          Force update selected ({selectedCount})
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="icon-btn"
          title="Refresh"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
          }}
        >
          <RefreshCw size={13} />
          Refresh
        </button>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          placeholder="Filter by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            padding: '7px 10px',
            border: '1px solid var(--border, #cbd5e1)',
            borderRadius: 8,
            background: 'var(--bg, transparent)',
            color: 'inherit',
            fontSize: 13,
            minWidth: 220,
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            color: '#dc2626',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}
      {okMsg && (
        <div
          role="status"
          style={{
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.25)',
            color: '#059669',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <CheckCircle2 size={14} />
          {okMsg}
        </div>
      )}

      {loading && <div className="muted small">Loading device overview…</div>}

      {!loading && rows && rows.length === 0 && (
        <p className="muted small">
          No users with reported devices yet. Devices appear after a user signs
          into a v0.10.101+ build (the heartbeat reports the device).
        </p>
      )}

      {!loading && rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-soft, #f8fafc)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)', width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelectedInView}
                    onChange={toggleAllInView}
                    aria-label="Select all"
                  />
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>User</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Latest version</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Platform</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Devices</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Last seen</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const reqAt = r.latestDevice?.forceUpdateRequestedAt ?? null;
                const ackAt = r.latestDevice?.forceUpdateAckedAt ?? null;
                const pending = !!reqAt && (!ackAt || new Date(ackAt) < new Date(reqAt));
                return (
                  <tr key={r.userId}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.userId)}
                        onChange={() => toggleOne(r.userId)}
                        aria-label={`Select ${displayName(r)}`}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      <div style={{ fontWeight: 500 }}>{displayName(r)}</div>
                      <div className="muted small" style={{ fontSize: 11 }}>{r.email}</div>
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      <code style={{ fontSize: 12 }}>{r.latestDevice?.appVersion ?? '—'}</code>
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      <code style={{ fontSize: 11 }}>{r.latestDevice?.platform ?? '—'}</code>
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      {r.deviceCount}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }} title={r.latestDevice?.lastSeenAt ?? ''}>
                      {fmtAge(r.latestDevice?.lastSeenAt ?? null)}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                      {pending ? (
                        <span style={{ color: '#d97706', fontSize: 12 }}>Update pending</span>
                      ) : (
                        <span className="muted small" style={{ fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 14, textAlign: 'center' }} className="muted small">
                    No users match the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: 'var(--bg, #fff)',
              color: 'var(--text, inherit)',
              borderRadius: 12,
              maxWidth: 460,
              width: '100%',
              padding: 22,
              border: '1px solid var(--border, #e2e8f0)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600 }}>
              {confirm === 'all' ? 'Force update ALL users?' : 'Force update selected users?'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim, #475569)' }}>
              {confirm === 'all' ? (
                <>This will require every active user's dialer to download and install the latest version immediately. Users on an active call will see install deferred until their call ends. There is no opt-out.</>
              ) : (
                <>This will require {selectedCount} user(s) — {targetedDevices} device(s) total — to download and install the latest version immediately. Users on an active call will see install deferred until their call ends. There is no opt-out.</>
              )}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy}
                style={{
                  appearance: 'none',
                  border: '1px solid var(--border, #cbd5e1)',
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 13,
                  padding: '7px 14px',
                  borderRadius: 8,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runPush(confirm)}
                disabled={busy}
                style={{
                  appearance: 'none',
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  padding: '7px 14px',
                  borderRadius: 8,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {busy ? 'Pushing…' : 'Yes, force update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
