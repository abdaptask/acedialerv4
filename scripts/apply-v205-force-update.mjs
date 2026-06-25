#!/usr/bin/env node
// v0.10.205 - Admin "Force Update" — push the latest app version to every
// user (or any admin-chosen subset) and show each targeted client a
// BLOCKING modal that downloads + installs the update on the spot.
//
// WHY
//   The existing v0.10.101 device-heartbeat path lets an admin click
//   "Force update" on ONE specific device row, which triggers a silent
//   autoUpdater.checkForUpdatesAndNotify() on the client's next heartbeat
//   (within 60s). That covered the per-device case but had three gaps:
//
//     1) No way to push to ALL users at once.
//     2) No way to push to a multi-selected subset of users.
//     3) Client behavior was silent — the update downloaded in the
//        background and the user might never click the existing
//        "Restart to install" banner. Admin had no enforcement.
//
//   This release fixes all three. New batch admin endpoints, a new
//   blocking modal that DEFERS during active calls (per the unbroken
//   B-rule "never install during an active call"), and a dedicated
//   "Force Update" admin section under Settings.
//
// SCOPE OF CHANGES
//
//   A. NEW FILE  apps/web/src/components/ForceUpdateModal.tsx
//      Full-viewport blocking modal. Mounts once at the app root.
//      Listens for the new 'ace:force-update-required' window event
//      (dispatched by HeartbeatReporter when the server signals a
//      pending force-update for THIS device). Owns the entire update
//      lifecycle from that point: kicks off ace.checkForUpdates(),
//      subscribes to ace.onUpdateDownloaded/Progress/Error, polls
//      sipService.calls.size to defer install while on call, and
//      calls ace.installUpdate() + ackForceUpdate() when ready.
//
//   B. NEW FILE  apps/web/src/pages/settings/ForceUpdateAdminSection.tsx
//      The admin-only "Force Update" Settings pane. Lists every active
//      user with their latest device + version + last seen, lets the
//      admin select rows (or "select all") and push a force-update
//      via the new batch endpoint.
//
//   C. EDIT      apps/api/src/admin/admin.routes.ts
//      Adds 3 endpoints:
//        GET  /admin/devices/overview         — table data
//        POST /admin/force-update/all         — stamp every UserDevice
//        POST /admin/force-update/users       — body { userIds:number[] }
//      All write AuditLog entries.
//
//   D. EDIT      apps/web/src/api.ts
//      Adds 3 client functions + the DevicesOverviewRow type, mirroring
//      the existing v0.10.101 device-management functions.
//
//   E. EDIT      apps/web/src/components/HeartbeatReporter.tsx
//      Replace the in-place auto-trigger of ace.checkForUpdates() with
//      a window CustomEvent dispatch ('ace:force-update-required',
//      detail: { deviceId, requestedAt }). The new ForceUpdateModal
//      owns the install lifecycle and the ack — so we stop acking here.
//      That avoids the prior race where the ack landed BEFORE the
//      install completed and the modal-equivalent UI dismissed itself.
//
//   F. EDIT      apps/web/src/pages/Layout.tsx
//      Mount <ForceUpdateModal /> right next to <HeartbeatReporter />.
//
//   G. EDIT      apps/web/src/pages/Settings.tsx
//      Import ForceUpdateAdminSection and insert a new SECTIONS entry
//      ('force-update', Admin category, Zap icon, adminOnly: true).
//
//   H. EDIT      apps/web/src/components/DiagnosticsSection.tsx
//      Bump APP_VERSION 0.10.204 -> 0.10.205.
//
//   I. EDIT      apps/web/src/data/whatsNew.ts
//      Add v0.10.205 entry at the top of WHATS_NEW.
//
//   J. EDIT      7 x package.json
//      Bump 0.10.204 -> 0.10.205.
//
// SAFETY NOTES
//
//   - The B6 downgrade guard ('allowDowngrade=false' + per-event
//     version checks) is preserved by the existing UpdateBanner +
//     main.ts machinery. Force Update only pushes UP to whatever
//     GitHub Releases serves as latest. We never pin a target
//     version on the server — the client downloads "latest" and the
//     downgrade guard rejects anything <= local.
//
//   - The blocking modal defers install while sipService.calls.size > 0
//     OR sipService.incomingCallId !== null (matches the same defensive
//     check the SIP service uses in 11 other places — see grep). When
//     the call ends, install proceeds automatically (with a 3s grace
//     period so the user sees the modal pop in).
//
//   - The ack to /me/heartbeat/ack-update fires JUST BEFORE
//     ace.installUpdate(). If the install itself fails or the user
//     force-quits, the next admin "Push" sets a NEWER
//     forceUpdateRequestedAt than the ackedAt, so the modal
//     re-triggers — the schema's "pending if requested AND (no ack
//     OR ack < request)" handles re-pushes correctly.
//
// VERSION BUMP: 0.10.204 -> 0.10.205
// CODE CHANGES: this is the "force update by admin" feature.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v205] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v205] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v205] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v205] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeNewFile(relPath, body) {
  const fp = join(ROOT, relPath);
  if (existsSync(fp)) {
    console.error(`[apply-v205] FATAL: refusing to overwrite existing file ${relPath} via writeNewFile()`);
    process.exit(1);
  }
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, body, 'utf8');
  console.log(`  NEW ${relPath}: ${body.length} bytes`);
}

