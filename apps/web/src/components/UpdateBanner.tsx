// In-app banner that surfaces when a newer version of ACE Dialer is live.
//
// Two paths, depending on what the runtime supports:
//
//  A) ELECTRON with electron-updater (the new normal — Phase 7.1):
//     - Main process polls GitHub Releases every 60 min, downloads the new
//       installer SILENTLY in the background, and emits IPC events.
//     - We subscribe via window.ace.onUpdateAvailable / onUpdateDownloaded.
//     - When download finishes, show "Update ready — Restart to install"
//       with a single button that calls window.ace.installUpdate(). The
//       main process runs `autoUpdater.quitAndInstall()`, the new installer
//       runs, the app relaunches. Zero clicks beyond the restart button.
//
//  B) WEB BROWSER, or older Electron without the updater bridge (legacy):
//     - We fall back to polling the API's `/` endpoint every 15 min and
//       comparing the server version against the bundled __APP_VERSION__.
//     - When ahead, show a banner with:
//         - "Refresh now" (web) → reload the page so the new Vercel bundle
//           gets picked up.
//         - "Download installer" → opens GitHub Releases in the system
//           browser so the user can grab the new .dmg or .exe.
//
// Dismissal is keyed by candidate version so the banner reappears on the
// NEXT release even if the user dismissed the previous one.
import { useEffect, useState } from 'react';
import { Download, X, RefreshCcw } from 'lucide-react';
import { getApiVersion } from '../api';

const RELEASES_URL = 'https://github.com/abdaptask/acedialerv4/releases/latest';
const DISMISS_KEY_PREFIX = 'ace_update_dismissed_';
const POLL_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes (web/fallback path)

function parseSemver(v: string): number[] {
  return v.split(/[.\-+]/).map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}
