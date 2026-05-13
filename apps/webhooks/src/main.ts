// ACE Dialer Webhooks — Telnyx inbound webhook receiver.
// Phase 0: stub routes that log and return 200. Phase 2 adds signature
// verification, idempotency, and queue dispatch to background workers.
import Fastify from 'fastify';
import cors from '@fastify/cors';

const SERVICE_NAME = 'ace-dialer-webhooks';
const START_TIME = new Date().toISOString();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

await app.register(cors, { origin: false }); // webhooks aren't browser-callable

app.get('/', async () => ({ service: SERVICE_NAME, status: 'ok' }));
app.get('/health', async () => ({
  status: 'ok',
  service: SERVICE_NAME,
  uptimeSeconds: Math.floor(process.uptime()),
  startedAt: START_TIME,
  timestamp: new Date().toISOString(),
}));

// ----- Telnyx webhooks (stubs) -----
app.post('/webhooks/telnyx/calls', async (request) => {
  app.log.info({ payload: request.body }, '[telnyx] call event');
  return { received: true };
});

app.post('/webhooks/telnyx/sms', async (request) => {
  app.log.info({ payload: request.body }, '[telnyx] sms event');
  return { received: true };
});

app.post('/webhooks/telnyx/failover', async (request) => {
  app.log.info({ payload: request.body }, '[telnyx] failover event');
  return { received: true };
});

const port = Number(process.env.PORT ?? 3002);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info({ port, host }, `[${SERVICE_NAME}] listening`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, `[${SERVICE_NAME}] shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
