// Auth endpoints. Phase 1: login + me. Refresh tokens come in Phase 2.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@ace/db';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      // Identical message for missing user vs disabled user vs wrong password (don't leak which).
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    };
    const token = await reply.jwtSign(payload);

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: user.isAdmin,
      },
    });
  });

  // GET /auth/me — requires a valid JWT.
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const jwtUser = request.user as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: jwtUser.sub } });
    if (!user) return { error: 'User not found' };
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isAdmin: user.isAdmin,
    };
  });
}
