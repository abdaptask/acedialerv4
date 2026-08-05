// v0.10.216 — Pure validation for AI-rewritten SMS drafts.
//
// Split out of smsRewrite.ts deliberately: these functions are the safety
// boundary for the rewrite feature, so they must be unit-testable without an
// API key, without network access, and without a populated .env. Importing
// config.ts here would drag in a JWT_SECRET requirement and make that
// impossible — hence the separation. smsRewrite.ts owns the Anthropic client
// and re-exports what callers need.
//
// See smsRewrite.ts for why the model's output is validated at all rather
// than trusted, and smsRewriteGuards.test.ts for the failure story behind
// each individual check.
import { isPlaceholderScanClean, placeholderMultiset, scanPlaceholders } from './smsPlaceholders.js';

/** Below this there isn't enough text for a rewrite to mean anything. */
export const REWRITE_MIN_CHARS = 15;
/** Matches the admin template body cap and keeps us inside sane SMS territory. */
export const REWRITE_MAX_CHARS = 1600;


/**
 * Strip the wrappers a model reaches for even when told not to: surrounding
 * quotes, a markdown fence, or a "Here's the rewritten message:" preamble.
 */
export function cleanModelText(raw: string): string {
  let out = raw.trim();

  // Fenced block — take its contents.
  const fence = out.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1].trim();

  // Leading preamble ending in a colon on its own line.
  const preamble = out.match(/^(?:here(?:'s| is)[^\n:]*|rewritten message|revised message)\s*:\s*\n+([\s\S]+)$/i);
  if (preamble) out = preamble[1].trim();

  // Matched wrapping quotes, only when they wrap the whole thing.
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”' };
    if (pairs[first] === last && !out.slice(1, -1).includes(last)) {
      out = out.slice(1, -1).trim();
    }
  }

  return out;
}

export type Verdict = { ok: true; warnings: string[] } | { ok: false; reason: string };

/**
 * The hard guards. Every one of these has a concrete failure story behind
 * it, spelled out inline — none is defensive boilerplate.
 */
export function checkRewrite(original: string, candidate: string): Verdict {
  const warnings: string[] = [];

  if (!candidate) return { ok: false, reason: 'The rewrite came back empty.' };

  // 1. Length. A "rewrite" that pads a 2-line text into a paragraph costs
  //    the user real money in extra SMS segments and doesn't read like them.
  //    The allowance is generous for short drafts, because correcting
  //    "hey can u snd resume" genuinely does get longer, and tightens as the
  //    draft grows.
  const cap = Math.max(Math.round(original.length * 1.15), original.length + 40);
  if (candidate.length > cap) {
    return {
      ok: false,
      reason: `The rewrite was too long (${candidate.length} characters vs the ${cap} allowed for a ${original.length}-character draft).`,
    };
  }
  if (candidate.length > REWRITE_MAX_CHARS) {
    return { ok: false, reason: 'The rewrite exceeded the maximum message length.' };
  }

  // 2. Placeholders, exactly. Dropping one sends "Hi ," to a candidate;
  //    renaming one means it silently never fills in. Compare as a sorted
  //    multiset so reordering is allowed but counts must match.
  const before = placeholderMultiset(original);
  const after = placeholderMultiset(candidate);
  if (before.join('|') !== after.join('|')) {
    return {
      ok: false,
      reason: 'The rewrite changed the template fields in the message.',
    };
  }

  // 3. The rewrite must not introduce broken placeholder syntax of its own
  //    (a stray brace passes guard 2 but still sends literal `{` to a candidate).
  if (!isPlaceholderScanClean(scanPlaceholders(candidate))) {
    return { ok: false, reason: 'The rewrite produced invalid template field syntax.' };
  }

  // 4. Numbers. The guard that matters most: rates, dates, times, and phone
  //    numbers all live in digit runs, and "65/hr" becoming "60/hr" is the
  //    failure mode that costs someone money and trust.
  //
  //    v0.10.216 refinement — a numeral spelled out in words is NOT a
  //    factual change. The first version of this guard rejected
  //    "last 2 paystubs" -> "last two payslips", an obviously good edit
  //    (observed from qwen3.5:9b on the very first live run). Blocking that
  //    is its own kind of failure: the user sees "couldn't rewrite safely"
  //    on a perfectly correct suggestion, and after a couple of those they
  //    stop using the feature — which costs more than it protects.
  //
  //    So: a digit run may vanish only if its word form is present instead.
  //    Anything else — a changed value, a number that simply disappears —
  //    still fails closed, because that's the case reading over the message
  //    genuinely does not catch.
  const numsBefore = matchAll(original, /\d+(?:[.,]\d+)*/g);
  const numsAfter = new Set(matchAll(candidate, /\d+(?:[.,]\d+)*/g));
  const lowerCandidateForNums = candidate.toLowerCase();
  const lostNumbers = numsBefore.filter((n) => {
    if (numsAfter.has(n)) return false;
    const word = NUMBER_WORDS[n];
    // Word form counts as preserved — matched on a word boundary so "one"
    // isn't satisfied by "money".
    if (word && new RegExp(`\\b${word}\\b`).test(lowerCandidateForNums)) return false;
    return true;
  });
  if (lostNumbers.length > 0) {
    return {
      ok: false,
      reason: `The rewrite changed or dropped a number (${lostNumbers.slice(0, 3).join(', ')}).`,
    };
  }

  // 5. Links and emails, verbatim. A "tidied" URL is a dead URL.
  const linksBefore = matchAll(original, /(?:https?:\/\/|www\.)[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+/gi);
  const lostLinks = linksBefore.filter((l) => !candidate.includes(l));
  if (lostLinks.length > 0) {
    return {
      ok: false,
      reason: `The rewrite altered a link or email address (${lostLinks[0]}).`,
    };
  }

  // 6. Proper nouns — a WARNING, not a rejection, on purpose. Detecting a
  //    typed name without a dictionary means treating any mid-sentence
  //    capitalised word as one, which false-positives on things like "I'll
  //    call Monday" or a capitalised product name and would block perfectly
  //    good rewrites. Since the user must review before sending, flagging
  //    is the right strength here: it directs their eye without vetoing.
  const namesBefore = matchAll(original, /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/gm);
  const lowerCandidate = candidate.toLowerCase();
  const lostNames = [...new Set(namesBefore)].filter(
    (n) => !lowerCandidate.includes(n.toLowerCase()),
  );
  if (lostNames.length > 0) {
    warnings.push(
      `Check these words survived the rewrite: ${lostNames.slice(0, 4).join(', ')}`,
    );
  }

  // 7. Facts the model ADDED — a warning, not a rejection.
  //
  //    Both Qwen models were observed turning "65/hr" into "$65/hr". The
  //    number survived, so guard 4 is satisfied and the meaning is almost
  //    certainly what the user intended — but it is still the model asserting
  //    a currency the user didn't type, and on a rate quote that's worth a
  //    glance. Flagging directs the user's eye; blocking would be
  //    disproportionate.
  const addedSymbols = ['$', '€', '£', '₹', '%'].filter(
    (sym) => candidate.includes(sym) && !original.includes(sym),
  );
  if (addedSymbols.length > 0) {
    warnings.push(
      `The rewrite added ${addedSymbols.join(' and ')} — check that's what you meant`,
    );
  }

  return { ok: true, warnings };
}

/**
 * Facts worth a second look before sending, in the order they appear.
 *
 * Human review is the real control on an AI rewrite, but "please proofread"
 * is a weak instruction — people read for whether text *sounds* right, not
 * for whether it still says what they meant. Handing the reviewer the
 * specific tokens to verify turns a vibe check into a targeted one.
 */
export function factsToVerify(text: string): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(v);
    }
  };

  // Links and emails first — the highest-consequence, lowest-detectability item.
  for (const m of matchAll(text, /(?:https?:\/\/|www\.)[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+/gi)) push(m);
  // Money and rates, with whatever unit trails them.
  for (const m of matchAll(text, /[$€£₹]?\d+(?:[.,]\d+)*\s*(?:\/\s*(?:hr|hour|yr|year|wk|week))?/gi)) {
    push(m.trim());
  }
  // Day and month names, which a rewrite can silently shift.
  for (const m of matchAll(
    text,
    /\b(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
  )) push(m);

  return facts.slice(0, 6);
}

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
};

function matchAll(s: string, re: RegExp): string[] {
  return Array.from(s.matchAll(re), (m) => m[0]);
}
