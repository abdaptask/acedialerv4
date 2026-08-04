// v0.10.216 — "Rewrite with AI" for the SMS composer.
//
// Fixes grammar, spelling, and sentence structure in a recruiter's draft
// while leaving the facts alone. The user always reviews the result before
// it can be sent; this module never sends anything.
//
// ── Privacy contract ───────────────────────────────────────────────────
// The request body sent to the model contains the draft text and nothing
// else: no thread history, no contact name or phone number, no user id, no
// DID, no account metadata. By default the model is on our own DGX, so the
// draft doesn't leave ApTask's network at all. Placeholders stay literal, so a templated
// `{firstName}` never leaves as a real candidate name. Neither the input nor
// the output is logged or persisted — the audit trail records lengths and
// outcome only (see smsAssist.routes.ts).
//
// ── Why the output is mechanically validated ───────────────────────────
// A system prompt is guidance, not a guarantee. The genuinely damaging
// failure isn't a clumsy rewrite — it's a *plausible* one that quietly
// changes a pay rate from 65 to 60, drops a placeholder so the candidate
// receives "Hi ,", or swaps a URL. Those read as correct to someone
// skimming a review sheet. So every guard below is a hard, mechanical
// check, and a failed guard means the user keeps their original text
// (fail closed on outbound action — CLAUDE.md cross-cutting invariants).
//
// ── Model + where it runs ──────────────────────────────────────────────
// Self-hosted Qwen on the ApTask DGX by default (see lib/llm.ts for the
// provider abstraction and the measured reasons it uses Ollama's native API
// rather than the OpenAI-compatible one). Zero per-token cost, and no draft
// text leaves the network.
//
// Measured on the live box 2026-08-04 with the prompt below: qwen3.5:9b at
// ~1.1s warm, ~24 output tokens, 6/7 realistic drafts clearing the guards
// first try. qwen3:8b-nothink is ~770ms but edits more timidly (it left one
// draft untouched). Anthropic remains available as a dormant fallback.
import { chatComplete, isLlmConfigured } from './llm.js';
import {
  REWRITE_MAX_CHARS,
  REWRITE_MIN_CHARS,
  checkRewrite,
  cleanModelText,
  factsToVerify,
} from './smsRewriteGuards.js';

export { REWRITE_MAX_CHARS, REWRITE_MIN_CHARS } from './smsRewriteGuards.js';

export type RewriteResult =
  | {
      ok: true;
      rewritten: string;
      /** Non-blocking things the user should eyeball, shown in the review sheet. */
      warnings: string[];
      /** True when the model returned the draft essentially unchanged. */
      unchanged: boolean;
      /**
       * Specific facts the user should verify before sending (rates, links,
       * day names). Directs review instead of asking for a general proofread.
       */
      verify: string[];
    }
  | {
      ok: false;
      code: 'not_configured' | 'too_short' | 'too_long' | 'guard_failed' | 'upstream_failed';
      message: string;
    };

const SYSTEM_PROMPT = `You rewrite draft SMS messages written by recruiters at a staffing firm. You are a copy editor, not an author.

Fix only:
- spelling and grammar mistakes
- punctuation and capitalisation
- awkward or run-on sentence structure
- text-speak that reads as unprofessional ("u" -> "you", "snd" -> "send", "thx" -> "thanks")

Rules you must never break:
1. Preserve the original intent and meaning exactly. Do not add new offers, questions, apologies, pleasantries, or calls to action that the draft does not already contain.
2. Keep it the length of an SMS. Never make the message meaningfully longer than the draft. Shorter is fine.
3. Reproduce every {placeholder} exactly as written, character for character, including its capitalisation. Never add, remove, rename, translate, or reorder a placeholder, and never replace one with a real value.
4. Never change any fact. Names, phone numbers, email addresses, links, dates, times, day names, numbers, rates, pay, currency amounts, job titles, and company names must survive unaltered.
5. Keep the draft's tone and formality. Do not make a casual message formal or a formal one casual.
6. Do not add a greeting, a sign-off, a subject line, emoji, markdown, or quotation marks around the message.

Return only the rewritten message text.`;


export function isRewriteConfigured(): boolean {
  return isLlmConfigured();
}

export async function rewriteSmsDraft(draft: string): Promise<RewriteResult> {
  if (!isLlmConfigured()) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'AI rewrite is not configured on this server.',
    };
  }

  const original = draft.trim();
  if (original.length < REWRITE_MIN_CHARS) {
    return {
      ok: false,
      code: 'too_short',
      message: `Write at least ${REWRITE_MIN_CHARS} characters before rewriting.`,
    };
  }
  if (original.length > REWRITE_MAX_CHARS) {
    return {
      ok: false,
      code: 'too_long',
      message: `Message is too long to rewrite (limit ${REWRITE_MAX_CHARS} characters).`,
    };
  }

  // Two attempts: the first is a plain ask, the second restates whichever
  // guard failed. One retry only — a model that breaks a hard rule twice
  // isn't going to get it right on the third try, and the user is waiting.
  let lastFailure = 'Rewrite did not preserve the original message safely.';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt =
      attempt === 0
        ? original
        : `${original}\n\nYour previous attempt was rejected: ${lastFailure} Rewrite again, correcting only spelling, grammar, and sentence structure, and changing nothing else.`;

    const res = await chatComplete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      // A rewrite can't exceed the SMS cap, and with thinking suppressed the
      // observed output is ~24 tokens. 1000 is generous headroom that also
      // bounds a misbehaving model.
      maxTokens: 1000,
      temperature: 0.2,
    });

    if (!res.ok) {
      // The provider layer has already logged the cause (without content).
      return { ok: false, code: res.code, message: res.message };
    }

    const candidate = cleanModelText(res.text);
    const verdict = checkRewrite(original, candidate);
    if (verdict.ok) {
      return {
        ok: true,
        rewritten: candidate,
        warnings: verdict.warnings,
        unchanged: candidate === original,
        verify: factsToVerify(candidate),
      };
    }
    lastFailure = verdict.reason;
  }

  console.info('[sms-rewrite] rejected after retry:', lastFailure);
  return {
    ok: false,
    code: 'guard_failed',
    message: "Couldn't rewrite this safely without changing details — your original message was kept.",
  };
}
