// v0.10.59 — Scheduled message worker.
//
// Polls the scheduled_messages table every ~30s for rows due to fire,
// claims them atomically (status: 'pending' → 'sending'), and dispatches
// each through the shared sendMessageImmediate helper. On Telnyx success,
// the row is flipped to 'sent' with sentAt + telnyxMessageId stamped.
// On failure, we bump attempts and either retry next tick or mark
// 'failed' after MAX_ATTEMPTS.
//
// Design notes:
//
// * Single instance assumed. There's one `ace-api` pm2 process. If we ever
//   scale horizontally we'd need leader election or a separate worker
//   service. The atomic UPDATE...RETURNING pattern below would still
//   prevent double-sending, but multiple processes polling concurrently is
//   wasteful — and the per-tick pacing below would no longer bound our
//   aggregate send rate, which is the part that would actually bite.
//
// * No transaction needed between claim and send. The claim step writes
//   status='sending'. If the API process dies after claim but before send,
//   the row sits in 'sending' indefinitely and the sweep at the end of the
//   tick recovers it. Acceptable trade-off vs. a long-running transaction
//   holding a row lock across an external HTTP call.
//
// * Poll cadence is intentionally coarse (30s) — users scheduling a
//   message rarely care about sub-minute precision, and we'd rather not
//   thrash the DB. The actual firing precision is therefore "anywhere
//   from on-time to ~30s late", which we document in the UI.
//
// ── Scheduled-send hardening ───────────────────────────────────────────
// Three behaviours were added after auditing what this loop does when
// Telnyx says no. All three exist because a scheduled send has no human
// watching it, which is the opposite of the immediate-send path:
//
//   1. PACING. This used to take 20 due rows and send them back to back
//      with no delay. At 1:1 volumes that was invisible; but a burst of 20
//      from one long code inside ~2s is the traffic shape carrier filters
//      score as a campaign, and error 30007 (carrier-filtered) is silent
//      and per-DID sticky. Sends are now spaced by SMS_SEND_MPS.
//
//   2. RATE LIMITS DON'T BURN THE RETRY BUDGET. A 429 came back as
//      'telnyx_send_failed' and incremented `attempts`, so five throughput
//      refusals permanently failed a message Telnyx never actually
//      rejected. Those now return to 'pending' untouched, and the tick
//      stops sending so we're not hammering a limit we've already hit.
//
//   3. PERMANENT ERRORS STOP IMMEDIATELY, AND SAY SO. An opted-out
//      recipient (30004) or a disconnected number (30005) fails identically
//      on attempt 5, so spending four more sends only delays the moment the
//      user could have been told. classifyTelnyxError decides; the user gets
//      a Teams card either way, because the old code's real bug was that
//      giving up produced no signal anywhere.
import { prisma } from '@ace/db';
import type { FastifyBaseLogger } from 'fastify';
import { sendMessageImmediate } from './sendMessage.js';
import { classifyTelnyxError } from '../lib/telnyxErrorClass.js';
import { notifyScheduledSendFailed } from './scheduledSendFailureNotice.js';
import { decideFailureHandling, MAX_ATTEMPTS } from './scheduledSendPolicy.js';

const POLL_INTERVAL_MS = 30_000;

/**
 * Sustained sends per second. Deliberately env-tunable and deliberately low.
 *
 * The binding constraint is not Telnyx's API — it's the throughput the DID's
 * registered 10DLC campaign is approved for, and exceeding that gets messages
 * filtered SILENTLY by the destination carrier rather than rejected loudly by
 * Telnyx. So the failure mode of setting this too high is invisible, which is
 * why the default is conservative. Raise it only with an actual approved
 * throughput number in hand.
 */
const SEND_MPS = Number(process.env.SMS_SEND_MPS ?? 1);
const SEND_GAP_MS = Math.ceil(1000 / Math.max(SEND_MPS, 0.1));

/**
 * Stop dispatching partway through a tick if we've been at it this long, and
 * let the next tick pick up the rest. Comfortably under POLL_INTERVAL_MS so
 * ticks never overlap (the re-entrancy guard would skip them anyway, but a
 * skipped tick is a stalled queue).
 */
const TICK_BUDGET_MS = 20_000;

/**
 * How far past its scheduled time a message we've ALREADY TRIED may keep
 * being retried before we call it dead.
 *
 * Scoped to rows with prior attempts on purpose. A row that is hours late but
 * has never been tried means the API was down, not that the send is failing —
 * and dropping those would turn an outage into silently-cancelled messages.
 * Those still go out, late, exactly as before.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const SELECT_FIELDS = {
  id: true,
  userId: true,
  toNumber: true,
  body: true,
  mediaUrls: true,
  userDidId: true,
  attempts: true,
  scheduledFor: true,
} as const;

type DueRow = {
  id: number;
  userId: number;
  toNumber: string;
  body: string;
  mediaUrls: string[];
  userDidId: number | null;
  attempts: number;
  scheduledFor: Date;
};

/** What happened to one row, so the tick loop can decide whether to continue. */
type DispatchOutcome = 'sent' | 'failed' | 'retry' | 'rate_limited' | 'not_claimed';

