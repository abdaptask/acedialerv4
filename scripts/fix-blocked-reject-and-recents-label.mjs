// Two fixes bundled:
//   A) Webhook: use Telnyx /actions/reject (cause USER_BUSY) instead of
//      /actions/hangup. Stops blocked calls from falling through to
//      Hosted Voicemail - caller hears busy signal instead.
//   B) Recents UI: add red 'Blocked' label + Ban icon for blocked calls
//      so the user can clearly see "this number tried to call me and
//      was blocked." Currently they show as plain 'Incoming'.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function readFile(rel) { return readFileSync(resolve(repoRoot, rel), 'utf8'); }
function writeFile(rel, text) { writeFileSync(resolve(repoRoot, rel), text, 'utf8'); }
function count(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ============================================================================
// A. Webhook reject change
// ============================================================================

const whPath = 'apps/webhooks/src/main.ts';
let wh = readFile(whPath);
const wnl = wh.includes('\r\n') ? '\r\n' : '\n';

if (wh.includes('rejectCallByControlId')) {
  console.log('webhooks/main.ts: reject already present, skipping');
} else {
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
  ].join(wnl);

  const newHelper = [
    '// Phase 6.11 - number blocking: REJECT inbound call via Telnyx Call',
    '// Control with cause USER_BUSY. Previously we used /actions/hangup,',
    '// but Telnyx treated that as "no answer" and routed to Hosted Voicemail.',
    '// With reject+USER_BUSY, Telnyx returns SIP 486 to the caller and',
    '// SKIPS voicemail fallthrough - caller hears a busy signal.',
    '//',
    "// Fail-open: if the API key isn't set or the request fails, log and",
    '// let the call through.',
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
  ].join(wnl);

  if (count(wh, oldHelper) !== 1) {
    console.log(`ABORT(webhooks): hangup helper not found exactly once.`);
    process.exit(1);
  }
  wh = wh.replace(oldHelper, newHelper);

  // Call-site
  const oldCall = 'void hangupCallByControlId(callControlId).catch((e) =>';
  if (count(wh, oldCall) !== 1) {
    console.log(`ABORT(webhooks): hangup call site not found.`);
    process.exit(1);
  }
  wh = wh.replace(oldCall, 'void rejectCallByControlId(callControlId).catch((e) =>');

  // Log message
  const oldMsg = "'[blocked] inbound call from blocked number - hanging up',";
  if (count(wh, oldMsg) === 1) {
    wh = wh.replace(oldMsg, "'[blocked] inbound call from blocked number - rejecting with USER_BUSY',");
  }
  const oldWarn = "app.log.warn({ err: e }, '[blocked] hangup API failed'),";
  if (count(wh, oldWarn) === 1) {
    wh = wh.replace(oldWarn, "app.log.warn({ err: e }, '[blocked] reject API failed'),");
  }

  writeFile(whPath, wh);
  console.log('webhooks/main.ts: now uses /actions/reject with USER_BUSY cause');
}

// ============================================================================
// B. Recents UI - add Blocked label + icon
// ============================================================================

const recentsPath = 'apps/web/src/pages/Recents.tsx';
let recents = readFile(recentsPath);
const rnl = recents.includes('\r\n') ? '\r\n' : '\n';

