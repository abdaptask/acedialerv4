// v0.10.0 — User-self endpoints for multi-DID switching.
//
// Distinct from /auth/me (which returns the authenticated user's profile).
// These endpoints let a logged-in user enumerate the phone numbers they own
// and toggle which one is the active outbound identity for calls + SMS.
//
// Endpoints:
//   GET  /me/dids          — list this user's UserDid rows
//   POST /me/active-did    — switch the active outbound DID
//
// Both require an authenticated JWT. No admin gate — these operate on the
// caller's own data only.
//
// On /me/active-did:
//   - Refuses if the supplied userDidId doesn't belong to the caller.
//   - Updates User.activeUserDidId.
//   - Calls telnyx.setConnectionCallerIdOverride() to flip the outbound
//     caller-ID at Telnyx for subsequent calls. The PATCH propagates within
//     ~1 second on Telnyx's side — fast enough that users won't notice a lag.
//   - If the Telnyx PATCH fails, we still succeed the DB update and return
//     a warning in the response. Re-attempting the switch later (or any
//     server-side cron) can re-sync the override.
//   - Audit log entry on every successful switch.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';
import * as telnyx from '../telnyx/numbers.js';
import { recordAudit } from '../lib/audit.js';
import { sendAdaptiveCardToEmail } from '../lib/teamsNotify.js';
import { getConnectionStatus } from '../auth/microsoft.js';
// v0.10.79 — for /me/email-notifications/test, fires a sample notification
// email through SendGrid using the same template style as the real
// missed-call / SMS / voicemail emails (so users can confirm deliverability
// + filtering BEFORE relying on email for production events).
import { sendTestEmail } from '../email/sendgrid.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

const SwitchSchema = z.object({
  userDidId: z.number().int().positive(),
});

/**
 * Shape returned by GET /me/dids. Mirrors the UserDid prisma model but
 * deliberately strips telnyxNumberId + connectionId (Telnyx internal ids,
 * no client-side use). isActiveOutbound is a derived convenience flag so
 * the dropdown can highlight the currently-selected row without a separate
 * fetch of User.activeUserDidId.
 */
export interface UserDidPublic {
  id: number;
  didNumber: string;
  label: string;
  colorHex: string;
  isDefault: boolean;
  isActiveOutbound: boolean;
  ringGroupId: number | null;
  ivrMenuId: number | null;
}

// v0.10.0 Pillar 2 — Teams notification config.
//
// Three event types the user can opt in/out of independently. Stored as
// a comma-separated string in users.teams_notify_on (simpler than a
// JSONB array for what's at most three values).
const TEAMS_EVENT_TYPES = ['missed_call', 'sms', 'voicemail'] as const;
type TeamsEventType = (typeof TEAMS_EVENT_TYPES)[number];

// v0.10.1 — switched from per-user webhook URL to a tenant-wide Power
// Automate flow (TEAMS_TENANT_WEBHOOK_URL env var on the webhooks
// service). Users no longer manage a URL; they just toggle which event
// types they want cards for. The teamsWebhookUrl column stays in DB
// as nullable / unused for now to avoid a destructive migration —
// the notifier doesn't read it anymore.
const TeamsConfigSchema = z.object({
  // Array on the wire — easier for the client form to handle as checkboxes.
  // Convert to/from comma-separated string for storage.
  events: z.array(z.enum(TEAMS_EVENT_TYPES)).optional(),
});

// v0.10.79 — Email notification config. Same event vocabulary as Teams
// (missed_call / sms / voicemail) but a separate per-user opt-in stored
// in users.email_notify_on. Default NULL = OFF for everyone (decided at
// the schema layer — no DB default — so existing AND new users start
// opted out and choose to enable via Settings → Email notifications).
const EMAIL_EVENT_TYPES = ['missed_call', 'sms', 'voicemail'] as const;
type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];
const EmailConfigSchema = z.object({
  events: z.array(z.enum(EMAIL_EVENT_TYPES)).optional(),
});