let timer: NodeJS.Timeout | null = null;
let running = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start the periodic poll. Idempotent — calling twice is a no-op.
 * Wired up at API startup in apps/api/src/main.ts.
 */
export function startScheduledMessageWorker(log: FastifyBaseLogger): void {
  if (timer) return;
  log.info(
    '[scheduled-msg] worker starting (poll every %dms, pacing %d msg/s)',
    POLL_INTERVAL_MS,
    SEND_MPS,
  );
  // Fire one tick immediately so freshly-due messages don't wait 30s on boot.
  void tick(log).catch((e) => log.error({ err: e }, '[scheduled-msg] boot tick failed'));
  timer = setInterval(() => {
    void tick(log).catch((e) => log.error({ err: e }, '[scheduled-msg] tick failed'));
  }, POLL_INTERVAL_MS);
}

/** Cancel the poll. Currently only used by tests; kept for symmetry. */
export function stopScheduledMessageWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(log: FastifyBaseLogger): Promise<void> {
  // Re-entrancy guard. If a previous tick is still draining, skip this one.
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    await expireStaleRows(log);

    const now = new Date();
    // Fetch generously — the tick is bounded by TICK_BUDGET_MS and the pacing
    // gap, not by the page size. Anything we don't reach stays pending and is
    // picked up next tick, which is the backpressure.
    const due = await prisma.scheduledMessage.findMany({
      where: {
        status: 'pending',
        scheduledFor: { lte: now },
        attempts: { lt: MAX_ATTEMPTS },
      },
      // FIFO. Secondary sort on id so two rows scheduled for the same instant
      // have a stable order rather than whatever Postgres returns.
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: 200,
      select: SELECT_FIELDS,
    });

    let dispatched = 0;
    for (const row of due) {
      if (Date.now() - startedAt > TICK_BUDGET_MS) {
        log.info(
          { remaining: due.length - dispatched },
          '[scheduled-msg] tick budget spent, deferring rest to next tick',
        );
        break;
      }

      const outcome = await dispatch(row, log);

      if (outcome === 'rate_limited') {
        // We've already hit the ceiling; every further send this tick would
        // just collect another 429. Stop and let 30s of quiet pass.
        log.warn(
          { scheduledId: row.id, remaining: due.length - dispatched - 1 },
          '[scheduled-msg] rate limited — pausing dispatch for this tick',
        );
        break;
      }

      if (outcome !== 'not_claimed') {
        dispatched += 1;
        // Space out real sends only. A row someone else claimed cost us no
        // Telnyx call, so it shouldn't cost us a pacing gap either.
        await sleep(SEND_GAP_MS);
      }
    }

    await sweepStuckRows(log);
  } finally {
    running = false;
  }
}

/**
 * Claim one row and hand it to Telnyx, then record the outcome.
 *
 * Returns 'not_claimed' when the atomic claim lost — the row was canceled or
 * another tick took it — so the caller can skip its pacing delay.
 */
