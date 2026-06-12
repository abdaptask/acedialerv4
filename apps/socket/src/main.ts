// ACE Dialer Socket — real-time WebSocket service.
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
import jwt from 'jsonwebtoken';

const SERVICE_NAME = 'ace-dialer-socket';
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
});

app.get('/', async () => ({ service: SERVICE_NAME, status: 'ok' }));
app.get('/health', async () => ({
  status: 'ok',
  service: SERVICE_NAME,
  uptimeSeconds: Math.floor(process.uptime()),
  startedAt: START_TIME,
  timestamp: new Date().toISOString(),
}));

const port = Number(process.env.PORT ?? 3001);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info({ port, host }, `[${SERVICE_NAME}] http listening`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Attach Socket.IO to the same HTTP server.
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
    // v0.10.141 fix - cast via unknown because jwt.verify() returns
    // string | JwtPayload (where JwtPayload.sub is string | undefined).
    // Our tokens are minted with sub as a number, so this widening cast
    // is correct - just needs the explicit unknown step.
    const payload = jwt.verify(token, JWT_SECRET) as unknown as {
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
});

app.log.info(`[${SERVICE_NAME}] socket.io ready`);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, `[${SERVICE_NAME}] shutting down`);
  io.close();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
