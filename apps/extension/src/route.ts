// Where a clicked number goes. Pure, so the decision table is testable
// without a browser.
//
// Chrome can't tell us whether the desktop app's ace-dialer:// handler is
// installed, so we don't guess from a failed launch. The order is:
//
//   1. A web dialer tab that answers the hand-off. Someone with the web
//      dialer open is using it; launching the desktop app would surface a
//      different client (possibly signed in as nobody) and leave the tab they
//      are looking at untouched.
//   2. The user's (or IT's) preference: desktop app, or a new web dialer tab.

export const DIALER_ORIGIN = 'https://dialer.aptask.com';
export const DIALER_MATCH = `${DIALER_ORIGIN}/*`;

export type OpenIn = 'desktop' | 'web';
export const DEFAULT_OPEN_IN: OpenIn = 'desktop';

export function parseOpenIn(v: unknown): OpenIn | null {
  return v === 'desktop' || v === 'web' ? v : null;
}

export type Route =
  | { kind: 'desktop'; url: string }
  | { kind: 'new-tab'; url: string };

// Cap mirrors the old background handler: the app re-validates, this only
// stops a pathological selection from producing a giant URL.
const clip = (to: string) => encodeURIComponent(to.slice(0, 200));

/** `src=selection` makes both apps take the strict parser — this number came
 *  from someone else's page, not our database. */
export function desktopUrl(to: string): string {
  return `ace-dialer://call?to=${clip(to)}&src=selection`;
}

export function webDialerUrl(to: string): string {
  return `${DIALER_ORIGIN}/keypad?to=${clip(to)}&src=selection`;
}

/** The fallback once an open dialer tab has been tried (or there is none). */
export function fallbackRoute(to: string, openIn: OpenIn): Route {
  return openIn === 'web'
    ? { kind: 'new-tab', url: webDialerUrl(to) }
    : { kind: 'desktop', url: desktopUrl(to) };
}

/** Managed policy wins over the user's choice; either wins over the default. */
export function effectiveOpenIn(managed: unknown, user: unknown): { value: OpenIn; locked: boolean } {
  const m = parseOpenIn(managed);
  if (m) return { value: m, locked: true };
  return { value: parseOpenIn(user) ?? DEFAULT_OPEN_IN, locked: false };
}

/** Of several dialer tabs, the one the user touched last. */
export function pickDialerTab<T extends { id?: number; active?: boolean; lastAccessed?: number }>(
  tabs: T[],
): T | undefined {
  // lastAccessed is Chrome 121+; on older builds fall back to "the active one".
  const key = (t: T) => t.lastAccessed ?? (t.active ? Number.MAX_SAFE_INTEGER : 0);
  return tabs.filter((t) => t.id !== undefined).sort((a, b) => key(b) - key(a))[0];
}
