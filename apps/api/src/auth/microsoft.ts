// v0.10.22 — Microsoft Graph OAuth (delegated permissions) for the AptLink Bot
// service account (acebot@aptask.com).
//
// Flow:
//   1. Admin clicks "Connect Teams" in dialer settings.
//   2. GET /admin/microsoft/oauth/initiate redirects to Microsoft login.
//   3. Admin signs in as acebot@aptask.com, grants the requested scopes.
//   4. Microsoft redirects to /admin/microsoft/oauth/callback?code=...
//   5. Callback exchanges code for access_token + refresh_token + expires_in.
//   6. Both tokens get stored in MsServiceToken (single row, key=account).
//
// From then on, every Teams DM send:
//   • Reads MsServiceToken
//   • If expiresAt is in the past (or within 5 min), refresh the access_token
//     via POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
//     with grant_type=refresh_token. Microsoft returns NEW access + (often)
//     NEW refresh token — store both, bumping the sliding 90-day window.
//   • Use the access_token to call Graph API.
//
// Scopes used:
//   Chat.Create          — create 1:1 chats with other users
//   ChatMessage.Send     — send messages to chats
//   User.ReadBasic.All   — look up users by email/UPN to start a chat
//   offline_access       — REQUIRED to receive a refresh_token

import { prisma } from '@ace/db';

const SERVICE_ACCOUNT_UPN = 'acebot@aptask.com';
const GRAPH_SCOPES = [
  'Chat.Create',
  'ChatMessage.Send',
  'User.ReadBasic.All',
  'offline_access',
].join(' ');

function env(name: string): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function authBaseUrl(): string {
  return `https://login.microsoftonline.com/${env('MS_GRAPH_TENANT_ID')}/oauth2/v2.0`;
}

/** The redirect URI registered in the Azure AD app. Must match exactly. */
export function getRedirectUri(): string {
  // Allow override via env var; otherwise derive from API base.
  const explicit = (process.env.MS_GRAPH_REDIRECT_URI ?? '').trim();
  if (explicit) return explicit;
  // Fallback: synthesize from API_BASE if set.
  const apiBase = (process.env.API_BASE_URL ?? '').trim();
  if (apiBase) return `${apiBase.replace(/\/$/, '')}/admin/microsoft/oauth/callback`;
  throw new Error('MS_GRAPH_REDIRECT_URI not set and API_BASE_URL fallback unavailable');
}

/**
 * Build the Microsoft login URL the admin gets redirected to when they
 * click "Connect Teams".
 *
 * `state` is a random nonce we verify on callback to prevent CSRF.
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env('MS_GRAPH_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    state,
    // Force fresh consent (admin sees the scopes again) — safer for ops.
    prompt: 'consent',
    // Pre-fill the username field so admin is nudged to sign in as acebot.
    login_hint: SERVICE_ACCOUNT_UPN,
  });
  return `${authBaseUrl()}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;          // may be omitted on refresh; reuse old one if so
  expires_in: number;              // seconds — usually 3600
  token_type: string;              // "Bearer"
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Exchange the authorization code from the callback for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env('MS_GRAPH_CLIENT_ID'),
    client_secret: env('MS_GRAPH_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    scope: GRAPH_SCOPES,
  });
  const res = await fetch(`${authBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(`MS token exchange failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Refresh an expired access token using the stored refresh token. */
async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env('MS_GRAPH_CLIENT_ID'),
    client_secret: env('MS_GRAPH_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });
  const res = await fetch(`${authBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(`MS token refresh failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Persist the result of a token exchange or refresh. */
async function storeTokens(t: TokenResponse, fallbackRefreshToken?: string): Promise<void> {
  // Microsoft sometimes omits refresh_token on refresh responses if the existing
  // one is still valid. Keep using the old one in that case.
  const refreshToken = t.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new Error('MS token response had no refresh_token and no fallback');
  }
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000); // 60s safety margin
  await prisma.msServiceToken.upsert({
    where: { account: SERVICE_ACCOUNT_UPN },
    update: {
      accessToken: t.access_token,
      refreshToken,
      expiresAt,
    },
    create: {
      account: SERVICE_ACCOUNT_UPN,
      accessToken: t.access_token,
      refreshToken,
      expiresAt,
    },
  });
}

/** Called by the OAuth callback after successful code exchange. */
export async function storeInitialTokens(t: TokenResponse): Promise<void> {
  if (!t.refresh_token) {
    throw new Error('Initial token exchange returned no refresh_token — was offline_access scope granted?');
  }
  await storeTokens(t);
}

/**
 * Get a currently-valid access token. Refreshes if expired. Throws if no
 * tokens stored yet (admin hasn't connected) or refresh fails (re-auth needed).
 */
export async function getValidAccessToken(): Promise<string> {
  const row = await prisma.msServiceToken.findUnique({
    where: { account: SERVICE_ACCOUNT_UPN },
  });
  if (!row) {
    throw new Error('Microsoft Graph not connected — admin must complete OAuth at /admin/microsoft/oauth/initiate');
  }
  // Refresh if within 60s of expiry or already past.
  if (row.expiresAt.getTime() - Date.now() < 60_000) {
    const fresh = await refreshTokens(row.refreshToken);
    await storeTokens(fresh, row.refreshToken);
    return fresh.access_token;
  }
  return row.accessToken;
}

/** For the admin UI "Connection status" display. */
export async function getConnectionStatus(): Promise<{
  connected: boolean;
  account?: string;
  expiresAt?: Date;
  lastRefreshAt?: Date;
}> {
  const row = await prisma.msServiceToken.findUnique({
    where: { account: SERVICE_ACCOUNT_UPN },
  });
  if (!row) return { connected: false };
  return {
    connected: true,
    account: row.account,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.updatedAt,
  };
}

/** Disconnect: wipes the stored tokens. Admin will need to re-OAuth. */
export async function disconnectGraph(): Promise<void> {
  await prisma.msServiceToken.deleteMany({
    where: { account: SERVICE_ACCOUNT_UPN },
  });
}
