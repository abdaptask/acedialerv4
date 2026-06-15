// Custom Voicemail Greeting API.
//
// v0.10.100 - Two greetings per user (no-answer + busy). The legacy
// /voicemail-greeting endpoints (v0.10.99 single-greeting model) keep
// working as aliases for the noanswer variant so v0.10.99 clients
// continue to function during the rollout window.
//
// Flow:
//   1. Client POSTs an audio file (or in-app recording Blob) as base64
//      JSON to POST /voicemail-greeting/:type (type = noanswer | busy).
//   2. We store the file in Supabase Storage (ace-media bucket) under
//      voicemail-greetings/u{userId}/{type}/...
//   3. We save the URL + filename on the User row and flip mode='audio'.
//
// The Call Control voicemail webhook (apps/webhooks/src/voicemailCallControl.ts)
// reads the active variant's URL/text/mode on each inbound voicemail-bound
// call and plays the right greeting.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@ace/db';
import { config } from '../config.js';
// v0.10.152 - bundled ffmpeg binary for webm→wav transcode at upload time.
// In-app MediaRecorder produces audio/webm which Telnyx <Play> cannot
// decode (caused "application error has occurred" for TeXML trial
// users in v0.10.149). v0.10.149 transcoded webm→mp3 64kbps, which
// fixed playback but produced choppy/staticky audio for WebRTC
// listeners because Telnyx then re-encoded mp3→Opus for delivery
// (double-lossy chain with incompatible psychoacoustic models).
// v0.10.152 switches the output to WAV PCM 16-bit mono 48kHz - lossless
// so Telnyx can do a single clean wav→Opus (or wav→G.711) on the
// delivery path. Larger file (~10x mp3) but acceptable at this scale.
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'node:os';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';

// v0.10.149 - ffmpeg-static's TS types declare the default export as a
// module rather than a string in some toolchains; cast to string to
// satisfy fluent-ffmpeg's signature. At runtime ffmpegPath is always a
// path string (or null when the platform binary isn't bundled).
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
}

/**
 * v0.10.152 - Transcode a buffer of webm-encoded audio to lossless WAV
 * (PCM 16-bit mono 48kHz) using the bundled ffmpeg-static binary.
 *
 * Why WAV instead of MP3: Telnyx <Play> re-encodes whatever we hand it
 * into Opus (for WebRTC listeners) or G.711 (for PSTN listeners). If
 * our file is already MP3, Telnyx has to go MP3 -> Opus, which is a
 * lossy-to-lossy transcode between two codecs with incompatible
 * psychoacoustic models. The result is audible warble/static for
 * WebRTC listeners (PSTN listeners are fine because MP3 -> G.711 is
 * fundamentally a downsample/quantize). Handing Telnyx a lossless
 * WAV eliminates the codec-mismatch artifact entirely - it becomes a
 * single clean WAV -> {Opus|G.711} step.
 *
 * Trade-off: 10s of 48kHz mono PCM 16-bit ~= 960 KB (vs ~80 KB at
 * 64kbps mp3). Acceptable at our scale and well under Telnyx Play's
 * media size cap.
 *
 * Throws if ffmpeg fails. Caller should catch and return 502 to the
 * client with a friendly message.
 */
async function transcodeWebmToWav(input: Buffer): Promise<Buffer<ArrayBufferLike>> {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const tmpIn = pathJoin(tmpdir(), `vm-greeting-${stamp}.webm`);
  const tmpOut = pathJoin(tmpdir(), `vm-greeting-${stamp}.wav`);
  await writeFile(tmpIn, input);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        // PCM 16-bit signed little-endian = standard uncompressed WAV.
        .audioCodec('pcm_s16le')
        // 48 kHz matches WebRTC Opus native sample rate so Telnyx can
        // pass through to Opus without resampling. PSTN path resamples
        // cleanly 48k -> 8k regardless.
        .audioFrequency(48000)
        .audioChannels(1)
        .toFormat('wav')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(tmpOut);
    });
    return await readFile(tmpOut);
  } finally {
    // Best-effort cleanup. If unlink fails (e.g. transcode crashed
    // before writing tmpOut), don't surface that to the caller.
    await Promise.allSettled([unlink(tmpIn), unlink(tmpOut)]);
  }
}

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

const UploadSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/aac',
  // v0.10.100 - MediaRecorder output (in-app recording).
  'audio/webm',
]);

// v0.10.100 - Type-aware helpers map a 'noanswer' vs 'busy' request to
// the corresponding User-row columns.
type GreetingType = 'noanswer' | 'busy';

interface GreetingColumns {
  url: 'voicemailGreetingUrl' | 'voicemailBusyGreetingUrl';
  filename: 'voicemailGreetingFilename' | 'voicemailBusyGreetingFilename';
  text: 'voicemailGreetingText' | 'voicemailBusyGreetingText';
  mode: 'voicemailGreetingMode' | 'voicemailBusyGreetingMode';
}