if (recents.includes("c.status === 'blocked'")) {
  console.log('Recents.tsx: blocked status already wired, skipping');
} else {
  // 1. Add Ban icon to the lucide import
  const oldImport = "import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, RefreshCcw, Play, Search, X, MessageSquare, ArrowLeft, Star } from 'lucide-react';";
  const newImport = "import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, RefreshCcw, Play, Search, X, MessageSquare, ArrowLeft, Star, Ban } from 'lucide-react';";
  if (count(recents, oldImport) !== 1) {
    console.log('ABORT(recents): lucide import not found.');
    process.exit(1);
  }
  recents = recents.replace(oldImport, newImport);

  // 2. Extend isMissed to count 'blocked' as "missed" (so it gets the red
  //    styling that already exists on missed rows).
  const oldIsMissed = [
    "    c.status === 'missed' ||",
    "    c.status === 'no_answer' ||",
    "    c.status === 'rejected' ||",
    "    c.status === 'failed'",
  ].join(rnl);
  const newIsMissed = [
    "    c.status === 'missed' ||",
    "    c.status === 'no_answer' ||",
    "    c.status === 'rejected' ||",
    "    c.status === 'failed' ||",
    "    c.status === 'blocked'",
  ].join(rnl);
  if (count(recents, oldIsMissed) !== 1) {
    console.log('ABORT(recents): isMissed body not found.');
    process.exit(1);
  }
  recents = recents.replace(oldIsMissed, newIsMissed);

  // 3. callIcon — blocked gets the Ban icon, takes priority over the
  //    generic missed PhoneMissed icon.
  const oldCallIcon = [
    'function callIcon(c: CallRecord) {',
    '  if (isMissed(c)) return <PhoneMissed size={18} className="ico missed" />;',
    "  if (c.direction === 'inbound') return <PhoneIncoming size={18} className=\"ico in\" />;",
    '  return <PhoneOutgoing size={18} className="ico out" />;',
    '}',
  ].join(rnl);
  const newCallIcon = [
    'function callIcon(c: CallRecord) {',
    "  if (c.status === 'blocked') return <Ban size={18} className=\"ico blocked\" />;",
    '  if (isMissed(c)) return <PhoneMissed size={18} className="ico missed" />;',
    "  if (c.direction === 'inbound') return <PhoneIncoming size={18} className=\"ico in\" />;",
    '  return <PhoneOutgoing size={18} className="ico out" />;',
    '}',
  ].join(rnl);
  if (count(recents, oldCallIcon) !== 1) {
    console.log('ABORT(recents): callIcon body not found.');
    process.exit(1);
  }
  recents = recents.replace(oldCallIcon, newCallIcon);

  // 4. statusLabel — Blocked takes precedence over Missed/Declined for
  //    blocked rows.
  const oldStatusLabel = [
    'function statusLabel(c: CallRecord): string {',
    "  if (c.direction === 'inbound') {",
    "    if (c.status === 'rejected') return 'Declined';",
    "    if (c.status === 'missed' || c.status === 'no_answer') return 'Missed';",
    "    if (c.status === 'failed') return 'Failed';",
    "    return 'Incoming';",
    '  }',
    "  return 'Outgoing';",
    '}',
  ].join(rnl);
  const newStatusLabel = [
    'function statusLabel(c: CallRecord): string {',
    "  if (c.status === 'blocked') return 'Blocked';",
    "  if (c.direction === 'inbound') {",
    "    if (c.status === 'rejected') return 'Declined';",
    "    if (c.status === 'missed' || c.status === 'no_answer') return 'Missed';",
    "    if (c.status === 'failed') return 'Failed';",
    "    return 'Incoming';",
    '  }',
    "  return 'Outgoing';",
    '}',
  ].join(rnl);
  if (count(recents, oldStatusLabel) !== 1) {
    console.log('ABORT(recents): statusLabel body not found.');
    process.exit(1);
  }
  recents = recents.replace(oldStatusLabel, newStatusLabel);

  writeFile(recentsPath, recents);
  console.log('Recents.tsx: now shows Ban icon + "Blocked" label for blocked calls');
}

// ============================================================================
// C. styles.css - add .ico.blocked styling (red shield/ban look)
// ============================================================================

const cssPath = 'apps/web/src/styles.css';
let css = readFile(cssPath);

if (css.includes('.ico.blocked')) {
  console.log('styles.css: .ico.blocked already styled');
} else {
  // Append a small rule near the end. Use the file's existing newline.
  const cnl = css.includes('\r\n') ? '\r\n' : '\n';
  const append = [
    '',
    '/* Phase 6.11 - blocked-call indicator in Recents rows. */',
    '.ico.blocked { color: #ef4444; }',
    '.call-row.missed .call-meta { color: #ef4444; }',
  ].join(cnl);
  css = css + append + cnl;
  writeFile(cssPath, css);
  console.log('styles.css: added .ico.blocked styling');
}

console.log('');
console.log('Done. Diff to verify:');
console.log('  git diff apps/webhooks/src/main.ts apps/web/src/pages/Recents.tsx apps/web/src/styles.css');
