// v0.10.22 — Teams notifier via Microsoft Graph API (replaces the dead
// Power Automate flow). Uses the acebot@aptask.com service account's
// stored OAuth refresh token to send Teams DMs to any tenant user.
//
// Flow:
//   1. getValidAccessToken() — fresh or refreshed access token
//   2. GET /users?$filter=mail eq '{recipientEmail}' — resolve to user id
//   3. POST /chats — create or find 1:1 chat with that user (members: bot + recipient)
//   4. POST /chats/{id}/messages — send the Adaptive Card body
//
// Recipient sees DM from "AptLink Bot" (the service account's display name).
//
// Return shape unchanged so callers (admin.routes.ts) keep working without
// edits. Falls back to skippedReason when MS Graph isn't configured yet.

import { prisma } from '@ace/db';
import { getValidAccessToken } from '../auth/microsoft.js';

interface SendLineAssignedCardInput {
  userId: number;                 // The recipient's userId in our DB.
  didNumber: string;
  label: string;
  isDefault: boolean;
  mode: 'added' | 'migrated';
}

interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  skippedReason?: string;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

function formatDidForDisplay(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  return raw.startsWith('+') ? raw : `+${digits}`;
}

/** Resolve an email/UPN to a Microsoft user objectId via Graph. */
async function lookupUserId(accessToken: string, email: string): Promise<string | null> {
  const url = `${GRAPH}/users/${encodeURIComponent(email)}?$select=id,displayName,mail,userPrincipalName`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph user lookup failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  return json.id ?? null;
}

/**
 * Create (or get) a 1:1 chat with the recipient. Returns the chat id.
 * Graph's POST /chats with chatType=oneOnOne + the two members will RETURN
 * the existing chat if one already exists (Microsoft handles dedup).
 */
async function getOrCreateOneOnOneChat(
  accessToken: string,
  recipientUserId: string,
): Promise<string> {
  // The "from" side of the chat is whoever the token belongs to (the
  // acebot service account). Microsoft figures that out from the bearer.
  const url = `${GRAPH}/chats`;
  const body = {
    chatType: 'oneOnOne',
    members: [
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('me')`,
      },
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipientUserId}')`,
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
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

/**
 * Send an Adaptive Card to a chat as a message attachment. Graph expects
 * an attachment block referencing the card via contentType + content.
 */
async function postCardToChat(
  accessToken: string,
  chatId: string,
  card: Record<string, unknown>,
): Promise<void> {
  const url = `${GRAPH}/chats/${chatId}/messages`;
  const attachmentId = '1';      // arbitrary id, referenced in body HTML
  const body = {
    body: {
      contentType: 'html',
      content: `<attachment id="${attachmentId}"></attachment>`,
    },
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
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Graph chat-message send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

/** Build the Adaptive Card for a line_assigned event. */
function buildLineAssignedCard(args: {
  recipientFirstName: string | null;
  didNumber: string;
  label: string;
  isDefault: boolean;
  mode: 'added' | 'migrated';
}): Record<string, unknown> {
  const niceDid = formatDidForDisplay(args.didNumber);
  const greeting = args.recipientFirstName ? `Hi ${args.recipientFirstName},` : 'Hi,';
  const headline =
    args.mode === 'migrated'
      ? 'Your number has been migrated to AptLink'
      : 'A new phone line has been assigned to you';
  const body =
    args.mode === 'migrated'
      ? `Your number ${niceDid} (${args.label}) is now on AptLink. Calls and SMS will only ring on AptLink going forward — the old dialer (Pulse) is no longer receiving them.`
      : `A new line "${args.label}" — ${niceDid} — was added to your AptLink account. It's ready to use; open the dialer to start making and receiving calls on this number.`;

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: headline, size: 'Large', weight: 'Bolder' },
      { type: 'TextBlock', text: greeting, wrap: true, spacing: 'Small', isSubtle: true },
      {
        type: 'FactSet',
        facts: [
          { title: 'Label', value: args.label },
          { title: 'Number', value: niceDid },
          ...(args.isDefault ? [{ title: 'Default', value: 'Yes' }] : []),
        ],
      },
      { type: 'TextBlock', text: body, wrap: true, spacing: 'Medium' },
    ],
  };
}

export async function sendLineAssignedCard(
  input: SendLineAssignedCardInput,
): Promise<SendResult> {
  // 1. Load recipient.
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, firstName: true, isActive: true },
  });
  if (!user) return { ok: false, skippedReason: 'user not found' };
  if (!user.isActive) return { ok: false, skippedReason: 'user inactive' };
  if (!user.email) return { ok: false, skippedReason: 'user has no email' };

  // 2. Acquire a valid access token (refreshes if needed).
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (e) {
    return {
      ok: false,
      skippedReason: e instanceof Error ? e.message : 'no MS Graph token',
    };
  }

  // 3. Look up recipient's Graph user id by email.
  const recipientId = await lookupUserId(accessToken, user.email).catch((e) => {
    throw new Error(`recipient lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!recipientId) {
    return { ok: false, error: `Recipient ${user.email} not found in Microsoft tenant` };
  }

  // 4. Create or find 1:1 chat with that user.
  try {
    const chatId = await getOrCreateOneOnOneChat(accessToken, recipientId);
    const card = buildLineAssignedCard({
      recipientFirstName: user.firstName,
      didNumber: input.didNumber,
      label: input.label,
      isDefault: input.isDefault,
      mode: input.mode,
    });
    await postCardToChat(accessToken, chatId, card);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