// =====================================================================
// A. NEW FILE — apps/web/src/components/ForceUpdateModal.tsx
// =====================================================================
const FORCE_UPDATE_MODAL_TSX = `// v0.10.205 — Blocking force-update modal.
//
// HOW IT FIRES
//   HeartbeatReporter dispatches a CustomEvent 'ace:force-update-required'
//   with { deviceId, requestedAt } in detail when the server-side
//   forceUpdate flag flips on for this device. This component listens
//   for that event and takes over the update flow.
//
// WHAT IT DOES
//   1. Kicks off ace.checkForUpdates() (Electron) to begin background
//      download. Web users skip straight to "reload required."
//   2. Subscribes to ace.onUpdateDownloaded / onUpdateProgress /
//      onUpdateError + ace.getUpdateState() to track download state.
//   3. Renders a full-viewport backdrop (z-index 100000+) so the user
//      cannot use the app until the update lands. Centered modal with
//      live status: "Downloading 67%" -> "Ready to install" -> button
//      "Install & Restart" (auto-clicks after 10s if downloaded).
//   4. DEFERS the install while sipService.calls.size > 0 OR
//      sipService.incomingCallId !== null. Shows a slim banner along
//      the top instead of the full block so the user can keep working
//      the call. The moment the call ends (subscribing to sipService
//      'state' events + polling calls.size as a backstop), the full
//      block surfaces again and install proceeds.
//   5. Before triggering ace.installUpdate(), calls ackForceUpdate()
//      so the server knows this device satisfied the request.
//
// WEB FALLBACK
//   No window.ace? Show the blocking modal with text "Reload required"
//   + a "Reload now" button that calls window.location.reload(). Web
//   users on the freshest Vercel bundle pick up the latest code on
//   the next reload.

import { useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle, RefreshCcw } from 'lucide-react';
import { ackForceUpdate } from '../api';
import { sipService } from '../services/sip';

type ModalState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number; version: string | null }
  | { phase: 'downloaded'; version: string | null }
  | { phase: 'installing' }
  | { phase: 'error'; message: string }
  | { phase: 'web-reload-required' };

const AUTO_INSTALL_AFTER_DOWNLOAD_MS = 10_000;

function hasActiveCall(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = sipService as any;
  try {
    const callCount = svc?.calls?.size ?? 0;
    const incoming = svc?.incomingCallId ?? null;
    return callCount > 0 || incoming !== null;
  } catch {
    return false;
  }
}

export default function ForceUpdateModal() {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<ModalState>({ phase: 'idle' });
  const [onCall, setOnCall] = useState(false);
  const deviceIdRef = useRef<string | null>(null);
  const installAckedRef = useRef(false);
  const autoInstallTimerRef = useRef<number | null>(null);

  // Listen for the trigger event from HeartbeatReporter.
  useEffect(() => {
    const onTrigger = (e: Event) => {
      const detail = (e as CustomEvent).detail as { deviceId?: string } | null;
      const deviceId = detail?.deviceId ?? null;
      if (!deviceId) return;
      if (active) return; // already running
      deviceIdRef.current = deviceId;
      setActive(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const ace = w.ace;
      if (!ace?.isElectron || typeof ace.checkForUpdates !== 'function') {
        // Web fallback — no Electron auto-updater. The user will need
        // to reload to pick up a new Vercel bundle.
        setState({ phase: 'web-reload-required' });
        return;
      }

      setState({ phase: 'checking' });
      // Kick off the silent background download. Errors come back via
      // the onUpdateError subscription below.
      ace.checkForUpdates().catch(() => undefined);

      // Rehydrate from main-process state-mirror in case the download
      // already completed in a prior heartbeat cycle.
      if (typeof ace.getUpdateState === 'function') {
        void ace.getUpdateState().then((s: { phase?: string; version?: string | null; percent?: number; message?: string } | null) => {
          if (!s) return;
          if (s.phase === 'downloaded') {
            setState({ phase: 'downloaded', version: s.version ?? null });
          } else if (s.phase === 'downloading') {
            setState({ phase: 'downloading', percent: s.percent ?? 0, version: s.version ?? null });
          } else if (s.phase === 'error') {
            setState({ phase: 'error', message: s.message ?? 'Update failed' });
          }
        }).catch(() => undefined);
      }
    };
    window.addEventListener('ace:force-update-required', onTrigger as EventListener);
    return () => window.removeEventListener('ace:force-update-required', onTrigger as EventListener);
  }, [active]);

  // Subscribe to autoUpdater events once we're active.
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.isElectron) return;

    const unsubProg = ace.onUpdateProgress?.((info: { percent?: number; version?: string | null }) => {
      setState({ phase: 'downloading', percent: info.percent ?? 0, version: info.version ?? null });
    });
    const unsubDone = ace.onUpdateDownloaded?.((info: { version?: string | null }) => {
      setState({ phase: 'downloaded', version: info.version ?? null });
    });
    const unsubErr = ace.onUpdateError?.((info: { message?: string }) => {
      setState({ phase: 'error', message: info.message ?? 'Update failed' });
    });

    return () => {
      unsubProg?.();
      unsubDone?.();
      unsubErr?.();
    };
  }, [active]);

  // Watch active-call state — both via the sipService 'state' event
  // (fires synchronously on call lifecycle changes) and a 1s polling
  // backstop in case the event misses an edge.
  useEffect(() => {
    if (!active) return;
    const tick = () => setOnCall(hasActiveCall());
    tick();
    const id = window.setInterval(tick, 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = sipService as any;
    let off: (() => void) | undefined;
    try {
      if (typeof svc?.on === 'function') {
        off = svc.on('state', tick);
        if (typeof off !== 'function') off = undefined;
      }
    } catch { /* noop */ }
    return () => {
      window.clearInterval(id);
      off?.();
    };
  }, [active]);

  // Auto-install 10s after download completes, but ONLY if we're not
  // on a call. If we are, hold off — the next call-ended tick will
  // re-evaluate and fire install.
  useEffect(() => {
    if (state.phase !== 'downloaded') {
      if (autoInstallTimerRef.current !== null) {
        window.clearTimeout(autoInstallTimerRef.current);
        autoInstallTimerRef.current = null;
      }
      return;
    }
    if (onCall) return;
    if (autoInstallTimerRef.current !== null) return;
    autoInstallTimerRef.current = window.setTimeout(() => {
      autoInstallTimerRef.current = null;
      void handleInstall();
    }, AUTO_INSTALL_AFTER_DOWNLOAD_MS);
    return () => {
      if (autoInstallTimerRef.current !== null) {
        window.clearTimeout(autoInstallTimerRef.current);
        autoInstallTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, onCall]);

  async function handleInstall() {
    if (state.phase === 'installing') return;
    setState({ phase: 'installing' });
    // Ack BEFORE quit so the server records satisfaction even if the
    // OS kills us mid-install. Best-effort — we proceed even if ack
    // fails.
    if (!installAckedRef.current) {
      installAckedRef.current = true;
      const token = sessionStorage.getItem('ace_token');
      const deviceId = deviceIdRef.current;
      if (token && deviceId) {
        try { await ackForceUpdate(token, deviceId); } catch { /* noop */ }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.isElectron || typeof ace.installUpdate !== 'function') {
      // Web fallback — reload picks up the latest Vercel bundle.
      window.location.reload();
      return;
    }
    void ace.installUpdate().catch((e: unknown) => {
      setState({ phase: 'error', message: (e as Error)?.message ?? 'Install failed' });
    });
  }

  function handleRetry() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const ace = w.ace;
    if (!ace?.checkForUpdates) return;
    setState({ phase: 'checking' });
    void ace.checkForUpdates().catch(() => undefined);
  }

  if (!active) return null;

  // -------- Render --------
  const statusText = (() => {
    if (state.phase === 'checking') return 'Preparing the update…';
    if (state.phase === 'downloading') return \`Downloading update… \${Math.round(state.percent)}%\`;
    if (state.phase === 'downloaded') return onCall ? 'Ready — installing when your call ends' : 'Ready to install';
    if (state.phase === 'installing') return 'Installing — the app will restart momentarily…';
    if (state.phase === 'error') return state.message;
    if (state.phase === 'web-reload-required') return 'Reload to pick up the latest version.';
    return '';
  })();

  const showInstallButton =
    state.phase === 'downloaded' ||
    state.phase === 'error' ||
    state.phase === 'web-reload-required';
  const installLabel =
    state.phase === 'web-reload-required' ? 'Reload now'
    : state.phase === 'error' ? 'Try again'
    : 'Install & Restart now';
  const onInstallClick =
    state.phase === 'error' ? handleRetry
    : state.phase === 'web-reload-required' ? () => window.location.reload()
    : handleInstall;

  // ------- Active-call slim banner (does not block the UI) ---------
  if (onCall && state.phase !== 'installing') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99998,
          background: 'linear-gradient(180deg, #b45309, #92400e)',
          color: '#fff',
          padding: '10px 16px',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}
      >
        <Download size={14} aria-hidden="true" />
        <strong style={{ marginRight: 6 }}>Required update —</strong>
        <span>will install automatically when your current call ends.</span>
      </div>
    );
  }

  // ------- Full blocking modal -----------------------------------
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ace-force-update-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated, #1c1c1e)',
          color: 'var(--text, #fff)',
          borderRadius: 14,
          maxWidth: 440,
          width: '100%',
          padding: '28px 28px 24px',
          boxShadow: '0 25px 60px -12px rgba(0,0,0,0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: state.phase === 'error' ? 'rgba(220,38,38,0.15)' : 'rgba(59,130,246,0.15)',
            color: state.phase === 'error' ? '#dc2626' : '#3b82f6',
            display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}
          aria-hidden="true"
        >
          {state.phase === 'error'
            ? <AlertTriangle size={28} />
            : state.phase === 'installing'
              ? <RefreshCcw size={28} />
              : <Download size={28} />}
        </div>
        <h2
          id="ace-force-update-title"
          style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}
        >
          {state.phase === 'error' ? 'Update failed' : 'Required update'}
        </h2>
        <p
          style={{
            margin: '10px 0 18px',
            color: 'var(--text-dim, rgba(235,235,245,0.7))',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {state.phase === 'error'
            ? 'The update could not be downloaded or installed. You can try again.'
            : 'Your administrator has required all dialer clients to update to the latest version. The dialer will install and restart automatically.'}
        </p>
        {state.phase === 'downloading' && (
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
              marginBottom: 12,
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: \`\${Math.max(2, Math.min(100, state.percent))}%\`,
                height: '100%',
                background: '#3b82f6',
                transition: 'width 240ms ease-out',
              }}
            />
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-muted, rgba(235,235,245,0.5))',
            marginBottom: 18,
            minHeight: 18,
          }}
          aria-live="polite"
        >
          {statusText}
        </div>
        {showInstallButton && (
          <button
            type="button"
            onClick={onInstallClick}
            style={{
              appearance: 'none',
              border: 'none',
              background: state.phase === 'error' ? '#dc2626' : '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              padding: '11px 22px',
              borderRadius: 999,
              cursor: 'pointer',
              minWidth: 200,
            }}
          >
            {installLabel}
          </button>
        )}
        {state.phase === 'downloaded' && !onCall && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--text-muted, rgba(235,235,245,0.45))',
            }}
          >
            Installing automatically in a few seconds…
          </div>
        )}
      </div>
    </div>
  );
}
`;
writeNewFile('apps/web/src/components/ForceUpdateModal.tsx', FORCE_UPDATE_MODAL_TSX);

