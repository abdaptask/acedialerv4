// JobDiva V2 API client — Phase 5.5.
//
// Confirmed endpoints (api.jobdiva.com / V2):
//   GET  /apiv2/jobdiva/authenticate                           → bearer token
//   GET  /apiv2/jobdiva/quickCandidateProfileSearch?<filters>  → candidate rows
//
// Auth: query string with clientid, username, password.
// Token in subsequent calls as `Authorization: Bearer <token>`.
import { config } from '../config.js';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

function log(...args: unknown[]): void {
  // Use console so it shows in Render's plain log stream regardless of logger config.
  console.log('[jobdiva]', ...args);
}

async function authenticate(): Promise<string | null> {
  if (!config.jobDivaBaseUrl || !config.jobDivaUsername || !config.jobDivaPassword) {
    log('not configured — missing JOBDIVA_BASE_URL / USERNAME / PASSWORD');
    return null;
  }
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const base = config.jobDivaBaseUrl.replace(/\/+$/, '');
  // JobDiva V2 wants HTTP Basic Auth: username:password in the Authorization
  // header. clientid travels as a query-string param.
  const basic = Buffer.from(
    `${config.jobDivaUsername}:${config.jobDivaPassword}`,
    'utf-8',
  ).toString('base64');
  const url = `${base}/apiv2/jobdiva/authenticate?clientid=${encodeURIComponent(
    config.jobDivaClientId ?? '',
  )}`;
  log('auth: GET /apiv2/jobdiva/authenticate (basic auth)');

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Authorization: `Basic ${basic}`,
      },
    });
    const text = await res.text();
    log('auth: status', res.status, 'len', text.length);
    if (!res.ok) {
      log('auth: failed body=', text.slice(0, 300));
      return null;
    }
    let token: string | null = null;
    try {
      const json = JSON.parse(text);
      token =
        (json.token as string | undefined) ??
        (json.access_token as string | undefined) ??
        (json.bearer as string | undefined) ??
        null;
    } catch {
      token = text.replace(/^"|"$/g, '').trim() || null;
    }
    if (!token) {
      log('auth: no token in response body');
      return null;
    }
    log('auth: ok, token len=', token.length);
    tokenCache = { token, expiresAt: now + 12 * 60 * 60 * 1000 };
    return token;
  } catch (e) {
    log('auth: network error', e);
    return null;
  }
}

export interface JobDivaContact {
  name: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  type?: 'candidate' | 'contact';
}

function normalizePhone(raw: string): string {
  const d = (raw ?? '').replace(/[^\d]/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

export async function lookupContactByPhone(rawPhone: string): Promise<JobDivaContact | null> {
  const token = await authenticate();
  if (!token) return null;

  const phone10 = normalizePhone(rawPhone);
  if (phone10.length < 7) {
    log('lookup: phone too short:', rawPhone);
    return null;
  }

  const base = config.jobDivaBaseUrl.replace(/\/+$/, '');
  const auth = `Bearer ${token}`;

  // quickCandidateProfileSearch supports many filters. We try a few common
  // phone-style params since JobDiva docs name them differently:
  //   phone, cellPhone, homePhone, workPhone, searchText
  const filters: Array<Record<string, string>> = [
    { phone: phone10 },
    { cellPhone: phone10 },
    { homePhone: phone10 },
    { workPhone: phone10 },
    { searchText: phone10 },
    // Also try the +1-prefixed form
    { phone: `+1${phone10}` },
    { searchText: `+1${phone10}` },
  ];

  for (const filter of filters) {
    const qs = new URLSearchParams(filter).toString();
    const url = `${base}/apiv2/jobdiva/quickCandidateProfileSearch?${qs}`;
    log('lookup: GET', url);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (res.status === 401) {
        log('lookup: 401 — token expired, clearing cache');
        tokenCache = null;
        return null;
      }
      const text = await res.text();
      log('lookup: status', res.status, 'len', text.length);
      if (!res.ok) {
        log('lookup: body sample', text.slice(0, 200));
        continue;
      }
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      const match = pickFirstMatch(json, phone10);
      if (match) {
        log('lookup: match found', match.name);
        return match;
      }
      log('lookup: no rows in response (sample)', JSON.stringify(json).slice(0, 300));
    } catch (e) {
      log('lookup: network error', e);
    }
  }

  log('lookup: no match across all filter attempts');
  return null;
}

function pickFirstMatch(payload: unknown, phone10: string): JobDivaContact | null {
  const rows = flattenRows(payload);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const candidatePhones = [
      r.phone, r.phoneNumber, r.phone_home, r.phone_work, r.phone_cell,
      r.mobilePhone, r.cellPhone, r.workPhone, r.homePhone,
      r.primaryPhone, r.secondaryPhone, r.otherPhone,
    ]
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      .map((v) => normalizePhone(String(v)));

    // If phone fields exist, require match; otherwise accept first row (some
    // tenants return results without exposing the phone field).
    if (candidatePhones.length > 0 && !candidatePhones.includes(phone10)) continue;

    const first = (r.firstName ?? r.first_name ?? r.givenName ?? r.firstname) as string | undefined;
    const last = (r.lastName ?? r.last_name ?? r.familyName ?? r.lastname) as string | undefined;
    const fullName =
      ((r.name ?? r.fullName ?? r.candidateName) as string | undefined) ??
      [first, last].filter(Boolean).join(' ');
    if (!fullName || !String(fullName).trim()) continue;

    return {
      name: String(fullName).trim(),
      firstName: first,
      lastName: last,
      company: (r.company ?? r.companyName ?? r.employer ?? r.currentEmployer) as string | undefined,
      jobTitle: (r.jobTitle ?? r.title ?? r.position ?? r.currentJobTitle) as string | undefined,
      email: (r.email ?? r.emailAddress ?? r.primaryEmail) as string | undefined,
      type: 'candidate',
    };
  }
  return null;
}

function flattenRows(payload: unknown): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  const r = payload as Record<string, unknown>;
  for (const key of ['candidates', 'contacts', 'data', 'rows', 'results', 'items', 'list']) {
    if (Array.isArray(r[key])) return r[key] as unknown[];
  }
  return [payload];
}
