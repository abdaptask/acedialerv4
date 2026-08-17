// Multi-select send from the Favorites list.
//
//   POST   /me/sms-campaigns        enqueue one message to several favorites
//   GET    /me/sms-campaigns        recent sends (for a history list)
//   GET    /me/sms-campaigns/:id    per-recipient progress + delivery status
//   DELETE /me/sms-campaigns/:id    cancel whatever hasn't gone out yet
//
// ── Why this creates ScheduledMessage rows instead of sending ───────────
// The route does no Telnyx work at all. It validates the audience, writes one
// ScheduledMessage per recipient with scheduledFor=now, and returns. The
// existing worker drains them — which means a bulk send inherits per-recipient
// retry, the QA-029 double-send guard, rate-limit backoff, pacing, and the
// failure notification, rather than reimplementing five things that already
// work. Each recipient is an ordinary 1:1 text landing in its own thread; this
// is not a group conversation and replies come back normally.
//
// The trade-off is that "send now" means "starts sending now" — at the worker's
// 1 msg/s pacing a 60-person send completes over about a minute. That pacing is
// deliberate (see scheduledMessageWorker.ts) and the UI reports progress.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { MAX_SMS_BODY_CHARS } from './sendMessage.js';
import { recordAudit } from '../lib/audit.js';
import { last10 } from '../lib/phone.js';
import {
  MAX_CAMPAIGN_RECIPIENTS,
  isOverRecipientLimit,
  resolveAudience,
  type RequestedRecipient,
} from './smsCampaignAudience.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

interface CreateBody {
  /** The body as typed, placeholders intact. Stored for the audit trail. */
  templateBody?: string;
  /** Per-recipient, already placeholder-filled by the client. */
  recipients?: RequestedRecipient[];
}

