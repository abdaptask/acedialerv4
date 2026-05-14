// Single Prisma client, shared across services.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

export type { User } from '@prisma/client';
