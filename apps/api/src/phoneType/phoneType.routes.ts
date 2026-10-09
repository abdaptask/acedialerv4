// GET /phone-type?number=+17325551234 — verified line type for the dialer badge.
//
// The client already shows a free numbering-plan inference instantly; this
// endpoint only ever UPGRADES that to a carrier-verified answer. So every
// failure mode here — no provider, DB down, provider timeout, budget spent —
// returns 200 `unavailable` and the client keeps what it had. Nothing in the
// dial path waits on this route.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { config } from '../config.js';
import { lookupEligibility, type LineType, type LookupResult } from './classify.js';
import { activeProvider } from './providers.js';

type PhoneTypeResponse =
  | {
      status: 'verified';
      lineType: LineType;
      carrier: string | null;
      ported: boolean | null;
      checkedAt: string;
      cached: boolean;
    }
  | { status: 'invalid' }
  | { status: 'unavailable'; reason: string };

/** Under the client's patience: the badge should settle while the call is
 *  still ringing, and a hung provider must not pin a Fastify handler. */
const PROVIDER_TIMEOUT_MS = 4000;

// Concurrent requests for one number (two tabs, a re-render) share one paid
// lookup.
const inflight = new Map<string, Promise<PhoneTypeResponse>>();

// Per-process daily spend guard. Approximate across pm2 replicas by design —
// it's a runaway brake, not an accounting system.
let budgetDay = '';
let budgetUsed = 0;
function takeBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    budgetUsed = 0;
  }
  if (budgetUsed >= config.phoneLookupDailyLimit) return false;
  budgetUsed++;
  return true;
}

/** Numbers in logs are trimmed to the last four — enough to correlate a
 *  report, not enough to reconstruct who someone was calling. */
const tail = (e164: string) => `…${e164.slice(-4)}`;

function verified(r: LookupResult, checkedAt: Date, cached: boolean): PhoneTypeResponse {
  return {
    status: 'verified',
    lineType: r.lineType,
    carrier: r.carrier,
    ported: r.ported,
    checkedAt: checkedAt.toISOString(),
    cached,
  };
}

async function resolve(app: FastifyInstance, e164: string): Promise<PhoneTypeResponse> {
  const provider = activeProvider();
  if (!provider) return { status: 'unavailable', reason: 'not_configured' };

  const ttlMs = config.phoneLookupTtlDays * 24 * 60 * 60 * 1000;
  try {
    const row = await prisma.phoneTypeLookup.findUnique({ where: { e164 } });
    if (row && Date.now() - row.checkedAt.getTime() < ttlMs) {
      return verified(
        { lineType: row.lineType as LineType, carrier: row.carrierName, ported: row.ported },
        row.checkedAt,
        true,
      );
    }
  } catch (err) {
    // A cache read failure costs a lookup, never the answer.
    app.log.warn({ err, number: tail(e164) }, '[phone-type] cache read failed');
  }

  if (!takeBudget()) {
    app.log.warn({ limit: config.phoneLookupDailyLimit }, '[phone-type] daily lookup limit reached');
    return { status: 'unavailable', reason: 'limit_reached' };
  }

  let outcome;
  try {
    outcome = await provider.lookup(e164, AbortSignal.timeout(PROVIDER_TIMEOUT_MS));
  } catch (err) {
    app.log.warn({ err, number: tail(e164), provider: provider.name }, '[phone-type] provider threw');
    return { status: 'unavailable', reason: 'provider_error' };
  }
  if (!outcome.ok) {
    app.log.warn({ error: outcome.error, number: tail(e164), provider: provider.name }, '[phone-type] lookup failed');
    return { status: 'unavailable', reason: 'provider_error' };
  }

  const now = new Date();
  const r = outcome.result;
  try {
    await prisma.phoneTypeLookup.upsert({
      where: { e164 },
      create: { e164, lineType: r.lineType, carrierName: r.carrier, ported: r.ported, provider: provider.name, checkedAt: now },
      update: { lineType: r.lineType, carrierName: r.carrier, ported: r.ported, provider: provider.name, checkedAt: now },
    });
  } catch (err) {
    app.log.warn({ err, number: tail(e164) }, '[phone-type] cache write failed');
  }
  return verified(r, now, false);
}

export async function phoneTypeRoutes(app: FastifyInstance) {
  app.get(
    '/phone-type',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest): Promise<PhoneTypeResponse> => {
      const { number } = request.query as { number?: string };
      const e164 = String(number ?? '').trim();

      const eligibility = lookupEligibility(e164);
      if (eligibility === 'invalid') return { status: 'invalid' };
      if (eligibility !== 'ok') return { status: 'unavailable', reason: eligibility };

      let p = inflight.get(e164);
      if (!p) {
        p = resolve(app, e164).finally(() => inflight.delete(e164));
        inflight.set(e164, p);
      }
      return p;
    },
  );
}
