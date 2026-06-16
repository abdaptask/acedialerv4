// Voicemail endpoints. Phase 5.6.
// Voicemail records are inserted by the webhook handler when Telnyx finishes
// recording an unanswered call. The user endpoints below read + mark as
// listened.
//
// v0.10.157 - audio refresh helper for older recordings whose stored
// signed URL has expired. See task #28 + the audio proxy route below.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';

// v0.10.157/.163 - Parse a Telnyx recording UUID out of a stored
// download URL. v0.10.163 broadened the regex to also match the
// actual Telnyx S3 telephony-recorder-prod filename pattern:
//   /.../<account_id>/<date>/<recording_id>-<timestamp>.mp3
// Earlier versions only matched /recordings/<uuid>/ paths and silently
// returned null for the S3 filename pattern, defeating the refresh
// logic for any voicemail Telnyx stored on S3 (i.e., basically all of
// them). New regex tries multiple patterns in order; the last-resort
// branch picks the rightmost UUID in the path since the account_id
// typically comes before the recording_id.
function extractRecordingIdFromUrl(url: string): string | null {
  // Strip query string so signature params don't interfere with matching.
  const path = url.split('?')[0];

  // Pattern A: Telnyx S3 telephony-recorder-prod filename
  //   /.../<recording_uuid>-<timestamp>.{mp3,wav}
  const s3Filename = path.match(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+\.(?:mp3|wav)$/i,
  );
  if (s3Filename) return s3Filename[1];

  // Pattern B: api.telnyx.com/v2/recordings/<uuid>/...
  const apiPath = path.match(
    /\/recordings?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (apiPath) return apiPath[1];

  // Pattern C: simple /<uuid>.{mp3,wav}
  const simpleFilename = path.match(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:mp3|wav)$/i,
  );
  if (simpleFilename) return simpleFilename[1];

  // Pattern D (last resort): any UUID anywhere in the path. Prefer
  // the rightmost since account_id usually precedes recording_id.
  const allUuids = [
    ...path.matchAll(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    ),
  ];
  if (allUuids.length > 0) return allUuids[allUuids.length - 1][1];

  return null;
}

