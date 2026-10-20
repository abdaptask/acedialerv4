// Receiving end of the browser extension's hand-off (apps/extension,
// dialerBridge.ts). When the web dialer is already open in a tab, the
// extension delivers a clicked number here instead of opening a new tab or
// the desktop app — and instead of reloading this one, which would drop the
// tab's JWT and SIP registration and end any call in progress.

export interface ExtensionDial {
  id: string;
  to: string;
  action: 'call' | 'sms';
  /** False = text read off someone else's page (src=selection): strict parse.
   *  True = a follow-up from our own database: the Teams-card path. */
  trusted: boolean;
}

/**
 * Accept only our own extension's message shape, from this window.
 *
 * The origin check matters less than it looks — anything that can post from
 * this origin already runs inside the app — but it keeps other frames and
 * other windows out. What actually keeps this safe is what happens next:
 * every route below only PREFILLS — nothing on this path can place a call or
 * send a text — and a page capture carries `src=selection`, so Dialpad runs
 * the strict parser on it.
 */
export function parseExtensionDial(
  e: Pick<MessageEvent, 'origin' | 'data'>,
  ownOrigin: string,
): ExtensionDial | null {
  if (e.origin !== ownOrigin) return null;
  const d = e.data as { source?: unknown; type?: unknown; id?: unknown; to?: unknown; action?: unknown; src?: unknown } | null;
  if (!d || d.source !== 'ace-extension' || (d.type !== 'dial' && d.type !== 'open')) return null;
  if (typeof d.id !== 'string' || typeof d.to !== 'string' || !d.to.trim()) return null;
  const base = { id: d.id.slice(0, 64), to: d.to.slice(0, 200) };
  // 'dial' = a number captured off a page: always a strict-parsed call,
  // whatever else the message claims.
  if (d.type === 'dial') return { ...base, action: 'call', trusted: false };
  // 'open' = a follow-up panel action. Fail toward strict: only a message
  // with NO src at all is trusted, the same rule as the desktop deep links.
  return {
    ...base,
    action: d.action === 'sms' ? 'sms' : 'call',
    trusted: d.src === undefined || d.src === null,
  };
}

/** The route the desktop app uses for the same hand-off (App.tsx deep links). */
export function extensionDialRoute(dial: Pick<ExtensionDial, 'to' | 'action' | 'trusted'>): string {
  const to = encodeURIComponent(dial.to);
  if (dial.action === 'sms') return `/messages?to=${to}`;
  return `/keypad?to=${to}${dial.trusted ? '' : '&src=selection'}`;
}

export function extensionDialAck(id: string) {
  return { source: 'ace-dialer-web', type: 'dial-ack', id } as const;
}
