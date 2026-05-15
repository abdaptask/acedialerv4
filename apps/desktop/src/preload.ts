// Preload — bridges Electron main process and renderer in a sandboxed way.
// Anything exposed via contextBridge becomes window.ace.* in the React app.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aceDesktop', {
  version: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
});

// Phase 5.2: incoming-call bridge. Renderer asks main to wake the window when
// an inbound call rings, so a minimized dialer pops to the front.
contextBridge.exposeInMainWorld('ace', {
  isElectron: true,
  appVersion: process.env.npm_package_version,
  onIncomingCall: (number?: string) => {
    ipcRenderer.send('ace:incoming-call', { number });
  },
});
