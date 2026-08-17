// Tests for the touch-base matching rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTouchBase,
  indexLatestByKey,
  last10,
  parseDays,
  pickPrimaryPhone,
  type FavoriteForTouchBase,
} from './touchBase.js';

const NOW = new Date('2026-08-17T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function fav(over: Partial<FavoriteForTouchBase> & { id: number }): FavoriteForTouchBase {
  return {
    phone: '+17325551000',
    firstName: 'Test',
    lastName: 'Person',
    label: null,
    numbers: [{ phone: '+17325551000', label: 'Cell', isPrimary: true }],
    ...over,
  };
}

// ── last10 ──────────────────────────────────────────────────────────────

test('last10 normalizes carrier formatting to a common key', () => {
  const expected = '7325551000';
  for (const input of ['+17325551000', '17325551000', '7325551000', '(732) 555-1000', '+1 732-555-1000']) {
    assert.equal(last10(input), expected, `${input} should key to ${expected}`);
  }
});

test('last10 rejects anything too short to be a real number', () => {
  // Short codes and junk must not collide into a key that matches a favorite.
  for (const input of ['72524', '', null, undefined, 'abc', '911']) {
    assert.equal(last10(input as string), '');
  }
});

// ── indexLatestByKey ────────────────────────────────────────────────────

test('indexLatestByKey keeps the most recent timestamp per number', () => {
  const idx = indexLatestByKey([
    { phone: '+17325551000', at: daysAgo(40) },
    { phone: '(732) 555-1000', at: daysAgo(3) },
    { phone: '7325551000', at: daysAgo(90) },
  ]);
  assert.equal(idx.size, 1, 'all three formats are the same number');
  assert.equal(idx.get('7325551000')?.getTime(), daysAgo(3).getTime(), 'must take the max, not the last seen');
});

test('indexLatestByKey drops unusable numbers instead of keying them as ""', () => {
  const idx = indexLatestByKey([{ phone: '72524', at: daysAgo(1) }]);
  assert.equal(idx.size, 0);
});

// ── The three rules ─────────────────────────────────────────────────────

test('inbound contact resets the clock, not just outbound', () => {
  const [row] = computeTouchBase({
    favorites: [fav({ id: 1 })],
    outboundByKey: new Map(),
    inboundByKey: new Map([['7325551000', daysAgo(2)]]),
    days: 30,
    now: NOW,
  });
  assert.equal(row.due, false, 'they texted us 2 days ago — we are in touch');
  assert.equal(row.lastOutboundAt, null, 'but we still never reached out');
  assert.equal(row.lastInboundAt?.getTime(), daysAgo(2).getTime());
});

test('lastContactAt is the max across both directions', () => {
  const [row] = computeTouchBase({
    favorites: [fav({ id: 1 })],
    outboundByKey: new Map([['7325551000', daysAgo(50)]]),
    inboundByKey: new Map([['7325551000', daysAgo(5)]]),
    days: 30,
    now: NOW,
  });
  assert.equal(row.lastContactAt?.getTime(), daysAgo(5).getTime());
  assert.equal(row.daysSinceContact, 5);
  assert.equal(row.due, false);
});

test('a contact on a NON-primary number still counts', () => {
  const [row] = computeTouchBase({
    favorites: [
      fav({
        id: 1,
        numbers: [
          { phone: '+17325551000', label: 'Cell', isPrimary: true },
          { phone: '+19085552000', label: 'Work', isPrimary: false },
        ],
      }),
    ],
    // Reached them on the Work line only.
    outboundByKey: new Map([['9085552000', daysAgo(4)]]),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  });
  assert.equal(row.due, false, 'a call to their Work line is still contact');
  assert.equal(row.primaryPhone, '+17325551000', 'but a send would still target the primary');
});

// ── never vs. long ago ──────────────────────────────────────────────────