function compareSemver(a: string, b: string): number {
  const aP = parseSemver(a);
  const bP = parseSemver(b);
  const len = Math.max(aP.length, bP.length);
  for (let i = 0; i < len; i++) {
    const diff = (aP[i] ?? 0) - (bP[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

declare const __APP_VERSION__: string | undefined;

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string | null }
  | { phase: 'downloading'; version: string | null; percent: number }
  | { phase: 'downloaded'; version: string | null }
  | { phase: 'server-ahead'; version: string }; // fallback path (web or legacy electron)

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [installing, setInstalling] = useState<boolean>(false);

  const localVersion =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  const ace = window.ace;
  const isElectron = !!ace?.isElectron;
  const hasAutoUpdater =
    isElectron &&
    typeof ace?.onUpdateAvailable === 'function' &&
    typeof ace?.onUpdateDownloaded === 'function' &&
    typeof ace?.installUpdate === 'function';

  // Path A — silent auto-update events from the Electron main process.
  useEffect(() => {
    if (!hasAutoUpdater) return;
    const unsubAvail = ace!.onUpdateAvailable!((info) => {
      setState({ phase: 'available', version: info.version });
    });
    const unsubProg = ace!.onUpdateProgress?.((info) => {
      setState((prev) => {
        const version = ('version' in prev) ? prev.version ?? null : null;
        return { phase: 'downloading', version, percent: info.percent };
      });
    });
    const unsubDone = ace!.onUpdateDownloaded!((info) => {
      setState({ phase: 'downloaded', version: info.version });
    });
    return () => {
      unsubAvail?.();
      unsubProg?.();
      unsubDone?.();
    };
  }, [hasAutoUpdater, ace]);

  // Path B — fallback poll of API version (web browser, or old Electron
  // installs that don't have the auto-updater bridge yet).
  useEffect(() => {
    if (hasAutoUpdater) return;
    let cancelled = false;
    async function check() {
      const v = await getApiVersion();
      if (cancelled || !v) return;
      if (compareSemver(v, localVersion) > 0) {
        setState({ phase: 'server-ahead', version: v });
      }
    }
    void check();
    const id = window.setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasAutoUpdater, localVersion]);

  // Reset dismissal when the candidate version changes — a new release
  // surfaces fresh even if the previous one was dismissed.
  useEffect(() => {
    const v =
      state.phase === 'idle' ? null
      : state.phase === 'available' || state.phase === 'downloading' || state.phase === 'downloaded' ? state.version
      : state.version;
    if (!v) return;
    const key = DISMISS_KEY_PREFIX + v;
    setDismissed(sessionStorage.getItem(key) === '1');
  }, [state]);

  if (state.phase === 'idle') return null;
  if (dismissed) return null;

  function handleInstallNow() {
    if (!ace?.installUpdate) return;
    setInstalling(true);
    // Fire-and-forget — main quits the app and runs the installer; React
    // never gets a chance to re-render so we just show the "installing" UI
    // until the OS swaps us out.
    void ace.installUpdate().catch(() => setInstalling(false));
  }

  function handleOpenReleases() {
    if (isElectron && ace?.openExternal) {
      void ace.openExternal(RELEASES_URL);
    } else {
      window.open(RELEASES_URL, '_blank', 'noopener,noreferrer');
    }
  }

  function handleRefresh() {
    window.location.reload();
  }

  function handleDismiss() {
    const v =
      state.phase === 'available' || state.phase === 'downloading' || state.phase === 'downloaded' ? state.version
      : state.phase === 'server-ahead' ? state.version
      : null;
    if (!v) return;
    sessionStorage.setItem(DISMISS_KEY_PREFIX + v, '1');
    setDismissed(true);
  }

  // ------- Render -------
  const candidate =
    state.phase === 'server-ahead' ? state.version
    : (state.phase === 'available' || state.phase === 'downloading' || state.phase === 'downloaded') ? (state.version ?? '')
    : '';

  let title = 'Update available';
  let actions: React.ReactNode = null;

  if (state.phase === 'available') {
    title = 'Update available — downloading…';
    actions = (
      <span className="update-banner-versions">
        v{localVersion} → v{candidate || '?'}
      </span>
    );
  } else if (state.phase === 'downloading') {
    title = `Downloading update — ${Math.round(state.percent)}%`;
    actions = (
      <span className="update-banner-versions">
        v{localVersion} → v{candidate || '?'}
      </span>
    );
  } else if (state.phase === 'downloaded') {
    title = 'Update ready';
    actions = (
      <>
        <span className="update-banner-versions">
          v{localVersion} → v{candidate || '?'}
        </span>
        <button
          type="button"
          className="update-banner-cta"
          onClick={handleInstallNow}
          disabled={installing}
          title="Restart the app to install"
        >
          <Download size={14} />
          {installing ? 'Restarting…' : 'Restart to install'}
        </button>
      </>
    );
  } else if (state.phase === 'server-ahead') {
    title = 'Update available';
    actions = (
      <>
        <span className="update-banner-versions">
          v{localVersion} → v{candidate}
        </span>
        {isElectron ? (
          <button
            type="button"
            className="update-banner-cta"
            onClick={handleOpenReleases}
            title={`Open ${RELEASES_URL}`}
          >
            <Download size={14} />
            Download installer
          </button>
        ) : (
          <>
            <button
              type="button"
              className="update-banner-cta"
              onClick={handleRefresh}
              title="Reload to pick up the new web bundle"
            >
              <RefreshCcw size={14} />
              Refresh now
            </button>
            <button
              type="button"
              className="update-banner-cta-secondary"
              onClick={handleOpenReleases}
              title={`Open ${RELEASES_URL}`}
            >
              Desktop installers
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        <Download size={16} />
      </span>
      <span className="update-banner-text">
        <strong>{title}</strong>
      </span>
      <div className="update-banner-actions">
        {actions}
        <button
          type="button"
          className="update-banner-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
          title="Dismiss for this session"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
