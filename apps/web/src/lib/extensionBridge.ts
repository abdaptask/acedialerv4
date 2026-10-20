// Receiving end of the browser extension's hand-off (apps/extension,
// dialerBridge.ts). When the web dialer is already open in a tab, the
// extension delivers a clicked number here instead of opening a new tab or
// the desktop app — and instead of reloading this one, which would drop the
// tab's JWT and SIP registration and end any call in progress.

export interface ExtensionDial {
  id: string;
  to: string;
}

/**
 * Accept only our own extension's message shape, from this window.
 *
 * The origin check matters less than it looks — anything that can post from
 * this origin already runs inside the app — but it keeps other frames and
 * other windows out. What actually keeps this safe is what happens next: the
 * number is routed with `src=selection`, so Dialpad runs the strict parser
 * and only ever PREFILLS. Nothing on this path can place a call.
 */
export function parseExtensionDial(
  e: Pick<MessageEvent, 'origin' | 'data'>,
  ownOrigin: string,
): ExtensionDial | null {
  if (e.origin !== ownOrigin) return null;
  const d = e.data as { source?: unknown; type?: unknown; id?: unknown; to?: unknown } | null;
  if (!d || d.source !== 'ace-extension' || d.type !== 'dial') return null;
  if (typeof d.id !== 'string' || typeof d.to !== 'string' || !d.to.trim()) return null;
  return { id: d.id.slice(0, 64), to: d.to.slice(0, 200) };
}

/** The route the desktop app uses for the same capture (App.tsx deep links). */
export function extensionDialRoute(to: string): string {
  return `/keypad?to=${encodeURIComponent(to)}&src=selection`;
}

export function extensionDialAck(id: string) {
  return { source: 'ace-dialer-web', type: 'dial-ack', id } as const;
}
