// vNEXT — Pulse REST API client for migration backfill.
//
// Replaces (without removing) the MySQL/ngrok path in pulseBackfill.ts.
// This module talks to Pulse's public REST API at
//   https://pulse.aptask.com/api/2.0/...
// using the same JWT auth the existing Pulse front-end uses.
//
// Hybrid auth model (per user request):
//   - SMS history is fetched with the SERVICE ACCOUNT JWT (set via env)
//     because the messages endpoint takes the target user as a query param.
//   - Call logs are fetched with a PER-USER JWT (obtained by logging in as
//     that user with their Pulse password at migrate time) because
//     getCallLogs is scoped to the JWT's own user_id and has no override.
//
// Both functions return [] silently when env vars / inputs are missing,
// matching the safe-to-deploy-dormant convention used elsewhere.
//
// Env vars:
//   PULSE_API_BASE_URL  — e.g. "https://pulse.aptask.com/api/2.0"
//                         (no trailing slash). When unset, all functions
//                         no-op.
//   PULSE_SVC_EMAIL     — service-account email for SMS fetches
//   PULSE_SVC_PASSWORD  — service-account password
//
// Pulse's JWT scheme is `Authorization: JWT <token>` — NOT `Bearer`.
// (Verified in pulse-master/Server/api/middleware/auth.js — passportJWT
//  ExtractJwt.fromAuthHeaderWithScheme('JWT').)

import { request } from 'node:https';
import { URL } from 'node:url';

// ─── Response types ─────────────────────────────────────────────────────

export interface PulseRestCallRow {
  id: number;
  sid: string | null;
  // Pulse production returns "incoming" / "outgoing" (not "inbound"/"outbound").
  // Verified live for user_id=55 on 2026-05-29.
  direction: string | null;
  // Pulse stores phone numbers as raw integers (no leading +, e.g. 17327344818).
  // Accept number | string and normalize in the caller.
  from: string | number | null;
  to: string | number | null;
  status: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string | null;
  chat_user_id: number | null;
  first_name: string | null;
  last_name: string | null;
  recording_url_conferrence?: string | null;
  recording_conferrence_duration?: number | null;
}

export interface PulseRestMessageRow {
  // Mongo-shaped — Pulse stores conversations in MongoDB. Each conversation
  // doc has a chatMessages array. We flatten into individual messages here.
  conv_id: string;
  who: number | string;                // sender user_id (Pulse user) or chat_user id
  toWhomName: string | null;
  message: string;
  messageType: string;                 // 'sms' | 'chat' | 'audio' | etc.
  media: string | null;
  status: string | null;
  created_at: string;
  // The other party's phone number (from the conversation's candidate /
  // chat_user). Pulse front-end resolves this server-side; we extract from
  // the candidate or chat_user join on the conversation doc.
  candidatePhone: string | null;
  candidateFirstName: string | null;
  candidateLastName: string | null;
  candidate_id: number | null;         // chat_user.id
}

// ─── HTTP helper ────────────────────────────────────────────────────────

function getBaseUrl(): string | null {
  const raw = (process.env.PULSE_API_BASE_URL ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

interface PulseHttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function pulseGet<T = unknown>(
  path: string,
  jwt: string,
  timeoutMs = 20_000,
): Promise<PulseHttpResult<T>> {
  const base = getBaseUrl();
  if (!base) return { ok: false, status: 0, data: null, error: 'PULSE_API_BASE_URL unset' };
  const url = new URL(base + path);
  return new Promise((resolve) => {
    const req = request(
      {
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          Authorization: `JWT ${jwt}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          let parsed: unknown = null;
          try { parsed = JSON.parse(body); } catch { /* leave null */ }
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status, data: parsed as T });
          } else {
            resolve({ ok: false, status, data: null, error: body.slice(0, 500) });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, data: null, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Pulse GET ${path} timed out`));
    });
    req.end();
  });
}

