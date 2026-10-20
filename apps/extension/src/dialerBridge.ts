// Runs only on the web dialer (https://dialer.aptask.com). Carries a number
// from the background worker into the running SPA.
//
// Why a postMessage hand-off and not chrome.tabs.update({ url }): a URL
// navigation reloads the SPA, and a reload drops the per-tab sessionStorage
// JWT and the SIP registration — which ends any call in progress. The page
// routes in-app instead (App.tsx), exactly as the desktop app does for its
// deep links.
//
// The page must ACK. An older web build has no listener, and a tab still on
// the login screen may not either; without an ack the background worker
// can't tell "delivered" from "dropped" and the click would vanish. No ack →
// report failure → the worker falls back to the user's preference.

const ACK_TIMEOUT_MS = 600;

// The worker re-injects this file into tabs that were open before the
// extension was installed; two listeners would deliver the number twice.
const w = window as { __aceDialerBridge?: boolean };
if (!w.__aceDialerBridge) {
  w.__aceDialerBridge = true;
  chrome.runtime.onMessage.addListener(onDial);
}

function onDial(msg: { type?: string; to?: string }, _sender: chrome.runtime.MessageSender, sendResponse: (r: { ok: boolean }) => void) {
  if (msg?.type !== 'ace-dial' || !msg.to) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const done = (ok: boolean) => {
    window.removeEventListener('message', onAck);
    clearTimeout(timer);
    sendResponse({ ok });
  };
  const onAck = (e: MessageEvent) => {
    const d = e.data as { source?: string; type?: string; id?: string } | null;
    if (e.origin !== location.origin || d?.source !== 'ace-dialer-web') return;
    if (d.type === 'dial-ack' && d.id === id) done(true);
  };
  const timer = setTimeout(() => done(false), ACK_TIMEOUT_MS);
  window.addEventListener('message', onAck);
  window.postMessage({ source: 'ace-extension', type: 'dial', id, to: msg.to, src: 'selection' }, location.origin);
  return true; // async sendResponse
}

export {};
