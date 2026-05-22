// Phase 6.13 — Admin Users panel.
//
// Endpoints for the in-app Users management UI. All routes require an
// authenticated user with isAdmin=true. Every mutation writes an AuditLog
// entry so a separate admin can review what happened and when.
//
// API surface:
//   GET    /admin/users              List all users (sorted by createdAt desc)
//   POST   /admin/users              Invite a new user (creates DB row, awaits first SSO)
//   PATCH  /admin/users/:id          Promote / demote / activate / deactivate / edit
//   GET    /admin/audit-logs         Recent admin actions (paginated, default 100)
//   POST   /admin/users/bulk-import  Phase 5 — CSV bulk-import (#189)
//
// Safeguards (Phase 6.13 spec):
//   - Can't demote the LAST remaining active admin.
//   - Can't deactivate yourself (would brick the panel for you).
//   - Can't change your own admin flag — ask another admin.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';
import bcrypt from 'bcryptjs';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const u = request.user as JwtPayload | undefined;
  if (!u?.isAdmin) {
    return reply.code(403).send({ error: 'Admin access required' });
  }
}

function publicUser(u: {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  isActive: boolean;
  provider: string;
  sipUsername: string | null;
  didNumber: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    isAdmin: u.isAdmin,
    isActive: u.isActive,
    provider: u.provider,
    sipUsername: u.sipUsername,
    didNumber: u.didNumber,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

// Audit helper — best-effort. We never want an audit-log write to fail the
// admin action itself, so log + swallow.
async function recordAudit(
  actorUserId: number,
  action: string,
  targetUserId: number | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        targetUserId,
        // Prisma's JSON column accepts undefined (NULL) or a value, NOT a
        // bare null literal — that requires Prisma.JsonNull. Coerce.
        metadata: (metadata ?? undefined) as object | undefined,
      },
    });
  } catch (err) {
    console.warn('[audit] failed to write audit entry', { action, err });
  }
}

const InviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  sipUsername: z.string().max(120).nullable().optional(),
  sipPassword: z.string().max(200).nullable().optional(),
  didNumber: z.string().max(20).nullable().optional(),
  isAdmin: z.boolean().optional(),
  localPassword: z.string().min(8).max(200).nullable().optional(),
});

const UpdateSchema = z.object({
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  sipUsername: z.string().max(120).nullable().optional(),
  sipPassword: z.string().max(200).nullable().optional(),
  didNumber: z.string().max(20).nullable().optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  localPassword: z.string().min(8).max(200).nullable().optional(),
});

// Phase 5 (#189) — bulk import schema. Each row mirrors the CSV column set.
// Rows without sipPassword are accepted; user gets created but can't register
// against Telnyx until an admin fills the password in later (staged rollout).
const BulkRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(80).optional().nullable(),
  lastName: z.string().max(80).optional().nullable(),
  sipUsername: z.string().max(120).optional().nullable(),
  sipPassword: z.string().max(200).optional().nullable(),
  didNumber: z.string().max(20).optional().nullable(),
  isAdmin: z.boolean().optional().nullable(),
  phoneExtension: z.string().max(20).optional().nullable(),
});
const BulkImportSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  rows: z.array(BulkRowSchema).min(1).max(500),
});