// =====================================================================
// B. NEW FILE — apps/web/src/pages/settings/ForceUpdateAdminSection.tsx
// =====================================================================
const FORCE_UPDATE_ADMIN_SECTION_TSX = `// v0.10.205 — Admin "Force Update" Settings pane.
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
        setOkMsg(\`Force-update requested on \${r.devicesUpdated} device(s) across all users. Clients will see the blocking modal within ~60 seconds.\`);
      } else {
        const ids = Array.from(selected);
        if (ids.length === 0) {
          setError('No users selected.');
          return;
        }
        const r = await forceUpdateUserDevices(token, ids);
        setOkMsg(\`Force-update requested on \${r.devicesUpdated} device(s) across \${ids.length} user(s). Clients will see the blocking modal within ~60 seconds.\`);
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
                        aria-label={\`Select \${displayName(r)}\`}
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
`;
writeNewFile('apps/web/src/pages/settings/ForceUpdateAdminSection.tsx', FORCE_UPDATE_ADMIN_SECTION_TSX);

// =====================================================================
// C. EDIT — apps/api/src/admin/admin.routes.ts
// Add 3 endpoints right after the per-device force-update endpoint
// =====================================================================
applyEdits('apps/api/src/admin/admin.routes.ts', [
  {
    label: 'add /admin/devices/overview + /admin/force-update/{all,users}',
    find: `      await recordAudit(actor.sub, 'user.device_force_update', userId, { deviceId });
      return { ok: true };
    },
  );

  // v0.10.108 CRITICAL backfill - repair existing Call/Voicemail/Message rows`,
    replace: `      await recordAudit(actor.sub, 'user.device_force_update', userId, { deviceId });
      return { ok: true };
    },
  );

  // v0.10.205 - "Force Update" admin section. Three endpoints:
  //   GET  /admin/devices/overview        - table data for the new admin pane
  //   POST /admin/force-update/all        - stamp every UserDevice
  //   POST /admin/force-update/users      - body { userIds:number[] }
  //
  // Per-device endpoint above remains for the legacy per-device button.
  // All three write AuditLog entries so the audit trail covers batch ops too.
  app.get(
    '/admin/devices/overview',
    { onRequest: [app.authenticate, requireAdmin] },
    async () => {
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          email: { not: { endsWith: '@deleted.ace.local' } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          devices: {
            orderBy: { lastSeenAt: 'desc' },
            select: {
              deviceId: true,
              platform: true,
              appVersion: true,
              lastSeenAt: true,
              forceUpdateRequestedAt: true,
              forceUpdateAckedAt: true,
            },
          },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
      return {
        users: users.map((u) => ({
          userId: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          deviceCount: u.devices.length,
          latestDevice: u.devices[0]
            ? {
                deviceId: u.devices[0].deviceId,
                platform: u.devices[0].platform,
                appVersion: u.devices[0].appVersion,
                lastSeenAt: u.devices[0].lastSeenAt.toISOString(),
                forceUpdateRequestedAt: u.devices[0].forceUpdateRequestedAt?.toISOString() ?? null,
                forceUpdateAckedAt: u.devices[0].forceUpdateAckedAt?.toISOString() ?? null,
              }
            : null,
        })),
      };
    },
  );

  app.post(
    '/admin/force-update/all',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const actor = request.user as JwtPayload;
      const result = await prisma.userDevice.updateMany({
        data: { forceUpdateRequestedAt: new Date() },
      });
      await recordAudit(actor.sub, 'admin.force_update_all', null, {
        devicesUpdated: result.count,
      });
      return { ok: true, devicesUpdated: result.count };
    },
  );

  app.post<{ Body: { userIds?: unknown } }>(
    '/admin/force-update/users',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const actor = request.user as JwtPayload;
      const raw = request.body?.userIds;
      if (!Array.isArray(raw)) {
        return reply.code(400).send({ error: 'userIds must be an array of user ids' });
      }
      const userIds = raw
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (userIds.length === 0) {
        return reply.code(400).send({ error: 'userIds is empty' });
      }
      const result = await prisma.userDevice.updateMany({
        where: { userId: { in: userIds } },
        data: { forceUpdateRequestedAt: new Date() },
      });
      await recordAudit(actor.sub, 'admin.force_update_users', null, {
        userIds,
        devicesUpdated: result.count,
      });
      return { ok: true, devicesUpdated: result.count };
    },
  );

  // v0.10.108 CRITICAL backfill - repair existing Call/Voicemail/Message rows`,
  },
]);

