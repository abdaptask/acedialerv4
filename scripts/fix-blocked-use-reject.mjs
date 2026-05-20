// Phase 6.11 — Use Telnyx Call Control 'reject' action instead of 'hangup'
// for blocked-number calls.
//
// Background: with 'hangup', Telnyx treats it as "call ended unanswered"
// and falls through to Hosted Voicemail (which is enabled on the phone
// number). The caller hears voicemail greeting and can leave a message.
//
// With 'reject' + cause: USER_BUSY, Telnyx returns a SIP 486 Busy Here to
// the carrier without falling through to voicemail. The caller hears a
// busy signal — no voicemail recording, no fall-through.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '..', 'apps', 'webhooks', 'src', 'main.ts');
let text = readFileSync(file, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';

function count(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// Rename helper + change endpoint from /hangup to /reject and add cause body.

const oldHelper = [
  '// Phase 6.8 - number blocking: hang up an inbound call that the recipient',
  '// has blacklisted. Uses Telnyx Call Control hangup API. Fail-open: if the',
  "// API key isn't set or the request fails, we just log and let the call",
  '// continue to the SIP endpoint - better to ring a legit call than to',
  '// silently drop one due to a server-side hiccup.',
  'async function hangupCallByControlId(',
  '  callControlId: string,',
  '): Promise<{ ok: boolean; status?: number; error?: unknown }> {',
  "  if (!TELNYX_API_KEY) return { ok: false, error: 'TELNYX_API_KEY not set on webhooks service' };",
  '  const res = await fetch(',
  '    `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`,',
  '    {',
  "      method: 'POST',",
  '      headers: {',
  "        'Content-Type': 'application/json',",
  '        Authorization: `Bearer ${TELNYX_API_KEY}`,',
  '      },',
  '      body: JSON.stringify({}),',
  '    },',
  '  );',
  '  const body = await res.json().catch(() => ({}));',
  '  return { ok: res.ok, status: res.status, ...(res.ok ? {} : { error: body }) };',
  '}',
].join(nl);

const newHelper = [
  '// Phase 6.11 - number blocking: REJECT an inbound call from a blocked',
  '// number using Telnyx Call Control reject action with cause USER_BUSY.',
  '// Previously we used /actions/hangup, but Telnyx treats hangup as',
  '// "call ended unanswered" and falls through to Hosted Voicemail (which',
  '// is enabled on the DID). With reject+USER_BUSY, Telnyx returns SIP',
  '// 486 Busy Here to the carrier and skips voicemail fallthrough. Caller',
  '// hears a busy signal instead of voicemail.',
  '//',
  "// Fail-open: if the API key isn't set or the request fails, we just",
  '// log and let the call through.',
  'async function rejectCallByControlId(',
  '  callControlId: string,',
  '): Promise<{ ok: boolean; status?: number; error?: unknown }> {',
  "  if (!TELNYX_API_KEY) return { ok: false, error: 'TELNYX_API_KEY not set on webhooks service' };",
  '  const res = await fetch(',
  '    `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/reject`,',
  '    {',
  "      method: 'POST',",
  '      headers: {',
  "        'Content-Type': 'application/json',",
  '        Authorization: `Bearer ${TELNYX_API_KEY}`,',
  '      },',
  "      body: JSON.stringify({ cause: 'USER_BUSY' }),",
  '    },',
  '  );',
  '  const body = await res.json().catch(() => ({}));',
  '  return { ok: res.ok, status: res.status, ...(res.ok ? {} : { error: body }) };',
  '}',
].join(nl);

if (count(text, oldHelper) !== 1) {
  console.log(`ABORT: hangup helper block not found exactly once (got ${count(text, oldHelper)}).`);
  process.exit(1);
}
text = text.replace(oldHelper, newHelper);

// Update the call sites: hangupCallByControlId -> rejectCallByControlId
const oldCall1 = 'void hangupCallByControlId(callControlId).catch((e) =>';
const newCall1 = 'void rejectCallByControlId(callControlId).catch((e) =>';
const c = count(text, oldCall1);
if (c !== 1) {
  console.log(`ABORT: hangup call-site not found exactly once (got ${c}).`);
  process.exit(1);
}
text = text.replace(oldCall1, newCall1);

// Update the log message to say "rejecting" not "hanging up"
const oldLog = "'[blocked] inbound call from blocked number - hanging up',";
const newLog = "'[blocked] inbound call from blocked number - rejecting with USER_BUSY',";
if (count(text, oldLog) !== 1) {
  console.log(`ABORT: log message not found exactly once.`);
  process.exit(1);
}
text = text.replace(oldLog, newLog);

const oldWarn = "app.log.warn({ err: e }, '[blocked] hangup API failed'),";
const newWarn = "app.log.warn({ err: e }, '[blocked] reject API failed'),";
if (count(text, oldWarn) === 1) {
  text = text.replace(oldWarn, newWarn);
}

writeFileSync(file, text, 'utf8');
console.log('Patched: blocked calls now use /actions/reject with USER_BUSY cause.');
console.log('Caller will hear busy signal instead of voicemail.');
console.log('New line count:', text.split(nl).length);
