// Sign-in and API access for the follow-ups panel.
//
// The extension signs in on its own, through Microsoft, rather than borrowing
// the web dialer's token: that token lives in a tab's sessionStorage on
// purpose, and the one it holds is full-power. What the server mints for an
// extension redirect is a scoped token that can read the caller's follow-up
// list and nothing else (apps/api lib/extensionAuth.ts) — so even this
// extension's worst day can't send a text or read a message.
//
// The token lives in chrome.storage.session: memory only, gone when the
// browser quits, and (by default) unreadable from content scripts, which run
// inside other people's pages. That mirrors the app's sessionStorage rule.

import { DIALER_ORIGIN } from './route';

export const API_BASE = `${DIALER_ORIGIN}/api`;
const KEY = 'aceSession';

export interface Session {
  token: string;
  firstName: string | null;
  email: string;
  /** ms epoch; read from the JWT so we never send a token we know is dead. */
  exp: number;
}

export async function getSession(): Promise<Session | null> {
  const { [KEY]: s } = await chrome.storage.session.get(KEY);
  const session = s as Session | undefined;
  if (!session?.token) return null;
  // A minute of margin: a token that expires mid-request is a 401 the user sees.
  if (session.exp && session.exp - 60_000 < Date.now()) {
    await clearSession();
    return null;
  }
  return session;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(KEY);
}

export function jwtExpiry(token: string): number {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(part)) as { exp?: number };
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function random(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

/** Thrown with a sentence the panel can show as-is. */
export class SignInError extends Error {}

/**
 * Microsoft sign-in in Chrome's own auth window (never an embedded page —
 * CLAUDE.md §2.4), PKCE + state, then the server's normal exchange.
 *
 * `interactive: false` is the silent renewal: `prompt=none` against the
 * existing Microsoft session, no window. Interactive sign-in shows the
 * account picker, same as the app, because these machines are shared.
 */
export async function signIn(interactive: boolean, loginHint?: string): Promise<Session> {
  const cfgRes = await fetch(`${API_BASE}/auth/microsoft/config`).catch(() => null);
  const cfg = (await cfgRes?.json().catch(() => null)) as { clientId?: string; tenantId?: string } | null;
  if (!cfg?.clientId || !cfg.tenantId) throw new SignInError('Couldn’t reach ACE Dialer. Check your connection and try again.');

  const redirectUri = chrome.identity.getRedirectURL();
  const state = random(16);
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: interactive ? 'select_account' : 'none',
  });
  if (!interactive && loginHint) params.set('login_hint', loginHint);

  let returned: string | undefined;
  try {
    returned = await chrome.identity.launchWebAuthFlow({
      url: `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize?${params}`,
      interactive,
    });
  } catch (e) {
    throw new SignInError(interactive ? 'Sign-in was closed before it finished.' : String((e as Error).message));
  }
  const back = new URL(returned ?? '');
  // CSRF: the code must come back to the flow that asked for it.
  if (back.searchParams.get('state') !== state) throw new SignInError('Sign-in didn’t complete. Try again.');
  const code = back.searchParams.get('code');
  if (!code) {
    const desc = back.searchParams.get('error_description');
    throw new SignInError(desc ? `Microsoft sign-in failed: ${desc}` : 'Sign-in didn’t complete. Try again.');
  }

  const res = await fetch(`${API_BASE}/auth/microsoft/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirectUri, codeVerifier: verifier }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { token?: string; user?: { firstName?: string | null; email?: string }; message?: string }
    | null;
  if (!res?.ok || !body?.token) {
    throw new SignInError(body?.message ?? 'ACE Dialer didn’t accept the sign-in. Try again, or ask your admin.');
  }
  const session: Session = {
    token: body.token,
    firstName: body.user?.firstName ?? null,
    email: body.user?.email ?? '',
    exp: jwtExpiry(body.token),
  };
  await chrome.storage.session.set({ [KEY]: session });
  return session;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; signedOut: boolean };

/** GET with the scoped token. A 401/403 means the token is no good any more:
 *  drop it so the panel shows "Sign in" instead of retrying forever. */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const s = await getSession();
  if (!s) return { ok: false, signedOut: true };
  const res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${s.token}` } }).catch(() => null);
  if (!res) return { ok: false, signedOut: false };
  if (res.status === 401 || res.status === 403) {
    await clearSession();
    return { ok: false, signedOut: true };
  }
  if (!res.ok) return { ok: false, signedOut: false };
  return { ok: true, data: (await res.json()) as T };
}

/** POST/DELETE with the scoped token. Only a 401 signs out here: a 403 on a
 *  write is an API that doesn't allow this route yet (the extension can
 *  reach users before a deploy does), and that must not cost them their
 *  session — it's reported as an ordinary failure. */
export async function apiSend(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<null>> {
  const s = await getSession();
  if (!s) return { ok: false, signedOut: true };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${s.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, signedOut: false };
  if (res.status === 401) {
    await clearSession();
    return { ok: false, signedOut: true };
  }
  return res.ok ? { ok: true, data: null } : { ok: false, signedOut: false };
}

export interface FollowUpItem {
  kind: 'missed_call' | 'text' | 'voicemail';
  number: string;
  name: string | null;
  count: number;
  voicemails: number;
  since: string;
  lastAt: string;
}

export interface FollowUps {
  generatedAt: string;
  days: number;
  count: number;
  totals: { missedCalls: number; texts: number; voicemails: number };
  items: FollowUpItem[];
}

// ── The dialer panel's lists (apps/api panel/panelView.ts) ──
// Who, when and what kind only: the server never sends message text here.

export interface PanelRecent {
  number: string;
  name: string | null;
  direction: 'inbound' | 'outbound';
  /** The dialer's own wording, decided server-side so the two never differ. */
  label: string;
  red: boolean;
  at: string;
  durationSeconds: number;
}

export interface PanelThread {
  number: string;
  name: string | null;
  lastDirection: 'inbound' | 'outbound';
  lastAt: string;
  unread: number;
  failed: boolean;
}

export interface PanelContact {
  name: string;
  numbers: Array<{ label: string | null; number: string }>;
}
