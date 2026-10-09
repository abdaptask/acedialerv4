// Phone-number type inference + display merge.
//
// The cases that matter most are the NEGATIVE ones: a US geographic number
// must come back "Unknown" (the numbering plan can't say mobile vs landline),
// and a half-typed number must render nothing rather than "Invalid".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describePhoneType,
  dialablePart,
  inferPhoneType,
  refineWithFullMetadata,
  shouldLookUp,
  type Inference,
} from './phoneType.js';

const kind = (s: string) => inferPhoneType(s).kind;
const lineType = (s: string) => {
  const r = inferPhoneType(s);
  assert.equal(r.kind, 'inferred', `${s} → ${r.kind}`);
  return r.kind === 'inferred' ? r.lineType : null;
};

test('nothing to show for empty, DTMF and SIP input', () => {
  for (const s of ['', '   ', '*', '*67', '#', 'sip:bob@example.com', '+']) assert.equal(kind(s), 'none', s);
});

test('a number still being typed is incomplete, not invalid', () => {
  for (const s of ['7', '732', '732555', '732555123', '+9', '+91', '+9198765', '1234567']) {
    assert.equal(kind(s), 'incomplete', s);
  }
});

test('complete-length numbers that are not real are invalid', () => {
  for (const s of ['5555551234', '0000000000', '1235551234', '73272712345']) assert.equal(kind(s), 'invalid', s);
});

test('US/Canada geographic numbers are Unknown — NANP does not encode the line type', () => {
  for (const s of ['7327271234', '(732) 727-1234', '+17327271234', '1-732-727-1234', '+14165551234', '+16135550123']) {
    assert.equal(lineType(s), 'unknown', s);
  }
});

test('toll-free and premium-rate are certain from the number alone', () => {
  for (const s of ['8005551234', '+18885551212', '833-555-0101', '(877) 555-0199']) assert.equal(lineType(s), 'toll_free', s);
  assert.equal(lineType('9005551234'), 'premium_rate');
});

test('post-dial DTMF and extensions do not affect the type', () => {
  assert.equal(dialablePart('+17327271234,,802'), '+17327271234');
  assert.equal(dialablePart('7327271234 x203'), '7327271234');
  assert.equal(dialablePart('7327271234 ext. 9'), '7327271234');
  assert.equal(lineType('+18005551234,,1'), 'toll_free');
});

test('international numbers whose plans encode the type are inferred', () => {
  assert.equal(lineType('+442071234567'), 'landline');
  assert.equal(lineType('+447911123456'), 'mobile');
});

test('countries missing from the bundled metadata are refined with the full set', async () => {
  const r = inferPhoneType('+919876543210');
  assert.equal(r.kind, 'inferred');
  if (r.kind !== 'inferred') return;
  assert.equal(r.typeMissing, true);
  const refined = await refineWithFullMetadata(r.e164);
  assert.equal(refined.kind === 'inferred' && refined.lineType, 'mobile');
});

test('carrier lookups are only requested where they can add something', () => {
  assert.equal(shouldLookUp(inferPhoneType('7327271234')), true);
  assert.equal(shouldLookUp(inferPhoneType('+14165551234')), true);
  assert.equal(shouldLookUp(inferPhoneType('8005551234')), false); // already certain
  assert.equal(shouldLookUp(inferPhoneType('+442071234567')), false); // region not enabled
  assert.equal(shouldLookUp(inferPhoneType('5555551234')), false); // invalid
  assert.equal(shouldLookUp(inferPhoneType('732555')), false); // incomplete
});

// ── describePhoneType: the verified/inferred distinction ──────────────

const us = inferPhoneType('7327271234') as Inference;
const tollFree = inferPhoneType('8005551234') as Inference;

test('hidden while incomplete, explicit while invalid', () => {
  assert.deepEqual(describePhoneType(inferPhoneType('732'), { status: 'idle' }), { state: 'hidden' });
  const d = describePhoneType(inferPhoneType('5555551234'), { status: 'idle' });
  assert.equal(d.state, 'invalid');
});

test('verified lookup wins and is labelled as verified', () => {
  const d = describePhoneType(us, {
    status: 'verified',
    result: { lineType: 'mobile', carrier: 'T-Mobile', ported: true },
  });
  assert.equal(d.state === 'shown' && d.label, 'Mobile');
  assert.equal(d.state === 'shown' && d.source, 'verified');
  assert.match(d.state === 'shown' ? d.detail : '', /Verified by carrier lookup · T-Mobile · ported/);
});

test('a carrier "fixed line" answer is shown as Landline or VoIP, verified', () => {
  const d = describePhoneType(us, {
    status: 'verified',
    result: { lineType: 'landline_or_voip', carrier: 'TELNYX, LLC', ported: null },
  });
  assert.equal(d.state === 'shown' && d.label, 'Landline or VoIP');
  assert.equal(d.state === 'shown' && d.source, 'verified');
});

test('a failed or unconfigured lookup falls back to Unknown and never blocks', () => {
  for (const reason of ['not_configured', 'provider_error', 'network', 'limit_reached']) {
    const d = describePhoneType(us, { status: 'unavailable', reason });
    assert.equal(d.state, 'shown');
    if (d.state !== 'shown') continue;
    assert.equal(d.label, 'Unknown');
    assert.equal(d.source, 'inferred');
    assert.equal(d.loading, false);
  }
});

test('loading is surfaced while a lookup is in flight', () => {
  const d = describePhoneType(us, { status: 'loading' });
  assert.equal(d.state === 'shown' && d.loading, true);
});

test('an inferred type says it is inferred', () => {
  const d = describePhoneType(tollFree, { status: 'idle' });
  assert.equal(d.state === 'shown' && d.label, 'Toll-free');
  assert.equal(d.state === 'shown' && d.source, 'inferred');
  assert.match(d.state === 'shown' ? d.detail : '', /Inferred from the number format/);
});
