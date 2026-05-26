// scripts/diff-did-settings.mjs
//
// v0.9.13 — Diagnostic: read-only diff of the DID-level settings (NOT the
// Credential Connection settings — that's diff-credential-connection.mjs).
//
// Telnyx phone numbers have their own settings object that sits ABOVE the
// Credential Connection. Fields like call_control_app_id, voice_service,
// messaging_profile_id, billing_group, status, etc. live here. A
// misconfiguration at the DID level (e.g. an orphaned Call Control App
// pointing at the number) will intercept the inbound call BEFORE it
// reaches the SIP credential's routing rules — webhook still fires
// (so user sees missed call) but no SIP INVITE is ever delivered.
//
// Usage:
//   $env:TELNYX_API_KEY="KEY..."; node scripts/diff-did-settings.mjs +17322001305 +17322014727 +16096169570
//
// First DID = template (known-good). Remaining DIDs are compared against it.
// Read-only. Only GETs.

const API_KEY = process.env.TELNYX_API_KEY;
if (!API_KEY) {
  console.error('TELNYX_API_KEY not set in env.');
  process.exit(1);
}

const dids = process.argv.slice(2);
if (dids.length < 2) {
  console.error('Usage: node scripts/diff-did-settings.mjs <template_did> <broken_did_1> [broken_did_2 ...]');
  process.exit(1);
}

const BASE = 'https://api.telnyx.com/v2';

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed: HTTP ${res.status} ${body}`);
  }
  return res.json();
}

function normalizeE164(d) {
  const digits = d.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return d.startsWith('+') ? d : `+${digits}`;
}

async function findNumber(e164) {
  const qs = new URLSearchParams({
    'filter[phone_number]': e164,
    'page[size]': '5',
  });
  const json = await api(`/phone_numbers?${qs.toString()}`);
  return (json.data || []).find((n) => n.phone_number === e164) ?? null;
}

async function fetchPhoneNumberDetail(numberId) {
  // The /phone_numbers/:id endpoint returns the basic number record.
  // The /phone_numbers/:id/voice endpoint returns the voice settings
  // (including call_control_app_id, tech_prefix, etc.) which is what
  // we actually care about for inbound routing.
  const [base, voice, messaging] = await Promise.all([
    api(`/phone_numbers/${numberId}`).catch((e) => ({ error: e.message })),
    api(`/phone_numbers/${numberId}/voice`).catch((e) => ({ error: e.message })),
    api(`/phone_numbers/${numberId}/messaging`).catch((e) => ({ error: e.message })),
  ]);
  return {
    base: base.data ?? base,
    voice: voice.data ?? voice,
    messaging: messaging.data ?? messaging,
  };
}

function summarize(label, e164, num, detail) {
  console.log(`\n=== ${label}: ${e164} ===`);
  if (!num) {
    console.log('  (not found on this account)');
    return;
  }
  console.log(`  id:                       ${num.id}`);
  console.log(`  phone_number:             ${num.phone_number}`);
  console.log(`  status:                   ${num.status}`);
  console.log(`  phone_number_type:        ${num.phone_number_type}`);
  console.log(`  connection_id:            ${num.connection_id || '(none)'}`);
  console.log(`  messaging_profile_id:     ${num.messaging_profile_id || '(none)'}`);
  console.log(`  billing_group_id:         ${num.billing_group_id || '(none)'}`);
  console.log(`  emergency_address_id:     ${num.emergency_address_id || '(none)'}`);
  console.log(`  tags:                     ${JSON.stringify(num.tags || [])}`);

  const v = detail.voice;
  if (v?.error) {
    console.log(`  voice settings error:     ${v.error}`);
  } else {
    console.log(`  --- voice settings ---`);
    console.log(`  connection_id (voice):    ${v.connection_id || '(none)'}`);
    console.log(`  call_forwarding:          ${v.call_forwarding ? JSON.stringify(v.call_forwarding) : '(none)'}`);
    console.log(`  call_recording:           ${v.call_recording ? JSON.stringify(v.call_recording) : '(none)'}`);
    console.log(`  caller_id_name_enabled:   ${v.caller_id_name_enabled}`);
    console.log(`  cnam_listing:             ${v.cnam_listing ? JSON.stringify(v.cnam_listing) : '(none)'}`);
    console.log(`  inbound_call_screening:   ${v.inbound_call_screening || '(none)'}`);
    console.log(`  media_features:           ${JSON.stringify(v.media_features || {})}`);
    console.log(`  tech_prefix_enabled:      ${v.tech_prefix_enabled}`);
    console.log(`  translated_number:        ${v.translated_number || '(none)'}`);
    console.log(`  usage_payment_method:     ${v.usage_payment_method || '(none)'}`);
    console.log(`  call_control_app_id:      ${v.call_control_app_id || '(none)'}`);
    console.log(`  voice_service:            ${v.voice_service || '(none)'}`);
  }

  const m = detail.messaging;
  if (m?.error) {
    console.log(`  messaging settings error: ${m.error}`);
  } else {
    console.log(`  --- messaging settings ---`);
    console.log(`  messaging_profile_id (m): ${m.messaging_profile_id || '(none)'}`);
    console.log(`  messaging_product:        ${m.messaging_product || '(none)'}`);
  }
}

async function main() {
  const list = dids.map(normalizeE164);

  // Look up all numbers in parallel.
  const records = await Promise.all(list.map(async (e164) => {
    const num = await findNumber(e164);
    const detail = num ? await fetchPhoneNumberDetail(num.id) : null;
    return { e164, num, detail };
  }));

  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const label = i === 0 ? 'TEMPLATE' : `BROKEN #${i}`;
    summarize(label, r.e164, r.num, r.detail);
  }

  // Compare just the most-important fields.
  console.log('\n\n=== KEY FIELDS SIDE-BY-SIDE ===');
  const cols = records.map((r) => r.e164);
  console.log('Field                     | ' + cols.join(' | '));
  console.log('-'.repeat(80));
  const fields = [
    ['status',                (r) => r.num?.status],
    ['phone_number_type',     (r) => r.num?.phone_number_type],
    ['connection_id (base)',  (r) => r.num?.connection_id || '(none)'],
    ['connection_id (voice)', (r) => r.detail?.voice?.connection_id || '(none)'],
    ['call_control_app_id',   (r) => r.detail?.voice?.call_control_app_id || '(none)'],
    ['voice_service',         (r) => r.detail?.voice?.voice_service || '(none)'],
    ['messaging_profile_id',  (r) => r.num?.messaging_profile_id || '(none)'],
    ['emergency_address_id',  (r) => r.num?.emergency_address_id || '(none)'],
    ['tech_prefix_enabled',   (r) => r.detail?.voice?.tech_prefix_enabled],
    ['translated_number',     (r) => r.detail?.voice?.translated_number || '(none)'],
    ['inbound_call_screening',(r) => r.detail?.voice?.inbound_call_screening || '(none)'],
    ['media_features',        (r) => JSON.stringify(r.detail?.voice?.media_features || {})],
    ['call_forwarding',       (r) => JSON.stringify(r.detail?.voice?.call_forwarding || {})],
    ['usage_payment_method',  (r) => r.detail?.voice?.usage_payment_method || '(none)'],
  ];
  for (const [label, getter] of fields) {
    const vals = records.map(getter).map(String);
    console.log(label.padEnd(25) + ' | ' + vals.join(' | '));
  }

  console.log('\nDone. Look for fields where the BROKEN columns differ from the TEMPLATE column.');
}

main().catch((e) => {
  console.error('Script error:', e.message);
  process.exit(1);
});