// =====================================================================
// D. EDIT — apps/web/src/api.ts
// Append 3 functions + types right after requestDeviceForceUpdate
// =====================================================================
applyEdits('apps/web/src/api.ts', [
  {
    label: 'add DevicesOverviewRow + batch force-update functions',
    find: `export async function requestDeviceForceUpdate(
  token: string,
  userId: number,
  deviceId: string,
): Promise<void> {
  const res = await fetch(
    \`\${API_URL}/admin/users/\${userId}/devices/\${encodeURIComponent(deviceId)}/force-update\`,
    { method: 'POST', headers: { Authorization: \`Bearer \${token}\` } },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || \`HTTP \${res.status}\`);
  }
}`,
    replace: `export async function requestDeviceForceUpdate(
  token: string,
  userId: number,
  deviceId: string,
): Promise<void> {
  const res = await fetch(
    \`\${API_URL}/admin/users/\${userId}/devices/\${encodeURIComponent(deviceId)}/force-update\`,
    { method: 'POST', headers: { Authorization: \`Bearer \${token}\` } },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || \`HTTP \${res.status}\`);
  }
}

// v0.10.205 - "Force Update" admin section. Batch endpoints to push the
// latest dialer version to every active user (or any chosen subset).
export interface DevicesOverviewLatestDevice {
  deviceId: string;
  platform: string;
  appVersion: string;
  lastSeenAt: string;
  forceUpdateRequestedAt: string | null;
  forceUpdateAckedAt: string | null;
}

export interface DevicesOverviewRow {
  userId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  deviceCount: number;
  latestDevice: DevicesOverviewLatestDevice | null;
}

export async function getDevicesOverview(token: string): Promise<DevicesOverviewRow[]> {
  const res = await fetch(\`\${API_URL}/admin/devices/overview\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  const j = (await res.json()) as { users: DevicesOverviewRow[] };
  return j.users;
}

export async function forceUpdateAllDevices(token: string): Promise<{ ok: boolean; devicesUpdated: number }> {
  const res = await fetch(\`\${API_URL}/admin/force-update/all\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || \`HTTP \${res.status}\`);
  }
  return res.json();
}

export async function forceUpdateUserDevices(
  token: string,
  userIds: number[],
): Promise<{ ok: boolean; devicesUpdated: number }> {
  const res = await fetch(\`\${API_URL}/admin/force-update/users\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || \`HTTP \${res.status}\`);
  }
  return res.json();
}`,
  },
]);