async function pulsePost<T = unknown>(
  path: string,
  body: unknown,
  timeoutMs = 20_000,
): Promise<PulseHttpResult<T>> {
  const base = getBaseUrl();
  if (!base) return { ok: false, status: 0, data: null, error: 'PULSE_API_BASE_URL unset' };
  const url = new URL(base + path);
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  return new Promise((resolve) => {
    const req = request(
      {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          let parsed: unknown = null;
          try { parsed = JSON.parse(txt); } catch { /* leave null */ }
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status, data: parsed as T });
          } else {
            resolve({ ok: false, status, data: null, error: txt.slice(0, 500) });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: 0, data: null, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Pulse POST ${path} timed out`));
    });
    req.write(payload);
    req.end();
  });
}

// ─── Login ──────────────────────────────────────────────────────────────

/**
 * Log in to Pulse with email + password. Returns the JWT on success.
 *
 * Pulse's login lives at /api/2.0/login (publicRouter, mounted at root).
 * Body: { email, password }. The token field name varies between Pulse
 * versions ("token", "jwt", or nested in "data.token"); we try all.
 *
 * Returns null on any failure — caller should treat that as "skip Pulse".
 */
export async function loginToPulse(email: string, password: string): Promise<string | null> {
  if (!email || !password) return null;
  const res = await pulsePost<Record<string, unknown>>('/login', { email, password });
  if (!res.ok || !res.data) return null;
  // Pulse's response shape after userLogin success places the JWT at a few
  // possible keys depending on the responseHelper wrapper.
  const d = res.data as Record<string, unknown>;
  const candidates: unknown[] = [
    d.token,
    d.jwt,
    (d.data as Record<string, unknown> | undefined)?.token,
    (d.data as Record<string, unknown> | undefined)?.jwt,
    (d.data as Record<string, unknown> | undefined)?.access_token,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 20) return c;
  }
  return null;
}

// ─── JWT payload decode ──────────────────────────────────────────────────
//
// Pulse signs its own JWTs; we decode the payload only (no signature
// verify — we're trusting the token we just received from Pulse's own
// login response). The payload schema comes directly from
// pulse-master Server/services/userService.js userLogin().

export interface PulseJwtPayload {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  mobile_no?: string;
  voip_number?: string;
  caller_phone_number?: string;
  personal_email?: string;
  ext?: string;
  bot_id?: number;
  tenent_id?: number;
}

export function decodePulseJwt(jwt: string): PulseJwtPayload | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    // base64url decode the payload
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (typeof obj.id !== 'number' || typeof obj.email !== 'string') return null;
    return {
      id: obj.id,
      email: obj.email,
      first_name: typeof obj.first_name === 'string' ? obj.first_name : undefined,
      last_name: typeof obj.last_name === 'string' ? obj.last_name : undefined,
      mobile_no: typeof obj.mobile_no === 'string' ? obj.mobile_no : undefined,
      voip_number: typeof obj.voip_number === 'string' ? obj.voip_number : undefined,
      caller_phone_number: typeof obj.caller_phone_number === 'string'
        ? obj.caller_phone_number : undefined,
      personal_email: typeof obj.personal_email === 'string' ? obj.personal_email : undefined,
      ext: typeof obj.ext === 'string' ? obj.ext : undefined,
      bot_id: typeof obj.bot_id === 'number' ? obj.bot_id : undefined,
      tenent_id: typeof obj.tenent_id === 'number' ? obj.tenent_id : undefined,
    };
  } catch {
    return null;
  }
}

let cachedSvcJwt: { jwt: string; expiresAt: number } | null = null;

/**
 * Get a service-account JWT for fetching SMS via the messages endpoints.
 * Cached in-process for 30 min to avoid re-logging-in on each call.
 *
 * Returns null if PULSE_SVC_EMAIL / PULSE_SVC_PASSWORD aren't set.
 */
export async function getServiceJwt(): Promise<string | null> {
  const email = (process.env.PULSE_SVC_EMAIL ?? '').trim();
  const password = (process.env.PULSE_SVC_PASSWORD ?? '').trim();
  if (!email || !password) return null;
  if (cachedSvcJwt && cachedSvcJwt.expiresAt > Date.now()) {
    return cachedSvcJwt.jwt;
  }
  const jwt = await loginToPulse(email, password);
  if (!jwt) return null;
  // 30 minute cache. Pulse JWTs are valid longer but we want to refresh
  // periodically to stay resilient to mid-flight expiry.
  cachedSvcJwt = { jwt, expiresAt: Date.now() + 30 * 60_000 };
  return jwt;
}

// ─── Call logs ──────────────────────────────────────────────────────────

/**
 * Fetch the user's call history from Pulse, filtered to the last N days
 * client-side. Requires a JWT issued for the target user (Pulse's
 * /telnyx/getCallLogs is scoped to the JWT's own user_id).
 *
 * Returns [] on any failure.
 */
export async function getCallLogsAsUser(args: {
  userJwt: string;
  daysBack: number;
}): Promise<PulseRestCallRow[]> {
  if (!args.userJwt) return [];
  const res = await pulseGet<unknown>('/telnyx/getCallLogs', args.userJwt);
  if (!res.ok || !res.data) return [];
  // Response can be either:
  //   - { data: [...rows], totalLength } when ?status= is passed (we don't)
  //   - rows[] directly (the default branch in telnyxService.callLogs)
  //   - { data: rows[] } wrapped by responseHandler
  let rows: unknown[] = [];
  if (Array.isArray(res.data)) {
    rows = res.data;
  } else if (typeof res.data === 'object') {
    const d = res.data as Record<string, unknown>;
    if (Array.isArray(d.data)) rows = d.data as unknown[];
    else if (Array.isArray(d.rows)) rows = d.rows as unknown[];
  }

  const cutoff = Date.now() - args.daysBack * 86400_000;
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r): PulseRestCallRow => ({
      id: Number(r.id ?? 0),
      sid: typeof r.sid === 'string' ? r.sid : null,
      direction: typeof r.direction === 'string' ? r.direction : null,
      from: (typeof r.from === 'string' || typeof r.from === 'number') ? r.from : null,
      to: (typeof r.to === 'string' || typeof r.to === 'number') ? r.to : null,
      status: typeof r.status === 'string' ? r.status : null,
      duration: typeof r.duration === 'number' ? r.duration
        : (typeof r.duration === 'string' ? parseInt(r.duration, 10) || 0 : 0),
      createdAt: String(r.createdAt ?? r.created_at ?? ''),
      updatedAt: r.updatedAt == null ? null : String(r.updatedAt),
      chat_user_id: typeof r.chat_user_id === 'number' ? r.chat_user_id : null,
      first_name: typeof r.first_name === 'string' ? r.first_name : null,
      last_name: typeof r.last_name === 'string' ? r.last_name : null,
      recording_url_conferrence: typeof r.recording_url_conferrence === 'string'
        ? r.recording_url_conferrence : null,
      recording_conferrence_duration: typeof r.recording_conferrence_duration === 'number'
        ? r.recording_conferrence_duration : null,
    }))
    .filter((r) => {
      if (!r.createdAt) return false;
      const t = new Date(r.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
}

// ─── Messages ───────────────────────────────────────────────────────────
//
// NOTE (v0.10.36, verified live 2026-05-29 for user_id=55):
//   Pulse's REST API does NOT expose SMS message bodies in any route a
//   regular user JWT can reach. Specifically:
//     - /messages/getAllChatByUser?userID=N returns conversation envelopes
//       but with `dialog: []` hardcoded (see pulse-master Server/services/
//       messageService.js — the populate-loop is commented out).
//     - /messages/<conv_id> returns 401 Unauthorized in production even
//       for the conversation's owner (some additional gate we can't see in
//       the open-source code).
//   Result: REST is unusable for SMS backfill today. The MySQL path in
//   pulseBackfill.ts (with pulseUserIdOverride passed in) remains the
//   real source of truth for SMS history.
//   The function below is retained as a stub that always returns [] so
//   existing callers continue to compile; remove once we're sure we won't
//   come back to a REST approach.

export async function getMessagesForPulseUserId(_args: {
  pulseUserId: number;
  daysBack: number;
  svcJwt?: string | null;
}): Promise<PulseRestMessageRow[]> {
  // Pulse's REST messages endpoints do not return SMS bodies (see comment
  // above). Always return []. Real SMS backfill goes through the MySQL
  // path in pulseBackfill.ts with pulseUserIdOverride.
  return [];
}