export async function meRoutes(app: FastifyInstance) {
  // ── GET /me/dids ──────────────────────────────────────────────────────
  app.get(
    '/me/dids',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest) => {
      const me = (request.user as JwtPayload).sub;

      // Pull the user + their DIDs in one round-trip. The user row also
      // tells us activeUserDidId so we can derive isActiveOutbound below
      // without a second query.
      const user = await prisma.user.findUnique({
        where: { id: me },
        select: { activeUserDidId: true },
      });
      const activeId = user?.activeUserDidId ?? null;

      const dids = await prisma.userDid.findMany({
        where: { userId: me },
        orderBy: [
          // Default DID first so the dropdown's first option is always the
          // user's primary line, regardless of insertion order.
          { isDefault: 'desc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          didNumber: true,
          label: true,
          colorHex: true,
          isDefault: true,
          ringGroupId: true,
          ivrMenuId: true,
        },
      });

      const out: UserDidPublic[] = dids.map((d) => ({
        id: d.id,
        didNumber: d.didNumber,
        label: d.label,
        colorHex: d.colorHex,
        isDefault: d.isDefault,
        // Fallback: if there's no activeUserDidId set yet (a user that
        // existed before v0.10.0's backfill happens to land), treat
        // isDefault as the active marker. Should always be at most one row.
        isActiveOutbound:
          activeId !== null
            ? d.id === activeId
            : d.isDefault,
        ringGroupId: d.ringGroupId,
        ivrMenuId: d.ivrMenuId,
      }));
      return { dids: out };
    },
  );

  // ── POST /me/active-did ───────────────────────────────────────────────
  app.post(
    '/me/active-did',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const me = (request.user as JwtPayload).sub;
      const parsed = SwitchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { userDidId } = parsed.data;

      // Look up the target DID + verify it belongs to the caller in one
      // go. Strict ownership check — a user supplying someone else's
      // userDidId gets 404, not 403, so we don't leak the existence of
      // other users' DIDs.
      const target = await prisma.userDid.findFirst({
        where: { id: userDidId, userId: me },
        select: {
          id: true,
          didNumber: true,
          label: true,
          connectionId: true,
        },
      });
      if (!target) {
        return reply.code(404).send({ error: 'DID not found for this user' });
      }

      // Update the pointer first (DB write is cheap + idempotent). If the
      // Telnyx PATCH fails next, the dialer header still shows the new
      // selection and the user can retry — the SMS path uses
      // activeUserDidId immediately, no Telnyx round-trip required.
      await prisma.user.update({
        where: { id: me },
        data: { activeUserDidId: userDidId },
      });

      // Update Telnyx's outbound caller-ID override on the connection
      // that handles this user's calls. We need the connectionId for
      // that PATCH. If the UserDid row doesn't have it cached yet (older
      // rows from before v0.10.0's backfill), we skip the Telnyx update
      // and return a warning — the SMS path still works, just outbound
      // calls keep the previous caller ID until someone updates the
      // connection cache (admin "Repair" button, or first invite from
      // this user).
      let telnyxUpdated = false;
      let telnyxWarning: string | null = null;
      if (target.connectionId) {
        const res = await telnyx.setConnectionCallerIdOverride(
          target.connectionId,
          target.didNumber,
        );
        if (res.ok) {
          telnyxUpdated = true;
        } else {
          telnyxWarning = `Telnyx PATCH returned ${res.status}: ${JSON.stringify(res.error)}`;
          request.log.warn(
            { userId: me, userDidId, status: res.status, error: res.error },
            '[me/active-did] Telnyx caller-id override update failed',
          );
        }
      } else {
        telnyxWarning =
          'No Telnyx connectionId cached on this DID — outbound caller ID may not switch immediately.';
      }

      await recordAudit(me, 'user.active_did_switched', me, {
        userDidId,
        didNumber: target.didNumber,
        label: target.label,
        telnyxUpdated,
        telnyxWarning,
      });

      return {
        ok: true,
        userDidId,
        didNumber: target.didNumber,
        label: target.label,
        telnyxUpdated,
        ...(telnyxWarning ? { warning: telnyxWarning } : {}),
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // v0.10.0 Pillar 2 — Microsoft Teams notification config (Task 6).
  //
  // Each user maintains their own personal Incoming Webhook URL pointing
  // at a Teams channel of their choosing. We POST Adaptive Cards to it
  // on missed call / inbound SMS / voicemail completed events. Per-user
  // (not per-org) so each pilot user can route to their own DMs / a
  // private team / wherever. They control the opt-in independently.
  //
  // Endpoints:
  //   GET   /me/teams-config        — read current settings
  //   PATCH /me/teams-config        — update URL and/or event opt-ins
  //   POST  /me/teams-config/test   — send a sample card so the user
  //                                    can verify the URL works before
  //                                    relying on it for production
  //                                    events.
  // ═══════════════════════════════════════════════════════════════════════

  app.get(
    '/me/teams-config',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest) => {
      const me = (request.user as JwtPayload).sub;
      const user = await prisma.user.findUnique({
        where: { id: me },
        select: { teamsNotifyOn: true },
      });
      const eventsCsv = user?.teamsNotifyOn ?? '';
      const events = eventsCsv
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TeamsEventType =>
          (TEAMS_EVENT_TYPES as readonly string[]).includes(s),
        );
      // tenantConfigured tells the UI whether to show the event toggles.
      // Teams now delivers via the ACE Bot over Graph, so "configured"
      // means the bot is connected (a service token is stored). When it
      // isn't, the UI shows the "ask your admin to connect" empty state.
      const graph = await getConnectionStatus();
      return {
        tenantConfigured: graph.connected,
        events,
        availableEvents: TEAMS_EVENT_TYPES,
      };
    },
  );

  app.patch(
    '/me/teams-config',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const me = (request.user as JwtPayload).sub;
      const parsed = TeamsConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid input',
          details: parsed.error.flatten(),
        });
      }
      const { events } = parsed.data;
      const data: { teamsNotifyOn?: string | null } = {};
      if (events !== undefined) {
        // Dedup + sort for stable storage.
        const deduped = Array.from(new Set(events)).sort();
        data.teamsNotifyOn = deduped.length > 0 ? deduped.join(',') : null;
      }
      await prisma.user.update({ where: { id: me }, data });
      await recordAudit(me, 'user.teams_config_updated', me, {
        events: data.teamsNotifyOn ?? null,
      });
      return { ok: true };
    },
  );

  // Sends a sample Adaptive Card to the calling user as a Teams DM from
  // the ACE Bot via Microsoft Graph (same path as production missed-call
  // / SMS / voicemail cards). Lets the user confirm they can receive
  // cards in Teams. 503 if the bot isn't connected; 502 on a Graph error
  // (e.g. recipient has no Teams license).
  app.post(
    '/me/teams-config/test',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const me = (request.user as JwtPayload).sub;
      const user = await prisma.user.findUnique({
        where: { id: me },
        select: {
          firstName: true,
          email: true,
        },
      });
      if (!user?.email) {
        return reply.code(409).send({
          error: 'Your account has no email on file; cannot route a Teams card.',
        });
      }
      // Bare AdaptiveCard sent via Microsoft Graph (the ACE Bot DMs the
      // user). Matches the shape the notifier sends for real events.
      const card = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '✅ ACE Dialer Teams notifications connected',
            size: 'Large',
            weight: 'Bolder',
          },
          {
            type: 'TextBlock',
            text: `Hello ${user.firstName ?? user.email}, this is a test card from ACE Dialer. You'll receive cards here when you have a missed call, a new SMS, or a voicemail (per your opt-ins).`,
            wrap: true,
            isSubtle: true,
          },
          {
            type: 'TextBlock',
            text: 'Use the toggles in Settings → Personal → Teams notifications to mute event types you don\'t want.',
            wrap: true,
            isSubtle: true,
            spacing: 'Small',
          },
        ],
      };
      const result = await sendAdaptiveCardToEmail(user.email, card);
      if (result.ok) {
        return { ok: true };
      }
      if (result.skippedReason) {
        // Bot not connected (no stored token) — admin must connect in
        // Settings → Teams connection.
        return reply.code(503).send({
          ok: false,
          error:
            'Teams notifications aren\'t connected yet. Ask your admin to connect the ACE Bot in Settings → Teams connection.',
        });
      }
      request.log.warn(
        { recipient: user.email, error: result.error },
        '[me/teams-config/test] Graph send failed',
      );
      return reply.code(502).send({
        ok: false,
        error:
          result.error?.includes('not found in Microsoft tenant')
            ? 'Your account could not be found in Microsoft Teams. Make sure you have a Teams license.'
            : `Teams send failed: ${result.error ?? 'unknown error'}`,
      });
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // v0.10.79 — Per-user email notification config.
  //
  // Parallel to Teams notifications. Same 3 event types (missed_call /
  // sms / voicemail). Independent opt-in stored in User.emailNotifyOn.
  // Default NULL/empty = OFF (no schema default — every user starts
  // opted out and chooses to enable).
  //
  // Endpoints:
  //   GET   /me/email-notifications        — read current settings
  //   PATCH /me/email-notifications        — update event opt-ins
  //   POST  /me/email-notifications/test   — send a sample email so the
  //                                          user can confirm it lands
  //                                          (and isn't filtered to spam)
  //                                          before turning real events on.
  // ═══════════════════════════════════════════════════════════════════════

  app.get(
    '/me/email-notifications',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest) => {
      const me = (request.user as JwtPayload).sub;
      const user = await prisma.user.findUnique({
        where: { id: me },
        select: { emailNotifyOn: true, email: true },
      });
      const eventsCsv = user?.emailNotifyOn ?? '';
      const events = eventsCsv
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is EmailEventType =>
          (EMAIL_EVENT_TYPES as readonly string[]).includes(s),
        );
      // emailConfigured reports whether SendGrid is wired up at the
      // service level. If false, the UI shows an "ask your admin" empty
      // state (mirrors Teams pattern).
      return {
        emailConfigured: Boolean((process.env.SENDGRID_API_KEY ?? '').trim()),
        email: user?.email ?? null,
        events,
        availableEvents: EMAIL_EVENT_TYPES,
      };
    },
  );

  app.patch(
    '/me/email-notifications',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const me = (request.user as JwtPayload).sub;
      const parsed = EmailConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid input',
          details: parsed.error.flatten(),
        });
      }
      const { events } = parsed.data;
      const data: { emailNotifyOn?: string | null } = {};
      if (events !== undefined) {
        const deduped = Array.from(new Set(events)).sort();
        data.emailNotifyOn = deduped.length > 0 ? deduped.join(',') : null;
      }
      await prisma.user.update({ where: { id: me }, data });
      await recordAudit(me, 'user.email_config_updated', me, {
        events: data.emailNotifyOn ?? null,
      });
      return { ok: true };
    },
  );

  // v0.10.79 — Sends a sample notification email to the user's own
  // address using the same SendGrid sender config as production
  // notifications. Useful to (a) verify deliverability + spam filtering
  // BEFORE relying on email for missed calls, and (b) let users see
  // what the styling looks like in their client.
  app.post(
    '/me/email-notifications/test',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply) => {
      const me = (request.user as JwtPayload).sub;
      const apiKey = (process.env.SENDGRID_API_KEY ?? '').trim();
      if (!apiKey) {
        return reply.code(503).send({
          ok: false,
          error:
            'Email notifications are not configured at the service level. Ask your admin to set SENDGRID_API_KEY.',
        });
      }
      const user = await prisma.user.findUnique({
        where: { id: me },
        select: { firstName: true, email: true },
      });
      if (!user?.email) {
        return reply.code(409).send({
          ok: false,
          error: 'Your account has no email on file; cannot send a test notification.',
        });
      }
      const result = await sendTestEmail({
        toEmail: user.email,
        firstName: user.firstName,
      });
      if (!result.ok) {
        request.log.warn(
          { status: result.status, error: result.error },
          '[me/email-notifications/test] SendGrid rejected test send',
        );
        return reply.code(502).send({
          ok: false,
          status: result.status,
          error:
            typeof result.error === 'string'
              ? result.error
              : `SendGrid returned HTTP ${result.status}`,
        });
      }
      return { ok: true, status: result.status, messageId: result.messageId };
    },
  );

  // ── GET /me/activity-summary ────────────────────────────────────────────
  //
  // v0.10.47 — Returns counts of activity in a date range for the
  // authenticated user. Used by the "Daily activity" banner shown on the
  // first sign-in of each calendar day. Client passes `since` and `until`
  // in ISO format (with time and timezone) so the banner reflects the
  // user's local calendar day, not the server's UTC day.
  //
  // Returned counts:
  //   missedCalls  — Call rows with status='missed' or 'no_answer'
  //   newSms       — Message rows with direction='inbound'
  //   voicemails   — Voicemail rows
  //
  // Cheap query — three Prisma counts. ~50ms total.
  const ActivitySummarySchema = z.object({
    since: z.string().datetime(),
    until: z.string().datetime(),
  });
  app.get(
    '/me/activity-summary',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const parsed = ActivitySummarySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: 'since and until must be ISO datetime strings',
        });
      }
      const since = new Date(parsed.data.since);
      const until = new Date(parsed.data.until);
      if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
        return reply.code(400).send({ ok: false, error: 'Invalid dates' });
      }
      if (since >= until) {
        return reply.code(400).send({ ok: false, error: 'since must be before until' });
      }

      const [missedCalls, newSms, voicemails] = await Promise.all([
        prisma.call.count({
          where: {
            userId: user.sub,
            startedAt: { gte: since, lt: until },
            status: { in: ['missed', 'no_answer', 'no-answer'] },
            direction: 'inbound',
          },
        }),
        prisma.message.count({
          where: {
            userId: user.sub,
            sentAt: { gte: since, lt: until },
            direction: 'inbound',
          },
        }),
        // Voicemail rows use receivedAt (when caller hung up after
        // leaving the message), not createdAt — the latter is the DB
        // row insertion time.
        prisma.voicemail.count({
          where: {
            userId: user.sub,
            receivedAt: { gte: since, lt: until },
          },
        }),
      ]);

      return {
        ok: true,
        since: parsed.data.since,
        until: parsed.data.until,
        missedCalls,
        newSms,
        voicemails,
      };
    },
  );

  // ── GET /me/sms-templates ───────────────────────────────────────────────
  //
  // v0.10.52 — Returns the tenant's active SMS templates for the picker
  // in the SMS compose UI. Read-only for users — admin manages the list.
  app.get(
    '/me/sms-templates',
    { onRequest: [app.authenticate] },
    async () => {
      const templates = await prisma.smsTemplate.findMany({
        where: { isActive: true },
        orderBy: [
          { category: 'asc' },
          { sortOrder: 'asc' },
          { id: 'asc' },
        ],
        select: {
          id: true,
          category: true,
          name: true,
          body: true,
          sortOrder: true,
        },
      });
      return { ok: true, templates };
    },
  );

  // ── GET /me/hold-music ──────────────────────────────────────────────────
  //
  // v0.10.48 — Returns the tenant-wide default hold music if the admin has
  // uploaded one. Each user's browser caches it locally and uses it for
  // hold-music playback when they put a call on hold. Users can override
  // with their own local file (see Settings → Microphone) — the local
  // override takes precedence over this default.
  app.get(
    '/me/hold-music',
    { onRequest: [app.authenticate] },
    async () => {
      const [url, name] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: 'hold_music_data_url' } }),
        prisma.systemSetting.findUnique({ where: { key: 'hold_music_filename' } }),
      ]);
      return {
        ok: true,
        dataUrl: url?.value ?? null,
        filename: name?.value ?? null,
      };
    },
  );

  // v0.10.101 - Device heartbeat. Called by the dialer client on login,
  // on window focus, and once a minute while active. Reports the device's
  // current app version + platform so admin can see who's on what
  // version. Response signals whether admin has requested a force-update
  // on this specific device.
  app.post(
    '/me/heartbeat',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const body = (request.body ?? {}) as {
        deviceId?: string;
        platform?: string;
        appVersion?: string;
        osLabel?: string | null;
      };
      const deviceId = (body.deviceId ?? '').trim();
      const platform = (body.platform ?? '').trim();
      const appVersion = (body.appVersion ?? '').trim();
      const osLabel = body.osLabel ? String(body.osLabel).slice(0, 200) : null;
      if (!deviceId || deviceId.length < 8 || deviceId.length > 100) {
        return reply.code(400).send({ error: 'Invalid deviceId' });
      }
      if (!platform || platform.length > 30) {
        return reply.code(400).send({ error: 'Invalid platform' });
      }
      if (!appVersion || appVersion.length > 30) {
        return reply.code(400).send({ error: 'Invalid appVersion' });
      }

      // Upsert by deviceId. New devices get a row; existing devices get
      // lastSeenAt + appVersion + platform refreshed.
      const now = new Date();
      const saved = await prisma.userDevice.upsert({
        where: { deviceId },
        update: {
          userId: u.sub,
          platform,
          appVersion,
          osLabel,
          lastSeenAt: now,
        },
        create: {
          userId: u.sub,
          deviceId,
          platform,
          appVersion,
          osLabel,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        select: {
          forceUpdateRequestedAt: true,
          forceUpdateAckedAt: true,
        },
      });

      // Force-update is "pending" if requested AND not yet acked (or
      // acked is older than requested).
      const reqAt = saved.forceUpdateRequestedAt;
      const ackAt = saved.forceUpdateAckedAt;
      const forceUpdatePending = !!reqAt && (!ackAt || ackAt < reqAt);

      return {
        ok: true,
        forceUpdate: forceUpdatePending,
        forceUpdateRequestedAt: reqAt?.toISOString() ?? null,
      };
    },
  );

  // v0.10.101 - Client acks the force-update signal (after calling
  // autoUpdater.checkForUpdatesAndNotify). We don't clear the requested
  // timestamp; we stamp acked. Admin can re-request by setting a newer
  // requested timestamp.
  app.post(
    '/me/heartbeat/ack-update',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const body = (request.body ?? {}) as { deviceId?: string };
      const deviceId = (body.deviceId ?? '').trim();
      if (!deviceId) return reply.code(400).send({ error: 'Invalid deviceId' });
      const result = await prisma.userDevice.updateMany({
        where: { deviceId, userId: u.sub },
        data: { forceUpdateAckedAt: new Date() },
      });
      return { ok: true, updated: result.count };
    },
  );

  // ── GET /me/reports/usage ──────────────────────────────────────────
  //
  // v0.10.181 — Self-view of the existing admin Usage report. Returns
  // the SAME UsageReport JSON shape that /admin/reports/usage returns,
  // but every Call / Message query is filtered to userId = req.user.sub.
  // The byUser array contains a single row (this user's totals) so the
  // frontend can reuse the UsageReport TypeScript type without changes.
  //
  // Range semantics match the admin endpoint: 'today' | '7d' | '30d'.
  app.get<{ Querystring: { range?: string } }>(
    '/me/reports/usage',
    { onRequest: [app.authenticate] },
    async (request) => {
      const u = request.user as JwtPayload;
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

      // Calls grouped by direction + status for this user only.
      const callsByDir = await prisma.call.groupBy({
        by: ['direction', 'status'],
        where: { userId: u.sub, startedAt: { gte: since } },
        _count: { _all: true },
        _sum: { durationSeconds: true },
      });
      let inbound = 0, outbound = 0, missed = 0, talkSec = 0;
      for (const r of callsByDir) {
        const c = r._count._all;
        const t = r._sum.durationSeconds ?? 0;
        if (r.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(r.status)) missed += c;
          else inbound += c;
        } else if (r.direction === 'outbound') {
          outbound += c;
        }
        talkSec += t;
      }

      // SMS grouped by direction for this user only.
      const smsByDir = await prisma.message.groupBy({
        by: ['direction'],
        where: { userId: u.sub, createdAt: { gte: since } },
        _count: { _all: true },
      });
      let smsSent = 0, smsReceived = 0;
      for (const r of smsByDir) {
        if (r.direction === 'outbound') smsSent += r._count._all;
        else smsReceived += r._count._all;
      }

      // User row (so byUser[0] has a name/email/did for display).
      const me = await prisma.user.findUnique({
        where: { id: u.sub },
        select: { id: true, email: true, firstName: true, lastName: true, didNumber: true },
      });

      const myRow = {
        userId: u.sub,
        email: me?.email ?? '(unknown)',
        name:
          ([me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() ||
            me?.email) ?? '(unknown)',
        didNumber: me?.didNumber ?? null,
        totalCalls: inbound + outbound + missed,
        inbound,
        outbound,
        missed,
        talkSeconds: talkSec,
        smsSent,
        smsReceived,
      };

      // Per-day chart, same logic as /admin/reports/usage but filtered.
      const callsInWindow = await prisma.call.findMany({
        where: { userId: u.sub, startedAt: { gte: since } },
        select: { startedAt: true, direction: true, status: true },
      });
      const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
      const byDay: Array<{ date: string; inbound: number; outbound: number; missed: number }> = [];
      for (let i = 0; i < days; i += 1) {
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        dayStart.setUTCDate(dayStart.getUTCDate() - (days - 1 - i));
        const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        let inb = 0, out = 0, mis = 0;
        for (const c of callsInWindow) {
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

      return {
        range,
        generatedAt: now.toISOString(),
        byUser: [myRow],
        byDay,
      };
    },
  );
}
