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
}
interface Window {
  ace?: AceElectronBridge;
}
