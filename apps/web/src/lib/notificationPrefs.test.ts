// Notification-preference tests, focused on the ringer-during-a-call pref.
//
// Run: npm run test -w apps/web
//
// The case that actually matters here is the SECOND one: this key ships
// default-ON to users who already have a stored prefs object written before
// the key existed. If the merge in getNotificationPrefs ever stopped layering
// defaults under the parsed value, every existing user would silently read
// `undefined` — falsy — and keep the loud ring the pref exists to stop, with
// the Settings toggle showing "off" for a preference they never set.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getNotificationPrefs,
  setNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
} from './userPrefs.js';

const KEY = 'ace_notification_prefs';

function installEnv(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  // setNotificationPrefs announces changes on the window; the tests don't
  // care about the event, only that emitting it doesn't throw in Node.
  (globalThis as { window?: unknown }).window = { dispatchEvent: () => true };
  return store;
}

let store = installEnv();
beforeEach(() => { store = installEnv(); });

test('a fresh install silences the ringer during a call', () => {
  assert.equal(getNotificationPrefs().silenceRingerDuringCall, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.silenceRingerDuringCall, true);
});

test('an existing user whose stored prefs predate the key gets the default', () => {
  // Exactly what's on disk for someone who set their volume months ago.
  store.set(KEY, JSON.stringify({
    inAppToast: true,
    ringtone: true,
    ringtoneVolume: 0.35,
    desktopNotification: true,
    smsNotification: true,
    voicemailNotification: true,
  }));
  const prefs = getNotificationPrefs();
  assert.equal(prefs.silenceRingerDuringCall, true, 'new key must fall back to its default');
  assert.equal(prefs.ringtoneVolume, 0.35, 'their own settings must survive the merge');
});

test('turning it off persists and survives a re-read', () => {
  setNotificationPrefs({ silenceRingerDuringCall: false });
  assert.equal(getNotificationPrefs().silenceRingerDuringCall, false);
  // Other prefs untouched.
  assert.equal(getNotificationPrefs().ringtone, true);
});

test('unreadable storage falls back to the defaults rather than throwing', () => {
  store.set(KEY, '{not json');
  assert.equal(getNotificationPrefs().silenceRingerDuringCall, true);
});
