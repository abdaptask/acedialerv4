// v0.10.209 — Microsoft Graph client for the WEBHOOKS service.
//
// WHY this is a near-duplicate of apps/api/src/lib/teamsNotify.ts +
// apps/api/src/auth/microsoft.ts: the monorepo rule (CLAUDE.md §1.4) is
// that the only shared code between `api` and `webhooks` is `@ace/db`.
// We cannot import from `apps/api`, so the Graph send + token-refresh
// logic is re-implemented here. The two copies talk to the SAME
// `ms_service_tokens` row (via the shared Prisma client), so the bot
// only ever needs to be connected ONCE (admin completes OAuth in the
// api/Settings flow; this service just reads + refreshes the token).
//
// Token-refresh concurrency: both services may refresh the same row.
// Azure AD keeps a redeemed refresh token valid for a short overlap
// window, so two near-simultaneous refreshes both succeed; whichever
// write lands last wins and is valid. Acceptable — we only refresh
// within 60s of expiry, so the collision window is tiny.

import { prisma } from '@ace/db';

const SERVICE_ACCOUNT_UPN = 'acebot@aptask.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
// Must match the scopes the api OAuth flow consented to, or refresh fails.
const GRAPH_SCOPES = [
  'Chat.Create',
  'ChatMessage.Send',
  'User.ReadBasic.All',
  'offline_access',
].join(' ');

export interface GraphSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Set when we deliberately didn't send (not connected, no email, etc.). */
  skippedReason?: string;
}

function env(name: string): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function authBaseUrl(): string {
  return `https://login.microsoftonline.com/${env('MS_GRAPH_TENANT_ID')}/oauth2/v2.0`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

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
    throw new Error(
      `MS token refresh failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`,
    );
  }
  return json;
}

async function storeRefreshedTokens(t: TokenResponse, fallbackRefreshToken: string): Promise<void> {
  // Microsoft sometimes omits refresh_token on refresh if the existing one
  // is still valid — keep using the old one in that case.
  const refreshToken = t.refresh_token ?? fallbackRefreshToken;
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000); // 60s safety margin
  await prisma.msServiceToken.update({
    where: { account: SERVICE_ACCOUNT_UPN },
    data: { accessToken: t.access_token, refreshToken, expiresAt },
  });
}

/**
 * A valid access token, refreshing if expired. Returns null (rather than
 * throwing) when the bot isn't connected yet — callers treat that as
 * "skip, not configured" so a missing token never crashes a webhook.
 */
async function getValidAccessToken(): Promise<string | null> {
  const row = await prisma.msServiceToken.findUnique({
    where: { account: SERVICE_ACCOUNT_UPN },
  });
  if (!row) return null; // admin hasn't completed OAuth in the api/Settings flow
  if (row.expiresAt.getTime() - Date.now() < 60_000) {
    const fresh = await refreshTokens(row.refreshToken);
    await storeRefreshedTokens(fresh, row.refreshToken);
    return fresh.access_token;
  }
  return row.accessToken;
}

// The bot's own Graph object id. Required as an explicit member in the
// POST /chats body — Graph rejects the `users('me')` alias there with
// "The caller must be one of the members specified in request body".
// The id is stable for the acebot account, so resolve once and cache.
let cachedBotUserId: string | null = null;
async function getBotUserId(accessToken: string): Promise<string> {
  if (cachedBotUserId) return cachedBotUserId;
  const res = await fetch(`${GRAPH}/me?$select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph /me lookup failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Graph /me returned no id');
  cachedBotUserId = json.id;
  return json.id;
}

/** Resolve an email/UPN to a Microsoft user objectId. Null = not found. */
async function lookupUserId(accessToken: string, email: string): Promise<string | null> {
  const url = `${GRAPH}/users/${encodeURIComponent(email)}?$select=id`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph user lookup failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  return json.id ?? null;
}

/**
 * Create (or get) the 1:1 chat between the bot and the recipient. Graph
 * dedups oneOnOne chats, so this returns the existing chat if present.
 */
async function getOrCreateOneOnOneChat(
  accessToken: string,
  botUserId: string,
  recipientUserId: string,
): Promise<string> {
  const body = {
    chatType: 'oneOnOne',
    members: [
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        // Real object id, NOT users('me') — Graph requires the caller to be
        // an explicit member by id or it 400s "caller must be one of the members".
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${botUserId}')`,
      },
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipientUserId}')`,
      },
    ],
  };
  const res = await fetch(`${GRAPH}/chats`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Graph chat create failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Graph chat create returned no id');
  return json.id;
}

/** Post a bare AdaptiveCard to a chat as an attachment. */
async function postCardToChat(
  accessToken: string,
  chatId: string,
  card: Record<string, unknown>,
): Promise<number> {
  const attachmentId = '1'; // arbitrary; referenced from the message HTML body
  const body = {
    body: { contentType: 'html', content: `<attachment id="${attachmentId}"></attachment>` },
    attachments: [
      {
        id: attachmentId,
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: JSON.stringify(card),
        name: null,
        thumbnailUrl: null,
      },
    ],
  };
  const res = await fetch(`${GRAPH}/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Graph chat-message send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.status;
}

/**
 * Send a bare AdaptiveCard as a Teams DM (from the ACE Bot service account)
 * to the user with the given email. Never throws — returns a result object
 * so the fire-and-forget webhook callers can log and move on.
 */
export async function sendAdaptiveCardToEmail(
  email: string,
  card: Record<string, unknown>,
): Promise<GraphSendResult> {
  let accessToken: string | null;
  try {
    accessToken = await getValidAccessToken();
  } catch (e) {
    // Refresh failed — token revoked / password change / conditional access.
    // Treat as "not deliverable right now"; admin must re-connect in Settings.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!accessToken) {
    return { ok: false, skippedReason: 'ms_graph_not_connected' };
  }

  try {
    const recipientId = await lookupUserId(accessToken, email);
    if (!recipientId) {
      return { ok: false, error: `Recipient ${email} not found in Microsoft tenant` };
    }
    const botUserId = await getBotUserId(accessToken);
    const chatId = await getOrCreateOneOnOneChat(accessToken, botUserId, recipientId);
    const status = await postCardToChat(accessToken, chatId, card);
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
