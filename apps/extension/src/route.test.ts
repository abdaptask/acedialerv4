// Click routing tests.
//
// Run: npm run test -w apps/extension

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOpenIn, fallbackRoute, pickDialerTab } from './route.js';

test('desktop is the default, and keeps the strict-parse marker', () => {
  const { value } = effectiveOpenIn(undefined, undefined);
  assert.deepEqual(fallbackRoute('+1 732 200 1305', value), {
    kind: 'desktop',
    url: 'ace-dialer://call?to=%2B1%20732%20200%201305&src=selection',
  });
});

test('web preference opens the web keypad, also marked untrusted', () => {
  assert.deepEqual(fallbackRoute('7322001305', 'web'), {
    kind: 'new-tab',
    url: 'https://dialer.aptask.com/keypad?to=7322001305&src=selection',
  });
});

test('policy beats the user, the user beats the default, junk is ignored', () => {
  assert.deepEqual(effectiveOpenIn('web', 'desktop'), { value: 'web', locked: true });
  assert.deepEqual(effectiveOpenIn(undefined, 'web'), { value: 'web', locked: false });
  assert.deepEqual(effectiveOpenIn('phone', 'tablet'), { value: 'desktop', locked: false });
});

test('a pathological selection is clipped before it becomes a URL', () => {
  const r = fallbackRoute('9'.repeat(5000), 'desktop');
  assert.ok(r.url.length < 300);
});

test('of several dialer tabs, the most recently used wins', () => {
  assert.equal(pickDialerTab([]), undefined);
  assert.equal(
    pickDialerTab([{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 300 }, { id: 3, lastAccessed: 200 }])?.id,
    2,
  );
  // Chrome < 121 has no lastAccessed: prefer the active tab.
  assert.equal(pickDialerTab([{ id: 1 }, { id: 2, active: true }])?.id, 2);
  assert.equal(pickDialerTab([{ active: true }, { id: 4 }])?.id, 4);
});