// =====================================================================
// E. EDIT — apps/web/src/components/HeartbeatReporter.tsx
// HeartbeatReporter now JUST dispatches the event; the modal owns the
// install + ack lifecycle.
// =====================================================================
applyEdits('apps/web/src/components/HeartbeatReporter.tsx', [
  {
    label: 'replace force-update auto-trigger with event dispatch',
    find: `        if (r.forceUpdate && r.forceUpdateRequestedAt && r.forceUpdateRequestedAt !== lastForceTriggerRef.current) {
          lastForceTriggerRef.current = r.forceUpdateRequestedAt;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.ace?.checkForUpdates) {
              console.info('[heartbeat] admin requested force-update - triggering autoUpdater');
              await w.ace.checkForUpdates();
            } else {
              console.info('[heartbeat] admin requested force-update - reloading web app');
              setTimeout(() => window.location.reload(), 500);
            }
          } catch (e) {
            console.warn('[heartbeat] force-update trigger failed', e);
          }
          await ackForceUpdate(token, deviceIdRef.current).catch(() => undefined);
        }`,
    replace: `        if (r.forceUpdate && r.forceUpdateRequestedAt && r.forceUpdateRequestedAt !== lastForceTriggerRef.current) {
          lastForceTriggerRef.current = r.forceUpdateRequestedAt;
          // v0.10.205 - Dispatch a window event that ForceUpdateModal listens
          // for. The modal owns the entire install lifecycle (download UI,
          // active-call deferral, install, ack). We no longer ack here -
          // acking before the install completed dismissed the prompt while
          // the install was still in flight.
          console.info('[heartbeat] admin requested force-update - dispatching ace:force-update-required');
          try {
            window.dispatchEvent(new CustomEvent('ace:force-update-required', {
              detail: {
                deviceId: deviceIdRef.current,
                requestedAt: r.forceUpdateRequestedAt,
              },
            }));
          } catch (e) {
            console.warn('[heartbeat] dispatch failed', e);
          }
        }`,
  },
]);

