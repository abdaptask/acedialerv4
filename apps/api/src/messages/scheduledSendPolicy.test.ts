// Tests for the scheduled-send give-up decision.
//
// dispatch() itself is unmockable Prisma + HTTP, but the rule it applies is
// pure and is the substance of the hardening pass, so it's tested directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFailureHandling } from './scheduledSendPolicy.js';

const MAX = 5;

test('a permanent error gives up on the FIRST attempt', () => {
  const got = decideFailureHandling({
    errorCode: 'telnyx_send_failed',
    kind: 'permanent',
    nextAttempts: 1,
    maxAttempts: MAX,
  });
  assert.equal(got.giveUp, true, 'no point spending four more sends on 30004/30005');
  assert.equal(got.permanent, true);
});

test('a transient error retries until the attempt budget is spent', () => {
  for (const nextAttempts of [1, 2, 3, 4]) {
    const got = decideFailureHandling({
      errorCode: 'telnyx_send_failed',
      kind: 'transient',
      nextAttempts,
      maxAttempts: MAX,
    });
    assert.equal(got.giveUp, false, `attempt ${nextAttempts} should still retry`);
    assert.equal(got.permanent, false);
  }
});

test('a transient error gives up once attempts reach the max', () => {
  const got = decideFailureHandling({
    errorCode: 'telnyx_send_failed',
    kind: 'transient',
    nextAttempts: MAX,
    maxAttempts: MAX,
  });
  assert.equal(got.giveUp, true);
  // Not permanent — the user's notice should say "try again", not "this will
  // never work". The two produce opposite advice.
  assert.equal(got.permanent, false);
});

test('no_did_assigned is permanent regardless of how Telnyx classified it', () => {
  const got = decideFailureHandling({
    errorCode: 'no_did_assigned',
    kind: 'transient',
    nextAttempts: 1,
    maxAttempts: MAX,
  });
  assert.equal(got.giveUp, true, 'retrying will not conjure a DID');
  assert.equal(got.permanent, true);
});

// Guards the ordering of the two branches in dispatch(): a rate limit is
// handled and returned BEFORE this function is reached, so if a 'rate_limited'
// kind ever arrives here it means that early return was removed and every
// throughput refusal is silently eating the retry budget again — the exact
// bug this pass fixed.
test('a rate_limited kind is never treated as permanent if it does reach here', () => {
  const got = decideFailureHandling({
    errorCode: 'telnyx_rate_limited',
    kind: 'rate_limited',
    nextAttempts: 1,
    maxAttempts: MAX,
  });
  assert.equal(got.permanent, false);
  assert.equal(got.giveUp, false);
});
