// Phase 6.5 — fix inbound TexML so a 486 Busy on the second concurrent call
// doesn't fall through to <Record> (which is why Hold & Accept couldn't trigger).
//
// Two changes to apps/webhooks/src/main.ts:
//   1. Rewrite texmlHandler so <Dial> has an action URL + 45s timeout, and
//      remove the inline <Say>/<Record>/<Hangup> fallthrough.
//   2. Add a new dialStatusHandler + GET/POST routes for /texml/dial-status
//      that branch on DialCallStatus: busy -> hangup, no-answer -> voicemail.
//
// Safe to re-run: aborts cleanly if the file isn't in the expected state.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '..', 'apps', 'webhooks', 'src', 'main.ts');
let text = readFileSync(file, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';

// --- 1. Replace texmlHandler -----------------------------------------------

const oldHandler = [
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
  'const texmlHandler = (request: any): string => {',
  "  const sipUser = process.env.PILOT_SIP_USERNAME ?? '';",
  '  const greeting =',
  '    process.env.PILOT_VOICEMAIL_GREETING ??',
  '    "You\'ve reached ACE Dialer. Please leave a message after the tone, then press pound or hang up.";',
  '',
  '  if (!sipUser) {',
  "    app.log.warn('[texml] PILOT_SIP_USERNAME not set; returning hangup-only flow');",
  '  }',
  '',
  '  // Build an ABSOLUTE URL for the Record action — Telnyx requires absolute',
  '  // URLs for callbacks. Prefer an explicit env var, fall back to the host',
  '  // header Telnyx hit us on (Render sets x-forwarded-proto correctly).',
  "  const proto = (request?.headers?.['x-forwarded-proto'] as string) ?? 'https';",
  "  const host = (request?.headers?.host as string) ?? 'ace-dialer-webhooks.onrender.com';",
  "  const baseUrl = (process.env.WEBHOOKS_PUBLIC_URL ?? `${proto}://${host}`).replace(/\\/+$/, '');",
  '  const recordAction = `${baseUrl}/webhooks/telnyx/voicemail`;',
  '',
  "  // Telnyx's TexML reference is a Twilio-compatible subset. Sticking to the",
  '  // safe core verbs/attributes to avoid parser errors:',
  '  //   <Dial><Sip>…</Sip></Dial>            → bridge to SIP target',
  '  //   timeout                              → seconds before no-answer fallthrough',
  '  //   <Say voice="alice">                  → standard TTS voice; Polly.* voices',
  "  //                                          aren't always accepted.",
  '  //   <Record action maxLength playBeep>   → record + POST to action URL',
  '  //   <Hangup/>                            → end the call',
  '  const xml = sipUser',
  '    ? `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Dial timeout="25">',
  '    <Sip>sip:${xmlEscape(sipUser)}@sip.telnyx.com</Sip>',
  '  </Dial>',
  '  <Say voice="alice">${xmlEscape(greeting)}</Say>',
  '  <Record maxLength="120" playBeep="true" action="${xmlEscape(recordAction)}" method="POST" finishOnKey="#" />',
  '  <Hangup/>',
  '</Response>`',
  '    : `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Say voice="alice">Service not yet configured.</Say>',
  '  <Hangup/>',
  '</Response>`;',
  '',
  '  return xml;',
  '};',
].join(nl);

const newHandler = [
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
  'const texmlHandler = (request: any): string => {',
  "  const sipUser = process.env.PILOT_SIP_USERNAME ?? '';",
  '  if (!sipUser) {',
  "    app.log.warn('[texml] PILOT_SIP_USERNAME not set; returning hangup-only flow');",
  '  }',
  '',
  '  // Build an ABSOLUTE URL for the Dial action - Telnyx requires absolute URLs.',
  "  const proto = (request?.headers?.['x-forwarded-proto'] as string) ?? 'https';",
  "  const host = (request?.headers?.host as string) ?? 'ace-dialer-webhooks.onrender.com';",
  "  const baseUrl = (process.env.WEBHOOKS_PUBLIC_URL ?? `${proto}://${host}`).replace(/\\/+$/, '');",
  '  const dialStatusAction = `${baseUrl}/texml/dial-status`;',
  '',
  '  // Phase 6.5 - Hold & Accept friendly inbound flow.',
  '  //',
  '  // Old flow: <Dial><Sip/></Dial> immediately followed by <Say>+<Record>.',
  '  // When a second concurrent call came in, the SIP endpoint returned 486',
  '  // Busy on the new INVITE; TexML treated <Dial> as failed and fell',
  '  // straight through to <Record>. Result: caller hit voicemail with no',
  '  // ringing, and Hold & Accept never got a chance to show.',
  '  //',
  '  // New flow: <Dial> has an action URL so dialStatusHandler can branch on',
  '  // DialCallStatus - busy -> polite hangup, no-answer/failed -> voicemail,',
  '  // completed -> nothing. Timeout bumped to 45s so the user has room to',
  '  // see the IncomingCall UI and tap Hold & Accept.',
  '  const xml = sipUser',
  '    ? `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Dial timeout="45" action="${xmlEscape(dialStatusAction)}" method="POST">',
  '    <Sip>sip:${xmlEscape(sipUser)}@sip.telnyx.com</Sip>',
  '  </Dial>',
  '</Response>`',
  '    : `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Say voice="alice">Service not yet configured.</Say>',
  '  <Hangup/>',
  '</Response>`;',
  '',
  '  return xml;',
  '};',
  '',
  '// Phase 6.5 - Dial action handler. Telnyx POSTs (or GETs) here when',
  '// <Dial> finishes. We branch on DialCallStatus:',
  '//   completed/answered -> empty Response (call already done)',
  "//   busy                -> polite hangup (don't dump caller into voicemail)",
  '//   no-answer / failed  -> fall through to voicemail Record',
  '//   canceled            -> fall through to voicemail Record',
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
  'const dialStatusHandler = (request: any): string => {',
  '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
  '  const body = (request?.body ?? {}) as any;',
  '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
  '  const query = (request?.query ?? {}) as any;',
  "  const status: string = (body.DialCallStatus ?? query.DialCallStatus ?? '').toString().toLowerCase();",
  '',
  "  const proto = (request?.headers?.['x-forwarded-proto'] as string) ?? 'https';",
  "  const host = (request?.headers?.host as string) ?? 'ace-dialer-webhooks.onrender.com';",
  "  const baseUrl = (process.env.WEBHOOKS_PUBLIC_URL ?? `${proto}://${host}`).replace(/\\/+$/, '');",
  '  const recordAction = `${baseUrl}/webhooks/telnyx/voicemail`;',
  '  const greeting =',
  '    process.env.PILOT_VOICEMAIL_GREETING ??',
  '    "You\'ve reached ACE Dialer. Please leave a message after the tone, then press pound or hang up.";',
  '',
  "  app.log.info({ status }, '[texml] dial-status received');",
  '',
  "  if (status === 'completed' || status === 'answered') {",
  '    return `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response/>`;',
  '  }',
  "  if (status === 'busy') {",
  '    return `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Say voice="alice">The party you are trying to reach is on another call. Please try again in a moment.</Say>',
  '  <Hangup/>',
  '</Response>`;',
  '  }',
  '  // Default + no-answer / failed / canceled -> voicemail.',
  '  return `<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  '  <Say voice="alice">${xmlEscape(greeting)}</Say>',
  '  <Record maxLength="120" playBeep="true" action="${xmlEscape(recordAction)}" method="POST" finishOnKey="#" />',
  '  <Hangup/>',
  '</Response>`;',
  '};',
].join(nl);

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

if (text.includes('dialStatusHandler')) {
  console.log('ABORT: dialStatusHandler already exists in main.ts - file is already patched.');
  process.exit(1);
}

const handlerCount = countOccurrences(text, oldHandler);
if (handlerCount !== 1) {
  console.log(`ABORT (handler): found ${handlerCount} matches of the old texmlHandler, expected exactly 1.`);
  console.log('File may have been modified. Not touching it.');
  process.exit(1);
}

text = text.replace(oldHandler, newHandler);

// --- 2. Add GET + POST routes for /texml/dial-status -----------------------

const oldRoutes = [
  "app.post('/texml/inbound', async (request, reply) => {",
  '  const xml = texmlHandler(request);',
  "  app.log.info({ length: xml.length, sipUser: Boolean(process.env.PILOT_SIP_USERNAME) }, '[texml] inbound served');",
  "  reply.type('application/xml; charset=utf-8').send(xml);",
  '});',
].join(nl);

const newRoutes = [
  "app.post('/texml/inbound', async (request, reply) => {",
  '  const xml = texmlHandler(request);',
  "  app.log.info({ length: xml.length, sipUser: Boolean(process.env.PILOT_SIP_USERNAME) }, '[texml] inbound served');",
  "  reply.type('application/xml; charset=utf-8').send(xml);",
  '});',
  '',
  '// Phase 6.5 - TexML <Dial action="..."> callback. Telnyx POSTs DialCallStatus',
  '// here when the dial finishes; we branch to voicemail / hangup / no-op.',
  "app.get('/texml/dial-status', async (request, reply) => {",
  '  const xml = dialStatusHandler(request);',
  "  app.log.info({ length: xml.length }, '[texml] dial-status served (GET)');",
  "  reply.type('application/xml; charset=utf-8').send(xml);",
  '});',
  "app.post('/texml/dial-status', async (request, reply) => {",
  '  const xml = dialStatusHandler(request);',
  "  app.log.info({ length: xml.length }, '[texml] dial-status served (POST)');",
  "  reply.type('application/xml; charset=utf-8').send(xml);",
  '});',
].join(nl);

const routeCount = countOccurrences(text, oldRoutes);
if (routeCount !== 1) {
  console.log(`ABORT (routes): found ${routeCount} matches of the inbound route block, expected exactly 1.`);
  process.exit(1);
}

text = text.replace(oldRoutes, newRoutes);

writeFileSync(file, text, 'utf8');
console.log('Patched main.ts. New line count:', text.split(nl).length);
console.log('');
console.log('Now run:  git diff apps/webhooks/src/main.ts');
console.log('If diff is texmlHandler rewrite + new dial-status routes only, commit:');
console.log('  git commit -am "TexML: branch on DialCallStatus so busy on 2nd call no longer hits voicemail"');
console.log('  git push');
