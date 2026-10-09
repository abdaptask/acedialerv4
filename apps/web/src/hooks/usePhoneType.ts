// usePhoneType(raw) — the dialer's Mobile / Landline / VoIP / … badge state.
//
// Inference is synchronous and free; the carrier lookup is a background
// upgrade. Callers render the result and must never branch the dial path on
// it — this hook has no way to delay a call and must not grow one.
import { useEffect, useMemo, useState } from 'react';
import { lookupPhoneTypeApi, type PhoneTypeApiResult } from '../api';
import {
  describePhoneType,
  inferPhoneType,
  refineWithFullMetadata,
  shouldLookUp,
  type Inference,
  type LookupState,
  type PhoneTypeDisplay,
} from '../lib/phoneType';

/** Settle time before a PAID lookup. Inference is instant, but a number that
 *  is valid for a moment mid-edit shouldn't cost a carrier dip. */
const LOOKUP_DEBOUNCE_MS = 350;
/** The server's DB cache is authoritative; this only saves round trips
 *  between the Dialpad and the in-call screen and across re-renders. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
/** When the server says lookups aren't configured, stop asking for a while
 *  rather than once per number. */
const NOT_CONFIGURED_BACKOFF_MS = 10 * 60 * 1000;

const cache = new Map<string, { state: LookupState; expiresAt: number }>();
const inflight = new Map<string, Promise<LookupState>>();
let lookupsDisabledUntil = 0;

function toLookupState(r: PhoneTypeApiResult): LookupState {
  if (r.status === 'verified') {
    return {
      status: 'verified',
      result: { lineType: r.lineType, carrier: r.carrier, ported: r.ported, checkedAt: r.checkedAt },
    };
  }
  return { status: 'unavailable', reason: r.status === 'invalid' ? 'invalid' : r.reason };
}

function fetchLookup(e164: string): Promise<LookupState> {
  let p = inflight.get(e164);
  if (p) return p;
  const token = sessionStorage.getItem('ace_token');
  if (!token) return Promise.resolve({ status: 'unavailable', reason: 'signed_out' });
  // Not aborted on unmount: the Dialpad starts a lookup and the in-call screen
  // mounts a moment later wanting the same answer — it joins this promise.
  p = lookupPhoneTypeApi(token, e164)
    .then(toLookupState)
    .then((state) => {
      if (state.status === 'unavailable' && state.reason === 'not_configured') {
        lookupsDisabledUntil = Date.now() + NOT_CONFIGURED_BACKOFF_MS;
      }
      cache.set(e164, {
        state,
        expiresAt: Date.now() + (state.status === 'verified' ? VERIFIED_TTL_MS : FAILURE_TTL_MS),
      });
      return state;
    })
    .finally(() => inflight.delete(e164));
  inflight.set(e164, p);
  return p;
}

export function usePhoneType(raw: string | null | undefined): PhoneTypeDisplay {
  const base = useMemo(() => inferPhoneType(raw), [raw]);
  const e164 = base.kind === 'inferred' ? base.e164 : '';

  // Fuller-metadata refinement for international numbers the bundled
  // metadata can't type. Keyed by e164 so a stale result never paints over
  // a different number.
  const [refined, setRefined] = useState<{ e164: string; inf: Inference } | null>(null);
  useEffect(() => {
    if (base.kind !== 'inferred' || !base.typeMissing) return;
    let cancelled = false;
    void refineWithFullMetadata(base.e164).then((inf) => {
      if (!cancelled) setRefined({ e164: base.e164, inf });
    });
    return () => {
      cancelled = true;
    };
  }, [base]);
  const inference = refined && refined.e164 === e164 ? refined.inf : base;

  const [lookup, setLookup] = useState<{ e164: string; state: LookupState } | null>(null);
  const wantsLookup = shouldLookUp(base);
  useEffect(() => {
    if (!wantsLookup || !e164) return;
    if (Date.now() < lookupsDisabledUntil) {
      setLookup({ e164, state: { status: 'unavailable', reason: 'not_configured' } });
      return;
    }
    const hit = cache.get(e164);
    if (hit && hit.expiresAt > Date.now()) {
      setLookup({ e164, state: hit.state });
      return;
    }
    let cancelled = false;
    setLookup({ e164, state: { status: 'loading' } });
    const settle = (state: LookupState) => {
      if (!cancelled) setLookup({ e164, state });
    };
    // Already in flight (e.g. started on the Dialpad) → join without waiting
    // out the debounce again.
    const pending = inflight.get(e164);
    if (pending) {
      void pending.then(settle);
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => void fetchLookup(e164).then(settle), LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [e164, wantsLookup]);

  const lookupState: LookupState =
    lookup && lookup.e164 === e164 ? lookup.state : wantsLookup ? { status: 'loading' } : { status: 'idle' };

  return describePhoneType(inference, lookupState);
}
