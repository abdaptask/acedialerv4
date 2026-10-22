// The browser extension's dialer panel (apps/extension panel.html).
//
//   GET /me/panel/recents   → recent calls: who, direction, outcome, when, talk time
//   GET /me/panel/threads   → text conversations: who, who sent last, when, unread
//   GET /me/panel/contacts  → the caller's saved contacts and their numbers
//
// Self-only with no userId parameter, so an extension token gets no admin
// surface. Separate routes rather than allowlisting /calls and
// /messages/threads: those return message bodies, media and recording URLs,
// which the extension must never hold (CLAUDE.md §2.4, §4.4). panelView.ts
// builds every response field by field.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { dedupeCallLegs } from '../calls/calls.routes.js';
import { nameBook, toPanelContacts, toPanelRecent, toPanelThread } from './panelView.js';

const RECENTS = 60;
const THREADS = 60;

const me = (request: FastifyRequest) => (request.user as { sub: number }).sub;

const favoritesOf = (userId: number) =>
  prisma.favorite.findMany({
    where: { userId },
    select: {
      phone: true,
      firstName: true,
      lastName: true,
      label: true,
      numbers: { select: { phone: true, label: true, sortOrder: true } },
    },
    take: 2000,
  });

export async function panelRoutes(app: FastifyInstance) {
  app.get('/me/panel/recents', { onRequest: [app.authenticate] }, async (request) => {
    const userId = me(request);
    // Same infrastructure-leg filter as GET /calls: SIP URIs and credential
    // usernames are the server bridging to a softphone, not calls anyone made.
    const sipUsernames = (
      await prisma.user.findMany({ where: { sipUsername: { not: null } }, select: { sipUsername: true } })
    )
      .map((u) => u.sipUsername)
      .filter((s): s is string => !!s);
    const [calls, favorites] = await Promise.all([
      prisma.call.findMany({
        where: {
          userId,
          AND: [
            { NOT: { toNumber: { startsWith: 'sip:' } } },
            { NOT: { fromNumber: { startsWith: 'sip:' } } },
            { NOT: { toNumber: '' } },
            { NOT: { fromNumber: '' } },
            ...(sipUsernames.length ? [{ NOT: { toNumber: { in: sipUsernames } } }] : []),
          ],
        },
        orderBy: { startedAt: 'desc' },
        // Two legs per call collapse to one in dedupe.
        take: RECENTS * 2,
        select: {
          sessionId: true,
          direction: true,
          fromNumber: true,
          toNumber: true,
          status: true,
          startedAt: true,
          answeredAt: true,
          endedAt: true,
          durationSeconds: true,
        },
      }),
      favoritesOf(userId),
    ]);
    const book = nameBook(favorites);
    return { items: dedupeCallLegs(calls).slice(0, RECENTS).map((c) => toPanelRecent(c, book)) };
  });

  app.get('/me/panel/threads', { onRequest: [app.authenticate] }, async (request) => {
    const userId = me(request);
    // Raw SQL for the same reason as GET /messages/threads: "latest row per
    // thread_key" is DISTINCT ON, which Prisma can't express. The column list
    // is deliberately body-free.
    const [latest, unreadRows, favorites] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ thread_key: string; direction: string; status: string; created_at: Date }>>(
        `SELECT * FROM (
           SELECT DISTINCT ON (m.thread_key) m.thread_key, m.direction, m.status, m.created_at
             FROM messages m
            WHERE m.user_id = $1
            ORDER BY m.thread_key, m.created_at DESC
         ) t ORDER BY t.created_at DESC LIMIT ${THREADS}`,
        userId,
      ),
      prisma.message.groupBy({
        by: ['threadKey'],
        where: { userId, direction: 'inbound', readAt: null },
        _count: { _all: true },
      }),
      favoritesOf(userId),
    ]);
    const unread = new Map(unreadRows.map((r) => [r.threadKey, r._count._all]));
    const book = nameBook(favorites);
    return {
      items: latest.map((t) =>
        toPanelThread(
          { threadKey: t.thread_key, direction: t.direction, status: t.status, createdAt: t.created_at },
          unread.get(t.thread_key) ?? 0,
          book,
        ),
      ),
    };
  });

  app.get('/me/panel/contacts', { onRequest: [app.authenticate] }, async (request) => {
    return { items: toPanelContacts(await favoritesOf(me(request))) };
  });
}
