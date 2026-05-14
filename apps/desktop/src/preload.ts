// Preload — runs in an isolated context between Electron main and the renderer.
// Anything exposed via contextBridge becomes window.aceDesktop.* in the React app.
// Phase 3: just expose version + platform info. Native features come in Phase 4.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('aceDesktop', {
  version: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
});
