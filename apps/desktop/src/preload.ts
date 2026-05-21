// Preload — bridges Electron main process and renderer in a sandboxed way.
// Anything exposed via contextBridge becomes window.ace.* in the renderer.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aceDesktop', {
  version: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
});

// Phase 5.2: incoming-call bridge.
// - onIncomingCall(): renderer tells main "a call is ringing, surface a popup"
// - acceptCall() / declineCall(): the FLOATING RINGER window calls these when
//   the user clicks Accept or Decline; main forwards to the MAIN window's
//   SipContext (via ace:accept-request / ace:decline-request).
// - onAcceptRequest / onDeclineRequest: the MAIN window subscribes so it can
//   call sipService.acceptCall() / declineCall() when the floating ringer fires.
// - onCallEnded(): main tells the floater (and any listener) to close when the
//   call resolves so the floater goes away.
contextBridge.exposeInMainWorld('ace', {
  isElectron: true,
  appVersion: process.env.npm_package_version,
  onIncomingCall: (number?: string, callId?: string) => {
    ipcRenderer.send('ace:incoming-call', { number, callId });
  },
  acceptCall: () => ipcRenderer.send('ace:accept'),
  declineCall: () => ipcRenderer.send('ace:decline'),
  notifyCallEnded: () => ipcRenderer.send('ace:call-ended'),
  onAcceptRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:accept-request', handler);
    return () => ipcRenderer.removeListener('ace:accept-request', handler);
  },
  onDeclineRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:decline-request', handler);
    return () => ipcRenderer.removeListener('ace:decline-request', handler);
  },
  onClose: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:close-ringer', handler);
    return () => ipcRenderer.removeListener('ace:close-ringer', handler);
  },
  // For the ringer window to read the caller info passed in the URL.
  getQueryParam: (name: string): string | null => {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch {
      return null;
    }
  },
  // ── Microsoft SSO bridge (Phase 7) ──
  // openExternal: ask main to open a https:// URL in the system browser
  // (used for the Microsoft authorize page — Microsoft blocks embedded
  // webviews for OAuth + Conditional Access often requires a real browser).
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('ace:open-external', url),
  // onSsoCallback: renderer subscribes so it gets the ace-dialer://auth/callback
  // URL the OS handed us when Microsoft redirected back. Returns an unsubscribe
  // function for the React useEffect cleanup pattern.
  onSsoCallback: (cb: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('ace:sso-callback', handler);
    return () => ipcRenderer.removeListener('ace:sso-callback', handler);
  },
  // notifyReadyForSso: renderer pings main when it's ready to receive
  // cold-start protocol URLs (used to flush a buffered URL from the
  // first launch's argv).
  notifyReadyForSso: () => ipcRenderer.send('ace:sso-ready'),
});
