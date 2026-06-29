// v0.10.0 Pillar 2 Task 8 — Teams notification service.
//
// One function per event type. Each:
//   1. Loads the user's Teams config (email + opt-ins).
//   2. Checks the user has opted into this event.
//   3. Pulls the source row from DB to populate the card.
//   4. Decides if the line label should be included (multi-DID only).
//   5. Builds the Adaptive Card via the Task-7 builders.
//   6. DMs the user as the ACE Bot via Microsoft Graph
//      (`sendAdaptiveCardToEmail` in ./graphClient).
//
// Failures never throw. Every entry point is fire-and-forget from
// the perspective of the webhook handler (which has already returned
// 200 to Telnyx). We log every outcome with structured fields so
// production triage is easy: `[teams] sent / failed / skipped` plus
// userId + eventType + sourceId.
//
// Dedup:
//   - Voicemail cards have an in-memory Set guard so the
//     "transcription completed" path and the 30s timeout fallback
//     don't double-fire for the same voicemail row.
//   - Missed-call cards have a 30s scheduled fire that bails out
//     if a Voicemail row for the same telnyx_call_id exists at
//     fire time (voicemail card supersedes — design decision Q3).

import { prisma } from '@ace/db';
import {
  buildInboundSmsCard,
  buildMissedCallCard,
  buildVoicemailCard,
  type TeamsMessage,
} from './teamsCards/index.js';

// ─────────────────────────────────────────────────────────────────
// Delivery transport.
// ─────────────────────────────────────────────────────────────────
//
// v0.10.209 — switched delivery from the (now-dead) tenant-wide Power
// Automate flow to direct Microsoft Graph sends. The Power Automate
// flow kept getting auto-Suspended ("WorkflowTriggerIsNotEnabled"),
// silently dropping every card. We now DM the user as the ACE Bot
// service account (acebot@aptask.com) via Graph — see ./graphClient.
//
// The bot is connected ONCE by an admin (Settings → Teams connection,
// served by the `api` service). This service shares the stored token
// row (`ms_service_tokens`) through Prisma and refreshes it as needed.
// Per-user opt-outs still apply: we honor `teamsNotifyOn` at notify
// time before sending.

import { sendAdaptiveCardToEmail } from './graphClient.js';

type LogFn = (obj: Record<string, unknown>, msg: string) => void;
const consoleLog: LogFn = (obj, msg) => console.info(msg, obj);
const consoleWarn: LogFn = (obj, msg) => console.warn(msg, obj);

type EventType = 'missed_call' | 'sms' | 'voicemail';

/** Pull the AdaptiveCard content out of the Teams envelope our card
 *  builders return. The envelope is `{type:'message', attachments:[
 *  {contentType, content: <AdaptiveCard>}]}`; we want `attachments[0].content`. */
function extractAdaptiveCard(envelope: TeamsMessage): Record<string, unknown> {
  const card = envelope?.attachments?.[0]?.content;
  // Cast: builders always produce an AdaptiveCard shape here, but we
  // surface it as Record<string, unknown> for JSON-stringification.
  return (card as unknown as Record<string, unknown>) ?? {};
}

// ─────────────────────────────────────────────────────────────────
// Opt-in lookup.
// ─────────────────────────────────────────────────────────────────

interface TeamsConfig {
  /** Where to deliver this user's card — their work email, which the
   *  Graph client resolves to a Teams account to DM. */
  email: string;
  /** Which event types this user opted into. */
  events: Set<EventType>;
}

/** Load the per-user email + per-user opt-ins. Returns null when there's
 *  nothing to send (user has no email, or all events opted out). The bot
 *  connection itself is checked at send time by the Graph client. */
async function loadTeamsConfig(userId: number): Promise<TeamsConfig | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, teamsNotifyOn: true, isActive: true },
  });
  if (!user) return null;
  if (!user.isActive) return null; // tombstoned / deactivated user
  if (!user.email) {
    consoleWarn(
      { userId },
      '[teams] user has no email; cannot route Teams notification',
    );
    return null;
  }

  // Parse the CSV of opted-in events. Empty string / null = nothing
  // opted in. We don't auto-fill defaults here — that's done at the
  // schema level (DB default = "missed_call,sms,voicemail") so every
  // new user starts opted-in to all three.
  const events = new Set<EventType>(
    (user.teamsNotifyOn ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is EventType =>
        s === 'missed_call' || s === 'sms' || s === 'voicemail',
      ),
  );
  if (events.size === 0) return null;
  return { email: user.email, events };
}