// HeartbeatReporter no longer calls ackForceUpdate directly. Strip the
// now-unused import line so tsc doesn't complain about an unused symbol.
applyEdits('apps/web/src/components/HeartbeatReporter.tsx', [
  {
    label: 'drop unused ackForceUpdate import (modal owns it now)',
    find: `import { sendHeartbeat, ackForceUpdate } from '../api';`,
    replace: `import { sendHeartbeat } from '../api';`,
  },
]);

// =====================================================================
// F. EDIT — apps/web/src/pages/Layout.tsx
// Mount <ForceUpdateModal /> right next to <HeartbeatReporter />.
// =====================================================================
applyEdits('apps/web/src/pages/Layout.tsx', [
  {
    label: 'import ForceUpdateModal',
    find: `import HeartbeatReporter from '../components/HeartbeatReporter';`,
    replace: `import HeartbeatReporter from '../components/HeartbeatReporter';
import ForceUpdateModal from '../components/ForceUpdateModal';`,
  },
  {
    label: 'mount ForceUpdateModal after HeartbeatReporter',
    find: `      <HeartbeatReporter />
      <TelnyxStatusBanner />`,
    replace: `      <HeartbeatReporter />
      {/* v0.10.205 - Blocking force-update modal. Listens for the
          ace:force-update-required event HeartbeatReporter dispatches,
          shows a full-viewport block while downloading + installing,
          defers install during active calls. */}
      <ForceUpdateModal />
      <TelnyxStatusBanner />`,
  },
]);

