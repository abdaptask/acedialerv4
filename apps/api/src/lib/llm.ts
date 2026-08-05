// v0.10.216 — LLM provider abstraction for the SMS rewrite feature.
//
// Default and intended provider is our **self-hosted Qwen on the DGX**
// (Ollama at 172.16.219.222:11434). Nothing leaves ApTask's network and there
// is no per-token cost. The Anthropic path is retained but dormant — it only
// runs if someone explicitly sets LLM_PROVIDER=anthropic, so a stray
// ANTHROPIC_API_KEY in the environment can never quietly start billing.
//
// ── Why the native Ollama API and not the OpenAI-compatible /v1 path ───
// The internal migration guide says Ollama's /v1 endpoint is a drop-in
// OpenAI replacement — "change base_url and model". That is true in general
// and FALSE for Qwen3, which is a hybrid *reasoning* model. Measured against
// the live DGX on 2026-08-04 with this feature's real prompt:
//
//                          via /v1          via /api/chat + think:false
//   latency (avg)          16,031 ms        772 ms
//   output tokens          ~640             24
//   guard pass rate        5/7              7/7
//
// The /v1 path gives no way to disable thinking — the documented
// `chat_template_kwargs: {enable_thinking: false}` is silently IGNORED (also
// verified). Worse than slow: Ollama returns the reasoning in a separate
// `reasoning` field, so when it exhausts max_tokens before answering you get
// HTTP 200 with an EMPTY content string and no obvious cause. Two of seven
// probe drafts failed exactly that way.
//
// So: native /api/chat, `think: false`, and read `message.content`. Do not
// "simplify" this back to the OpenAI SDK without re-measuring.
import Anthropic from '@anthropic-ai/sdk';

import { config } from '../config.js';

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Low but non-zero: we want the most probable edit, not variety. */
  temperature?: number;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; code: 'not_configured' | 'upstream_failed'; message: string };

/** Which backend is live. 'off' disables the feature (returns 501 upstream). */
export function activeProvider(): 'ollama' | 'anthropic' | 'off' {
  const p = config.llmProvider.toLowerCase();
  if (p === 'off' || p === 'none' || p === 'disabled') return 'off';
  if (p === 'anthropic') return 'anthropic';
  return 'ollama';
}

export function isLlmConfigured(): boolean {
  const provider = activeProvider();
  if (provider === 'off') return false;
  if (provider === 'anthropic') return Boolean(config.anthropicApiKey);
  return Boolean(config.llmBaseUrl && config.llmModel);
}

/** Human-readable identity of the model in use, for audit rows. */
export function activeModelLabel(): string {
  const provider = activeProvider();
  if (provider === 'anthropic') return `anthropic:${config.anthropicModel}`;
  if (provider === 'off') return 'off';
  return `ollama:${config.llmModel}`;
}

export async function chatComplete(req: ChatRequest): Promise<ChatResult> {
  switch (activeProvider()) {
    case 'off':
      return { ok: false, code: 'not_configured', message: 'AI rewrite is disabled on this server.' };
    case 'anthropic':
      return anthropicComplete(req);
    default:
      return ollamaComplete(req);
  }
}

// ── Ollama / Qwen on the DGX (default) ─────────────────────────────────

async function ollamaComplete(req: ChatRequest): Promise<ChatResult> {
  if (!config.llmBaseUrl || !config.llmModel) {
    return { ok: false, code: 'not_configured', message: 'AI rewrite is not configured on this server.' };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${config.llmBaseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.llmModel,
        stream: false,
        // The load-bearing parameter — see the header note.
        think: false,
        options: {
          temperature: req.temperature ?? 0.2,
          num_predict: req.maxTokens,
        },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
      // A warm 9B model answers in ~1s; a cold one has to load into VRAM,
      // which was measured at ~47s. 60s keeps a cold start from surfacing as
      // an error, and boot-time pre-warming (see prewarmLlm) makes it rare.
      signal: AbortSignal.timeout(60_000),
    });

    const elapsed = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        '[llm] ollama request failed',
        res.status,
        `(${elapsed}ms, model=${config.llmModel})`,
        text.slice(0, 200),
      );
      return {
        ok: false,
        code: 'upstream_failed',
        message: 'Rewrite service is unavailable. Try again in a moment.',
      };
    }

    const body = (await res.json()) as {
      message?: { content?: string; thinking?: string };
      eval_count?: number;
    };
    const text = (body.message?.content ?? '').trim();

    // Never log message content — lengths and timing only.
    console.info(
      '[llm] ollama completed',
      `(${elapsed}ms, ${body.eval_count ?? '?'} tokens, ${text.length} chars)`,
    );

    if (!text) {
      // Almost always means thinking wasn't suppressed and ate the token
      // budget. Log loudly with the tell (a populated `thinking` field) so
      // this is diagnosable rather than a mystery empty response.
      console.warn(
        '[llm] ollama returned empty content',
        `(thinking field: ${body.message?.thinking?.length ?? 0} chars — if non-zero, "think: false" is not taking effect)`,
      );
      return {
        ok: false,
        code: 'upstream_failed',
        message: 'Rewrite service returned nothing. Try again in a moment.',
      };
    }

    return { ok: true, text };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'TimeoutError';
    console.warn('[llm] ollama request threw', aborted ? 'timeout' : e instanceof Error ? e.message : e);
    return {
      ok: false,
      code: 'upstream_failed',
      message: aborted
        ? 'Rewrite timed out. The model may be starting up — try again.'
        : 'Rewrite service is unavailable. Try again in a moment.',
    };
  }
}

/**
 * Ask the DGX to load the model into VRAM so the first real user doesn't pay
 * the cold-start cost (measured at ~47s for a 9B model that had been evicted).
 * Fire-and-forget from boot; failures are logged and ignored.
 */
export async function prewarmLlm(): Promise<void> {
  if (activeProvider() !== 'ollama' || !config.llmBaseUrl || !config.llmModel) return;
  try {
    const res = await fetch(`${config.llmBaseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.llmModel,
        stream: false,
        think: false,
        // keep_alive holds the model in VRAM between requests, so an idle
        // afternoon doesn't evict it and re-impose the cold start.
        keep_alive: config.llmKeepAlive,
        options: { num_predict: 1 },
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    console.info(`[llm] prewarm ${config.llmModel}: HTTP ${res.status}`);
  } catch (e) {
    console.warn('[llm] prewarm failed (first rewrite may be slow):', e instanceof Error ? e.message : e);
  }
}

// ── Anthropic (dormant fallback) ───────────────────────────────────────
//
// Only reachable with LLM_PROVIDER=anthropic. Kept so a DGX outage or
// decommission is a one-env-var switch rather than a code change; costs
// nothing while unused.

let anthropicClient: Anthropic | null = null;

async function anthropicComplete(req: ChatRequest): Promise<ChatResult> {
  if (!config.anthropicApiKey) {
    return { ok: false, code: 'not_configured', message: 'AI rewrite is not configured on this server.' };
  }
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const res = await anthropicClient.messages.create({
      model: config.anthropicModel,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    for (const block of res.content) {
      if (block.type === 'text') return { ok: true, text: block.text.trim() };
    }
    return { ok: false, code: 'upstream_failed', message: 'Rewrite service returned nothing.' };
  } catch (e) {
    console.warn('[llm] anthropic request failed', e instanceof Error ? e.message : e);
    return {
      ok: false,
      code: 'upstream_failed',
      message: 'Rewrite service is unavailable. Try again in a moment.',
    };
  }
}
