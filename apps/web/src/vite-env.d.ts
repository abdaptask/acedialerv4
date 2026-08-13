/// <reference types="vite/client" />

// Injected by vite.config.ts at build time.
declare const __APP_VERSION__: string;

// Electron preload bridge (apps/desktop/src/preload.ts).
interface AceElectronBridge {
  isElectron: boolean;
  appVersion?: string;
  // v0.10.120 - 3rd arg hasActiveCall. When true, floater hides plain
  // Accept (which would merge calls) and renders Hold & Accept instead.
  onIncomingCall: (number?: string, callId?: string, hasActiveCall?: boolean) => void;
  acceptCall: () => void;
  declineCall: () => void;
  // v0.10.120 - floater Hold & Accept click bridge.
  holdAndAcceptCall?: () => void;
  // v0.10.129 - floater Reply with Text click bridge.
  replyWithText?: () => void;
  notifyCallEnded: () => void;
  onAcceptRequest: (cb: () => void) => () => void;
  onDeclineRequest: (cb: () => void) => () => void;
  // v0.10.120 - main-window subscription fired when the floater user
  // clicked Hold & Accept. Optional so older preloads still typecheck.
  onHoldAndAcceptRequest?: (cb: () => void) => () => void;
  // v0.10.129 - main-window subscription for floater Reply with Text.
  onReplyWithTextRequest?: (cb: () => void) => () => void;
  onClose: (cb: () => void) => () => void;
  getQueryParam: (name: string) => string | null;
  // Phase 7 — Microsoft SSO bridge
  openExternal: (url: string) => Promise<boolean>;
  onSsoCallback: (cb: (url: string) => void) => () => void;
  notifyReadyForSso: () => void;
  // v0.10.4 Task 10 — Deep-link bridge (Teams card buttons)
  // v0.10.156 - widened for the voicemail Listen button.
  // v0.10.218 - `src: 'selection'` marks a link whose number came from
  // arbitrary highlighted text (tel: link, browser extension, clipboard
  // hotkey) rather than our own database. Those get strict validation and an
  // error surface; trusted sources keep the existing lenient behaviour.
  onDeepLink?: (
    cb: (
      data:
        // v0.10.221 - src names WHICH path captured the text, so the dialer can
        // attribute a refusal ("from your clipboard") instead of just refusing.
        // repeat = the hotkey was pressed twice on identical clipboard content.
        | { action: 'call'; to: string; src?: 'selection' | 'clipboard' | 'tel'; repeat?: boolean }
        | { action: 'sms'; to: string; src?: 'selection' | 'clipboard' | 'tel' }
        | { action: 'voicemail'; id: string },
    ) => void,
  ) => () => void;
  notifyReadyForDeepLink?: () => void;
  // v0.10.218 - Click-to-Dial OS registration, driven from Settings.
  setClickToDialConfig?: (cfg: { telHandler?: boolean; hotkey?: string | null }) => Promise<{
    tel?: { ok: boolean; error?: string };
    hotkey?: { ok: boolean; error?: string };
  }>;
  getClickToDialStatus?: () => Promise<{ telHandler: boolean; hotkey: string | null }>;
  // v0.10.9 — System power events (resume from sleep / unlock screen).
  onSipWake?: (cb: (data: { reason: string }) => void) => () => void;
  // Phase 7.1 — silent auto-update bridge
  onUpdateAvailable?: (cb: (info: { version: string | null }) => void) => () => void;
  onUpdateProgress?: (cb: (info: { percent: number }) => void) => () => void;
  onUpdateDownloaded?: (cb: (info: { version: string | null }) => void) => () => void;
  // v0.9.1 — surfaced when electron-updater errors out (download failed,
  // installer rejected, GitHub 403, etc.). Optional so older preloads
  // (without the bridge) still type-check.
  onUpdateError?: (cb: (info: { message: string }) => void) => () => void;
  // v0.10.209 — fired when a checkForUpdates() finds nothing newer to
  // install. Lets ForceUpdateModal ack + dismiss instead of hanging on
  // "Preparing the update…" when the client is already current.
  onUpdateNotAvailable?: (cb: (info: { version: string | null }) => void) => () => void;
  installUpdate?: () => Promise<boolean>;
  checkForUpdates?: () => Promise<{ state: string; version?: string | null; message?: string }>;
  // v0.8.8 — state-mirror query for the auto-update banner to rehydrate
  // on mount and never miss the one-shot 'update-downloaded' event.
  getUpdateState?: () => Promise<{
    phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
    version?: string | null;
    percent?: number;
    message?: string;
  }>;
}
interface Window {
  ace?: AceElectronBridge;
}