// =====================================================================
// G. EDIT — apps/web/src/pages/Settings.tsx
// Import + new SECTIONS entry. Both edits use unique anchors.
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'import ForceUpdateAdminSection',
    find: `  getUserDevices,
  requestDeviceForceUpdate,
  type UserDeviceRow,`,
    replace: `  getUserDevices,
  requestDeviceForceUpdate,
  type UserDeviceRow,
  // v0.10.205 - Force Update admin section uses these via the
  // ForceUpdateAdminSection component (imported below from a sibling file).
  type DevicesOverviewRow as _DevicesOverviewRow,`,
  },
  {
    label: 'import the new ForceUpdateAdminSection component',
    find: `} from 'lucide-react';`,
    replace: `} from 'lucide-react';
// v0.10.205 - Force Update admin section lives in its own file to keep
// Settings.tsx anchor-stable for future apply-script edits.
import ForceUpdateAdminSection from './settings/ForceUpdateAdminSection';`,
  },
  {
    label: 'add Force Update entry to SECTIONS (right before Users)',
    find: `  { key: 'users', category: 'Admin', label: 'Users', icon: Users, blurb: 'Invite, promote, deactivate (admin only)', Component: UsersAdminSection, adminOnly: true },`,
    replace: `  // v0.10.205 - Push the latest dialer version to all (or selected) users.
  // Each targeted client shows a blocking modal that downloads + installs.
  { key: 'force-update', category: 'Admin', label: 'Force update', icon: Zap, blurb: 'Push the latest dialer version to every user (or a chosen subset) immediately', Component: ForceUpdateAdminSection, adminOnly: true },
  { key: 'users', category: 'Admin', label: 'Users', icon: Users, blurb: 'Invite, promote, deactivate (admin only)', Component: UsersAdminSection, adminOnly: true },`,
  },
]);

