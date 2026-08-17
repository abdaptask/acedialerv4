// Tests for multi-select send audience resolution.
//
// Every case here is a way a bulk send goes wrong in a manner the user cannot
// undo, which is why the logic is pure and tested rather than inline in a route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CAMPAIGN_RECIPIENTS,
  indexOwnedNumbers,
  isOverRecipientLimit,
  pickPrimaryPhone,
  resolveAudience,
  unresolvedPlaceholders,
  type OwnedFavorite,
} from './smsCampaignAudience.js';

const MAX_BODY = 1600;

function ownedFav(id: number, numbers: Array<[string, boolean]>, legacy?: string): OwnedFavorite {
  return {
    id,
    phone: legacy ?? numbers[0][0],
    numbers: numbers.map(([phone, isPrimary]) => ({ phone, label: 'Cell', isPrimary })),
  };
}

const base = {
  blockedKeys: new Set<string>(),
  maxBodyChars: MAX_BODY,
};

// ── Trap 1: one text per person, not per number ──────────────────────────

test('a favorite with three numbers yields ONE recipient', () => {
  const fav = ownedFav(1, [
    ['+17325551000', true],
    ['+19085552000', false],
    ['+12125553000', false],
  ]);
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [fav],
    // A buggy client sends all three of this person's numbers. Number-only
    // deduping would let all three through — they're genuinely distinct
    // numbers — and one contact would get three texts.
    requested: [
      { favoriteId: 1, phone: '+17325551000', body: 'Hi' },
      { favoriteId: 1, phone: '+19085552000', body: 'Hi' },
      { favoriteId: 1, phone: '+12125553000', body: 'Hi' },
    ],
  });
  assert.equal(accepted.length, 1, 'one text per PERSON, whatever the client asked for');
  assert.equal(accepted[0].phone, '+17325551000', 'the first one offered wins');
  assert.equal(skipped.length, 2);
  assert.deepEqual(skipped.map((s) => s.reason), ['duplicate', 'duplicate']);
  assert.match(skipped[0].detail, /another number/);
  // The client is still expected to offer the primary; this is the backstop.
  assert.equal(pickPrimaryPhone(fav), '+17325551000');
});

test('pickPrimaryPhone selects the flagged primary, not list order', () => {
  assert.equal(
    pickPrimaryPhone(ownedFav(1, [['+17325551000', false], ['+19085552000', true]])),
    '+19085552000',
  );
});

test('pickPrimaryPhone falls back to the legacy Favorite.phone for pre-v0.10.66 rows', () => {
  assert.equal(pickPrimaryPhone({ id: 1, phone: '+17325557777', numbers: [] }), '+17325557777');
});

// ── Trap 2: two favorites sharing a number ──────────────────────────────

test('the same number twice is deduped, and the duplicate is named', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]]), ownedFav(2, [['+17325551000', true]])],
    requested: [
      { favoriteId: 1, phone: '+17325551000', body: 'Hi' },
      { favoriteId: 2, phone: '(732) 555-1000', body: 'Hi' },
    ],
  });
  assert.equal(accepted.length, 1, 'one text, not two, to a shared line');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'duplicate');
  assert.match(skipped[0].detail, /more than once/);
});

test('different formats of the same number collapse', () => {
  const { accepted } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [
      { favoriteId: 1, phone: '+17325551000', body: 'Hi' },
      { favoriteId: 1, phone: '7325551000', body: 'Hi' },
      { favoriteId: 1, phone: '1-732-555-1000', body: 'Hi' },
    ],
  });
  assert.equal(accepted.length, 1);
});

// ── Trap 3: the client's list is not an authority ────────────────────────

test('a number not on the caller\'s favorites is refused', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    // Forged / stale: this number belongs to nobody the caller starred.
    requested: [{ favoriteId: 1, phone: '+15005550000', body: 'Hi' }],
  });
  assert.equal(accepted.length, 0, 'this endpoint must not become send-anywhere');
  assert.equal(skipped[0].reason, 'not_a_favorite');
});

test('the owning favorite is re-derived server-side, not taken from the client', () => {
  const { accepted } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(7, [['+17325551000', true]])],
    // Client claims favoriteId 999; the real owner is 7.
    requested: [{ favoriteId: 999, phone: '+17325551000', body: 'Hi' }],
  });
  assert.equal(accepted[0].favoriteId, 7, 'attribution comes from our own index');
});

test('accepted numbers are normalized to E.164', () => {
  const { accepted } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '(732) 555-1000', body: 'Hi' }],
  });
  assert.equal(accepted[0].phone, '+17325551000');
});

