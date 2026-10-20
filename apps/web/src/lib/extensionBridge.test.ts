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
    parseExtensionDial(msg({ source: 'ace-extension', type: 'dial', id: 'a1', to: '(732) 200-1305', src: 'selection' }), ORIGIN),
    { id: 'a1', to: '(732) 200-1305', action: 'call', trusted: false },
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

test('page captures route as untrusted text, so Dialpad parses strictly and only prefills', () => {
  const d = parseExtensionDial(msg({ source: 'ace-extension', type: 'dial', id: 'a', to: '+1 732 200 1305', src: 'selection' }), ORIGIN)!;
  assert.equal(extensionDialRoute(d), '/keypad?to=%2B1%20732%20200%201305&src=selection');
});

test('a page capture is always an untrusted call, whatever else it claims', () => {
  const d = parseExtensionDial(msg({ source: 'ace-extension', type: 'dial', id: 'a', to: '+17322001305', action: 'sms' }), ORIGIN)!;
  assert.deepEqual([d.action, d.trusted], ['call', false]);
});

test('panel actions: any src value at all is untrusted; only its absence is trusted', () => {
  const base = { source: 'ace-extension', type: 'open', id: 'a', to: '+17322001305' };
  assert.equal(parseExtensionDial(msg({ ...base, src: 'bogus' }), ORIGIN)!.trusted, false);
  assert.equal(parseExtensionDial(msg({ ...base, src: '' }), ORIGIN)!.trusted, false);
  assert.equal(parseExtensionDial(msg(base), ORIGIN)!.trusted, true);
});

test('follow-up panel numbers: call takes the lenient path, text opens the thread', () => {
  const base = { source: 'ace-extension', type: 'open', id: 'a', to: '+17322001305' };
  assert.equal(extensionDialRoute(parseExtensionDial(msg(base), ORIGIN)!), '/keypad?to=%2B17322001305');
  assert.equal(extensionDialRoute(parseExtensionDial(msg({ ...base, action: 'sms' }), ORIGIN)!), '/messages?to=%2B17322001305');
  assert.equal(parseExtensionDial(msg({ ...base, action: 'fax' }), ORIGIN)!.action, 'call');
});