test('never-contacted is distinguished from contacted-long-ago', () => {
  const rows = computeTouchBase({
    favorites: [fav({ id: 1 }), fav({ id: 2, phone: '+19085559999', numbers: [{ phone: '+19085559999', label: 'Cell', isPrimary: true }] })],
    outboundByKey: new Map([['9085559999', daysAgo(200)]]),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  });
  const never = rows.find((r) => r.favoriteId === 1)!;
  const stale = rows.find((r) => r.favoriteId === 2)!;

  assert.equal(never.neverContacted, true);
  assert.equal(never.daysSinceContact, null, 'null, not 0 — "never" is not "today"');
  assert.equal(never.due, true);

  assert.equal(stale.neverContacted, false);
  assert.equal(stale.daysSinceContact, 200);
  assert.equal(stale.due, true);
});

test('the window boundary is respected', () => {
  const inside = computeTouchBase({
    favorites: [fav({ id: 1 })],
    outboundByKey: new Map([['7325551000', daysAgo(29)]]),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  })[0];
  const outside = computeTouchBase({
    favorites: [fav({ id: 1 })],
    outboundByKey: new Map([['7325551000', daysAgo(31)]]),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  })[0];
  assert.equal(inside.due, false);
  assert.equal(outside.due, true);
});

// ── Ordering ────────────────────────────────────────────────────────────

test('most-overdue sorts first, never-contacted above them, current last', () => {
  const mk = (id: number, phone: string) =>
    fav({ id, phone, numbers: [{ phone, label: 'Cell', isPrimary: true }] });
  const rows = computeTouchBase({
    favorites: [mk(1, '+17325551111'), mk(2, '+17325552222'), mk(3, '+17325553333'), mk(4, '+17325554444')],
    outboundByKey: new Map([
      ['7325551111', daysAgo(2)],    // current
      ['7325552222', daysAgo(45)],   // overdue
      ['7325553333', daysAgo(300)],  // very overdue
      // 4444 never contacted
    ]),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  });
  assert.deepEqual(
    rows.map((r) => r.favoriteId),
    [4, 3, 2, 1],
    'never → 300d → 45d → current',
  );
});

// ── The duplicate-recipient trap ────────────────────────────────────────

test('pickPrimaryPhone returns exactly one number for a multi-number favorite', () => {
  const phone = pickPrimaryPhone(
    fav({
      id: 1,
      numbers: [
        { phone: '+17325551000', label: 'Home', isPrimary: false },
        { phone: '+19085552000', label: 'Cell', isPrimary: true },
        { phone: '+12125553000', label: 'Work', isPrimary: false },
      ],
    }),
  );
  assert.equal(phone, '+19085552000', 'the explicit primary wins, not list order');
});

test('pickPrimaryPhone falls back when no number is flagged primary', () => {
  assert.equal(
    pickPrimaryPhone(fav({ id: 1, numbers: [{ phone: '+19085552000', label: 'Cell', isPrimary: false }] })),
    '+19085552000',
    'first number when none is primary',
  );
  // A pre-v0.10.66 favorite with no FavoriteNumber children at all.
  assert.equal(
    pickPrimaryPhone(fav({ id: 1, phone: '+17325557777', numbers: [] })),
    '+17325557777',
    'legacy Favorite.phone mirror is the last resort',
  );
});

test('one row per favorite even when it carries three numbers', () => {
  const rows = computeTouchBase({
    favorites: [
      fav({
        id: 1,
        numbers: [
          { phone: '+17325551000', label: 'Cell', isPrimary: true },
          { phone: '+19085552000', label: 'Home', isPrimary: false },
          { phone: '+12125553000', label: 'Work', isPrimary: false },
        ],
      }),
    ],
    outboundByKey: new Map(),
    inboundByKey: new Map(),
    days: 30,
    now: NOW,
  });
  assert.equal(rows.length, 1, 'three numbers must never become three recipients');
  assert.equal(rows[0].phones.length, 3, 'but all three are still offered to the UI');
});

// ── parseDays ───────────────────────────────────────────────────────────

test('parseDays clamps and defaults', () => {
  assert.equal(parseDays(undefined), 30);
  assert.equal(parseDays('abc'), 30);
  assert.equal(parseDays('7'), 7);
  assert.equal(parseDays('0'), 1, 'clamped up');
  assert.equal(parseDays('-5'), 1);
  assert.equal(parseDays('99999'), 365, 'clamped down');
  assert.equal(parseDays('30.7'), 30, 'truncated');
});