export async function smsCampaignsRoutes(app: FastifyInstance) {
  // ── POST /me/sms-campaigns ──────────────────────────────────────────────
  app.post('/me/sms-campaigns', { onRequest: [app.authenticate] }, async (request, reply) => {
    const me = (request.user as JwtPayload).sub;
    const body = request.body as CreateBody;
    const requested = Array.isArray(body?.recipients) ? body.recipients : [];

    if (requested.length === 0) {
      return reply.code(400).send({ error: 'no_recipients', message: 'Pick at least one favorite.' });
    }
    // Checked against the REQUESTED count, before filtering, so an oversized
    // request is refused rather than quietly trimmed.
    if (isOverRecipientLimit(requested.length)) {
      return reply.code(400).send({
        error: 'too_many_recipients',
        message: `${requested.length} recipients; the limit is ${MAX_CAMPAIGN_RECIPIENTS} per send.`,
      });
    }

    const [ownedFavorites, blocked, user] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId: me },
        select: {
          id: true,
          phone: true,
          numbers: {
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
            select: { phone: true, label: true, isPrimary: true },
          },
        },
      }),
      prisma.blockedNumber.findMany({ where: { userId: me }, select: { number: true } }),
      prisma.user.findUnique({
        where: { id: me },
        select: {
          activeUserDidId: true,
          userDids: {
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: { id: true },
          },
        },
      }),
    ]);

    const { accepted, skipped } = resolveAudience({
      requested,
      ownedFavorites,
      blockedKeys: new Set(blocked.map((b) => last10(b.number)).filter((k) => k !== '')),
      maxBodyChars: MAX_SMS_BODY_CHARS,
    });

    if (accepted.length === 0) {
      // Every recipient was refused. Return the reasons — a 400 with no
      // explanation would read as "bulk send is broken".
      return reply.code(400).send({
        error: 'no_valid_recipients',
        message: 'None of the selected contacts could be messaged.',
        skipped,
      });
    }

    // Pin the DID now so a mid-send active-DID switch can't split one send
    // across two numbers — recipients would see a stranger's number.
    const userDidId = user?.activeUserDidId ?? user?.userDids[0]?.id ?? null;
    if (!userDidId) {
      return reply.code(400).send({
        error: 'no_did_assigned',
        message:
          'You have no phone number (DID) assigned. Ask an admin to assign one before sending SMS.',
      });
    }

    const firesAt = new Date();
    const campaign = await prisma.$transaction(async (tx) => {
      const c = await tx.smsCampaign.create({
        data: {
          userId: me,
          templateBody: body.templateBody ?? '',
          status: 'queued',
          totalCount: accepted.length,
          skipped: skipped.length > 0 ? (skipped as unknown as object) : undefined,
        },
      });
      await tx.scheduledMessage.createMany({
        data: accepted.map((r) => ({
          userId: me,
          toNumber: r.phone,
          body: r.body,
          mediaUrls: [],
          scheduledFor: firesAt,
          userDidId,
          campaignId: c.id,
          favoriteId: r.favoriteId,
          status: 'pending',
        })),
      });
      return c;
    });

    // Content is never logged — count and outcome only, per §28.4.
    void recordAudit(me, 'sms.campaign.queued', null, {
      campaignId: campaign.id,
      accepted: accepted.length,
      skipped: skipped.length,
      bodyLength: (body.templateBody ?? '').length,
    });

    return reply.code(201).send({
      campaign: {
        id: campaign.id,
        status: campaign.status,
        totalCount: campaign.totalCount,
        createdAt: campaign.createdAt,
      },
      accepted: accepted.length,
      skipped,
    });
  });

  // ── GET /me/sms-campaigns ───────────────────────────────────────────────
  app.get('/me/sms-campaigns', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const me = (request.user as JwtPayload).sub;
    const rows = await prisma.smsCampaign.findMany({
      where: { userId: me },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        templateBody: true,
        status: true,
        totalCount: true,
        createdAt: true,
      },
    });
    return { campaigns: rows };
  });

  // ── GET /me/sms-campaigns/:id ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/me/sms-campaigns/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const me = (request.user as JwtPayload).sub;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Invalid id' });

      const campaign = await prisma.smsCampaign.findFirst({
        where: { id, userId: me },
        select: {
          id: true,
          templateBody: true,
          status: true,
          totalCount: true,
          skipped: true,
          createdAt: true,
        },
      });
      if (!campaign) return reply.code(404).send({ error: 'Not found' });

      const rows = await prisma.scheduledMessage.findMany({
        where: { campaignId: id, userId: me },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          toNumber: true,
          favoriteId: true,
          status: true,
          attempts: true,
          lastError: true,
          telnyxMessageId: true,
          sentAt: true,
        },
      });

      // OUR status ('pending' | 'sending' | 'sent' | 'failed') says whether we
      // handed it to Telnyx. The CARRIER outcome lives on the Message row,
      // written by the existing message.sent / message.finalized webhooks — so
      // "sent" and "delivered" are genuinely different things here and the UI
      // shows both.
      const telnyxIds = rows
        .map((r) => r.telnyxMessageId)
        .filter((v): v is string => typeof v === 'string');
      const delivery = telnyxIds.length
        ? await prisma.message.findMany({
            where: { userId: me, telnyxMessageId: { in: telnyxIds } },
            select: { telnyxMessageId: true, status: true, deliveredAt: true, errors: true },
          })
        : [];
      const byTelnyxId = new Map(delivery.map((m) => [m.telnyxMessageId, m]));

      // Favorite names for the progress list, resolved in one query.
      const favIds = [...new Set(rows.map((r) => r.favoriteId).filter((v): v is number => v !== null))];
      const favs = favIds.length
        ? await prisma.favorite.findMany({
            where: { id: { in: favIds }, userId: me },
            select: { id: true, firstName: true, lastName: true, label: true },
          })
        : [];
      const byFavId = new Map(favs.map((f) => [f.id, f]));

      const recipients = rows.map((r) => {
        const msg = r.telnyxMessageId ? byTelnyxId.get(r.telnyxMessageId) : undefined;
        const fav = r.favoriteId !== null ? byFavId.get(r.favoriteId) : undefined;
        return {
          id: r.id,
          toNumber: r.toNumber,
          name:
            [fav?.firstName, fav?.lastName].filter(Boolean).join(' ') || fav?.label || null,
          status: r.status,
          attempts: r.attempts,
          lastError: r.lastError,
          sentAt: r.sentAt,
          carrierStatus: msg?.status ?? null,
          deliveredAt: msg?.deliveredAt ?? null,
          carrierErrors: msg?.errors ?? null,
        };
      });

      return {
        campaign,
        counts: {
          total: recipients.length,
          pending: recipients.filter((r) => r.status === 'pending' || r.status === 'sending').length,
          sent: recipients.filter((r) => r.status === 'sent').length,
          delivered: recipients.filter((r) => r.carrierStatus === 'delivered').length,
          failed: recipients.filter((r) => r.status === 'failed' || r.carrierStatus === 'failed')
            .length,
          canceled: recipients.filter((r) => r.status === 'canceled').length,
        },
        recipients,
      };
    },
  );

  // ── DELETE /me/sms-campaigns/:id ────────────────────────────────────────
  // Cancel whatever hasn't left yet. Rows already claimed by the worker
  // ('sending') or handed to Telnyx ('sent') are untouchable — we can't unsend.
  app.delete<{ Params: { id: string } }>(
    '/me/sms-campaigns/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const me = (request.user as JwtPayload).sub;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Invalid id' });

      const campaign = await prisma.smsCampaign.findFirst({
        where: { id, userId: me },
        select: { id: true },
      });
      if (!campaign) return reply.code(404).send({ error: 'Not found' });

      const canceled = await prisma.scheduledMessage.updateMany({
        where: { campaignId: id, userId: me, status: 'pending' },
        data: { status: 'canceled' },
      });
      await prisma.smsCampaign.update({ where: { id }, data: { status: 'canceled' } });

      void recordAudit(me, 'sms.campaign.canceled', null, {
        campaignId: id,
        canceledCount: canceled.count,
      });

      return { ok: true, canceled: canceled.count };
    },
  );
}
