// AptLink Socket — real-time WebSocket service.
// Phase 0: just registers and accepts connections; emits ping/pong.
// Phase 1 onward: implement the 31 chatSocket events from Pulse.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';

const SERVICE_NAME = 'aptlink-socket';
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
    origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*' ? true : allowedOrigins,
    credentials: true,
  },
});

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = new Redis(redisUrl);
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  app.log.error('JWT_SECRET is not set');
  process.exit(1);
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: Missing token'));
  try {
    const decoded = jwt.verify(token, jwtSecret) as unknown as { sub: number };
    socket.data.userId = decoded.sub;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);
  app.log.info({ socketId: socket.id, userId }, '[socket] client connected');
  socket.emit('connected', { id: socket.id, ts: Date.now() });

  socket.on('ping', () => {
    socket.emit('pong', { ts: Date.now() });
  });

  socket.on('chat:typing_start', (data: { recipientId: number }) => {
    if (data?.recipientId) {
      socket.to(`user:${data.recipientId}`).emit('chat:typing_start', { senderId: userId });
    }
  });

  socket.on('chat:typing_stop', (data: { recipientId: number }) => {
    if (data?.recipientId) {
      socket.to(`user:${data.recipientId}`).emit('chat:typing_stop', { senderId: userId });
    }
  });

  socket.on('disconnect', (reason) => {
    app.log.info({ socketId: socket.id, userId, reason }, '[socket] client disconnected');
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