/**
 * Decide if we should include "on your X line" context. Only useful
 * when the user has more than one DID; otherwise it's noise.
 */
async function resolveLineLabel(
  userId: number,
  userDidId: number | null,
): Promise<string | null> {
  if (!userDidId) return null;
  const count = await prisma.userDid.count({ where: { userId } });
  if (count <= 1) return null;
  const did = await prisma.userDid.findUnique({
    where: { id: userDidId },
    select: { label: true },
  });
  return did?.label ?? null;
}

// ─────────────────────────────────────────────────────────────────
// Public: notify*
// ─────────────────────────────────────────────────────────────────

/**
 * v0.10.0 — Missed-call card.
 *
 * Called from the call.hangup handler when an INBOUND call ended
 * without being answered.
 *
 * v0.10.2 — DROPPED the 30s setTimeout grace window. It was meant to
 * suppress the missed-call card when a voicemail came in for the
 * same call (voicemail card supersedes — richer content). Problem:
 * Render's hibernating service tier kills the in-process timer when
 * the service idles after the call.hangup event, so the notification
 * never fired at all.
 *
 * New approach: fire immediately. If a voicemail then arrives a few
 * seconds later, the voicemail card ALSO fires — user gets two cards
 * but neither is missed. Acceptable trade-off vs. the previous
 * "scheduler died, user got nothing" failure mode.
 *
 * v0.10.3 — Added in-memory dedup. Telnyx sometimes fires call.hangup
 * multiple times for the same call (once per leg, retries on slow
 * acks, etc.). Without dedup, each event re-fired the card → user
 * saw duplicate missed-call cards. The in-memory Set is per-process
 * so it gets wiped on Render hibernation cycles — that's an
 * acceptable hole; the common case (multiple events in the same
 * minute) is fully covered.
 *
 * If we ever want strict cross-restart dedup, the right architecture
 * is a `teams_notified_at` column on the Call row with an atomic
 * conditional update — out of scope for v0.10.x.
 */
import { claimSend } from './webhookDedup.js';

const sentMissedCallCards = new Set<number>();

export function scheduleMissedCallNotification(opts: {
  userId: number;
  callDbId: number;
  telnyxCallId: string;
}): void {
  void notifyMissedCall(opts).catch((e) =>
    consoleWarn(
      { err: e instanceof Error ? e.message : String(e), ...opts },
      '[teams] missed-call scheduler threw',
    ),
  );
}

async function notifyMissedCall(opts: {
  userId: number;
  callDbId: number;
  telnyxCallId: string;
}): Promise<void> {
  // Dedup — skip if we've already sent a card for this call row in
  // this process lifetime. See file header for the full rationale.
  if (sentMissedCallCards.has(opts.callDbId)) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId },
      '[teams] missed-call already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race when Telnyx fires two
  // call.hangup events back-to-back.
  sentMissedCallCards.add(opts.callDbId);
  // v0.10.142 — QA-005 — cross-replica claim. Falls back to true if
  // the webhook_dedup table isn't deployed yet (graceful degradation).
  if (!(await claimSend(`teams:missedCall:${opts.callDbId}`))) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId },
      '[teams] missed-call card already claimed by another replica — skipping',
    );
    return;
  }
  // Suppress if a voicemail exists for this call — the voicemail card
  // covers the same notification need with richer content.
  const vm = await prisma.voicemail.findFirst({
    where: { telnyxCallId: opts.telnyxCallId },
    select: { id: true },
  });
  if (vm) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId, voicemailId: vm.id },
      '[teams] missed-call suppressed (voicemail card will fire instead)',
    );
    return;
  }

  const cfg = await loadTeamsConfig(opts.userId);
  if (!cfg) return; // not configured
  if (!cfg.events.has('missed_call')) {
    consoleLog(
      { userId: opts.userId, eventType: 'missed_call' },
      '[teams] skipped — user opted out',
    );
    return;
  }

  const call = await prisma.call.findUnique({
    where: { id: opts.callDbId },
    select: {
      fromNumber: true,
      userDidId: true,
      startedAt: true,
      answeredAt: true,
      status: true,
      direction: true,
    },
  });
  if (!call) return;

  // v0.10.2 — defensive duplicate of the scheduler's gate. An inbound
  // call is "missed" if it was never answered, regardless of the
  // hangup-cause classifier (which collapses originator_cancel into
  // 'completed'). We also skip blocklisted rows (user-suppressed).
  if (call.direction !== 'inbound') return;
  if (call.answeredAt) return; // actually picked up — not missed
  if (call.status === 'blocked') return;

  const lineLabel = await resolveLineLabel(opts.userId, call.userDidId);

  const envelope = buildMissedCallCard({
    fromNumber: call.fromNumber,
    toLineLabel: lineLabel,
    occurredAt: call.startedAt ?? new Date(),
  });

  const result = await sendAdaptiveCardToEmail(cfg.email, extractAdaptiveCard(envelope));
  if (result.ok) {
    consoleLog(
      {
        userId: opts.userId,
        callDbId: opts.callDbId,
        recipient: cfg.email,
        status: result.status,
      },
      '[teams] missed-call sent',
    );
  } else if (result.skippedReason) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId, reason: result.skippedReason },
      '[teams] missed-call skipped',
    );
  } else {
    consoleWarn(
      {
        userId: opts.userId,
        callDbId: opts.callDbId,
        recipient: cfg.email,
        status: result.status,
        error: result.error,
      },
      '[teams] missed-call send failed',
    );
  }
}

