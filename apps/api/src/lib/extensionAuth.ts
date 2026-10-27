// Browser-extension sign-in: a deliberately weak token.
//
// The extension sits beside arbitrary websites all day. If it — or a
// dependency of it — were ever compromised, whatever credential it holds is
// what leaks. So it never gets the dialer's full JWT: no SIP credentials, no
// SMS send, no message bodies, no admin. It gets a token that can read the
// caller's own follow-up list (and mark items in it Done), the dialer panel's
// who-and-when lists (recent calls, text threads without their text, saved
// contacts), and the line-type lookup the Keypad shows.
//
// Two rules make that hold, both server-side:
//   1. The scope is decided by the REDIRECT URI, not by anything the client
//      asks for. An extension's OAuth redirect is https://<id>.chromiumapp.org/,
//      a host only that extension can receive. A code issued for that redirect
//      always becomes a scoped token, so a compromised extension can't simply
//      ask for a full one.
//   2. `app.authenticate` refuses a scoped token on every route not listed
//      below. A new route is closed to the extension by default.

export const EXTENSION_SCOPE = 'ext';

/** Shorter than the app's 24h: the panel signs in again silently through
 *  Microsoft's session, and a leaked token should go stale within a workday. */
export const EXTENSION_TOKEN_TTL = '12h';

/** Fastify route patterns (routeOptions.url) an extension token may call. */
export const EXTENSION_ROUTES: ReadonlySet<string> = new Set([
  'GET /me/follow-ups',
  'GET /me/follow-ups/count',
  // Done / Undo on the caller's own follow-ups — the one write an extension
  // token can make. No userId parameter; it only hides items from the
  // caller's own list, later activity from the number reopens them, and
  // admins see a per-person Done count in Reports.
  'POST /me/follow-ups/done',
  'DELETE /me/follow-ups/done',
  // The dialer panel: metadata only, built field by field in panel/panelView.ts.
  'GET /me/panel/recents',
  'GET /me/panel/threads',
  'GET /me/panel/contacts',
  // One number's calls, texts and voicemails for the wide panel's detail
  // pane: the same metadata-only mapping (panelView.toPanelHistory).
  'GET /me/panel/history',
  // The Keypad's Mobile / Landline / VoIP line, as on the Dialpad. Not
  // user-scoped data; spend is bounded by the route's own gates (US/CA
  // geographic only, shared cache, PHONE_LOOKUP_DAILY_LIMIT across everyone).
  'GET /phone-type',
]);

/** The extension ID when `redirectUri` is an allowed extension redirect, else null. */
export function extensionIdFromRedirect(redirectUri: string, allowedIds: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  const m = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname);
  if (url.protocol !== 'https:' || !m) return null;
  return allowedIds.includes(m[1]) ? m[1] : null;
}

/** True when this is any chromiumapp.org redirect, allowed or not — used to
 *  refuse unknown extensions outright rather than minting them a FULL token. */
export function isExtensionRedirect(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    return u.hostname.endsWith('.chromiumapp.org');
  } catch {
    return false;
  }
}

export function extensionMayCall(method: string, routeUrl: string | undefined): boolean {
  return !!routeUrl && EXTENSION_ROUTES.has(`${method.toUpperCase()} ${routeUrl}`);
}
