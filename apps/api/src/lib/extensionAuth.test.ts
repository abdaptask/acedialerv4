// Extension-token scope tests.
//
// Run: npm run test -w apps/api

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionIdFromRedirect, extensionMayCall, isExtensionRedirect } from './extensionAuth.js';

const ID = 'cggkfkhangfehiaaebkniekchbhadbac';

test('an allowed extension redirect yields its id', () => {
  assert.equal(extensionIdFromRedirect(`https://${ID}.chromiumapp.org/`, [ID]), ID);
  assert.equal(extensionIdFromRedirect(`https://${ID}.chromiumapp.org/cb`, [ID]), ID);
});

test('unknown ids, look-alike hosts and other schemes are not extension redirects', () => {
  assert.equal(extensionIdFromRedirect(`https://${ID}.chromiumapp.org/`, []), null);
  assert.equal(extensionIdFromRedirect(`http://${ID}.chromiumapp.org/`, [ID]), null);
  assert.equal(extensionIdFromRedirect(`https://${ID}.chromiumapp.org.evil.com/`, [ID]), null);
  assert.equal(extensionIdFromRedirect(`https://x.${ID}.chromiumapp.org/`, [ID]), null);
  assert.equal(extensionIdFromRedirect('https://dialer.aptask.com/auth/microsoft/callback', [ID]), null);
  assert.equal(extensionIdFromRedirect('ace-dialer://auth/callback', [ID]), null);
  assert.equal(extensionIdFromRedirect('not a url', [ID]), null);
});

test('any chromiumapp.org redirect is recognised, so an unknown extension is refused, not upgraded', () => {
  assert.equal(isExtensionRedirect('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'), true);
  assert.equal(isExtensionRedirect('https://dialer.aptask.com/auth/microsoft/callback'), false);
});

test('extension tokens reach only the follow-up and panel routes', () => {
  assert.equal(extensionMayCall('GET', '/me/follow-ups'), true);
  assert.equal(extensionMayCall('get', '/me/follow-ups/count'), true);
  assert.equal(extensionMayCall('POST', '/me/follow-ups/done'), true);
  assert.equal(extensionMayCall('DELETE', '/me/follow-ups/done'), true);
  for (const u of ['/me/panel/recents', '/me/panel/threads', '/me/panel/contacts', '/phone-type']) {
    assert.equal(extensionMayCall('GET', u), true, u);
  }
  for (const [m, u] of [
    ['GET', '/auth/me'],
    ['POST', '/messages'],
    ['GET', '/messages/threads/:number'],
    ['GET', '/messages/threads'],
    ['GET', '/calls'],
    ['GET', '/favorites'],
    ['POST', '/me/panel/contacts'],
    ['GET', '/reports/follow-ups'],
    ['POST', '/me/follow-ups'],
    ['PUT', '/me/follow-ups/done'],
    ['GET', undefined],
  ] as const) {
    assert.equal(extensionMayCall(m, u), false, `${m} ${u}`);
  }
});