async function dispatch(row: DueRow, log: FastifyBaseLogger): Promise<DispatchOutcome> {
  // Atomic claim: only proceed if we win the race against another worker
  // tick or a user canceling. updateMany returns count, so we know if we
  // actually grabbed it.
  const claimed = await prisma.scheduledMessage.updateMany({
    where: { id: row.id, status: 'pending' },
    data: { status: 'sending' },
  });
  if (claimed.count === 0) return 'not_claimed';

  const result = await sendMessageImmediate({
    userId: row.userId,
    toNumber: row.toNumber,
    body: row.body,
    mediaUrls: row.mediaUrls,
    forcedUserDidId: row.userDidId,
  });

  if (result.ok) {
    await prisma.scheduledMessage.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        telnyxMessageId: result.message.telnyxMessageId,
        attempts: row.attempts + 1,
        lastError: null,
      },
    });
    log.info(
      { scheduledId: row.id, telnyxId: result.message.telnyxMessageId },
      '[scheduled-msg] sent',
    );
    return 'sent';
  }

  // Throughput refusal or an unhealthy Telnyx: back to pending with `attempts`
  // untouched. Note we do NOT push `scheduledFor` out — that column is what
  // the UI renders as "will fire at", and moving it would make our backoff
  // look like the user had rescheduled their own message. The 30s poll
  // interval is the backoff.
  if (result.code === 'telnyx_rate_limited') {
    await prisma.scheduledMessage.update({
      where: { id: row.id },
      data: { status: 'pending', lastError: `${result.code}: ${result.message}` },
    });
    return 'rate_limited';
  }

  // Everything else is a real rejection. classifyTelnyxError decides whether
  // trying again could plausibly change the answer.
  const klass = classifyTelnyxError(result.detail ?? result.code);
  const nextAttempts = row.attempts + 1;
  const { giveUp, permanent } = decideFailureHandling({
    errorCode: result.code,
    kind: klass.kind,
    nextAttempts,
  });

  await prisma.scheduledMessage.update({
    where: { id: row.id },
    data: {
      status: giveUp ? 'failed' : 'pending',
      attempts: nextAttempts,
      lastError: `${result.code}: ${klass.short}${klass.code ? ` (Telnyx ${klass.code})` : ''}`,
    },
  });

  log.warn(
    {
      scheduledId: row.id,
      code: result.code,
      telnyxCode: klass.code,
      kind: klass.kind,
      attempts: nextAttempts,
      giveUp,
    },
    '[scheduled-msg] send failed',
  );

  if (giveUp) {
    // Fire-and-forget: a Teams/Graph hiccup must not stall the queue behind
    // this row. notifyScheduledSendFailed never throws, but the void+catch
    // keeps an unhandled rejection out of the dispatch loop regardless.
    void notifyScheduledSendFailed(
      {
        scheduledId: row.id,
        userId: row.userId,
        toNumber: row.toNumber,
        body: row.body,
        scheduledFor: row.scheduledFor,
        reasonShort: klass.short,
        giveUpBecause: permanent ? 'permanent' : 'attempts_exhausted',
      },
      log,
    ).catch((e) => log.warn({ err: e }, '[scheduled-msg] failure notice rejected'));
    return 'failed';
  }

  return 'retry';
}

/**
 * Fail rows we've been retrying fruitlessly for hours.
 *
 * Without this, a row that only ever gets rate-limited never increments
 * `attempts` and so never reaches MAX_ATTEMPTS — it would retry every 30s
 * forever, and nobody would be told. Bounding by time rather than by count is
 * what lets the rate-limit path be free of charge and still terminate.
 */
async function expireStaleRows(log: FastifyBaseLogger): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.scheduledMessage.findMany({
    where: {
      status: 'pending',
      scheduledFor: { lt: cutoff },
      // Only rows we've actually engaged with. A never-attempted row this
      // late means downtime, not a delivery problem — see STALE_AFTER_MS.
      OR: [{ attempts: { gt: 0 } }, { lastError: { not: null } }],
    },
    take: 50,
    select: SELECT_FIELDS,
  });
  if (stale.length === 0) return;

  for (const row of stale) {
    const updated = await prisma.scheduledMessage.updateMany({
      where: { id: row.id, status: 'pending' },
      data: {
        status: 'failed',
        lastError: 'gave up: still undeliverable 2h after the scheduled time',
      },
    });
    if (updated.count === 0) continue;

    void notifyScheduledSendFailed(
      {
        scheduledId: row.id,
        userId: row.userId,
        toNumber: row.toNumber,
        body: row.body,
        scheduledFor: row.scheduledFor,
        reasonShort: 'Could not be delivered',
        giveUpBecause: 'stale',
      },
      log,
    ).catch((e) => log.warn({ err: e }, '[scheduled-msg] stale notice rejected'));
  }

  log.warn({ count: stale.length }, '[scheduled-msg] expired stale pending rows');
}

/**
 * Recover rows stranded in 'sending' by a crash mid-dispatch.
 *
 * v0.10.138 — QA-029 — Critically, SKIP rows where telnyxMessageId is
 * populated. If we have a Telnyx message id on the row, the SMS has already
 * left our side (Telnyx accepted it); re-sweeping back to 'pending' would
 * cause the worker to call sendMessageImmediate again and the recipient would
 * get the SMS twice. Mark such rows 'failed' instead so the user / admin can
 * see and act on them.
 */
async function sweepStuckRows(log: FastifyBaseLogger): Promise<void> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);

  const failedDoubleSend = await prisma.scheduledMessage.updateMany({
    where: {
      status: 'sending',
      updatedAt: { lt: fiveMinAgo },
      telnyxMessageId: { not: null },
    },
    data: {
      status: 'failed',
      lastError:
        'sweep: telnyxMessageId present, refused to re-send (v0.10.138 QA-029)',
    },
  });
  if (failedDoubleSend.count > 0) {
    log.warn(
      { count: failedDoubleSend.count },
      '[scheduled-msg] marked stuck-with-telnyxId rows as failed (refusing double-send)',
    );
  }

  const swept = await prisma.scheduledMessage.updateMany({
    where: {
      status: 'sending',
      updatedAt: { lt: fiveMinAgo },
      telnyxMessageId: null,
    },
    data: { status: 'pending' },
  });
  if (swept.count > 0) {
    log.warn(
      { count: swept.count },
      '[scheduled-msg] swept stuck sending rows back to pending',
    );
  }
}
