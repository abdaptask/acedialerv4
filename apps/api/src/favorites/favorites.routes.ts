// Phase 6.11 — Favorites sync.
//
// Per-user list of starred contacts. Replaces the localStorage-only favorites
// store that lived in apps/web/src/lib/userPrefs.ts. Now persisted server-side
// so the same favorites appear in the browser, the Electron app, and across
// the user's machines.
//
// API surface:
//   GET    /favorites                 List current user's favorites
//   POST   /favorites                 Add (upsert) { phone, firstName?, lastName?, label? }
//   PATCH  /favorites/:id             Rename { firstName?, lastName?, label? }
//   DELETE /favorites/:id             Remove
//
// Phone numbers are stored E.164-normalized. The (userId, phone) unique
// constraint makes POST idempotent so the client can blindly upsert.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

function toE164(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  return `+${cleaned}`;
}

const AddSchema = z.object({
  phone: z.string().min(7).max(20),
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  label: z.string().max(160).nullable().optional(),
});

const PatchSchema = z.object({
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  label: z.string().max(160).nullable().optional(),
});

export async function favoritesRoutes(app: FastifyInstance) {
  app.get(
    '/favorites',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest) => {
      const u = request.user as JwtPayload;
      const rows = await prisma.favorite.findMany({
        where: { userId: u.sub },
        orderBy: { addedAt: 'desc' },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          label: true,
          addedAt: true,
        },
      });
      return { items: rows };
    },
  );

  app.post(
    '/favorites',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const u = request.user as JwtPayload;
      const parsed = AddSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const e164 = toE164(parsed.data.phone);
      const joined = [parsed.data.firstName, parsed.data.lastName]
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(' ');
      const label = parsed.data.label ?? (joined || null);
      const row = await prisma.favorite.upsert({
        where: { userId_phone: { userId: u.sub, phone: e164 } },
        update: {
          firstName: parsed.data.firstName ?? undefined,
          lastName: parsed.data.lastName ?? undefined,
          label: label ?? undefined,
        },
        create: {
          userId: u.sub,
          phone: e164,
          firstName: parsed.data.firstName ?? null,
          lastName: parsed.data.lastName ?? null,
          label,
        },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          label: true,
          addedAt: true,
        },
      });
      return row;
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/favorites/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const parsed = PatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      // Scoped to userId so a user can't rename someone else's favorite by id.
      const existing = await prisma.favorite.findFirst({
        where: { id, userId: u.sub },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      const joined = [parsed.data.firstName, parsed.data.lastName]
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(' ');
      const label =
        parsed.data.label !== undefined
          ? parsed.data.label
          : joined || null;
      const row = await prisma.favorite.update({
        where: { id },
        data: {
          firstName: parsed.data.firstName ?? undefined,
          lastName: parsed.data.lastName ?? undefined,
          label,
        },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          label: true,
          addedAt: true,
        },
      });
      return row;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/favorites/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const result = await prisma.favorite.deleteMany({
        where: { id, userId: u.sub },
      });
      if (result.count === 0) return reply.code(404).send({ error: 'Not found' });
      return { ok: true };
    },
  );
}
