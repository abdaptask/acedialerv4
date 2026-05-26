// scripts/diff-credential-connection.mjs
//
// v0.9.13 — Diagnostic: read-only diff of a working Credential Connection
// (the template) against one or more broken ones. Used to figure out which
// fields are missing on connections that were cloned BEFORE we fixed the
// template-clone code in v0.9.11/v0.9.12.
//
// Symptom this helps debug: outbound calls work fine but inbound calls
// produce a "number you have dialed is no longer in service" intercept,
// and the assigned user sees the call in Recents without their dialer
// ever ringing. That pattern = Credential Connection's inbound side is
// missing fields (typically SIP URI routing) while the outbound side
// is fine.
//
// Usage (Windows PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/diff-credential-connection.mjs +17322001305 +17322014727 +16096169570
//
// Usage (bash):
//   TELNYX_API_KEY=KEY... node scripts/diff-credential-connection.mjs +17322001305 +17322014727 +16096169570
//
// The FIRST DID is treated as the "template" (known-good). The remaining
// DIDs are compared against it. The script prints, for each broken DID:
//   - Fields present on template but missing on broken (the bug)
//   - Fields different in value (might be intentional, e.g. ani_override)
//   - Fields present on broken but not on template (almost never matters)
//
// Read-only: makes only GET requests. Nothing on Telnyx changes.

const API_KEY = process.env.TELNYX_API_KEY;
if (!API_KEY) {
  console.error('TELNYX_API_KEY not set in env. See header comment.');
  process.exit(1);
}

const dids = process.argv.slice(2);
if (dids.length < 2) {
  console.error('Usage: node scripts/diff-credential-connection.mjs <template_did> <broken_did_1> [broken_did_2 ...]');
  console.error('Example: node scripts/diff-credential-connection.mjs +17322001305 +17322014727 +16096169570');
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
  // Telnyx's phone-numbers list endpoint with filter[phone_number]
  const qs = new URLSearchParams({
    'filter[phone_number]': e164,
    'page[size]': '5',
  });
  const json = await api(`/phone_numbers?${qs.toString()}`);
  return (json.data || []).find((n) => n.phone_number === e164) ?? null;
}

async function fetchConnection(connectionId) {
  const json = await api(`/credential_connections/${connectionId}`);
  return json.data;
}

// Recursive diff. Returns a list of { path, template, broken, kind }.
//   kind: 'missing'   = template has it, broken doesn't (or broken is null/undefined/empty)
//         'different' = both have it but values differ
//         'extra'     = broken has it, template doesn't (rare, usually harmless)
function diffObjects(tpl, brk, basePath = '') {
  const diffs = [];

  function isEmpty(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string' && v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === 'object' && Object.keys(v).length === 0) return true;
    return false;
  }

  function valuesEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (!valuesEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const ak = Object.keys(a);
      const bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      for (const k of ak) {
        if (!valuesEqual(a[k], b[k])) return false;
      }
      return true;
    }
    return false;
  }

  // Skip these — they're per-instance identifiers that always differ.
  const skipKeys = new Set([
    'id',
    'created_at',
    'updated_at',
    'connection_name',
    'user_name',
    'sip_uri_calls_subdomain',
    'record_type',
    'self',
  ]);

  const tplKeys = Object.keys(tpl || {});
  const brkKeys = Object.keys(brk || {});
  const allKeys = new Set([...tplKeys, ...brkKeys]);

  for (const k of allKeys) {
    if (skipKeys.has(k)) continue;
    const path = basePath ? `${basePath}.${k}` : k;
    const tv = tpl?.[k];
    const bv = brk?.[k];

    const tEmpty = isEmpty(tv);
    const bEmpty = isEmpty(bv);

    if (tEmpty && bEmpty) continue;
    if (!tEmpty && bEmpty) {
      diffs.push({ path, template: tv, broken: bv, kind: 'missing' });
      continue;
    }
    if (tEmpty && !bEmpty) {
      diffs.push({ path, template: tv, broken: bv, kind: 'extra' });
      continue;
    }
    // Both non-empty
    if (typeof tv === 'object' && !Array.isArray(tv) && typeof bv === 'object' && !Array.isArray(bv)) {
      diffs.push(...diffObjects(tv, bv, path));
    } else if (!valuesEqual(tv, bv)) {
      diffs.push({ path, template: tv, broken: bv, kind: 'different' });
    }
  }

  return diffs;
}

function printValue(v) {
  if (v === undefined) return '(missing)';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return JSON.stringify(v);
}

async function main() {
  const [templateDid, ...brokenDids] = dids.map(normalizeE164);
  console.log(`\n=== Looking up template DID: ${templateDid}`);
  const tplNum = await findNumber(templateDid);
  if (!tplNum) {
    console.error(`Template DID ${templateDid} not found on this Telnyx account.`);
    process.exit(2);
  }
  if (!tplNum.connection_id) {
    console.error(`Template DID ${templateDid} has no connection_id (unassigned).`);
    process.exit(2);
  }
  console.log(`  connection_id: ${tplNum.connection_id}`);
  const tplConn = await fetchConnection(tplNum.connection_id);
  console.log(`  connection_name: ${tplConn.connection_name}`);
  console.log(`  active: ${tplConn.active}`);
  console.log(`  anchorsite_override: ${tplConn.anchorsite_override}`);
  console.log(`  webhook_event_url: ${tplConn.webhook_event_url || '(none)'}`);

  for (const did of brokenDids) {
    console.log(`\n=== Comparing against ${did}`);
    const num = await findNumber(did);
    if (!num) {
      console.error(`  DID ${did} not found.`);
      continue;
    }
    if (!num.connection_id) {
      console.error(`  DID ${did} has no connection_id (unassigned). THIS is the bug.`);
      continue;
    }
    console.log(`  connection_id: ${num.connection_id}`);
    const conn = await fetchConnection(num.connection_id);
    console.log(`  connection_name: ${conn.connection_name}`);
    console.log(`  active: ${conn.active}`);
    console.log(`  webhook_event_url: ${conn.webhook_event_url || '(none)'}`);

    const diffs = diffObjects(tplConn, conn);
    const missing = diffs.filter((d) => d.kind === 'missing');
    const different = diffs.filter((d) => d.kind === 'different');
    const extra = diffs.filter((d) => d.kind === 'extra');

    console.log(`\n  --- ${missing.length} MISSING fields (template has, broken doesn't) ---`);
    if (missing.length === 0) {
      console.log('  (none)');
    } else {
      for (const d of missing) {
        console.log(`  - ${d.path}`);
        console.log(`      template: ${printValue(d.template)}`);
        console.log(`      broken:   ${printValue(d.broken)}`);
      }
    }

    console.log(`\n  --- ${different.length} DIFFERENT values (both have but values differ) ---`);
    if (different.length === 0) {
      console.log('  (none)');
    } else {
      for (const d of different) {
        console.log(`  - ${d.path}`);
        console.log(`      template: ${printValue(d.template)}`);
        console.log(`      broken:   ${printValue(d.broken)}`);
      }
    }

    console.log(`\n  --- ${extra.length} EXTRA fields (broken has, template doesn't) ---`);
    if (extra.length === 0) {
      console.log('  (none)');
    } else {
      for (const d of extra) {
        console.log(`  - ${d.path}: ${printValue(d.broken)}`);
      }
    }
  }

  console.log('\nDone. Fields in MISSING are almost always the cause of inbound failure.');
  console.log('Fields in DIFFERENT are usually fine (ani_override should differ — it\'s per-DID).');
}

main().catch((e) => {
  console.error('Script error:', e.message);
  process.exit(1);
});
