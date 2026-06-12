#!/usr/bin/env node
// v0.10.141 - QA-001: Socket service JWT auth + CORS lockdown.
//
// CURRENT STATE: apps/socket is in Phase 0 (ping/pong only). Zero
// authentication, CORS open to '*' by default. Anyone can connect.
// The web client has zero `io()` calls today, so locking down now
// is risk-free - no existing consumers to break. Future v0.11.0
// Presence + DND work will be authenticated by default.
//
// CHANGES:
//   1. Add JWT verification middleware via Socket.IO `io.use()`.
//      Uses `jsonwebtoken` (already a dep of apps/socket).
//      Requires JWT_SECRET env var matching apps/api's JWT_SECRET.
//      Rejects connections without `auth.token` or with invalid/expired tokens.
//
//   2. Replace CORS `origin: true` fallback (current behavior when
//      ALLOWED_ORIGINS='*' or unset) with strict allowlist. New env
//      var `SOCKET_CORS_ORIGINS` is the canonical name; ALLOWED_ORIGINS
//      kept as a fallback for the transitional deploy. If NEITHER is
//      set, service refuses to start (fail-closed, not silently insecure).
//
//   3. Same lockdown applied to the Fastify HTTP CORS (for the /health
//      and / endpoints) since the HTTP service shares the same origin
//      list.
//
//   4. Service refuses to start without JWT_SECRET set. Logs a clear
//      error message at startup explaining what's missing.
//
// ENV VARS REQUIRED ON RENDER for ace-dialer-socket service:
//   - JWT_SECRET: copy the value from ace-dialer-api's env vars (the
//     two services must agree on the signing key).
//   - SOCKET_CORS_ORIGINS: comma-separated allowlist of origins, e.g.
//     "https://dialer.ap-task.com,https://localhost:5173".
//     Alternative: keep using the existing ALLOWED_ORIGINS env var.
//
// VERIFICATION AFTER DEPLOY:
//   Use curl to test the upgrade endpoint:
//     curl -i https://ace-dialer-socket.onrender.com/socket.io/?EIO=4&transport=polling
//   Should return 200 (HTTP upgrade is open). But attempting an actual
//   Socket.IO connection WITHOUT auth.token should fail with the
//   custom Error('auth_missing').

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v141] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v141] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');

  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v141] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v141] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// apps/socket/src/main.ts - full hardening
