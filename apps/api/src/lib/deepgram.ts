// v0.10.216 — Deepgram speech-to-text for voice-composed SMS.
//
// ── Why this duplicates apps/webhooks/src/deepgram.ts ──────────────────
// The webhooks service has had a Deepgram helper since v0.9.15 for
// voicemail transcription. CLAUDE.md §1.4 forbids sharing TS modules
// between apps outside packages/db ("If something is shared, it goes
// through the API contract, not a shared TS module — otherwise we end up
// coupling deploys"), and this is a pure function with no HTTP surface
// worth exposing, so the deliberate call is to copy the ~40 lines that
// matter rather than couple `api` and `webhooks` deploys together.
//
// If you change the model or params here, change them there too — matching
// settings are what keep a dictated SMS and a voicemail transcript sounding
// like the same product. The webhooks copy carries the same note.
//
// ── What differs from the webhooks copy ────────────────────────────────
// That one takes a Telnyx recording URL and fetches the bytes with a Telnyx
// Bearer token first (and retries once, because Telnyx's recording CDN 404s
// for ~10s after the webhook fires). Here the browser hands us the bytes
// directly via MediaRecorder, so there's nothing to fetch and nothing to
// wait for — one attempt, fail fast, let the user hit record again.
//
// ── Data handling ──────────────────────────────────────────────────────
// Audio is never written to disk, never stored in Postgres, and never
// uploaded to Supabase. It exists as a request-scoped Buffer, goes to
// Deepgram over TLS, and is garbage-collected when the request ends. Logs
// record byte count and elapsed ms — never audio, never the transcript.
import { config } from '../config.js';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

export type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; code: 'not_configured' | 'no_speech' | 'upstream_failed'; message: string };

/**
 * Transcribe a short recording (expected: a few seconds to ~60s of speech
 * captured by MediaRecorder, typically WebM/Opus in Chrome + Electron or
 * MP4/AAC in Safari).
 *
 * `mimeType` is passed through to Deepgram as Content-Type. Deepgram
 * auto-detects container/codec from the bytes, but pinning the type helps
 * when detection is ambiguous on very short clips — which is exactly the
 * shape of input this endpoint gets.
 */
export async function transcribeAudioBytes(
  audio: Uint8Array,
  mimeType: string,
): Promise<TranscribeResult> {
  const apiKey = config.deepgramApiKey;
  if (!apiKey) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'Voice transcription is not configured on this server.',
    };
  }
  if (audio.length === 0) {
    return { ok: false, code: 'no_speech', message: 'The recording was empty.' };
  }

  const qs = new URLSearchParams({
    model: 'nova-3',
    // smart_format gives us sentence casing and punctuation, so the
    // transcript drops into the compose box as something sendable rather
    // than a lowercase run-on the user has to hand-punctuate.
    smart_format: 'true',
    punctuate: 'true',
    // 'multi' rather than 'en-US' — matches the webhooks copy. Chosen in
    // v0.9.15 because Indian-accented English transcribes materially better
    // under multi-language detection, and it costs the same as a single locale.
    language: 'multi',
  });

  const startedAt = Date.now();
  try {
    const res = await fetch(`${DEEPGRAM_API_URL}?${qs.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: audio,
    });
    const elapsed = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        '[sms-voice] deepgram transcription failed',
        res.status,
        `(${elapsed}ms, ${audio.length} bytes)`,
        text.slice(0, 200),
      );
      return {
        ok: false,
        code: 'upstream_failed',
        message: 'Transcription service is unavailable. Try again in a moment.',
      };
    }

    const body = (await res.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript = body?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';

    console.info(
      '[sms-voice] deepgram transcription completed',
      `(${elapsed}ms, ${audio.length} bytes audio, ${transcript.length} chars transcript)`,
    );

    if (!transcript) {
      return {
        ok: false,
        code: 'no_speech',
        message: "Couldn't hear any speech. Try recording again.",
      };
    }
    return { ok: true, transcript };
  } catch (e) {
    console.warn(
      '[sms-voice] deepgram transcription threw',
      e instanceof Error ? e.message : e,
    );
    return {
      ok: false,
      code: 'upstream_failed',
      message: 'Transcription service is unavailable. Try again in a moment.',
    };
  }
}