/** v0.10.0 — Inbound SMS card. Fired immediately on message.received. */
export async function notifyInboundSms(opts: {
  userId: number;
  messageDbId: number;
}): Promise<void> {
  const cfg = await loadTeamsConfig(opts.userId);
  if (!cfg) return;
  if (!cfg.events.has('sms')) {
    consoleLog(
      { userId: opts.userId, eventType: 'sms' },
      '[teams] skipped — user opted out',
    );
    return;
  }

  const msg = await prisma.message.findUnique({
    where: { id: opts.messageDbId },
    select: {
      fromNumber: true,
      body: true,
      userDidId: true,
      sentAt: true,
      direction: true,
    },
  });
  if (!msg || msg.direction !== 'inbound') return;

  const lineLabel = await resolveLineLabel(opts.userId, msg.userDidId);

  const envelope = buildInboundSmsCard({
    fromNumber: msg.fromNumber,
    body: msg.body ?? '',
    toLineLabel: lineLabel,
    occurredAt: msg.sentAt ?? new Date(),
  });

  const result = await sendAdaptiveCardToEmail(cfg.email, extractAdaptiveCard(envelope));
  if (result.ok) {
    consoleLog(
      {
        userId: opts.userId,
        messageDbId: opts.messageDbId,
        recipient: cfg.email,
        status: result.status,
      },
      '[teams] sms sent',
    );
  } else if (result.skippedReason) {
    consoleLog(
      { userId: opts.userId, messageDbId: opts.messageDbId, reason: result.skippedReason },
      '[teams] sms skipped',
    );
  } else {
    consoleWarn(
      {
        userId: opts.userId,
        messageDbId: opts.messageDbId,
        recipient: cfg.email,
        status: result.status,
        error: result.error,
      },
      '[teams] sms send failed',
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// Voicemail — two-path firing with in-memory dedup.
// ─────────────────────────────────────────────────────────────────
//
// Two events can trigger a voicemail card:
//   (a) Deepgram finishes transcription and updates the row → we
//       want to fire the card with transcript filled in.
//   (b) The 30s timeout fallback fires regardless of transcription
//       state, so the user still gets a card if Deepgram is down.
// We want exactly ONE card per voicemail, so we track which
// voicemail IDs we've already sent for in a module-level Set.

const sentVoicemailCards = new Set<number>();

/** v0.10.0 — Voicemail card. Called from two places (see header). */
export async function notifyVoicemail(opts: {
  userId: number;
  voicemailId: number;
  reason: 'transcribed' | 'timeout';
}): Promise<void> {
  if (sentVoicemailCards.has(opts.voicemailId)) {
    consoleLog(
      { voicemailId: opts.voicemailId, reason: opts.reason },
      '[teams] voicemail card already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race between transcribed + timeout.
  sentVoicemailCards.add(opts.voicemailId);
  // v0.10.142 — QA-005 — cross-replica claim. The Set above is the
  // fast-path within this process; this is the cross-replica guard.
  if (!(await claimSend(`teams:voicemail:${opts.voicemailId}`))) {
    consoleLog(
      { voicemailId: opts.voicemailId, reason: opts.reason },
      '[teams] voicemail card already claimed by another replica — skipping',
    );
    return;
  }

  try {
    const cfg = await loadTeamsConfig(opts.userId);
    if (!cfg) return;
    if (!cfg.events.has('voicemail')) {
      consoleLog(
        { userId: opts.userId, eventType: 'voicemail' },
        '[teams] skipped — user opted out',
      );
      return;
    }

    const vm = await prisma.voicemail.findUnique({
      where: { id: opts.voicemailId },
      select: {
        fromNumber: true,
        userDidId: true,
        receivedAt: true,
        durationSeconds: true,
        transcription: true,
      },
    });
    if (!vm) return;

    const lineLabel = await resolveLineLabel(opts.userId, vm.userDidId);

    const envelope = buildVoicemailCard({
      voicemailId: opts.voicemailId,
      fromNumber: vm.fromNumber,
      toLineLabel: lineLabel,
      occurredAt: vm.receivedAt ?? new Date(),
      durationSec: vm.durationSeconds,
      transcript: vm.transcription,
    });

    const result = await sendAdaptiveCardToEmail(cfg.email, extractAdaptiveCard(envelope));
    if (result.ok) {
      consoleLog(
        {
          userId: opts.userId,
          voicemailId: opts.voicemailId,
          recipient: cfg.email,
          reason: opts.reason,
          hasTranscript: Boolean(vm.transcription),
          status: result.status,
        },
        '[teams] voicemail sent',
      );
    } else if (result.skippedReason) {
      // Not a delivery failure (bot not connected) — keep the reservation
      // so we don't spam attempts; the other fire path is a no-op anyway.
      consoleLog(
        { userId: opts.userId, voicemailId: opts.voicemailId, reason: result.skippedReason },
        '[teams] voicemail skipped',
      );
    } else {
      // Release the reservation on hard failure so a retry path could
      // attempt again. (We don't have a retry path today, but this
      // avoids permanently silencing a user if Teams blips at the
      // exact moment we fire.)
      sentVoicemailCards.delete(opts.voicemailId);
      consoleWarn(
        {
          userId: opts.userId,
          voicemailId: opts.voicemailId,
          reason: opts.reason,
          status: result.status,
          error: result.error,
        },
        '[teams] voicemail send failed',
      );
    }
  } catch (e) {
    // On unexpected error, also release the reservation.
    sentVoicemailCards.delete(opts.voicemailId);
    consoleWarn(
      {
        userId: opts.userId,
        voicemailId: opts.voicemailId,
        err: e instanceof Error ? e.message : String(e),
      },
      '[teams] voicemail handler threw',
    );
  }
}

/**
 * Convenience: schedule the 30s timeout fallback. If transcription
 * finishes first and fires `notifyVoicemail({reason:'transcribed'})`,
 * the dedup Set ensures the timeout call is a no-op.
 */
export function scheduleVoicemailTimeoutFallback(opts: {
  userId: number;
  voicemailId: number;
}): void {
  setTimeout(() => {
    void notifyVoicemail({ ...opts, reason: 'timeout' }).catch((e) =>
      consoleWarn(
        { err: e instanceof Error ? e.message : String(e), ...opts },
        '[teams] voicemail timeout scheduler threw',
      ),
    );
  }, 30_000);
}
// v0.10.102 - Generic tenant-channel card sender used by the Telnyx status
// notifier. Wraps the existing POST-to-webhook pattern with caller-provided
// adaptive card content.
type LogFn2 = (obj: Record<string, unknown>, msg: string) => void;
export async function sendTenantTeamsCard(card: unknown, logger?: LogFn2): Promise<void> {
  const url = (process.env.TEAMS_TENANT_WEBHOOK_URL ?? '').trim();
  if (!url) {
    (logger ?? console.info)({}, '[teams] TEAMS_TENANT_WEBHOOK_URL not set - card not sent');
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    (logger ?? console.warn)({ status: res.status, errText }, '[teams] tenant card POST failed');
  }
}
