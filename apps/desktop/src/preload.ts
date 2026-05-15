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
});
