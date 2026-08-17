// Retry policy for scheduled sends. Pure decisions, no I/O.
//
// Split out of scheduledMessageWorker.ts so it can be unit tested: the worker
// imports sendMessage.ts → config.ts, which throws on a missing JWT_SECRET at
// module load, so anything importing the worker needs a full env. The rules
// below are the substance of the scheduled-send hardening pass and deserve
// tests more than they deserve to live next to the Prisma calls that apply them.
import type { TelnyxErrorKind } from '../lib/telnyxErrorClass.js';

/**
 * How many real rejections a scheduled message absorbs before we stop.
 *
 * Note "real": a throughput refusal (HTTP 429 / Telnyx 5xx) is handled before
 * the attempt counter is touched, because it says nothing about the recipient
 * or the body. Counting those was the original bug — five rate limits marked a
 * perfectly good message undeliverable.
 */
export const MAX_ATTEMPTS = 5;

/** Why we stopped trying. Selects which advice the user's failure notice gives. */
export type GiveUpReason = 'permanent' | 'attempts_exhausted' | 'stale';

/**
 * Should we stop trying this message, and is trying futile?
 *
 * `permanent` is not merely a reason code — it decides whether the user is
 * told "try again" or "this will never work", which are opposite instructions.
 * Getting it wrong in the optimistic direction wastes four sends and delays
 * the notice; getting it wrong in the pessimistic direction drops a message
 * someone scheduled. Hence classification is conservative (unknown codes are
 * transient) and this function only adds what classification can't see.
 */
export function decideFailureHandling(args: {
  /** SendMessageErr.code — our own error taxonomy, not Telnyx's. */
  errorCode: string;
  /** What classifyTelnyxError made of the Telnyx payload. */
  kind: TelnyxErrorKind;
  /** The attempt count AFTER this failure is recorded. */
  nextAttempts: number;
  maxAttempts?: number;
}): { giveUp: boolean; permanent: boolean } {
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS;
  // 'no_did_assigned' is terminal for a reason Telnyx classification can't
  // see: it's our own state, not the carrier's, and retrying won't conjure a
  // DID for the user.
  const permanent = args.kind === 'permanent' || args.errorCode === 'no_did_assigned';
  return {
    permanent,
    giveUp: permanent || args.nextAttempts >= maxAttempts,
  };
}