// ===========================================================
applyEdits('apps/socket/src/main.ts', [
  {
    label: 'QA-001 step 1: import jsonwebtoken (already in package.json deps)',
    find: `// ACE Dialer Socket — real-time WebSocket service.
// Phase 0: just registers and accepts connections; emits ping/pong.
// Phase 1 onward: implement the 31 chatSocket events from Pulse.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';`,
    replace: `// ACE Dialer Socket — real-time WebSocket service.
// Phase 0: just registers and accepts connections; emits ping/pong.
// Phase 1 onward: implement the 31 chatSocket events from Pulse.
//
// v0.10.141 — QA-001 hardening:
//   - JWT verification via Socket.IO io.use() middleware. Connections
//     without a valid auth.token are rejected immediately.
//   - CORS origins must be explicitly allowlisted via SOCKET_CORS_ORIGINS
//     (or legacy ALLOWED_ORIGINS) env var. No more '*' fallback.
//   - Service refuses to start if JWT_SECRET or origin allowlist is
//     missing (fail-closed, not silently insecure).
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';`,
  },
  {
    label: 'QA-001 step 2: enforce JWT_SECRET + lock CORS allowlist at startup',
    find: `const SERVICE_NAME = 'ace-dialer-socket';
const START_TIME = new Date().toISOString();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

await app.register(cors, {
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*' ? true : allowedOrigins,
  credentials: true,
});`,
    replace: `const SERVICE_NAME = 'ace-dialer-socket';
const START_TIME = new Date().toISOString();

// v0.10.141 - QA-001 - enforce JWT_SECRET at startup. Fail-closed if
// missing rather than running with no auth check.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[ace-dialer-socket] FATAL: JWT_SECRET env var is required. Refusing to start.');
  console.error('[ace-dialer-socket] Set JWT_SECRET on Render to the same value as ace-dialer-api.');
  process.exit(1);
}

// v0.10.141 - QA-001 - strict origin allowlist. Prefer SOCKET_CORS_ORIGINS
// for the new canonical name; fall back to ALLOWED_ORIGINS for the
// transitional deploy. Refuse to start if NEITHER is set (no more silent
// origin '*').
const corsEnv = (process.env.SOCKET_CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '').trim();
const allowedOrigins = corsEnv
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s !== '*');
if (allowedOrigins.length === 0) {
  console.error('[ace-dialer-socket] FATAL: no allowed CORS origins configured.');
  console.error('[ace-dialer-socket] Set SOCKET_CORS_ORIGINS (or legacy ALLOWED_ORIGINS) to a comma-separated origin list.');
  console.error('[ace-dialer-socket] Example: SOCKET_CORS_ORIGINS="https://dialer.ap-task.com,https://localhost:5173"');
  process.exit(1);
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

await app.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});`,
  },
  {
    label: 'QA-001 step 3: lock Socket.IO CORS to allowlist + add JWT auth middleware',
    find: `// Attach Socket.IO to the same HTTP server.
const io = new SocketIOServer(app.server, {
  cors: {
    origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*' ? true : allowedOrigins,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  app.log.info({ socketId: socket.id }, '[socket] client connected');
  socket.emit('connected', { id: socket.id, ts: Date.now() });

  socket.on('ping', () => {
    socket.emit('pong', { ts: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    app.log.info({ socketId: socket.id, reason }, '[socket] client disconnected');
  });
});`,
    replace: `// Attach Socket.IO to the same HTTP server.
const io = new SocketIOServer(app.server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// v0.10.141 - QA-001 - JWT verification middleware. Every connection
// must present a valid token in handshake.auth.token. Token must be
// signed by the same JWT_SECRET that ace-dialer-api uses. Payload is
// attached to socket.data.user so downstream events can use it for
// authorization (e.g. "is this user allowed to subscribe to room X?").
io.use((socket, next) => {
  // Token can be passed either via Socket.IO's auth object (preferred:
  // io(url, { auth: { token } })) or as a query param (fallback for
  // clients that can't set auth headers/options).
  const token =
    (socket.handshake.auth && (socket.handshake.auth as { token?: string }).token) ||
    (typeof socket.handshake.query.token === 'string' ? socket.handshake.query.token : undefined);
  if (!token) {
    return next(new Error('auth_missing'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: number;
      email?: string;
      isAdmin?: boolean;
      exp?: number;
    };
    // Stash on socket.data for downstream event handlers. Don't put the
    // raw token here - just the verified payload.
    (socket.data as { user?: typeof payload }).user = payload;
    return next();
  } catch {
    return next(new Error('auth_invalid'));
  }
});

io.on('connection', (socket) => {
  const user = (socket.data as { user?: { sub: number; email?: string } }).user;
  app.log.info(
    { socketId: socket.id, userId: user?.sub, email: user?.email },
    '[socket] authenticated client connected',
  );
  socket.emit('connected', { id: socket.id, ts: Date.now() });

  socket.on('ping', () => {
    socket.emit('pong', { ts: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    app.log.info({ socketId: socket.id, userId: user?.sub, reason }, '[socket] client disconnected');
  });
});`,
  },
]);

// ===========================================================
// Version bumps 0.10.140 → 0.10.141
// ===========================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.140"/, '"version": "0.10.141"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.140 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.140 → 0.10.141`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.141',
    find: `const APP_VERSION = '0.10.140';`,
    replace: `const APP_VERSION = '0.10.141';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.141 entry above v0.10.140',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.140',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.141',\n    date: 'June 12, 2026',\n    highlight: 'Backend security hardening — socket service now requires JWT authentication',\n    changes: [\n      { type: 'fixed', text: 'Security: the real-time socket service (ace-dialer-socket) used to accept any connection from any origin with no authentication. It now requires a valid JWT token on every connection and a strict CORS origin allowlist. This had no user-facing impact because the socket service is currently in Phase 0 (just ping/pong, no live events), but it had to be hardened before v0.11.0 ships Presence and Do Not Disturb features which broadcast user state over the socket.' },\n      { type: 'fixed', text: 'The socket service now refuses to start if JWT_SECRET or CORS origin allowlist is missing. Previously the service would silently fall back to accepting all origins with no auth. Required env vars on the Render service: JWT_SECRET (must match the value on ace-dialer-api) and SOCKET_CORS_ORIGINS (comma-separated allowlist).' },\n    ],\n  },\n  {\n    version: '0.10.140',`,
  },
]);

console.log('\n[apply-v141] ALL EDITS APPLIED SUCCESSFULLY');
console.log('');
console.log('CRITICAL DEPLOY STEP - env vars must be set on Render BEFORE this redeploys:');
console.log('  1. Open Render dashboard → ace-dialer-socket service → Environment');
console.log('  2. Add env var: JWT_SECRET = <same value as on ace-dialer-api>');
console.log('  3. Add env var: SOCKET_CORS_ORIGINS = "https://dialer.ap-task.com,https://localhost:5173"');
console.log('     (or whatever domain serves the web build; add more comma-separated as needed)');
console.log('  4. THEN commit + push, OR push first and trigger Manual Deploy after vars are set');
console.log('');
console.log('Without those env vars set, the service will FAIL TO START on first deploy.');
console.log('That is intentional (fail-closed). Set the vars first, then push.');
