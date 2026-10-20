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

/** What to open. `trusted` = the number came from our own database (the
 *  follow-ups panel), the same standing as a Teams-card link; otherwise it was
 *  read off someone else's page and the apps must parse it strictly. */
export interface Target {
  to: string;
  action: 'call' | 'sms';
  trusted: boolean;
}

// Cap mirrors the old background handler: the app re-validates, this only
// stops a pathological selection from producing a giant URL.
const clip = (to: string) => encodeURIComponent(to.slice(0, 200));

/** `src=selection` makes both apps take the strict parser. Its ABSENCE is
 *  what marks a number as trusted — the convention the deep links already
 *  use (CLAUDE.md §4.4) — so it is only ever dropped for `trusted`. */
const srcParam = (t: Target) => (t.trusted ? '' : '&src=selection');

export function desktopUrl(t: Target): string {
  return `ace-dialer://${t.action}?to=${clip(t.to)}${srcParam(t)}`;
}

export function webDialerUrl(t: Target): string {
  return t.action === 'sms'
    ? `${DIALER_ORIGIN}/messages?to=${clip(t.to)}`
    : `${DIALER_ORIGIN}/keypad?to=${clip(t.to)}${srcParam(t)}`;
}

/** The fallback once an open dialer tab has been tried (or there is none). */
export function fallbackRoute(t: Target, openIn: OpenIn): Route {
  return openIn === 'web'
    ? { kind: 'new-tab', url: webDialerUrl(t) }
    : { kind: 'desktop', url: desktopUrl(t) };
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
