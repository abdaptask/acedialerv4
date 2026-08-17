// Tell a user when a scheduled message gave up.
//
// ── Why this is needed at all ──────────────────────────────────────────
// An immediate send that fails is self-announcing: the recruiter is looking
// at the thread, the bubble turns red, and telnyxErrorBlurb explains it. A
// SCHEDULED send has no such moment. The worker fires at 9am, Telnyx refuses,
// the row lands in status='failed', and nothing anywhere tells the person who
// scheduled it. They believe a candidate was contacted and no one was.
//
// So the notification is not a nicety layered on the retry logic — it's the
// half that makes the retry logic legible. A permanent-failure fast path
// (see classifyTelnyxError) is only an improvement if giving up produces a
// message; otherwise it just fails sooner and equally silently.
//
// Delivery reuses the ACE Bot Teams DM that inbound SMS already uses, so this
// arrives in the same place the user already watches for messages. Best
// effort, never throws, never blocks the worker: an unreachable MS Graph must
// not stall the send queue behind it.
import { prisma } from '@ace/db';
import type { FastifyBaseLogger } from 'fastify';
import { sendAdaptiveCardToEmail } from '../lib/teamsNotify.js';
import { recordAudit } from '../lib/audit.js';

function formatNumberForDisplay(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  return raw;
}

/** First ~90 chars of the body, so the user can tell WHICH message this was. */
function previewOf(body: string): string {
  const flat = (body ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return '(no text — attachment only)';
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

export interface ScheduledSendFailureInput {
  scheduledId: number;
  userId: number;
  toNumber: string;
  body: string;
  scheduledFor: Date;
  /** Short human label from classifyTelnyxError, e.g. "Recipient blocked you". */
  reasonShort: string;
  /** Why we stopped trying — shapes the "what now" sentence. */
  giveUpBecause: 'permanent' | 'attempts_exhausted' | 'stale';
}

function buildCard(args: {
  recipientFirstName: string | null;
  toNumber: string;
  preview: string;
  scheduledFor: Date;
  reasonShort: string;
  giveUpBecause: ScheduledSendFailureInput['giveUpBecause'];
}): Record<string, unknown> {
  const greeting = args.recipientFirstName ? `Hi ${args.recipientFirstName},` : 'Hi,';

  // The action line differs by cause, because "try again" is good advice for
  // one of these and actively wrong for the other two.
  const whatNow =
    args.giveUpBecause === 'permanent'
      ? "This won't succeed on a retry — the number or the recipient's carrier is refusing messages from your line. Check the number, or reach them by phone instead."
      : args.giveUpBecause === 'stale'
        ? 'We kept trying for two hours past the scheduled time and never got through. Nothing was sent. Open the thread and send it manually if it still applies.'
        : 'We tried several times and never got through. Nothing was sent — open the thread and try again if it still applies.';

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'A scheduled message was not sent', size: 'Large', weight: 'Bolder' },
      { type: 'TextBlock', text: greeting, wrap: true, spacing: 'Small', isSubtle: true },
      {
        type: 'FactSet',
        facts: [
          { title: 'To', value: formatNumberForDisplay(args.toNumber) },
          { title: 'Scheduled for', value: args.scheduledFor.toLocaleString('en-US', { timeZone: 'America/New_York' }) },
          { title: 'Reason', value: args.reasonShort },
        ],
      },
      { type: 'TextBlock', text: `"${args.preview}"`, wrap: true, spacing: 'Medium', isSubtle: true },
      { type: 'TextBlock', text: whatNow, wrap: true, spacing: 'Medium' },
    ],
  };
}

/**
 * Fire-and-forget notice that a scheduled send is dead. Resolves to whether
 * the card went out; callers log and move on.
 *
 * Deliberately does NOT include the full message body — a scheduled SMS can
 * hold a candidate's rate and client name, and this leaves our network for
 * Microsoft's. A 90-char preview is enough to identify which message it was.
 */
export async function notifyScheduledSendFailed(
  input: ScheduledSendFailureInput,
  log: FastifyBaseLogger,
): Promise<void> {
  // The audit row is the durable record and is written first, so a Teams
  // outage still leaves a trace an admin can find. Body is never logged —
  // §28.4 keeps message content out of audit metadata.
  void recordAudit(input.userId, 'sms.scheduled.failed', null, {
    scheduledMessageId: input.scheduledId,
    toNumber: input.toNumber,
    reason: input.reasonShort,
    giveUpBecause: input.giveUpBecause,
    bodyLength: (input.body ?? '').length,
  });

  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, firstName: true, isActive: true },
    });
    if (!user?.email || !user.isActive) {
      log.info(
        { scheduledId: input.scheduledId },
        '[scheduled-msg] failure notice skipped (no email / inactive user)',
      );
      return;
    }

    const res = await sendAdaptiveCardToEmail(
      user.email,
      buildCard({
        recipientFirstName: user.firstName,
        toNumber: input.toNumber,
        preview: previewOf(input.body),
        scheduledFor: input.scheduledFor,
        reasonShort: input.reasonShort,
        giveUpBecause: input.giveUpBecause,
      }),
    );
    if (!res.ok) {
      log.warn(
        { scheduledId: input.scheduledId, error: res.error, skippedReason: res.skippedReason },
        '[scheduled-msg] failure notice not delivered',
      );
    }
  } catch (e) {
    // sendAdaptiveCardToEmail documents that it never throws, but a Prisma
    // blip here would otherwise reject inside the worker's dispatch loop and
    // take down the whole tick over a notification.
    log.warn({ err: e, scheduledId: input.scheduledId }, '[scheduled-msg] failure notice threw');
  }
}