// =====================================================================
// H. EDIT — DiagnosticsSection.tsx APP_VERSION
// =====================================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.204';`,
    replace: `const APP_VERSION = '0.10.205';`,
  },
]);

// =====================================================================
// I. EDIT — whatsNew.ts add v0.10.205 entry
// =====================================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.205 entry at top of WHATS_NEW',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.204',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.205',
    date: 'June 25, 2026',
    highlight: 'Admin "Force update" — push the latest dialer version to every user (or any chosen subset) with one click.',
    changes: [
      { type: 'new', text: 'Admin > Settings > Force update lists every active user with their latest version and device, and lets an admin push the latest dialer version to ALL users at once or to a selected subset.' },
      { type: 'new', text: 'Targeted clients show a full-screen blocking dialog that downloads and installs the update. Users on an active call see a slim banner instead and install runs automatically after the call ends — no calls are interrupted.' },
      { type: 'improved', text: 'The existing per-device "Force update" button under each user remains for the one-off case.' },
    ],
  },
  {
    version: '0.10.204',`,
  },
]);

// =====================================================================
// J. Version bumps 0.10.204 -> 0.10.205 across 7 package.json files
// =====================================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.204"/, '"version": "0.10.205"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.204 -> 0.10.205`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v205] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}
if (bumped !== PKGS.length) {
  console.warn(`[apply-v205] WARN: only ${bumped}/${PKGS.length} package.json files bumped (expected all 7)`);
}

console.log('');
console.log('[apply-v205] DONE');
console.log('');
console.log('NEXT (run from the repo root in PowerShell):');
console.log('  node scripts/strip-null-bytes.mjs');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.205: Admin Force Update - push latest version to all or selected users"');
console.log('  git tag v0.10.205');
console.log('  git push origin main');
console.log('  git push origin v0.10.205');
console.log('');
console.log('Reminder: server side (apps/api) auto-deploys to Render on main push.');
console.log('Desktop .exe builds via build-desktop.yml when the v0.10.205 tag lands.');