export async function adminRoutes(app: FastifyInstance) {
  // ───────────────────────── GET /admin/users ─────────────────────────
  app.get(
    '/admin/users',
    { onRequest: [app.authenticate, requireAdmin] },
    async () => {
      const rows = await prisma.user.findMany({
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isAdmin: true,
          isActive: true,
          provider: true,
          sipUsername: true,
          didNumber: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      return { items: rows.map(publicUser) };
    },
  );

  // ───────────────────────── POST /admin/users ────────────────────────
  app.post(
    '/admin/users',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const parsed = InviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { email, firstName, lastName, sipUsername, sipPassword, didNumber, isAdmin, localPassword } = parsed.data;
      const normEmail = email.trim().toLowerCase();

      const existing = await prisma.user.findUnique({ where: { email: normEmail }, select: { id: true } });
      if (existing) {
        return reply.code(409).send({ error: 'A user with this email already exists.' });
      }

      const passwordHash = localPassword ? await bcrypt.hash(localPassword, 10) : null;
      const created = await prisma.user.create({
        data: {
          email: normEmail,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          sipUsername: sipUsername ?? null,
          sipPassword: sipPassword ?? null,
          didNumber: didNumber ?? null,
          isAdmin: !!isAdmin,
          isActive: true,
          provider: localPassword ? 'local' : 'microsoft',
          passwordHash,
        },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isAdmin: true, isActive: true, provider: true,
          sipUsername: true, didNumber: true, lastLoginAt: true, createdAt: true,
        },
      });

      await recordAudit(u.sub, 'user.invited', created.id, {
        email: normEmail,
        invitedAs: created.isAdmin ? 'admin' : 'user',
        provider: created.provider,
        hasLocalPassword: !!localPassword,
        hasSipCreds: !!(sipUsername && sipPassword),
        didNumber: didNumber ?? null,
      });

      return publicUser(created);
    },
  );

  // ───────────────────────── PATCH /admin/users/:id ───────────────────
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const actor = request.user as JwtPayload;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Invalid id' });
      const parsed = UpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) return reply.code(404).send({ error: 'User not found' });

      const data: Record<string, unknown> = {};
      const auditMeta: Record<string, unknown> = {};

      const set = (field: string, prev: unknown, next: unknown) => {
        if (next === undefined) return;
        if (prev === next) return;
        data[field] = next;
        auditMeta[field] = { from: prev, to: next };
      };

      set('firstName', target.firstName, parsed.data.firstName ?? undefined);
      set('lastName', target.lastName, parsed.data.lastName ?? undefined);
      set('sipUsername', target.sipUsername, parsed.data.sipUsername ?? undefined);
      if (parsed.data.sipPassword !== undefined) {
        data.sipPassword = parsed.data.sipPassword;
        auditMeta.sipPassword = { changed: true };
      }
      set('didNumber', target.didNumber, parsed.data.didNumber ?? undefined);

      if (parsed.data.isActive !== undefined && parsed.data.isActive !== target.isActive) {
        if (id === actor.sub && parsed.data.isActive === false) {
          return reply
            .code(400)
            .send({ error: "You can't deactivate your own account." });
        }
        data.isActive = parsed.data.isActive;
        auditMeta.isActive = { from: target.isActive, to: parsed.data.isActive };
      }

      if (parsed.data.isAdmin !== undefined && parsed.data.isAdmin !== target.isAdmin) {
        if (id === actor.sub) {
          return reply.code(400).send({
            error: "You can't change your own admin status. Ask another admin to do it.",
          });
        }
        if (parsed.data.isAdmin === false) {
          const remaining = await prisma.user.count({
            where: { isAdmin: true, isActive: true, id: { not: id } },
          });
          if (remaining < 1) {
            return reply.code(400).send({
              error:
                "Can't demote the last admin. Promote someone else first or this account would be the only admin gone.",
            });
          }
        }
        data.isAdmin = parsed.data.isAdmin;
        auditMeta.isAdmin = { from: target.isAdmin, to: parsed.data.isAdmin };
      }

      if (parsed.data.localPassword !== undefined) {
        const newHash = parsed.data.localPassword
          ? await bcrypt.hash(parsed.data.localPassword, 10)
          : null;
        data.passwordHash = newHash;
        if (newHash) data.provider = 'local';
        auditMeta.passwordHash = newHash ? { reset: true } : { cleared: true };
      }

      if (Object.keys(data).length === 0) {
        return publicUser(target);
      }

      const updated = await prisma.user.update({
        where: { id },
        data,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isAdmin: true, isActive: true, provider: true,
          sipUsername: true, didNumber: true, lastLoginAt: true, createdAt: true,
        },
      });

      let action = 'user.updated';
      if (auditMeta.isAdmin) {
        action = (auditMeta.isAdmin as { to: boolean }).to ? 'user.promoted' : 'user.demoted';
      } else if (auditMeta.isActive) {
        action = (auditMeta.isActive as { to: boolean }).to ? 'user.activated' : 'user.deactivated';
      } else if (auditMeta.passwordHash) {
        action = 'user.password_reset';
      }
      await recordAudit(actor.sub, action, id, { email: target.email, changes: auditMeta });

      return publicUser(updated);
    },
  );

  // ───────────────────────── GET /admin/audit-logs ────────────────────
  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/audit-logs',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const rawLimit = Number(request.query.limit ?? 100);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
      const cursor = Number(request.query.cursor);
      const rows = await prisma.auditLog.findMany({
        take: limit + 1,
        orderBy: { id: 'desc' },
        ...(Number.isFinite(cursor) ? { skip: 1, cursor: { id: cursor } } : {}),
        include: {
          actor: { select: { id: true, email: true, firstName: true, lastName: true } },
          target: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, -1) : rows).map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actor
          ? {
              id: r.actor.id,
              email: r.actor.email,
              firstName: r.actor.firstName,
              lastName: r.actor.lastName,
            }
          : null,
        target: r.target
          ? {
              id: r.target.id,
              email: r.target.email,
              firstName: r.target.firstName,
              lastName: r.target.lastName,
            }
          : null,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      }));
      const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
      return { items, nextCursor };
    },
  );

  // ───────────────────── POST /admin/users/bulk-import (#189) ─────────
  // Per-row upsert by email. dryRun=true validates + returns the preview
  // without writing. Returns per-row { status, error?, missingPassword }
  // so the frontend can show a result table.
  app.post(
    '/admin/users/bulk-import',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const actor = request.user as JwtPayload;
      const parsed = BulkImportSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { dryRun, rows } = parsed.data;

      const inputEmails = rows.map((r) => r.email.trim().toLowerCase());
      const existing = await prisma.user.findMany({
        where: { email: { in: inputEmails } },
        select: { id: true, email: true },
      });
      const existingByEmail = new Map(existing.map((u) => [u.email, u.id]));

      type ItemResult = {
        row: number;
        email: string;
        status: 'created' | 'updated' | 'error' | 'skipped';
        missingPassword: boolean;
        error?: string;
        userId?: number;
      };
      const results: ItemResult[] = [];
      const seenEmails = new Set<string>();

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rowNum = i + 1;
        const email = row.email.trim().toLowerCase();

        if (seenEmails.has(email)) {
          results.push({
            row: rowNum,
            email,
            status: 'error',
            missingPassword: false,
            error: 'Duplicate email in CSV',
          });
          continue;
        }
        seenEmails.add(email);

        const hasPassword = !!(row.sipPassword && row.sipPassword.trim());
        const existingId = existingByEmail.get(email);

        try {
          if (dryRun) {
            results.push({
              row: rowNum,
              email,
              status: existingId ? 'updated' : 'created',
              missingPassword: !hasPassword,
              userId: existingId,
            });
            continue;
          }

          if (existingId) {
            const data: Record<string, unknown> = {};
            if (row.firstName !== undefined && row.firstName !== null) data.firstName = row.firstName;
            if (row.lastName !== undefined && row.lastName !== null) data.lastName = row.lastName;
            if (row.sipUsername !== undefined && row.sipUsername !== null && row.sipUsername.trim()) data.sipUsername = row.sipUsername.trim();
            if (hasPassword) data.sipPassword = (row.sipPassword as string).trim();
            if (row.didNumber !== undefined && row.didNumber !== null && row.didNumber.trim()) data.didNumber = row.didNumber.trim();
            if (row.isAdmin === true || row.isAdmin === false) data.isAdmin = row.isAdmin;
            if (row.phoneExtension !== undefined && row.phoneExtension !== null) data.phoneExtension = row.phoneExtension;

            const updated = await prisma.user.update({
              where: { id: existingId },
              data,
              select: { id: true },
            });
            results.push({
              row: rowNum,
              email,
              status: 'updated',
              missingPassword: !hasPassword,
              userId: updated.id,
            });
          } else {
            const created = await prisma.user.create({
              data: {
                email,
                firstName: row.firstName ?? null,
                lastName: row.lastName ?? null,
                sipUsername: row.sipUsername?.trim() || null,
                sipPassword: hasPassword ? (row.sipPassword as string).trim() : null,
                didNumber: row.didNumber?.trim() || null,
                phoneExtension: row.phoneExtension ?? null,
                isAdmin: row.isAdmin === true,
                isActive: true,
                provider: 'microsoft',
                passwordHash: null,
              },
              select: { id: true },
            });
            results.push({
              row: rowNum,
              email,
              status: 'created',
              missingPassword: !hasPassword,
              userId: created.id,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            row: rowNum,
            email,
            status: 'error',
            missingPassword: !hasPassword,
            error: msg.includes('Unique constraint')
              ? 'sipUsername or didNumber is already assigned to another user'
              : msg.slice(0, 240),
          });
        }
      }

      const summary = {
        total: rows.length,
        created: results.filter((r) => r.status === 'created').length,
        updated: results.filter((r) => r.status === 'updated').length,
        errors: results.filter((r) => r.status === 'error').length,
        missingPasswords: results.filter((r) => r.missingPassword && r.status !== 'error').length,
        dryRun,
      };

      if (!dryRun) {
        await recordAudit(actor.sub, 'users.bulk_imported', null, {
          total: summary.total,
          created: summary.created,
          updated: summary.updated,
          errors: summary.errors,
          missingPasswords: summary.missingPasswords,
        });
      }

      return { summary, items: results };
    },
  );

  // ───────────────────── GET /admin/reports/live (Phase 8 — #204) ─────
  // P0 reporting slice — at-a-glance numbers for an admin dashboard.
  // Designed to be cheap: 6 separate queries that all hit indexed columns
  // and return small aggregates, no per-call full scans.
  // Refresh budget on the client: 15s. Each call is < 100ms in practice.
  app.get(
    '/admin/reports/live',
    { onRequest: [app.authenticate, requireAdmin] },
    async () => {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfDay);
      startOfYesterday.setUTCDate(startOfDay.getUTCDate() - 1);
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

      // 1. Active calls right now: started but not ended yet, with a 4h
      //    sanity-cap so a stuck/dropped call doesn't show as active forever.
      const activeCallsNow = await prisma.call.count({
        where: {
          endedAt: null,
          startedAt: { gte: fourHoursAgo },
          status: { in: ['ringing', 'answered', 'initiated', 'connected'] },
        },
      });

      // 2. Today's calls — grouped by direction + status for an in/out/missed split.
      const todaysCallsRaw = await prisma.call.groupBy({
        by: ['direction', 'status'],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
      });
      let inbound = 0, outbound = 0, missed = 0;
      for (const r of todaysCallsRaw) {
        const c = r._count._all;
        if (r.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(r.status)) missed += c;
          else inbound += c;
        } else if (r.direction === 'outbound') {
          outbound += c;
        }
      }
      const todaysCallsTotal = inbound + outbound + missed;

      // 3. Yesterday's count for delta arrow.
      const yesterdayTotal = await prisma.call.count({
        where: {
          startedAt: { gte: startOfYesterday, lt: startOfDay },
        },
      });

      // 4. Today's SMS (inbound + outbound).
      const todaysSmsRaw = await prisma.message.groupBy({
        by: ['direction'],
        where: { createdAt: { gte: startOfDay } },
        _count: { _all: true },
      });
      const todaysSms = {
        sent: todaysSmsRaw.find((r) => r.direction === 'outbound')?._count._all ?? 0,
        received: todaysSmsRaw.find((r) => r.direction === 'inbound')?._count._all ?? 0,
      };

      // 5. Active users in the last 24h — anyone who's made a call OR sent/
      //    received a message. Best proxy for "online" without server-side
      //    SIP-presence tracking (which we'd need Telnyx Status webhooks for).
      const activeCallers = await prisma.call.findMany({
        where: { startedAt: { gte: last24h } },
        distinct: ['userId'],
        select: { userId: true },
      });
      const activeMessagers = await prisma.message.findMany({
        where: { createdAt: { gte: last24h } },
        distinct: ['userId'],
        select: { userId: true },
      });
      const activeUserIds = new Set<number>([
        ...activeCallers.map((c) => c.userId),
        ...activeMessagers.map((m) => m.userId),
      ]);

      // 6. Top callers today (top 5 by call count).
      const topCallersRaw = await prisma.call.groupBy({
        by: ['userId'],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 5,
      });
      const topCallerIds = topCallersRaw.map((r) => r.userId);
      const topCallerUsers =
        topCallerIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: topCallerIds } },
              select: { id: true, email: true, firstName: true, lastName: true },
            })
          : [];
      const topCallerById = new Map(topCallerUsers.map((u) => [u.id, u]));
      const topCallers = topCallersRaw.map((r) => {
        const u = topCallerById.get(r.userId);
        return {
          userId: r.userId,
          email: u?.email ?? '(unknown)',
          name:
            ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
              u?.email) ?? '(unknown)',
          callCount: r._count._all,
        };
      });

      // 7. Recent missed calls (last 10, with the user who missed them).
      const missedRows = await prisma.call.findMany({
        where: {
          direction: 'inbound',
          status: { in: ['missed', 'no_answer'] },
          startedAt: { gte: last24h },
        },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          fromNumber: true,
          startedAt: true,
          status: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      const recentMissed = missedRows.map((c) => ({
        id: c.id,
        fromNumber: c.fromNumber,
        startedAt: c.startedAt.toISOString(),
        status: c.status,
        userEmail: c.user.email,
        userName:
          [c.user.firstName, c.user.lastName].filter(Boolean).join(' ').trim() ||
          c.user.email,
      }));

      // 8. Hourly call buckets for today (24 buckets, indexed 0–23 UTC).
      const todaysCallsForChart = await prisma.call.findMany({
        where: { startedAt: { gte: startOfDay } },
        select: { startedAt: true, direction: true, status: true },
      });
      const hourly = Array.from({ length: 24 }, () => ({ inbound: 0, outbound: 0, missed: 0 }));
      for (const c of todaysCallsForChart) {
        const h = c.startedAt.getUTCHours();
        if (c.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(c.status)) hourly[h].missed += 1;
          else hourly[h].inbound += 1;
        } else if (c.direction === 'outbound') {
          hourly[h].outbound += 1;
        }
      }

      // 9. Total user counts for context.
      const [totalUsers, activeUsers, adminUsers] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { isAdmin: true, isActive: true } }),
      ]);

      return {
        generatedAt: now.toISOString(),
        users: {
          total: totalUsers,
          active: activeUsers,
          admins: adminUsers,
          activeLast24h: activeUserIds.size,
        },
        calls: {
          activeNow: activeCallsNow,
          today: {
            total: todaysCallsTotal,
            inbound,
            outbound,
            missed,
          },
          yesterdayTotal,
          hourlyToday: hourly,
        },
        sms: {
          today: todaysSms,
        },
        topCallers,
        recentMissed,
      };
    },
  );

  // ───────────────────── GET /admin/reports/presence (#211) ───────────
  // Per-user real-time presence: who's on a call, who's active, who's idle.
  // No true SIP-presence tracking (would need Telnyx Status webhooks); we
  // proxy via open Call rows + recent activity timestamps. Good enough.
  app.get(
    '/admin/reports/presence',
    { onRequest: [app.authenticate, requireAdmin] },
    async () => {
      const now = new Date();
      const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

      const users = await prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          didNumber: true, sipUsername: true, isAdmin: true,
        },
        orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
      });

      const openCalls = await prisma.call.findMany({
        where: {
          endedAt: null,
          startedAt: { gte: fourHoursAgo },
          status: { in: ['ringing', 'answered', 'initiated', 'connected'] },
        },
        select: {
          userId: true, fromNumber: true, toNumber: true, direction: true,
          startedAt: true, status: true,
        },
      });
      const openCallByUser = new Map<number, typeof openCalls[number]>();
      for (const c of openCalls) {
        if (!openCallByUser.has(c.userId)) openCallByUser.set(c.userId, c);
      }

      const lastCallPerUser = await prisma.call.groupBy({
        by: ['userId'],
        _max: { startedAt: true },
        where: { startedAt: { gte: last24h } },
      });
      const lastMsgPerUser = await prisma.message.groupBy({
        by: ['userId'],
        _max: { createdAt: true },
        where: { createdAt: { gte: last24h } },
      });
      const lastByUser = new Map<number, Date>();
      for (const r of lastCallPerUser) {
        if (r._max.startedAt) lastByUser.set(r.userId, r._max.startedAt);
      }
      for (const r of lastMsgPerUser) {
        if (!r._max.createdAt) continue;
        const prev = lastByUser.get(r.userId);
        if (!prev || r._max.createdAt > prev) lastByUser.set(r.userId, r._max.createdAt);
      }

      const todayCallsPerUser = await prisma.call.groupBy({
        by: ['userId', 'direction', 'status'],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
      });
      const todayByUser = new Map<number, { inbound: number; outbound: number; missed: number }>();
      for (const r of todayCallsPerUser) {
        const cur = todayByUser.get(r.userId) ?? { inbound: 0, outbound: 0, missed: 0 };
        const c = r._count._all;
        if (r.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(r.status)) cur.missed += c;
          else cur.inbound += c;
        } else if (r.direction === 'outbound') {
          cur.outbound += c;
        }
        todayByUser.set(r.userId, cur);
      }

      const items = users.map((u) => {
        const open = openCallByUser.get(u.id);
        const last = lastByUser.get(u.id);
        let status: 'on_call' | 'active' | 'recent' | 'idle' = 'idle';
        if (open) status = 'on_call';
        else if (last && last >= tenMinAgo) status = 'active';
        else if (last && last >= oneHourAgo) status = 'recent';
        const today = todayByUser.get(u.id) ?? { inbound: 0, outbound: 0, missed: 0 };
        return {
          id: u.id,
          email: u.email,
          name:
            ([u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
              u.email),
          didNumber: u.didNumber,
          isAdmin: u.isAdmin,
          status,
          lastActivity: last ? last.toISOString() : null,
          currentCall: open
            ? {
                fromNumber: open.fromNumber,
                toNumber: open.toNumber,
                direction: open.direction,
                startedAt: open.startedAt.toISOString(),
                status: open.status,
              }
            : null,
          todayCalls: today.inbound + today.outbound + today.missed,
          todayBreakdown: today,
        };
      });

      const counts = {
        on_call: items.filter((i) => i.status === 'on_call').length,
        active: items.filter((i) => i.status === 'active').length,
        recent: items.filter((i) => i.status === 'recent').length,
        idle: items.filter((i) => i.status === 'idle').length,
      };

      return { generatedAt: now.toISOString(), counts, items };
    },
  );

  // ───────────────────── GET /admin/reports/usage (#205) ──────────────
  app.get<{ Querystring: { range?: string } }>(
    '/admin/reports/usage',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const range = request.query.range ?? '7d';
      const now = new Date();
      let since: Date;
      if (range === 'today') {
        since = new Date(now); since.setUTCHours(0, 0, 0, 0);
      } else if (range === '30d') {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const callsByUser = await prisma.call.groupBy({
        by: ['userId', 'direction', 'status'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
        _sum: { durationSeconds: true },
      });
      type Agg = { userId: number; inbound: number; outbound: number; missed: number; talkSec: number };
      const aggMap = new Map<number, Agg>();
      for (const r of callsByUser) {
        const cur = aggMap.get(r.userId) ?? { userId: r.userId, inbound: 0, outbound: 0, missed: 0, talkSec: 0 };
        const c = r._count._all;
        const t = r._sum.durationSeconds ?? 0;
        if (r.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(r.status)) cur.missed += c;
          else cur.inbound += c;
        } else if (r.direction === 'outbound') {
          cur.outbound += c;
        }
        cur.talkSec += t;
        aggMap.set(r.userId, cur);
      }

      const smsByUser = await prisma.message.groupBy({
        by: ['userId', 'direction'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      const smsMap = new Map<number, { sent: number; received: number }>();
      for (const r of smsByUser) {
        const cur = smsMap.get(r.userId) ?? { sent: 0, received: 0 };
        if (r.direction === 'outbound') cur.sent += r._count._all;
        else cur.received += r._count._all;
        smsMap.set(r.userId, cur);
      }

      const allUserIds = new Set<number>([...aggMap.keys(), ...smsMap.keys()]);
      const userDetails = allUserIds.size === 0 ? [] : await prisma.user.findMany({
        where: { id: { in: Array.from(allUserIds) } },
        select: { id: true, email: true, firstName: true, lastName: true, didNumber: true },
      });
      const userById = new Map(userDetails.map((u) => [u.id, u]));

      const byUser = Array.from(allUserIds).map((id) => {
        const agg = aggMap.get(id) ?? { userId: id, inbound: 0, outbound: 0, missed: 0, talkSec: 0 };
        const sms = smsMap.get(id) ?? { sent: 0, received: 0 };
        const u = userById.get(id);
        const total = agg.inbound + agg.outbound + agg.missed;
        return {
          userId: id,
          email: u?.email ?? '(unknown)',
          name:
            ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
              u?.email) ?? '(unknown)',
          didNumber: u?.didNumber ?? null,
          totalCalls: total,
          inbound: agg.inbound,
          outbound: agg.outbound,
          missed: agg.missed,
          talkSeconds: agg.talkSec,
          smsSent: sms.sent,
          smsReceived: sms.received,
        };
      }).sort((a, b) => b.totalCalls - a.totalCalls);

      const allCallsInWindow = await prisma.call.findMany({
        where: { startedAt: { gte: since } },
        select: { startedAt: true, direction: true, status: true },
      });
      const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
      const byDay: Array<{ date: string; inbound: number; outbound: number; missed: number }> = [];
      for (let i = 0; i < days; i += 1) {
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        dayStart.setUTCDate(dayStart.getUTCDate() - (days - 1 - i));
        const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        let inb = 0, out = 0, mis = 0;
        for (const c of allCallsInWindow) {
          if (c.startedAt < dayStart || c.startedAt >= dayEnd) continue;
          if (c.direction === 'inbound') {
            if (['missed', 'no_answer', 'rejected'].includes(c.status)) mis += 1;
            else inb += 1;
          } else if (c.direction === 'outbound') {
            out += 1;
          }
        }
        byDay.push({ date: dayStart.toISOString().slice(0, 10), inbound: inb, outbound: out, missed: mis });
      }

      return { range, generatedAt: now.toISOString(), byUser, byDay };
    },
  );

  // ───────────────────── GET /admin/reports/quality (#206) ────────────
  app.get<{ Querystring: { range?: string } }>(
    '/admin/reports/quality',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const range = request.query.range ?? '7d';
      const now = new Date();
      const since = range === '30d'
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const calls = await prisma.call.findMany({
        where: { startedAt: { gte: since } },
        select: {
          userId: true, direction: true, status: true,
          durationSeconds: true, hangupCause: true, startedAt: true,
        },
      });

      type UA = { userId: number; missed: number; answered: number; short: number };
      const ua = new Map<number, UA>();
      const hangupCauses = new Map<string, number>();
      const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

      for (const c of calls) {
        const u = ua.get(c.userId) ?? { userId: c.userId, missed: 0, answered: 0, short: 0 };
        if (c.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(c.status)) u.missed += 1;
          else u.answered += 1;
        }
        if (c.durationSeconds > 0 && c.durationSeconds < 10) u.short += 1;
        ua.set(c.userId, u);

        if (c.hangupCause) {
          hangupCauses.set(c.hangupCause, (hangupCauses.get(c.hangupCause) ?? 0) + 1);
        }
        const dow = c.startedAt.getUTCDay();
        const hr = c.startedAt.getUTCHours();
        heatmap[dow][hr] += 1;
      }

      const userIds = Array.from(ua.keys());
      const users = userIds.length > 0 ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      }) : [];
      const userById = new Map(users.map((u) => [u.id, u]));

      const missedRateByUser = userIds.map((id) => {
        const u = ua.get(id)!;
        const detail = userById.get(id);
        const totalInbound = u.missed + u.answered;
        const rate = totalInbound > 0 ? u.missed / totalInbound : 0;
        return {
          userId: id,
          email: detail?.email ?? '(unknown)',
          name:
            ([detail?.firstName, detail?.lastName].filter(Boolean).join(' ').trim() ||
              detail?.email) ?? '(unknown)',
          missed: u.missed,
          answered: u.answered,
          shortCalls: u.short,
          missedRate: rate,
        };
      }).filter((r) => r.missed + r.answered >= 3)
        .sort((a, b) => b.missedRate - a.missedRate)
        .slice(0, 25);

      const hangupCausesArr = Array.from(hangupCauses.entries())
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count);

      const totalShort = Array.from(ua.values()).reduce((sum, u) => sum + u.short, 0);

      return {
        range,
        generatedAt: now.toISOString(),
        missedRateByUser,
        hangupCauses: hangupCausesArr,
        totals: { shortCalls: totalShort, totalCalls: calls.length },
        heatmap,
      };
    },
  );

  // ───────────────────── GET /admin/reports/cost (#207) ───────────────
  // Telnyx cost reporting. Pricing constants come from env vars (with
  // sane defaults) so an admin can tune them in one place if Telnyx
  // pricing changes.
  app.get<{ Querystring: { range?: string } }>(
    '/admin/reports/cost',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const range = request.query.range ?? '30d';
      const now = new Date();
      const since = range === '7d'
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const days = range === '7d' ? 7 : 30;

      // Pricing — Telnyx US defaults. Override via env if your plan differs.
      const COST_INBOUND_PER_MIN = parseFloat(process.env.TELNYX_COST_INBOUND_PER_MIN ?? '0.005');
      const COST_OUTBOUND_PER_MIN = parseFloat(process.env.TELNYX_COST_OUTBOUND_PER_MIN ?? '0.007');
      const COST_PER_SMS = parseFloat(process.env.TELNYX_COST_PER_SMS ?? '0.004');
      const COST_PER_DID_MONTHLY = parseFloat(process.env.TELNYX_COST_PER_DID_MONTHLY ?? '1.00');

      // Per-user voice spend.
      const calls = await prisma.call.findMany({
        where: { startedAt: { gte: since }, durationSeconds: { gt: 0 } },
        select: { userId: true, direction: true, durationSeconds: true },
      });
      const byUser = new Map<number, { inboundSec: number; outboundSec: number }>();
      for (const c of calls) {
        const cur = byUser.get(c.userId) ?? { inboundSec: 0, outboundSec: 0 };
        if (c.direction === 'inbound') cur.inboundSec += c.durationSeconds;
        else cur.outboundSec += c.durationSeconds;
        byUser.set(c.userId, cur);
      }

      // SMS spend.
      const smsByUser = await prisma.message.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      const smsMap = new Map(smsByUser.map((r) => [r.userId, r._count._all]));

      // Per-DID minutes.
      const callsByDid = await prisma.call.groupBy({
        by: ['toNumber'],
        where: {
          startedAt: { gte: since },
          direction: 'inbound',
          durationSeconds: { gt: 0 },
        },
        _sum: { durationSeconds: true },
      });
      const didMinutes = callsByDid
        .map((r) => ({ did: r.toNumber, minutes: Math.round((r._sum.durationSeconds ?? 0) / 60) }))
        .filter((r) => r.did)
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 25);

      const userIds = Array.from(byUser.keys()).concat(Array.from(smsMap.keys()));
      const uniqUserIds = Array.from(new Set(userIds));
      const userDetails = uniqUserIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: uniqUserIds } },
            select: { id: true, email: true, firstName: true, lastName: true, didNumber: true },
          })
        : [];
      const userById = new Map(userDetails.map((u) => [u.id, u]));

      const byUserArr = uniqUserIds.map((id) => {
        const voice = byUser.get(id) ?? { inboundSec: 0, outboundSec: 0 };
        const smsCount = smsMap.get(id) ?? 0;
        const u = userById.get(id);
        const inboundCost = (voice.inboundSec / 60) * COST_INBOUND_PER_MIN;
        const outboundCost = (voice.outboundSec / 60) * COST_OUTBOUND_PER_MIN;
        const smsCost = smsCount * COST_PER_SMS;
        const total = inboundCost + outboundCost + smsCost;
        return {
          userId: id,
          email: u?.email ?? '(unknown)',
          name:
            ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
              u?.email) ?? '(unknown)',
          didNumber: u?.didNumber ?? null,
          inboundMinutes: Math.round(voice.inboundSec / 60),
          outboundMinutes: Math.round(voice.outboundSec / 60),
          smsCount,
          inboundCost,
          outboundCost,
          smsCost,
          totalCost: total,
        };
      }).sort((a, b) => b.totalCost - a.totalCost);

      // Active DID count for the rental projection.
      const activeUsers = await prisma.user.count({ where: { isActive: true, didNumber: { not: null } } });

      const voiceTotal = byUserArr.reduce((s, u) => s + u.inboundCost + u.outboundCost, 0);
      const smsTotal = byUserArr.reduce((s, u) => s + u.smsCost, 0);
      const didRentalMonthly = activeUsers * COST_PER_DID_MONTHLY;

      // Projected monthly = (voice + sms over `days`) / days * 30 + DID rental.
      const usageProjection = ((voiceTotal + smsTotal) / Math.max(days, 1)) * 30;
      const projectedMonthly = usageProjection + didRentalMonthly;

      return {
        range,
        generatedAt: now.toISOString(),
        pricing: {
          inboundPerMin: COST_INBOUND_PER_MIN,
          outboundPerMin: COST_OUTBOUND_PER_MIN,
          perSms: COST_PER_SMS,
          didMonthly: COST_PER_DID_MONTHLY,
        },
        totals: {
          voiceCost: voiceTotal,
          smsCost: smsTotal,
          didRentalMonthly,
          projectedMonthly,
          activeDids: activeUsers,
        },
        byUser: byUserArr,
        didMinutes,
      };
    },
  );

  // ───────────────────── GET /admin/reports/recruiter (#208) ──────────
  // ApTask-specific recruiter metrics.
  //   - candidateReach: unique outbound numbers dialed per user per day (avg)
  //   - conversationRate: % of outbound calls that connected > 30s
  app.get<{ Querystring: { range?: string } }>(
    '/admin/reports/recruiter',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request) => {
      const range = request.query.range ?? '7d';
      const now = new Date();
      const since = range === '30d'
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const days = range === '30d' ? 30 : 7;

      const outboundCalls = await prisma.call.findMany({
        where: {
          startedAt: { gte: since },
          direction: 'outbound',
        },
        select: { userId: true, toNumber: true, durationSeconds: true, startedAt: true },
      });

      type Row = {
        userId: number;
        totalDialed: number;
        connectedOver30s: number;
        uniqueNumbers: Set<string>;
        uniqueDays: Set<string>;
      };
      const rows = new Map<number, Row>();
      for (const c of outboundCalls) {
        const row = rows.get(c.userId) ?? {
          userId: c.userId,
          totalDialed: 0,
          connectedOver30s: 0,
          uniqueNumbers: new Set<string>(),
          uniqueDays: new Set<string>(),
        };
        row.totalDialed += 1;
        if (c.durationSeconds >= 30) row.connectedOver30s += 1;
        if (c.toNumber) row.uniqueNumbers.add(c.toNumber.replace(/[^\d]/g, '').slice(-10));
        row.uniqueDays.add(c.startedAt.toISOString().slice(0, 10));
        rows.set(c.userId, row);
      }

      const userIds = Array.from(rows.keys());
      const users = userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, firstName: true, lastName: true },
          })
        : [];
      const userById = new Map(users.map((u) => [u.id, u]));

      const byUser = userIds.map((id) => {
        const r = rows.get(id)!;
        const u = userById.get(id);
        const activeDays = Math.max(r.uniqueDays.size, 1);
        const conversationRate = r.totalDialed > 0 ? r.connectedOver30s / r.totalDialed : 0;
        return {
          userId: id,
          email: u?.email ?? '(unknown)',
          name:
            ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
              u?.email) ?? '(unknown)',
          totalDialed: r.totalDialed,
          uniqueNumbers: r.uniqueNumbers.size,
          activeDays,
          avgUniquePerDay: Math.round((r.uniqueNumbers.size / activeDays) * 10) / 10,
          connectedOver30s: r.connectedOver30s,
          conversationRate,
        };
      }).sort((a, b) => b.totalDialed - a.totalDialed);

      // Team averages for benchmarking.
      const totalDialed = byUser.reduce((s, r) => s + r.totalDialed, 0);
      const totalConnected = byUser.reduce((s, r) => s + r.connectedOver30s, 0);
      const totalUnique = byUser.reduce((s, r) => s + r.uniqueNumbers, 0);
      const teamConversationRate = totalDialed > 0 ? totalConnected / totalDialed : 0;
      const teamAvgUniquePerUser = byUser.length > 0
        ? Math.round((totalUnique / byUser.length) * 10) / 10
        : 0;

      return {
        range,
        generatedAt: now.toISOString(),
        days,
        team: {
          totalDialed,
          totalConnected,
          totalUnique,
          conversationRate: teamConversationRate,
          avgUniquePerUser: teamAvgUniquePerUser,
          activeRecruiters: byUser.length,
        },
        byUser,
      };
    },
  );

  // ───────────────────── GET /admin/reports/alerts (#210) ─────────────
  // Surfaces anomalies the admin should know about. No cron yet — admin
  // refreshes to recompute. Cheap enough to run on demand.
  app.get(
    '/admin/reports/alerts',
    { onRequest: [app.authenticate, requireAdmin] },
    async () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);

      type Alert = {
        severity: 'info' | 'warn' | 'critical';
        type: string;
        message: string;
        userId?: number;
        userEmail?: string;
        userName?: string;
      };
      const alerts: Alert[] = [];

      // 1. Active users with NO call/SMS activity in the last 7 days.
      const activeUsers = await prisma.user.findMany({
        where: { isActive: true, sipUsername: { not: null }, didNumber: { not: null } },
        select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      });

      const recentlyActiveCallerIds = new Set(
        (await prisma.call.findMany({
          where: { startedAt: { gte: sevenDaysAgo } },
          distinct: ['userId'],
          select: { userId: true },
        })).map((r) => r.userId)
      );
      const recentlyActiveMessagerIds = new Set(
        (await prisma.message.findMany({
          where: { createdAt: { gte: sevenDaysAgo } },
          distinct: ['userId'],
          select: { userId: true },
        })).map((r) => r.userId)
      );

      for (const u of activeUsers) {
        // Don't alert on accounts created within the last 7 days — they're new.
        if (u.createdAt >= sevenDaysAgo) continue;
        if (recentlyActiveCallerIds.has(u.id) || recentlyActiveMessagerIds.has(u.id)) continue;
        alerts.push({
          severity: 'warn',
          type: 'user.idle_7d',
          message: 'No calls or messages in 7 days',
          userId: u.id,
          userEmail: u.email,
          userName:
            ([u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
              u.email),
        });
      }

      // 2. Spike in today's missed calls vs 7-day average.
      const missedToday = await prisma.call.count({
        where: {
          startedAt: { gte: startOfDay },
          direction: 'inbound',
          status: { in: ['missed', 'no_answer', 'rejected'] },
        },
      });
      const missedLast7d = await prisma.call.count({
        where: {
          startedAt: { gte: sevenDaysAgo, lt: startOfDay },
          direction: 'inbound',
          status: { in: ['missed', 'no_answer', 'rejected'] },
        },
      });
      const missedAvgPerDay = missedLast7d / 7;
      if (missedAvgPerDay > 0 && missedToday > missedAvgPerDay * 1.5 && missedToday >= 3) {
        alerts.push({
          severity: 'critical',
          type: 'missed.spike',
          message: `${missedToday} missed today vs ${Math.round(missedAvgPerDay)}/day 7-day avg`,
        });
      }

      // 3. DIDs (numbers we own) with no inbound activity in 14 days.
      const allDids = activeUsers.map((u) => ({ id: u.id, email: u.email, did: '' as string }));
      const recentInboundToNumbers = new Set(
        (await prisma.call.findMany({
          where: {
            startedAt: { gte: fourteenDaysAgo },
            direction: 'inbound',
          },
          distinct: ['toNumber'],
          select: { toNumber: true },
        })).map((r) => r.toNumber)
      );
      const usersWithDids = await prisma.user.findMany({
        where: { isActive: true, didNumber: { not: null } },
        select: { id: true, email: true, firstName: true, lastName: true, didNumber: true },
      });
      for (const u of usersWithDids) {
        if (!u.didNumber) continue;
        if (recentInboundToNumbers.has(u.didNumber)) continue;
        alerts.push({
          severity: 'info',
          type: 'did.inactive_14d',
          message: `DID ${u.didNumber} has received no calls in 14 days`,
          userId: u.id,
          userEmail: u.email,
          userName:
            ([u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
              u.email),
        });
      }

      return {
        generatedAt: now.toISOString(),
        counts: {
          critical: alerts.filter((a) => a.severity === 'critical').length,
          warn: alerts.filter((a) => a.severity === 'warn').length,
          info: alerts.filter((a) => a.severity === 'info').length,
        },
        alerts,
      };
    },
  );
}
