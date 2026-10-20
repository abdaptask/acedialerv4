// Browser-extension hand-off tests.
//
// Run: npm run test -w apps/web

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionDialRoute, parseExtensionDial } from './extensionBridge.js';

const ORIGIN = 'https://dialer.aptask.com';
const msg = (data: unknown, origin = ORIGIN) => ({ origin, data });

test('accepts the extension dial message from this origin', () => {
  assert.deepEqual(
    parseExtensionDial(msg({ source: 'ace-extension', type: 'dial', id: 'a1', to: '(732) 200-1305' }), ORIGIN),
    { id: 'a1', to: '(732) 200-1305' },
  );
});

test('rejects other origins, other shapes and empty numbers', () => {
  const good = { source: 'ace-extension', type: 'dial', id: 'a1', to: '7322001305' };
  assert.equal(parseExtensionDial(msg(good, 'https://evil.example'), ORIGIN), null);
  assert.equal(parseExtensionDial(msg({ ...good, source: 'ace-dialer-web' }), ORIGIN), null);
  assert.equal(parseExtensionDial(msg({ ...good, type: 'dial-ack' }), ORIGIN), null);
  assert.equal(parseExtensionDial(msg({ ...good, to: '   ' }), ORIGIN), null);
  assert.equal(parseExtensionDial(msg({ ...good, to: 7322001305 }), ORIGIN), null);
  assert.equal(parseExtensionDial(msg(null), ORIGIN), null);
  assert.equal(parseExtensionDial(msg('dial 7322001305'), ORIGIN), null);
});

test('routes as untrusted text, so Dialpad parses strictly and only prefills', () => {
  assert.equal(extensionDialRoute('+1 732 200 1305'), '/keypad?to=%2B1%20732%20200%201305&src=selection');
});
