// v0.10.20 — Tiny Teams-card helper for the API service.
//
// The full Teams notifier (with opt-in checks, dedup, retry) lives in
// apps/webhooks/src/teamsNotifier.ts and handles INBOUND-call events
// (missed_call / sms / voicemail). This file is the apps/api equivalent
// for ADMIN events (line_assigned). It's a thin wrapper over the same
// tenant-wide Power Automate flow.
//
// Flow expects: { recipientEmail, eventType, card } where `card` is a
// bare AdaptiveCard body. Returns ok=false on any failure (HTTP, timeout,
// missing env) — caller decides whether to surface or swallow. Never
// throws: admin endpoints shouldn't 5xx because Teams was unreachable.
//
// Why not share the apps/webhooks notifier? Cross-app imports are messy
// in this monorepo (different tsconfig paths), and the admin path doesn't
// need the dedup/30s-grace machinery. A 30-line helper here is cleaner.

import { prisma } from '@ace/db';

interface SendLineAssignedCardInput {
  /** The user the line was just added/migrated to. */
  userId: number;
  /** E.164 of the new DID. */
  didNumber: string;
  /** Label set by the admin (e.g. "Sales"). */
  label: string;
  /** Whether this became the user's default outbound line. */
  isDefault: boolean;
  /** 'added' = new purchase or unassigned pick; 'migrated' = re-bound from Pulse. */
  mode: 'added' | 'migrated';
}

interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
  skippedReason?: string;
}

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

export async function sendLineAssignedCard(
  input: SendLineAssignedCardInput,
): Promise<SendResult> {
  const tenantUrl = (process.env.TEAMS_TENANT_WEBHOOK_URL ?? '').trim();
  if (!tenantUrl) {
    return { ok: false, skippedReason: 'TEAMS_TENANT_WEBHOOK_URL not set' };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, firstName: true, isActive: true },
  });
  if (!user) return { ok: false, skippedReason: 'user not found' };
  if (!user.isActive) return { ok: false, skippedReason: 'user inactive' };
  if (!user.email) return { ok: false, skippedReason: 'user has no email' };

  const niceDid = formatDidForDisplay(input.didNumber);
  const greeting = user.firstName ? `Hi ${user.firstName},` : 'Hi,';
  const headline =
    input.mode === 'migrated'
      ? 'Your number has been migrated to ACE Dialer'
      : 'A new phone line has been assigned to you';
  const body =
    input.mode === 'migrated'
      ? `Your number ${niceDid} (${input.label}) is now on ACE Dialer. Calls and SMS will only ring on ACE going forward — the old dialer (Pulse) is no longer receiving them.`
      : `A new line "${input.label}" — ${niceDid} — was added to your ACE Dialer account. It's ready to use; open the dialer to start making and receiving calls on this number.`;
  const defaultNote = input.isDefault
    ? 'This is now your default outbound line.'
    : null;

  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: headline,
        size: 'Large',
        weight: 'Bolder',
      },
      {
        type: 'TextBlock',
        text: greeting,
        wrap: true,
        spacing: 'Small',
        isSubtle: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Label', value: input.label },
          { title: 'Number', value: niceDid },
          ...(defaultNote ? [{ title: 'Default', value: 'Yes' }] : []),
        ],
      },
      {
        type: 'TextBlock',
        text: body,
        wrap: true,
        spacing: 'Medium',
      },
    ],
  };

  try {
    const res = await fetch(tenantUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientEmail: user.email,
        eventType: 'line_assigned',
        card,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        error: `Teams flow returned HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to POST to Teams flow: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
