/// <reference types="vite/client" />

// Injected by vite.config.ts at build time.
declare const __APP_VERSION__: string;

// Electron IPC bridge exposed by apps/desktop/src/preload.ts.
interface AceElectronBridge {
  onIncomingCall: (number?: string) => void;
  isElectron: boolean;
  appVersion?: string;
}
interface Window {
  ace?: AceElectronBridge;
}
