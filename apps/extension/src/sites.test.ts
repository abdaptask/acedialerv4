import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_HOSTS, hostOf, isBuiltIn } from './sites.js';

test('built-in matches the patterns the options page stores, and nothing else', () => {
  assert.equal(isBuiltIn('*://www1.jobdiva.com/*'), true);
  assert.equal(isBuiltIn('https://www2.jobdiva.com/*'), true);
  assert.equal(isBuiltIn('*://www3.jobdiva.com/*'), false);
  assert.equal(isBuiltIn('*://evil-www1.jobdiva.com.example/*'), false);
  assert.equal(hostOf('*://crm.example.com/*'), 'crm.example.com');
});

test('the manifest grants and scans exactly the built-in hosts', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const want = BUILT_IN_HOSTS.map((h) => `https://${h}/*`).sort();
  const scanner = m.content_scripts.find((c: { js: string[] }) => c.js.includes('content.js'));
  assert.deepEqual([...scanner.matches].sort(), want);
  assert.equal(scanner.all_frames, true, 'JobDiva renders the record in frames');
  assert.deepEqual(m.host_permissions.filter((h: string) => h !== 'https://dialer.aptask.com/*').sort(), want);
  assert.ok(!JSON.stringify(m).includes('<all_urls>'));
});
