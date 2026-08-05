// v0.10.216 — User-owned SMS templates + the placeholder registry.
//
// Extends the v0.10.52 admin-curated playbook so a recruiter can save their
// own templates without an admin round-trip. One table serves both scopes,
// discriminated by SmsTemplate.ownerUserId:
//
//   ownerUserId = NULL   company-wide, admin-managed (/admin/sms-templates)
//   ownerUserId = <id>   personal, managed here by its owner
//
// Endpoints (all authenticated; none admin-gated):
//   GET    /me/sms-placeholders   the field registry, for the picker
//   GET    /me/sms-templates      company + own personal (see me.routes.ts)
//   POST   /me/sms-templates      create a personal template
//   PATCH  /me/sms-templates/:id  edit own personal template
//   DELETE /me/sms-templates/:id  archive own personal template
//
// ── The two security rules ─────────────────────────────────────────────
// 1. READ is scoped `OR: [{ownerUserId: null}, {ownerUserId: caller}]`. Get
//    this wrong and every user's private templates leak to the whole tenant.
//    That query lives in me.routes.ts alongside the pre-existing handler.
// 2. WRITE always uses a compound where on (id, ownerUserId: caller) via
//    updateMany, never findUnique(id)-then-check. A guessed id must miss,
//    not 403 — and it must be impossible for a request body to nominate a
//    different owner. Same rule CLAUDE.md §3.4 applies to favourites and
//    blocked numbers.
//
// Admins are NOT given visibility into others' personal templates: drafts
// routinely carry candidate comp details, and moderation wasn't asked for.
// Company templates remain entirely admin-owned and read-only to users.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';

import { recordAudit } from '../lib/audit.js';
import {
  describePlaceholderProblem,
  isPlaceholderScanClean,
  publicPlaceholders,
  scanPlaceholders,
} from '../lib/smsPlaceholders.js';
import { SMS_TEMPLATE_CATEGORIES } from '../lib/smsTemplateSeed.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

/**
 * Personal templates are capped so one user can't bloat the picker (which
 * every composer open fetches) or the table. 100 is far beyond any observed
 * playbook size — the whole company playbook is 20.
 */
const MAX_PERSONAL_TEMPLATES = 100;

const VALID_CATEGORIES = new Set(SMS_TEMPLATE_CATEGORIES.map((c) => c.key));

const TemplateInput = z.object({
  category: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  body: z.string().min(1).max(1600),
});

