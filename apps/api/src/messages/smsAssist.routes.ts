// v0.10.216 — Composer assists: voice-to-text and AI rewrite.
//
//   POST /me/sms/transcribe   audio bytes -> transcript (Deepgram)
//   POST /me/sms/rewrite      draft text  -> corrected draft (Qwen on our DGX)
//
// Both are *composition* helpers. Neither sends anything, neither touches
// the Message table, and neither is reachable from the send path — the text
// they produce lands in the compose box exactly as if the user had typed it,
// and the user still has to press Send. That separation is deliberate: it
// means no failure in either integration can produce an unreviewed outbound
// message.
//
// ── Kill switches ──────────────────────────────────────────────────────
// Each returns 501 when unconfigured, and the client hides the corresponding
// button: unset DEEPGRAM_API_KEY for voice, or set LLM_PROVIDER=off for
// rewrite, then restart ace-api. Either feature disappears in seconds with no
// deploy and no effect on ordinary SMS.
//
// ── Data handling ──────────────────────────────────────────────────────
// Audio: request-scoped buffer -> Deepgram -> discarded. Never written to
// disk, Postgres, or Supabase.
// Text: request-scoped -> the model -> returned. Never persisted. By default
// the model runs on our own DGX, so drafts never leave the network.
// Audit rows record lengths, duration, and outcome — never the audio, the
// transcript, or the message text. Message content belongs in the Message
// table when the user sends it, and nowhere else.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { recordAudit } from '../lib/audit.js';
import { config } from '../config.js';
import { transcribeAudioBytes } from '../lib/deepgram.js';
import { REWRITE_MAX_CHARS, isRewriteConfigured, rewriteSmsDraft } from '../lib/smsRewrite.js';
import { activeModelLabel } from '../lib/llm.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

/**
 * ~60 seconds of Opus at MediaRecorder's default bitrate is well under 1 MB;
 * 4 MB of base64 (~3 MB of audio) leaves generous headroom for a less
 * efficient codec (Safari's AAC) while still bounding a hostile upload.
 */
const MAX_AUDIO_BASE64 = 4 * 1024 * 1024;

const TranscribeInput = z.object({
  /** MediaRecorder's mimeType, e.g. "audio/webm;codecs=opus". */
  mimeType: z
    .string()
    .min(1)
    .max(100)
    .refine((m) => m.startsWith('audio/') || m.startsWith('video/webm'), {
      // Chrome sometimes reports a webm *container* as video/webm even for an
      // audio-only recording, so that one non-audio prefix is allowed through.
      message: 'Unsupported audio type',
    }),
  dataBase64: z.string().min(1).max(MAX_AUDIO_BASE64),
});

const RewriteInput = z.object({
  body: z.string().min(1).max(REWRITE_MAX_CHARS),
});

/**
 * Per-user, per-endpoint fixed-window limiter, in process memory.
 *
 * Rewrite runs on our own GPUs and transcription is billed per audio-minute,
 * so the risk isn't a runaway invoice so much as one user's render loop
 * saturating a shared resource for everyone else. In-process is
 * sufficient here: `api` runs as a single pm2 process, and the goal is
 * accident containment rather than defence against a determined attacker
 * (who is already authenticated as a real employee and audited).
 *
 * If `api` is ever scaled to a cluster, move this to Redis — ioredis is
 * already a dependency.
 */
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { transcribe: 40, rewrite: 40 } as const;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(userId: number, kind: keyof typeof LIMITS): boolean {
  const key = `${kind}:${userId}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMITS[kind];
}

// Opportunistic sweep so the map can't grow unbounded across a long uptime.
// Cheap: one pass over at most (users x 2) entries, every 15 minutes.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(key);
  }
}, WINDOW_MS);
sweep.unref();

export async function smsAssistRoutes(app: FastifyInstance) {
  // ── POST /me/sms/transcribe ───────────────────────────────────────────
  app.post('/me/sms/transcribe', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (!config.deepgramApiKey) {
      return reply.code(501).send({
        ok: false,
        error: 'Voice transcription is not configured on this server.',
      });
    }
    if (rateLimited(user.sub, 'transcribe')) {
      return reply.code(429).send({
        ok: false,
        error: 'Too many recordings in a short time. Try again in a few minutes.',
      });
    }

    const parsed = TranscribeInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: 'Recording was too large or in an unsupported format.',
      });
    }

    let audio: Buffer;
    try {
      audio = Buffer.from(parsed.data.dataBase64, 'base64');
    } catch {
      return reply.code(400).send({ ok: false, error: 'Recording could not be decoded.' });
    }

    const result = await transcribeAudioBytes(audio, parsed.data.mimeType);

    if (!result.ok) {
      // 'not_configured' is already handled above; treat anything else as a
      // soft failure the user can retry, and don't audit a non-event.
      const status = result.code === 'no_speech' ? 422 : 502;
      return reply.code(status).send({ ok: false, error: result.message, code: result.code });
    }

    // Length and byte count only — never the transcript.
    await recordAudit(user.sub, 'sms.voice_transcribed', null, {
      audioBytes: audio.length,
      transcriptChars: result.transcript.length,
    });

    return { ok: true, transcript: result.transcript };
  });

  // ── POST /me/sms/rewrite ──────────────────────────────────────────────
  app.post('/me/sms/rewrite', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;

    if (!isRewriteConfigured()) {
      return reply.code(501).send({
        ok: false,
        error: 'AI rewrite is not configured on this server.',
      });
    }
    if (rateLimited(user.sub, 'rewrite')) {
      return reply.code(429).send({
        ok: false,
        error: 'Too many rewrites in a short time. Try again in a few minutes.',
      });
    }

    const parsed = RewriteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Message is empty or too long to rewrite.' });
    }

    const result = await rewriteSmsDraft(parsed.data.body);

    if (!result.ok) {
      const status =
        result.code === 'too_short' || result.code === 'too_long'
          ? 400
          : result.code === 'guard_failed'
            ? 422
            : 502;
      // Audit the guard rejections: a run of these is the signal that the
      // model or the prompt has drifted and needs attention.
      if (result.code === 'guard_failed') {
        await recordAudit(user.sub, 'sms.ai_rewrite', null, {
          model: activeModelLabel(),
          inputChars: parsed.data.body.length,
          outcome: 'rejected_by_guard',
        });
      }
      return reply.code(status).send({ ok: false, error: result.message, code: result.code });
    }

    // Lengths and outcome only — never the draft or the rewrite.
    await recordAudit(user.sub, 'sms.ai_rewrite', null, {
      model: activeModelLabel(),
      inputChars: parsed.data.body.length,
      outputChars: result.rewritten.length,
      warnings: result.warnings.length,
      outcome: result.unchanged ? 'unchanged' : 'rewritten',
    });

    return {
      ok: true,
      rewritten: result.rewritten,
      warnings: result.warnings,
      unchanged: result.unchanged,
      verify: result.verify,
    };
  });
}
