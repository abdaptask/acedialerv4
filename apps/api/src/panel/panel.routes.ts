// The browser extension's dialer panel (apps/extension panel.html).
//
//   GET /me/panel/recents   → the dialer's Recents rows: who, label, when, length
//   GET /me/panel/threads   → text conversations: who, who sent last, when, unread
//   GET /me/panel/contacts  → the caller's favorites and their numbers
//   GET /me/panel/history?number= → every call, text and voicemail with one
//                             number in the last 30 days: who, when, outcome
//
// Self-only with no userId parameter, so an extension token gets no admin
// surface. Separate routes rather than allowlisting /calls and
// /messages/threads: those return message bodies, media and recording URLs,
// which the extension must never hold (CLAUDE.md §2.4, §4.4). panelView.ts
// builds every response field by field.
//
// Same rows as the dialer: Recents comes from loadRecents(), the function
// GET /calls returns, and favorites are read in GET /favorites order.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { dedupeCallLegs, loadRecents } from '../calls/calls.routes.js';
import { cachedJobDivaName } from '../jobdiva/jobdiva.routes.js';
import { last10, nameBook, toPanelContacts, toPanelHistory, toPanelRecent, toPanelThread } from './panelView.js';

/** Safety cap only; the dialer's own list has none and nobody comes close. */
const THREADS_CAP = 500;
const HISTORY_DAYS = 30;
/** Per source, before merging; the response keeps the newest 50. */
const HISTORY_ROWS = 200;

const me = (request: FastifyRequest) => (request.user as { sub: number }).sub;

const favoritesOf = (userId: number) =>
  prisma.favorite.findMany({
    where: { userId },
    orderBy: { addedAt: 'desc' },
    select: {
      phone: true,
      firstName: true,
      lastName: true,
      label: true,
      numbers: {
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        select: { phone: true, label: true },
      },
    },
  });

/** GET /favorites returns newest first and the dialer inserts into its cache
 *  in that order, later rows overwriting, so a number saved twice resolves to
 *  the OLDEST favorite. Same order in, same answer out. */
const bookFor = (favorites: Awaited<ReturnType<typeof favoritesOf>>) => nameBook(favorites);

export async function panelRoutes(app: FastifyInstance) {
  app.get('/me/panel/recents', { onRequest: [app.authenticate] }, async (request) => {
    const userId = me(request);
    const [calls, favorites] = await Promise.all([loadRecents(userId), favoritesOf(userId)]);
    const book = bookFor(favorites);
    return { items: calls.map((c) => toPanelRecent(c, book, cachedJobDivaName)) };
  });

  app.get('/me/panel/threads', { onRequest: [app.authenticate] }, async (request) => {
    const userId = me(request);
    // Raw SQL for the same reason as GET /messages/threads: "latest row per
    // thread_key" is DISTINCT ON, which Prisma can't express. The column list
    // is deliberately body-free. Ties (a bulk send stamps many threads with
    // the same instant) break by thread_key, the order the dialer's stable
    // sort leaves them in.
    const [latest, unreadRows, favorites] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ thread_key: string; direction: string; status: string; created_at: Date }>>(
        `SELECT * FROM (
           SELECT DISTINCT ON (m.thread_key) m.thread_key, m.direction, m.status, m.created_at
             FROM messages m
            WHERE m.user_id = $1
            ORDER BY m.thread_key, m.created_at DESC
         ) t ORDER BY t.created_at DESC, t.thread_key ASC LIMIT ${THREADS_CAP}`,
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
    const book = bookFor(favorites);
    return {
      items: latest.map((t) =>
        toPanelThread(
          { threadKey: t.thread_key, direction: t.direction, status: t.status, createdAt: t.created_at },
          unread.get(t.thread_key) ?? 0,
          book,
          cachedJobDivaName,
        ),
      ),
    };
  });

  app.get('/me/panel/contacts', { onRequest: [app.authenticate] }, async (request) => {
    return { items: toPanelContacts(await favoritesOf(me(request))) };
  });

  app.get<{ Querystring: { number?: string } }>('/me/panel/history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = me(request);
    const key = last10(request.query.number);
    if (key.length < 10) return reply.code(400).send({ error: 'That number is too short.' });
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    // Numbers are stored E.164, so the last 10 digits are a suffix match;
    // body-free selects, same as the threads query above.
    const [calls, texts, voicemails, favorites] = await Promise.all([
      prisma.call.findMany({
        where: {
          userId,
          startedAt: { gte: since },
          OR: [
            { direction: 'inbound', fromNumber: { endsWith: key } },
            { direction: 'outbound', toNumber: { endsWith: key } },
          ],
        },
        orderBy: { startedAt: 'desc' },
        take: HISTORY_ROWS,
        select: {
          sessionId: true, direction: true, fromNumber: true, toNumber: true, status: true,
          hangupCause: true, startedAt: true, durationSeconds: true,
        },
      }),
      prisma.message.findMany({
        where: { userId, threadKey: { endsWith: key }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_ROWS,
        select: { direction: true, status: true, createdAt: true },
      }),
      prisma.voicemail.findMany({
        where: { userId, fromNumber: { endsWith: key }, receivedAt: { gte: since } },
        orderBy: { receivedAt: 'desc' },
        take: HISTORY_ROWS,
        select: { receivedAt: true, durationSeconds: true },
      }),
      favoritesOf(userId),
    ]);
    return toPanelHistory(
      request.query.number ?? key,
      HISTORY_DAYS,
      { calls: dedupeCallLegs(calls), texts, voicemails },
      bookFor(favorites),
      cachedJobDivaName,
    );
  });
}
