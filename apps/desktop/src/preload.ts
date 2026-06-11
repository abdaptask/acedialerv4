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
  // v0.10.120 - third arg hasActiveCall. When true, the floating ringer
  // popup MUST hide the plain Accept button and only offer Decline + Hold
  // & Accept, otherwise tapping Accept while already on a call merges the
  // two audio streams (the original bug that triggered this hotfix).
  onIncomingCall: (number?: string, callId?: string, hasActiveCall?: boolean) => {
    ipcRenderer.send('ace:incoming-call', { number, callId, hasActiveCall: !!hasActiveCall });
  },
  acceptCall: () => ipcRenderer.send('ace:accept'),
  declineCall: () => ipcRenderer.send('ace:decline'),
  // v0.10.120 - new bridge: floater click on Hold & Accept goes here.
  // Main forwards to main window via ace:hold-and-accept-request which
  // SipContext subscribes to and routes to sipService.holdAndAcceptCall.
  holdAndAcceptCall: () => ipcRenderer.send('ace:hold-and-accept'),
  // v0.10.122 - new bridge: floater click on Reply with Text goes here.
  // Main forwards to main window via ace:reply-with-text-request; the
  // IncomingCall React component subscribes there and dispatches the
  // existing ace:reply-after-decline CustomEvent that PostDeclineReply
  // listens for (same flow as clicking Reply on the in-app full-screen
  // ringer).
  replyWithText: () => ipcRenderer.send('ace:reply-with-text'),
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
  // v0.10.120 - main window subscribes; fires when the floater user picked
  // Hold & Accept. Returns an unsubscribe fn (matches existing patterns).
  onHoldAndAcceptRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:hold-and-accept-request', handler);
    return () => ipcRenderer.removeListener('ace:hold-and-accept-request', handler);
  },
  // v0.10.122 - main window subscribes; fires when the floater user picked
  // Reply with Text. Returns an unsubscribe fn (matches existing patterns).
  onReplyWithTextRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:reply-with-text-request', handler);
    return () => ipcRenderer.removeListener('ace:reply-with-text-request', handler);
  },
  onClose: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ace:close-ringer', handler);
    return () => ipcRenderer.removeListener('ace:close-ringer', handler);
  },
  getQueryParam: (name: string): string | null => {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch {
      return null;
    }
  },
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('ace:open-external', url),
  onSsoCallback: (cb: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('ace:sso-callback', handler);
    return () => ipcRenderer.removeListener('ace:sso-callback', handler);
  },
  notifyReadyForSso: () => ipcRenderer.send('ace:sso-ready'),
  onDeepLink: (cb: (data: { action: 'call' | 'sms'; to: string }) => void) => {
    const handler = (_e: unknown, data: { action: 'call' | 'sms'; to: string }) =>
      cb(data);
    ipcRenderer.on('ace:deep-link', handler);
    return () => ipcRenderer.removeListener('ace:deep-link', handler);
  },
  notifyReadyForDeepLink: () => ipcRenderer.send('ace:deep-link-ready'),
  onSipWake: (cb: (data: { reason: string }) => void) => {
    const handler = (_e: unknown, data: { reason: string }) => cb(data);
    ipcRenderer.on('ace:sip-wake', handler);
    return () => ipcRenderer.removeListener('ace:sip-wake', handler);
  },
  onUpdateAvailable: (cb: (info: { version: string | null }) => void) => {
    const handler = (_e: unknown, info: { version: string | null }) => cb(info);
    ipcRenderer.on('ace:update-available', handler);
    return () => ipcRenderer.removeListener('ace:update-available', handler);
  },
  onUpdateProgress: (cb: (info: { percent: number }) => void) => {
    const handler = (_e: unknown, info: { percent: number }) => cb(info);
    ipcRenderer.on('ace:update-progress', handler);
    return () => ipcRenderer.removeListener('ace:update-progress', handler);
  },
  onUpdateDownloaded: (cb: (info: { version: string | null }) => void) => {
    const handler = (_e: unknown, info: { version: string | null }) => cb(info);
    ipcRenderer.on('ace:update-downloaded', handler);
    return () => ipcRenderer.removeListener('ace:update-downloaded', handler);
  },
  onUpdateError: (cb: (info: { message: string }) => void) => {
    const handler = (_e: unknown, info: { message: string }) => cb(info);
    ipcRenderer.on('ace:update-error', handler);
    return () => ipcRenderer.removeListener('ace:update-error', handler);
  },
  getUpdateState: (): Promise<{
    phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
    version?: string | null;
    percent?: number;
    message?: string;
  }> => ipcRenderer.invoke('ace:get-update-state'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('ace:install-update'),
  checkForUpdates: (): Promise<{ state: string; version?: string | null; message?: string }> =>
    ipcRenderer.invoke('ace:check-for-updates'),
});
