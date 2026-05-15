// Call history endpoints. Phase 5.1 — client-side logging.
// The web app reports call lifecycle here (start / end) because Telnyx
// Call Control webhooks don't fire for SDK-originated WebRTC calls.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

interface CreateCallBody {
  telnyxCallId: string;
  direction?: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  status?: string;
  startedAt?: string;
}

interface UpdateCallBody {
  status?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  hangupCause?: string | null;
}

export async function callsRoutes(app: FastifyInstance) {
  app.get('/calls', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const user = request.user as JwtPayload;
    const calls = await prisma.call.findMany({
      where: { userId: user.sub },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return calls;
  });

  app.get('/calls/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const call = await prisma.call.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!call) return reply.code(404).send({ error: 'Not found' });
    return call;
  });

  app.post('/calls', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = request.body as CreateCallBody;

    if (!body?.telnyxCallId || !body?.fromNumber || !body?.toNumber) {
      return reply
        .code(400)
        .send({ error: 'telnyxCallId, fromNumber, and toNumber are required' });
    }

    const direction = body.direction === 'inbound' ? 'inbound' : 'outbound';
    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const status = body.status ?? 'initiated';

    const call = await prisma.call.upsert({
      where: { telnyxCallId: body.telnyxCallId },
      update: { status },
      create: {
        userId: user.sub,
        telnyxCallId: body.telnyxCallId,
        direction,
        fromNumber: body.fromNumber,
        toNumber: body.toNumber,
        status,
        startedAt,
      },
    });

    return call;
  });

  app.patch('/calls/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const body = (request.body as UpdateCallBody) ?? {};

    const where = /^\d+$/.test(id)
      ? { id: Number(id), userId: user.sub }
      : { telnyxCallId: id, userId: user.sub };

    const existing = await prisma.call.findFirst({ where });
    if (!existing) return reply.code(404).send({ error: 'Not found' });

    const data: Record<string, unknown> = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.answeredAt !== undefined)
      data.answeredAt = body.answeredAt ? new Date(body.answeredAt) : null;
    if (body.endedAt !== undefined)
      data.endedAt = body.endedAt ? new Date(body.endedAt) : null;
    if (body.durationSeconds !== undefined) data.durationSeconds = body.durationSeconds;
    if (body.hangupCause !== undefined) data.hangupCause = body.hangupCause;

    const call = await prisma.call.update({
      where: { id: existing.id },
      data,
    });

    return call;
  });
}
