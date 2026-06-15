// Voicemail endpoints. Phase 5.6.
// Voicemail records are inserted by the webhook handler when Telnyx finishes
// recording an unanswered call. The user endpoints below read + mark as
// listened.
//
// v0.10.157 - audio refresh helper for older recordings whose stored
// signed URL has expired. See task #28 + the audio proxy route below.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';

// v0.10.157 - Parse a Telnyx recording UUID out of a stored download URL.
// Telnyx URLs typically embed the recording_id as a UUID in the path,
// e.g. https://api.telnyx.com/v2/recordings/<uuid>/download/<token>.mp3
// or https://media.telnyx.com/v2/recording/<uuid>.mp3. Returns null if
// no UUID-shaped segment is present (older test setups using S3, etc.).
function extractRecordingIdFromUrl(url: string): string | null {
  const m = url.match(/\/recordings?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

// v0.10.157 - Query Telnyx Recordings API for a fresh signed download URL.
// Used when the stored URL returns 401/403 (signature expired). Returns
// null on any error so the caller can surface the original failure
// without masking it. We prefer the mp3 download_url; fall back to wav.
async function getFreshTelnyxDownloadUrl(
  recordingId: string,
  telnyxKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/recordings/${encodeURIComponent(recordingId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${telnyxKey}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        download_urls?: { mp3?: string; wav?: string };
        // Some Telnyx responses use 'recording_url' as a flat field
        // (older API shape). Accept either.
        recording_url?: string;
      };
    };
    return (
      body?.data?.download_urls?.mp3 ??
      body?.data?.download_urls?.wav ??
      body?.data?.recording_url ??
      null
    );
  } catch {
    return null;
  }
}

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

// Hard retention period for voicemails. Anything older than this is
// auto-deleted on the next list fetch. Frontend renders an "Auto-deletes
// in X days" countdown using the same constant.
export const VOICEMAIL_RETENTION_DAYS = 30;

// Delete voicemails older than the retention window FOR THIS USER.
// Lazy approach — runs on every /voicemails list fetch, so we don't need
// a long-running cron. The cost is O(rows deleted) DELETE which uses the
// (userId, receivedAt) index; trivial for normal volumes.
async function purgeExpired(userId: number): Promise<number> {
  const cutoff = new Date(Date.now() - VOICEMAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const res = await prisma.voicemail.deleteMany({
    where: { userId, receivedAt: { lt: cutoff } },
  });
  return res.count;
}

export async function voicemailsRoutes(app: FastifyInstance) {
  // GET /voicemails — list newest-first, capped at 100. Also purges any
  // voicemails past the 30-day retention window before returning, so the
  // user never sees expired rows.
  app.get('/voicemails', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const user = request.user as JwtPayload;
    const purged = await purgeExpired(user.sub);
    if (purged > 0) {
      app.log.info({ userId: user.sub, purged }, '[voicemail] auto-deleted expired rows');
    }
    const items = await prisma.voicemail.findMany({
      where: { userId: user.sub },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      // v0.10.0 Task 5 — include UserDid for the line-badge tag.
      include: {
        userDid: {
          select: { id: true, label: true, colorHex: true, didNumber: true },
        },
      },
    });
    return items;
  });

  // GET /voicemails/retention — what the frontend uses to compute the
  // "auto-deletes in X days" countdown. Exposing as an endpoint keeps the
  // value server-controlled — if we ever change retention to 60 or 90 days,
  // the frontend updates automatically without a redeploy.
  app.get('/voicemails/retention', { onRequest: [app.authenticate] }, async () => {
    return { days: VOICEMAIL_RETENTION_DAYS };
  });

  // GET /voicemails/unread/count — small endpoint to populate the tab badge.
  app.get('/voicemails/unread/count', { onRequest: [app.authenticate] }, async (request: FastifyRequest) => {
    const user = request.user as JwtPayload;
    // Also purge here so the badge doesn't count expired rows.
    await purgeExpired(user.sub);
    const count = await prisma.voicemail.count({
      where: { userId: user.sub, listenedAt: null },
    });
    return { count };
  });

  // v0.10.2 Task 9 — single voicemail metadata for the playback page.
  // Used by /voicemail/:id/play to render caller info + transcript.
  // Guards on userId so a user can't fetch someone else's voicemail.
  app.get('/voicemails/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const vmId = Number(id);
    if (!Number.isFinite(vmId)) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const vm = await prisma.voicemail.findFirst({
      where: { id: vmId, userId: user.sub },
      include: {
        userDid: {
          select: { id: true, label: true, colorHex: true, didNumber: true },
        },
      },
    });
    if (!vm) return reply.code(404).send({ error: 'Not found' });
    return vm;
  });

  // v0.10.2 Task 9 — audio proxy. Telnyx hosted-voicemail recordings
  // live behind a Bearer-auth-protected URL on api.telnyx.com — the
  // browser can't fetch them directly. We proxy: authenticate the
  // requesting user via JWT, verify they own the voicemail, fetch the
  // upstream MP3 with our Telnyx API key, stream the bytes back with
  // an audio Content-Type so the HTML5 <audio> tag plays it.
  //
  // v0.10.157 - older recordings (months back) have a stored
  // recordingUrl whose signature has expired, so the upstream fetch
  // returns 401 or 403 even with a valid Bearer token. When that
  // happens, parse the recording UUID out of the stored URL, query
  // Telnyx Recordings API to get a fresh signed download URL, and
  // retry once. Brand-new voicemails are unaffected because their
  // stored URL still works on the first try.
  app.get(
    '/voicemails/:id/audio',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const vmId = Number(id);
      if (!Number.isFinite(vmId)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const vm = await prisma.voicemail.findFirst({
        where: { id: vmId, userId: user.sub },
        select: { id: true, recordingUrl: true },
      });
      if (!vm) return reply.code(404).send({ error: 'Not found' });
      if (!vm.recordingUrl) {
        return reply.code(404).send({ error: 'No recording available' });
      }
      const telnyxKey = process.env.TELNYX_API_KEY;

      // Helper: attempt a single upstream fetch with appropriate auth.
      const tryFetch = async (url: string) => {
        const headers: Record<string, string> = {};
        if (telnyxKey && /(^|\.)telnyx\.com\//.test(url)) {
          headers.Authorization = `Bearer ${telnyxKey}`;
        }
        return fetch(url, { method: 'GET', headers });
      };

      try {
        // First attempt: the URL captured at receive-time.
        let upstream = await tryFetch(vm.recordingUrl);

        // v0.10.157 - recover from expired signed URLs. 401/403 on a
        // Telnyx URL almost always means the URL signature lapsed
        // (not an auth-key issue, since the same key works for fresh
        // recordings). Try refreshing once.
        if (
          (upstream.status === 401 || upstream.status === 403) &&
          telnyxKey
        ) {
          const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
          if (recordingId) {
            const freshUrl = await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
            if (freshUrl) {
              request.log.info(
                { voicemailId: vm.id, recordingId },
                '[voicemail] stored URL expired, retrying with fresh signed URL',
              );
              upstream = await tryFetch(freshUrl);
            }
          }
        }

        if (!upstream.ok) {
          request.log.warn(
            { voicemailId: vm.id, status: upstream.status },
            '[voicemail] upstream audio fetch failed (after refresh attempt)',
          );
          return reply.code(502).send({
            error: `Failed to fetch audio: HTTP ${upstream.status}`,
          });
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        // Telnyx recordings are MP3. Set explicit Content-Type so the
        // browser's <audio> element plays without guessing. Allow
        // caching since the recording itself is immutable.
        reply
          .header('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
          .header('Content-Length', String(buf.length))
          .header('Cache-Control', 'private, max-age=3600')
          .header('Accept-Ranges', 'bytes');
        return reply.send(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        request.log.error({ err: msg }, '[voicemail] audio proxy error');
        return reply.code(502).send({ error: `Audio proxy error: ${msg}` });
      }
    },
  );

  // PATCH /voicemails/:id  { listened?: boolean }
  app.patch('/voicemails/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const body = (request.body as { listened?: boolean }) ?? {};
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const data: Record<string, unknown> = {};
    if (body.listened === true) data.listenedAt = new Date();
    else if (body.listened === false) data.listenedAt = null;
    const updated = await prisma.voicemail.update({
      where: { id: existing.id },
      data,
    });
    return updated;
  });

  // PATCH /voicemails/bulk  { ids: number[], listened: boolean }
  // Bulk mark multiple voicemails as listened/unlistened. Used by the
  // select-mode toolbar.
  app.patch('/voicemails/bulk', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = (request.body as { ids?: number[]; listened?: boolean }) ?? {};
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'ids[] required' });
    }
    if (typeof body.listened !== 'boolean') {
      return reply.code(400).send({ error: 'listened (boolean) required' });
    }
    const result = await prisma.voicemail.updateMany({
      where: { id: { in: body.ids.map((i) => Number(i)) }, userId: user.sub },
      data: { listenedAt: body.listened ? new Date() : null },
    });
    return { ok: true, count: result.count };
  });

  // DELETE /voicemails/:id
  app.delete('/voicemails/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.voicemail.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}