// ── Trap 4: the blocklist applies outbound ───────────────────────────────

test('a blocked number is refused even though it is a favorite', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    blockedKeys: new Set(['7325551000']),
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '+17325551000', body: 'Hi' }],
  });
  assert.equal(accepted.length, 0);
  assert.equal(skipped[0].reason, 'blocked');
});

// ── Trap 5: unresolved placeholders fail closed ──────────────────────────

test('a body with an unfilled placeholder is refused, naming the token', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '+17325551000', body: 'Hi {firstName}, checking in' }],
  });
  assert.equal(accepted.length, 0, '"Hi {firstName}," to a real person is unrecoverable');
  assert.equal(skipped[0].reason, 'unresolved_placeholder');
  assert.match(skipped[0].detail, /\{firstName\}/);
});

test('a fully-filled body passes', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '+17325551000', body: 'Hi Shirin, checking in' }],
  });
  assert.equal(accepted.length, 1);
  assert.equal(skipped.length, 0);
});

test('unresolvedPlaceholders finds every token', () => {
  assert.deepEqual(unresolvedPlaceholders('Hi {firstName}, the {role} role'), ['{firstName}', '{role}']);
  assert.deepEqual(unresolvedPlaceholders('Hi Shirin'), []);
});

// ── Body limits ─────────────────────────────────────────────────────────

test('an over-long body is refused per recipient with the count', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '+17325551000', body: 'x'.repeat(MAX_BODY + 1) }],
  });
  assert.equal(accepted.length, 0);
  assert.equal(skipped[0].reason, 'body_too_long');
  assert.match(skipped[0].detail, /1601/);
});

test('an empty body is refused rather than sent as a blank text', () => {
  const { skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '+17325551000', body: '   ' }],
  });
  assert.equal(skipped[0].reason, 'empty_body');
});

// ── Junk input ──────────────────────────────────────────────────────────

test('a non-dialable number is refused and quoted back', () => {
  const { skipped } = resolveAudience({
    ...base,
    ownedFavorites: [ownedFav(1, [['+17325551000', true]])],
    requested: [{ favoriteId: 1, phone: '72524', body: 'Hi' }],
  });
  assert.equal(skipped[0].reason, 'not_dialable');
  assert.match(skipped[0].detail, /72524/);
});

test('indexOwnedNumbers indexes every number, not just primaries', () => {
  const idx = indexOwnedNumbers([
    ownedFav(1, [['+17325551000', true], ['+19085552000', false]]),
  ]);
  assert.equal(idx.get('7325551000'), 1);
  assert.equal(idx.get('9085552000'), 1, 'reaching someone on a non-primary line is allowed');
});

// ── Blast radius ────────────────────────────────────────────────────────

test('the recipient ceiling is checked against the request, not the survivors', () => {
  assert.equal(isOverRecipientLimit(MAX_CAMPAIGN_RECIPIENTS), false);
  assert.equal(isOverRecipientLimit(MAX_CAMPAIGN_RECIPIENTS + 1), true);
});

test('the ceiling sits above the largest real favorites list', () => {
  // Production's heaviest list is 155; next is 56. A limit at or below 155
  // would reject a legitimate send.
  assert.ok(MAX_CAMPAIGN_RECIPIENTS > 155, 'must not reject the 155-favorite user');
});

// ── Mixed batch ─────────────────────────────────────────────────────────

test('a mixed batch accepts the good and names every exclusion', () => {
  const { accepted, skipped } = resolveAudience({
    ...base,
    blockedKeys: new Set(['2125553000']),
    ownedFavorites: [
      ownedFav(1, [['+17325551000', true]]),
      ownedFav(2, [['+19085552000', true]]),
      ownedFav(3, [['+12125553000', true]]),
    ],
    requested: [
      { favoriteId: 1, phone: '+17325551000', body: 'Hi Shirin' },       // ok
      { favoriteId: 2, phone: '+19085552000', body: 'Hi {firstName}' },  // unresolved
      { favoriteId: 3, phone: '+12125553000', body: 'Hi Ravi' },         // blocked
      { favoriteId: 1, phone: '7325551000', body: 'Hi Shirin' },         // duplicate
      { favoriteId: 9, phone: '+15005550000', body: 'Hi' },              // not a favorite
    ],
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].phone, '+17325551000');
  assert.deepEqual(
    skipped.map((s) => s.reason).sort(),
    ['blocked', 'duplicate', 'not_a_favorite', 'unresolved_placeholder'],
    'a partial send must never be silent — every exclusion is reported',
  );
});