// v0.10.157/.161 - Query Telnyx Recordings API for a fresh signed
// download URL. v0.10.161 widened the return type so callers receive
// BOTH the url (or null) AND a structured diagnostic explaining why
// it might be null. Lets us log the actual failure mode (Telnyx 404,
// 401, parse error, etc.) instead of silently bailing.
interface TelnyxRefreshResult {
  url: string | null;
  diagnostic: {
    telnyxStatus?: number;
    bodyKeys?: string[];
    errSample?: string;
    err?: string;
  };
}
async function getFreshTelnyxDownloadUrl(
  recordingId: string,
  telnyxKey: string,
): Promise<TelnyxRefreshResult> {
  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/recordings/${encodeURIComponent(recordingId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${telnyxKey}` } },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        url: null,
        diagnostic: {
          telnyxStatus: res.status,
          errSample: errText.slice(0, 300),
        },
      };
    }
    const body = (await res.json()) as {
      data?: {
        download_urls?: { mp3?: string; wav?: string };
        recording_url?: string;
      };
    };
    const url =
      body?.data?.download_urls?.mp3 ??
      body?.data?.download_urls?.wav ??
      body?.data?.recording_url ??
      null;
    return {
      url,
      diagnostic: {
        telnyxStatus: res.status,
        bodyKeys: body?.data ? Object.keys(body.data) : [],
      },
    };
  } catch (e) {
    return {
      url: null,
      diagnostic: { err: e instanceof Error ? e.message : String(e) },
    };
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
  app.get('/voicemails', { onRequest: [app.authenticate] }, async (request: FastifyRequest, reply) => {
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
    // v0.10.163 - short browser cache to reduce bandwidth from the
    // polling pattern in the Voicemail list view. 30s is short enough
    // that a brand-new voicemail still appears within reason, long
    // enough to cut down on ~75% of redundant fetches during normal
    // listening sessions.
    reply.header('Cache-Control', 'private, max-age=30');
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

      // v0.10.161 - log every decision point so failures can be
      // diagnosed from Render logs alone. The previous code only
      // logged the generic "fetch failed" line at the end and we
      // couldn't tell which step in the chain broke (regex, Telnyx
      // API call, retry, etc.). All log lines include voicemailId.
      const urlHost = (() => {
        try { return new URL(vm.recordingUrl).hostname; }
        catch { return 'invalid-url'; }
      })();
      request.log.info(
        { voicemailId: vm.id, hasTelnyxKey: !!telnyxKey, urlHost },
        '[voicemail] audio proxy: start',
      );

      try {
        let upstream = await tryFetch(vm.recordingUrl);
        request.log.info(
          { voicemailId: vm.id, firstAttemptStatus: upstream.status },
          '[voicemail] audio proxy: first fetch attempt',
        );

        if (
          (upstream.status === 401 || upstream.status === 403) &&
          telnyxKey
        ) {
          const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
          if (!recordingId) {
            request.log.warn(
              {
                voicemailId: vm.id,
                urlSample: vm.recordingUrl.split('?')[0].slice(0, 200),
              },
              '[voicemail] regex did NOT extract a recordingId from URL',
            );
          } else {
            const { url: freshUrl, diagnostic } =
              await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
            request.log.info(
              {
                voicemailId: vm.id,
                recordingId,
                gotFreshUrl: !!freshUrl,
                ...diagnostic,
              },
              '[voicemail] Telnyx Recordings API lookup result',
            );
            if (freshUrl) {
              request.log.info(
                { voicemailId: vm.id, recordingId },
                '[voicemail] stored URL expired, retrying with fresh signed URL',
              );
              upstream = await tryFetch(freshUrl);
              request.log.info(
                { voicemailId: vm.id, retryStatus: upstream.status },
                '[voicemail] retry with fresh URL result',
              );
            }
          }
        } else if (
          (upstream.status === 401 || upstream.status === 403) &&
          !telnyxKey
        ) {
          request.log.warn(
            { voicemailId: vm.id, firstAttemptStatus: upstream.status },
            '[voicemail] TELNYX_API_KEY not set - cannot refresh expired URLs',
          );
        }

        if (!upstream.ok) {
          // Capture upstream body sample so a 403 XML from S3 (or
          // anything else) is visible in the log line.
          const bodySample = await upstream
            .text()
            .catch(() => '')
            .then((t) => t.slice(0, 300));
          request.log.warn(
            { voicemailId: vm.id, status: upstream.status, bodySample },
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

  // v0.10.163 - GET /voicemails/:id/fresh-url
  // Returns a freshly-signed Telnyx S3 download URL for the voicemail's
  // recording. The stored vm.recordingUrl is signed with a finite
  // expiry (Telnyx currently uses 10 min); after that window the URL
  // returns 403. The frontend hits this endpoint on row expand to
  // get a fresh URL it can hand to the <audio> element.
  //
  // Falls back to the stored URL on any internal failure (no API key,
  // unparseable URL, Telnyx error) so fresh voicemails - whose stored
  // URL still works - never regress.
  //
  // Why we return a URL instead of proxying audio bytes through our
  // server: keeps our outbound bandwidth low. Audio still streams
  // browser <-> S3 directly. Render bandwidth measured in KB per click,
  // not MB.
  app.get('/voicemails/:id/fresh-url', { onRequest: [app.authenticate] }, async (request, reply) => {
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
    if (!telnyxKey) {
      request.log.warn(
        { voicemailId: vm.id },
        '[voicemail] fresh-url: no TELNYX_API_KEY - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const recordingId = extractRecordingIdFromUrl(vm.recordingUrl);
    if (!recordingId) {
      request.log.warn(
        { voicemailId: vm.id, urlSample: vm.recordingUrl.split('?')[0].slice(0, 200) },
        '[voicemail] fresh-url: regex did NOT extract recordingId - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    const { url: freshUrl, diagnostic } = await getFreshTelnyxDownloadUrl(recordingId, telnyxKey);
    if (!freshUrl) {
      request.log.warn(
        { voicemailId: vm.id, recordingId, ...diagnostic },
        '[voicemail] fresh-url: Telnyx Recordings API did not return a URL - returning stored URL as fallback',
      );
      return { url: vm.recordingUrl };
    }

    request.log.info(
      { voicemailId: vm.id, recordingId },
      '[voicemail] fresh-url: returning fresh signed URL',
    );
    return { url: freshUrl };
  });

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
