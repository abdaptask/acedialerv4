// Phone-type lookup — input gate and provider-response normalisation.
// The gate decides what we PAY for, so its cases are the expensive ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lookupEligibility, normalizeLineType, parseTelnyxLookup } from './classify.js';

test('only valid-shaped geographic NANP numbers are eligible for a paid lookup', () => {
  assert.equal(lookupEligibility('+17325551234'), 'ok');
  assert.equal(lookupEligibility('+14165551234'), 'ok'); // Canada
  // Toll-free and premium are known from the number alone.
  assert.equal(lookupEligibility('+18005551234'), 'not_needed');
  assert.equal(lookupEligibility('+18885551212'), 'not_needed');
  assert.equal(lookupEligibility('+19005551234'), 'not_needed');
  // International: designed for, not enabled yet.
  assert.equal(lookupEligibility('+442071234567'), 'unsupported_region');
  assert.equal(lookupEligibility('+919876543210'), 'unsupported_region');
});

test('junk never reaches the provider', () => {
  for (const s of ['', '7325551234', '+1732555123', '+117325551234', '+11235551234', '+17321551234', 'sip:x@y', '+1 732 555 1234']) {
    assert.equal(lookupEligibility(s), 'invalid', s);
  }
});

test('provider vocabulary maps onto our line types', () => {
  assert.equal(normalizeLineType('mobile'), 'mobile');
  assert.equal(normalizeLineType('Wireless'), 'mobile');
  assert.equal(normalizeLineType('fixed line'), 'landline');
  assert.equal(normalizeLineType('landline'), 'landline');
  assert.equal(normalizeLineType('voip'), 'voip');
  assert.equal(normalizeLineType('non-fixed VoIP'), 'voip');
  assert.equal(normalizeLineType('toll free'), 'toll_free');
  assert.equal(normalizeLineType('premium_rate'), 'premium_rate');
});

test('ambiguous or missing provider answers stay unknown — never a guess', () => {
  assert.equal(normalizeLineType('fixed line or mobile'), 'unknown');
  assert.equal(normalizeLineType(''), 'unknown');
  assert.equal(normalizeLineType(null), 'unknown');
  assert.equal(normalizeLineType(3), 'unknown');
  assert.equal(normalizeLineType('pager'), 'unknown');
});

// Shape from the Telnyx identity docs quickstart.
const telnyxDocExample = {
  data: {
    carrier: { error_code: null, mobile_country_code: 'US', mobile_network_code: 866, name: 'Telnyx/4', type: 'voip' },
    country_code: 'US',
    phone_number: '+13129457420',
    portability: {
      line_type: 'voip',
      ported_date: '2017-10-20',
      ported_status: 'Y',
      spid_carrier_name: 'Telnyx/4',
    },
    record_type: 'number_lookup',
  },
};

test('parses the documented Telnyx response', () => {
  assert.deepEqual(parseTelnyxLookup(telnyxDocExample), {
    lineType: 'voip',
    carrier: 'Telnyx/4',
    ported: true,
  });
});

test('portability (current carrier) wins over the carrier block (original holder)', () => {
  // A landline ported to a VoIP provider: the case this feature exists for.
  const r = parseTelnyxLookup({
    data: {
      carrier: { name: 'Verizon', type: 'fixed line' },
      portability: { line_type: 'voip', ported_status: 'Y', spid_carrier_name: 'Bandwidth' },
    },
  });
  assert.equal(r?.lineType, 'voip');
  assert.equal(r?.carrier, 'Bandwidth');
});

test('falls back to carrier.type when portability is absent', () => {
  const r = parseTelnyxLookup({ data: { carrier: { name: 'T-Mobile', type: 'mobile' }, portability: null } });
  assert.deepEqual(r, { lineType: 'mobile', carrier: 'T-Mobile', ported: null });
});

test('unparseable bodies return null rather than a fabricated answer', () => {
  assert.equal(parseTelnyxLookup(null), null);
  assert.equal(parseTelnyxLookup({}), null);
  assert.equal(parseTelnyxLookup({ errors: [{ code: '10007' }] }), null);
  assert.equal(parseTelnyxLookup({ data: {} })?.lineType, 'unknown');
  assert.equal(parseTelnyxLookup({ data: { portability: { ported_status: 'N' } } })?.ported, false);
});