const NOANSWER_COLS: GreetingColumns = {
  url: 'voicemailGreetingUrl',
  filename: 'voicemailGreetingFilename',
  text: 'voicemailGreetingText',
  mode: 'voicemailGreetingMode',
};
const BUSY_COLS: GreetingColumns = {
  url: 'voicemailBusyGreetingUrl',
  filename: 'voicemailBusyGreetingFilename',
  text: 'voicemailBusyGreetingText',
  mode: 'voicemailBusyGreetingMode',
};
function colsFor(type: GreetingType): GreetingColumns {
  return type === 'busy' ? BUSY_COLS : NOANSWER_COLS;
}

const ALLOWED_TYPES = new Set<GreetingType>(['noanswer', 'busy']);

export async function voicemailGreetingRoutes(app: FastifyInstance) {
  app.get(
    '/voicemail-greeting',
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest) => {
      const u = request.user as JwtPayload;
      const row = await prisma.user.findUnique({
        where: { id: u.sub },
        select: {
          voicemailGreetingUrl: true,
          voicemailGreetingFilename: true,
          voicemailGreetingText: true,
          voicemailGreetingMode: true,
          voicemailBusyGreetingUrl: true,
          voicemailBusyGreetingFilename: true,
          voicemailBusyGreetingText: true,
          voicemailBusyGreetingMode: true,
        },
      });
      return {
        url: row?.voicemailGreetingUrl ?? null,
        filename: row?.voicemailGreetingFilename ?? null,
        text: row?.voicemailGreetingText ?? null,
        mode: row?.voicemailGreetingMode ?? null,
        noanswer: {
          url: row?.voicemailGreetingUrl ?? null,
          filename: row?.voicemailGreetingFilename ?? null,
          text: row?.voicemailGreetingText ?? null,
          mode: row?.voicemailGreetingMode ?? null,
        },
        busy: {
          url: row?.voicemailBusyGreetingUrl ?? null,
          filename: row?.voicemailBusyGreetingFilename ?? null,
          text: row?.voicemailBusyGreetingText ?? null,
          mode: row?.voicemailBusyGreetingMode ?? null,
        },
      };
    },
  );

  app.put<{ Params: { type: string } }>(
    '/voicemail-greeting/:type/tts',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const type = request.params.type as GreetingType;
      if (!ALLOWED_TYPES.has(type)) {
        return reply.code(400).send({ error: 'Invalid type (use noanswer or busy)' });
      }
      const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const c = colsFor(type);
      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: { [c.text]: parsed.data.text, [c.mode]: 'tts' },
        select: { [c.text]: true, [c.mode]: true },
      });
      return {
        text: (saved as unknown as Record<string, string | null>)[c.text],
        mode: (saved as unknown as Record<string, string | null>)[c.mode],
      };
    },
  );

  app.put<{ Params: { type: string } }>(
    '/voicemail-greeting/:type/mode',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const type = request.params.type as GreetingType;
      if (!ALLOWED_TYPES.has(type)) {
        return reply.code(400).send({ error: 'Invalid type (use noanswer or busy)' });
      }
      const parsed = z.object({ mode: z.enum(['audio', 'tts', 'default']) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid mode (audio, tts, or default)' });
      }
      const c = colsFor(type);
      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: { [c.mode]: parsed.data.mode },
        select: { [c.mode]: true },
      });
      return { mode: (saved as unknown as Record<string, string | null>)[c.mode] };
    },
  );

  app.post<{ Params: { type: string } }>(
    '/voicemail-greeting/:type',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const type = request.params.type as GreetingType;
      if (!ALLOWED_TYPES.has(type)) {
        return reply.code(400).send({ error: 'Invalid type (use noanswer or busy)' });
      }
      const parsed = UploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { filename, mimeType, dataBase64 } = parsed.data;
      const normalizedMime = mimeType.toLowerCase().split(';')[0].trim();
      if (!ALLOWED_MIMES.has(normalizedMime)) {
        return reply.code(400).send({
          error: `Unsupported audio type: ${mimeType}. Use MP3, WAV, M4A, AAC, OGG, or WebM.`,
        });
      }
      if (!config.supabaseUrl || !config.supabaseServiceKey) {
        return reply.code(500).send({ error: 'Supabase Storage not configured' });
      }

      // v0.10.149 - explicitly type as the wider Buffer<ArrayBufferLike>
      // variant so the post-transcode reassignment from readFile (which
      // returns the wider variant) is compatible. Runtime is identical;
      // this just matches what the @types/node strict generics expect.
      let bytes: Buffer<ArrayBufferLike> = Buffer.from(dataBase64, 'base64');
      if (bytes.length > MAX_BYTES) {
        return reply.code(413).send({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` });
      }

      // v0.10.149 - if upload is webm (in-app MediaRecorder output),
      // v0.10.152 - transcode to WAV (lossless) so Telnyx <Play> can
      // decode it AND so Telnyx's onward Opus / G.711 transcoding for
      // WebRTC / PSTN listeners is a single clean step (no codec-
      // mismatch artifacts). We adjust both the bytes and the
      // downstream filename/mime so storage + User row reflect wav.
      let effectiveMime = normalizedMime;
      let effectiveFilename = filename;
      if (normalizedMime === 'audio/webm') {
        try {
          const startMs = Date.now();
          bytes = await transcodeWebmToWav(bytes);
          effectiveMime = 'audio/wav';
          effectiveFilename = filename.replace(/\.[^.]+$/, '') + '.wav';
          app.log.info(
            { userId: u.sub, type, durMs: Date.now() - startMs, outBytes: bytes.length },
            '[vm-greeting] webm→wav transcoded',
          );
        } catch (transcodeErr) {
          app.log.error(
            { err: transcodeErr instanceof Error ? transcodeErr.message : String(transcodeErr), userId: u.sub },
            '[vm-greeting] webm→mp3 transcode failed',
          );
          return reply.code(502).send({
            error: 'Greeting recording could not be processed. Try uploading an MP3 file instead.',
          });
        }
      }

      const safeName = effectiveFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectPath = `voicemail-greetings/u${u.sub}/${type}/${Date.now()}_${safeName}`;
      const uploadUrl = `${config.supabaseUrl}/storage/v1/object/${config.supabaseMediaBucket}/${objectPath}`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.supabaseServiceKey}`,
          // v0.10.152 - use effectiveMime so transcoded webm files get
          // stored with audio/wav content-type. Telnyx + browsers
          // then receive the right MIME on fetch.
          'Content-Type': effectiveMime,
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '');
        app.log.warn(
          { status: uploadRes.status, errText, type },
          '[vm-greeting] supabase upload failed',
        );
        return reply.code(502).send({ error: 'Storage upload failed', details: errText });
      }
      const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/${config.supabaseMediaBucket}/${objectPath}`;

      const c = colsFor(type);
      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: {
          [c.url]: publicUrl,
          // v0.10.152 - record the *effective* filename so the Settings
          // UI shows the .wav extension that's actually stored.
          [c.filename]: effectiveFilename,
          [c.mode]: 'audio',
        },
        select: { [c.url]: true, [c.filename]: true, [c.mode]: true },
      });
      app.log.info({ userId: u.sub, url: publicUrl, type }, '[vm-greeting] saved');
      return {
        url: (saved as unknown as Record<string, string | null>)[c.url],
        filename: (saved as unknown as Record<string, string | null>)[c.filename],
        mode: (saved as unknown as Record<string, string | null>)[c.mode],
      };
    },
  );

  app.delete<{ Params: { type: string } }>(
    '/voicemail-greeting/:type',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const type = request.params.type as GreetingType;
      if (!ALLOWED_TYPES.has(type)) {
        return reply.code(400).send({ error: 'Invalid type (use noanswer or busy)' });
      }
      const user = await prisma.user.findUnique({ where: { id: u.sub } });
      if (!user) return reply.code(404).send({ error: 'User not found' });
      const c = colsFor(type);
      await prisma.user.update({
        where: { id: u.sub },
        data: { [c.url]: null, [c.filename]: null },
      });
      return { ok: true };
    },
  );

  // ------ Legacy v0.10.99 shim endpoints (alias to noanswer). ------
  app.put(
    '/voicemail-greeting/tts',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: { voicemailGreetingText: parsed.data.text, voicemailGreetingMode: 'tts' },
        select: { voicemailGreetingText: true, voicemailGreetingMode: true },
      });
      return { text: saved.voicemailGreetingText, mode: saved.voicemailGreetingMode };
    },
  );

  app.put(
    '/voicemail-greeting/mode',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const parsed = z.object({ mode: z.enum(['audio', 'tts', 'default']) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid mode (audio, tts, or default)' });
      }
      const saved = await prisma.user.update({
        where: { id: u.sub },
        data: { voicemailGreetingMode: parsed.data.mode },
        select: { voicemailGreetingMode: true },
      });
      return { mode: saved.voicemailGreetingMode };
    },
  );

  app.delete(
    '/voicemail-greeting',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const u = request.user as JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: u.sub } });
      if (!user) return reply.code(404).send({ error: 'User not found' });
      await prisma.user.update({
        where: { id: u.sub },
        data: { voicemailGreetingUrl: null, voicemailGreetingFilename: null },
      });
      return { ok: true };
    },
  );
}