export async function smsTemplatesRoutes(app: FastifyInstance) {
  // ── GET /me/sms-placeholders ──────────────────────────────────────────
  //
  // Served rather than hardcoded client-side so the registry has exactly one
  // definition. Before v0.10.216 the category list alone was duplicated in
  // three files and drifted; the placeholder list is not repeating that.
  app.get('/me/sms-placeholders', { onRequest: [app.authenticate] }, async () => ({
    ok: true,
    placeholders: publicPlaceholders(),
    categories: SMS_TEMPLATE_CATEGORIES,
  }));

  // ── POST /me/sms-templates ────────────────────────────────────────────
  app.post('/me/sms-templates', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const parsed = TemplateInput.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { category, name, body } = parsed.data;

    if (!VALID_CATEGORIES.has(category)) {
      return reply.code(400).send({ ok: false, error: 'Unknown category' });
    }

    // Validate placeholders BEFORE saving: a template with `{firstNmae}` in
    // it would otherwise sit in the picker sending a literal typo to
    // candidates every time it's used.
    const scan = scanPlaceholders(body);
    if (!isPlaceholderScanClean(scan)) {
      return reply.code(400).send({
        ok: false,
        error: describePlaceholderProblem(scan) ?? 'Invalid template fields',
        field: 'body',
      });
    }

    const count = await prisma.smsTemplate.count({
      where: { ownerUserId: user.sub, isActive: true },
    });
    if (count >= MAX_PERSONAL_TEMPLATES) {
      return reply.code(400).send({
        ok: false,
        error: `You've reached the limit of ${MAX_PERSONAL_TEMPLATES} personal templates. Delete one to add another.`,
      });
    }

    const created = await prisma.smsTemplate.create({
      data: {
        category,
        name,
        // Store the normalized body so `{FirstName}` is persisted as
        // `{firstName}` and the insert-time resolver only has to know one
        // spelling.
        body: scan.normalizedBody,
        ownerUserId: user.sub,
        updatedBy: user.sub,
        // Personal templates sort after company ones within a category, and
        // among themselves by id (creation order).
        sortOrder: 500,
      },
    });

    await recordAudit(user.sub, 'sms_template.user_created', null, {
      templateId: created.id,
      category: created.category,
      // Name only — never the body. A template body is user content and can
      // carry candidate details; the audit log is not the place for it.
      name: created.name,
    });

    return { ok: true, template: toPublic(created) };
  });

  // ── PATCH /me/sms-templates/:id ───────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    '/me/sms-templates/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ ok: false, error: 'Invalid id' });
      }

      const parsed = TemplateInput.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { category, name, body } = parsed.data;

      if (category !== undefined && !VALID_CATEGORIES.has(category)) {
        return reply.code(400).send({ ok: false, error: 'Unknown category' });
      }

      let normalizedBody: string | undefined;
      if (body !== undefined) {
        const scan = scanPlaceholders(body);
        if (!isPlaceholderScanClean(scan)) {
          return reply.code(400).send({
            ok: false,
            error: describePlaceholderProblem(scan) ?? 'Invalid template fields',
            field: 'body',
          });
        }
        normalizedBody = scan.normalizedBody;
      }

      // Compound where — a company template (ownerUserId NULL) or another
      // user's row simply doesn't match, so there's no id-probing oracle.
      const result = await prisma.smsTemplate.updateMany({
        where: { id, ownerUserId: user.sub },
        data: {
          ...(category !== undefined ? { category } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(normalizedBody !== undefined ? { body: normalizedBody } : {}),
          updatedBy: user.sub,
        },
      });
      if (result.count === 0) {
        return reply.code(404).send({ ok: false, error: 'Template not found' });
      }

      const updated = await prisma.smsTemplate.findUnique({ where: { id } });
      await recordAudit(user.sub, 'sms_template.user_updated', null, {
        templateId: id,
        // Which fields changed, not what they changed to.
        changed: Object.keys(parsed.data),
      });

      return { ok: true, template: updated ? toPublic(updated) : null };
    },
  );

  // ── DELETE /me/sms-templates/:id ──────────────────────────────────────
  //
  // Soft delete, matching the admin archive path: the row survives for audit
  // and the delete stays reversible with a single SQL update if a user asks
  // for it back.
  app.delete<{ Params: { id: string } }>(
    '/me/sms-templates/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ ok: false, error: 'Invalid id' });
      }

      const result = await prisma.smsTemplate.updateMany({
        where: { id, ownerUserId: user.sub, isActive: true },
        data: { isActive: false, updatedBy: user.sub },
      });
      if (result.count === 0) {
        return reply.code(404).send({ ok: false, error: 'Template not found' });
      }

      await recordAudit(user.sub, 'sms_template.user_archived', null, { templateId: id });
      return { ok: true };
    },
  );
}

/**
 * Shape returned to the client. `scope` and `canEdit` are derived so the UI
 * doesn't reimplement the ownership rule — but they are rendering hints only;
 * the server never trusts them coming back in.
 */
function toPublic(t: {
  id: number;
  category: string;
  name: string;
  body: string;
  sortOrder: number;
  ownerUserId: number | null;
}) {
  return {
    id: t.id,
    category: t.category,
    name: t.name,
    body: t.body,
    sortOrder: t.sortOrder,
    ownerUserId: t.ownerUserId,
    scope: t.ownerUserId === null ? ('company' as const) : ('personal' as const),
    canEdit: t.ownerUserId !== null,
  };
}
