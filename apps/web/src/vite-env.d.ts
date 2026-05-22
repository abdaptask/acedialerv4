/// <reference types="vite/client" />

// Injected by vite.config.ts at build time.
declare const __APP_VERSION__: string;

// Electron preload bridge (apps/desktop/src/preload.ts).
interface AceElectronBridge {
  isElectron: boolean;
  appVersion?: string;
  onIncomingCall: (number?: string, callId?: string) => void;
  acceptCall: () => void;
  declineCall: () => void;
  notifyCallEnded: () => void;
  onAcceptRequest: (cb: () => void) => () => void;
  onDeclineRequest: (cb: () => void) => () => void;
  onClose: (cb: () => void) => () => void;
  getQueryParam: (name: string) => string | null;
  // Phase 7 — Microsoft SSO bridge
  openExternal: (url: string) => Promise<boolean>;
  onSsoCallback: (cb: (url: string) => void) => () => void;
  notifyReadyForSso: () => void;
  // Phase 7.1 — silent auto-update bridge
  onUpdateAvailable?: (cb: (info: { version: string | null }) => void) => () => void;
  onUpdateProgress?: (cb: (info: { percent: number }) => void) => () => void;
  onUpdateDownloaded?: (cb: (info: { version: string | null }) => void) => () => void;
  installUpdate?: () => Promise<boolean>;
  checkForUpdates?: () => Promise<{ state: string; version?: string | null; message?: string }>;
}
interface Window {
  ace?: AceElectronBridge;
}
