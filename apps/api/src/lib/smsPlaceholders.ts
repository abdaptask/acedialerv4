// v0.10.216 — Canonical registry of SMS template placeholder fields.
//
// Before this file, placeholders were free-form text: the 20 seeded
// templates in smsTemplateSeed.ts happened to use 16 `{camelCase}` keys,
// two of which (`{firstName}`, `{recruiter}`) were resolved by a hardcoded
// regex in Messages.tsx and the rest of which were left literal for the
// user to type over. Nothing enumerated the set and nothing validated it,
// so a typo like `{firstNmae}` shipped silently and sent as literal text
// to a candidate.
//
// This module is the single source of truth for:
//   1. which keys exist (served to the client via GET /me/sms-placeholders
//      so the composer's "Insert field" picker isn't a fourth hardcoded copy)
//   2. what each one resolves from (contact / signed-in user / typed by hand)
//   3. whether a given template body is valid (used on save AND as the
//      post-check on AI-rewritten text)
//
// Verified against production before enabling strict validation: the live
// sms_templates table held exactly the 20 seeded rows using exactly the 16
// keys below, so no pre-existing template can fail validation. If an admin
// later needs a new field, add it here rather than loosening the validator.

/** Where a placeholder's value comes from when a template is inserted. */
export type SmsPlaceholderSource =
  /** Resolved from the conversation's contact (Favorites name, then JobDiva). */
  | 'contact'
  /** Resolved from the signed-in user (the recruiter sending the message). */
  | 'user'
  /** No automatic source — the user types over it before sending. */
  | 'manual';

export interface SmsPlaceholder {
  /** Canonical key, always camelCase. Rendered as `{key}` in a body. */
  key: string;
  /** Human label for the "Insert field" picker. */
  label: string;
  /** Example value, shown next to the label so intent is obvious. */
  sample: string;
  source: SmsPlaceholderSource;
  /**
   * Alternate spellings accepted on input and rewritten to `key`. Case is
   * handled separately (all matching is case-insensitive), so this is only
   * for genuinely different spellings like snake_case.
   */
  aliases?: string[];
  /**
   * Valid, but not offered in the picker. Used for keys that are
   * semantically duplicated by a newer, better-named key: the old key keeps
   * working (existing templates must never break) while users are only
   * shown one obvious choice.
   */
  hidden?: boolean;
}

/**
 * The registry. Order matters — it's the order the picker renders in, so
 * the auto-filling fields come first (they're the ones that make a template
 * feel magic) and the type-it-yourself fields follow.
 */
export const SMS_PLACEHOLDERS: SmsPlaceholder[] = [
  // ── Auto-filled from the contact ──────────────────────────────────────
  {
    key: 'firstName',
    label: 'Contact first name',
    sample: 'Jean',
    source: 'contact',
    aliases: ['first_name'],
  },
  {
    key: 'lastName',
    label: 'Contact last name',
    sample: 'Dupont',
    source: 'contact',
    aliases: ['last_name'],
  },
  {
    key: 'jobTitle',
    label: 'Contact job title',
    sample: 'Senior Java Developer',
    source: 'contact',
    aliases: ['job_title', 'title'],
  },
  {
    key: 'companyName',
    label: "Contact's current company",
    sample: 'Acme Corp',
    source: 'contact',
    aliases: ['company', 'company_name'],
  },
  {
    // Pre-v0.10.216 name for companyName, used by the seeded "Quarterly
    // touch base" template. Kept canonical (not aliased) so re-saving that
    // template doesn't silently rewrite an admin's stored body text; hidden
    // so the picker offers only `companyName`. Now resolves from JobDiva
    // where it previously rendered literally.
    key: 'currentCompany',
    label: "Contact's current company",
    sample: 'Acme Corp',
    source: 'contact',
    hidden: true,
  },

  // ── Auto-filled from the signed-in user ───────────────────────────────
  {
    key: 'recruiterName',
    label: 'Your first name',
    sample: 'Abdulla',
    source: 'user',
    aliases: ['recruiter_name'],
  },
  {
    // Pre-v0.10.216 name for recruiterName, used by two seeded templates.
    // Same reasoning as currentCompany: canonical, hidden, still resolves.
    key: 'recruiter',
    label: 'Your first name',
    sample: 'Abdulla',
    source: 'user',
    hidden: true,
  },

  // ── Typed by the user before sending ──────────────────────────────────
  { key: 'role', label: 'Role / job title being pitched', sample: 'Backend Engineer', source: 'manual' },
  { key: 'client', label: 'Hiring client', sample: 'Fortune 500 bank', source: 'manual' },
  { key: 'rate', label: 'Rate', sample: '65', source: 'manual' },
  { key: 'clientRate', label: "Client's offered rate", sample: '60', source: 'manual' },
  { key: 'askedRate', label: 'Rate the candidate asked for', sample: '70', source: 'manual' },
  { key: 'location', label: 'Work location', sample: 'Dallas, TX (hybrid)', source: 'manual' },
  { key: 'date', label: 'Date', sample: 'Tuesday the 12th', source: 'manual' },
  { key: 'time', label: 'Time', sample: '2:30 PM ET', source: 'manual' },
  { key: 'startDate', label: 'Start date', sample: 'March 3', source: 'manual' },
  { key: 'dueDate', label: 'Due date', sample: 'Friday', source: 'manual' },
  { key: 'option1', label: 'First option offered', sample: 'Tue 10 AM', source: 'manual' },
  { key: 'option2', label: 'Second option offered', sample: 'Wed 3 PM', source: 'manual' },
  { key: 'referrer', label: 'Who referred them', sample: 'Priya', source: 'manual' },
];

/**
 * Lowercased key/alias → canonical key. Built once at module load; this is
 * what makes matching case-insensitive, so a user who types `{FirstName}`
 * (the casing style people reach for naturally) gets the same field as the
 * seeded templates' `{firstName}`.
 */
const CANONICAL_BY_LOWER: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const p of SMS_PLACEHOLDERS) {
    map.set(p.key.toLowerCase(), p.key);
    for (const alias of p.aliases ?? []) map.set(alias.toLowerCase(), p.key);
  }
  return map;
})();

/** Resolve any accepted spelling/casing to its canonical key, or null. */
export function canonicalPlaceholderKey(raw: string): string | null {
  return CANONICAL_BY_LOWER.get(raw.toLowerCase()) ?? null;
}

export function getPlaceholder(key: string): SmsPlaceholder | undefined {
  const canonical = canonicalPlaceholderKey(key);
  if (!canonical) return undefined;
  return SMS_PLACEHOLDERS.find((p) => p.key === canonical);
}

export interface MalformedPlaceholder {
  /** The offending fragment, clipped for display. */
  raw: string;
  /** Why it's rejected, phrased for a non-technical user. */
  reason: string;
}

export interface UnknownPlaceholder {
  raw: string;
  /** Closest canonical key within edit distance 2, if any. */
  suggestion?: string;
}

export interface PlaceholderScan {
  /** Canonical keys found, in order, INCLUDING duplicates. */
  keys: string[];
  unknown: UnknownPlaceholder[];
  malformed: MalformedPlaceholder[];
  /**
   * The body with every recognized placeholder rewritten to its canonical
   * casing (`{FirstName}` → `{firstName}`). Only casing/alias spelling
   * changes; surrounding text is untouched byte-for-byte.
   */
  normalizedBody: string;
}

/**
 * Single-pass brace scanner.
 *
 * Deliberately hand-rolled rather than a regex: the failure modes we care
 * about are the ones a regex quietly skips over. `Hi {firstName, are you`
 * has no match at all for /\{(\w+)\}/ and would validate clean, then send a
 * literal stray brace to a candidate. Walking the string lets us report the
 * unclosed brace, the stray closer, the empty `{}`, the spaced
 * `{ firstName }`, and the nested `{a{b}}` distinctly.
 */
export function scanPlaceholders(body: string): PlaceholderScan {
  const keys: string[] = [];
  const unknown: UnknownPlaceholder[] = [];
  const malformed: MalformedPlaceholder[] = [];
  let out = '';
  let i = 0;

  const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

  while (i < body.length) {
    const ch = body[i];

    if (ch === '}') {
      malformed.push({
        raw: '}',
        reason: 'Closing brace with no matching opening brace',
      });
      out += ch;
      i += 1;
      continue;
    }

    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }

    // At an opening brace — find its closer, rejecting a nested opener.
    const close = body.indexOf('}', i + 1);
    const nextOpen = body.indexOf('{', i + 1);

    if (close === -1) {
      malformed.push({
        raw: clip(body.slice(i)),
        reason: 'Opening brace is never closed',
      });
      out += body.slice(i);
      break;
    }

    if (nextOpen !== -1 && nextOpen < close) {
      // e.g. `{a{b}}` — report and consume only the outer opener so the
      // inner one is still scanned on the next iteration.
      malformed.push({
        raw: clip(body.slice(i, close + 1)),
        reason: 'Braces cannot be nested',
      });
      out += ch;
      i += 1;
      continue;
    }

    const inner = body.slice(i + 1, close);
    const raw = body.slice(i, close + 1);

    if (inner.length === 0) {
      malformed.push({ raw, reason: 'Empty field name' });
    } else if (/\s/.test(inner)) {
      malformed.push({
        raw,
        reason: 'Field names cannot contain spaces',
      });
    } else {
      const canonical = canonicalPlaceholderKey(inner);
      if (canonical) {
        keys.push(canonical);
        out += `{${canonical}}`;
        i = close + 1;
        continue;
      }
      unknown.push({ raw, suggestion: suggestPlaceholder(inner) });
    }

    // Malformed or unknown: preserve the original text verbatim. Validation
    // blocks the save, so there's nothing to gain from rewriting it, and
    // echoing it back unchanged keeps the user's cursor position sane.
    out += raw;
    i = close + 1;
  }

  return { keys, unknown, malformed, normalizedBody: out };
}

/** True when the body is safe to save/send. */
export function isPlaceholderScanClean(scan: PlaceholderScan): boolean {
  return scan.unknown.length === 0 && scan.malformed.length === 0;
}

/**
 * Human-readable summary of the first problem, for an inline form error.
 * Returns null when the scan is clean.
 */
export function describePlaceholderProblem(scan: PlaceholderScan): string | null {
  const bad = scan.malformed[0];
  if (bad) return `${bad.reason}: ${bad.raw}`;
  const miss = scan.unknown[0];
  if (miss) {
    return miss.suggestion
      ? `${miss.raw} isn't a supported field — did you mean {${miss.suggestion}}?`
      : `${miss.raw} isn't a supported field.`;
  }
  return null;
}

/** Closest canonical key within edit distance 2, else undefined. */
export function suggestPlaceholder(raw: string): string | undefined {
  const needle = raw.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const p of SMS_PLACEHOLDERS) {
    // Suggest only keys we'd actually offer, so we never nudge someone
    // toward a hidden legacy spelling.
    if (p.hidden) continue;
    const score = editDistance(needle, p.key.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = p.key;
    }
  }
  return bestScore <= 2 ? best : undefined;
}

/** Levenshtein distance, two-row variant. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/**
 * Multiset of canonical keys, used by the AI-rewrite guard: the rewritten
 * text must contain exactly the same placeholders the same number of times
 * as the original, or we reject the rewrite and keep the user's text.
 * Sorted so two bodies with reordered placeholders compare equal.
 */
export function placeholderMultiset(body: string): string[] {
  return scanPlaceholders(body).keys.slice().sort();
}

/** Registry shape served to the client. */
export interface SmsPlaceholderPublic extends SmsPlaceholder {
  /** Pre-rendered token, so the client never string-builds `{`+key+`}`. */
  token: string;
}

export function publicPlaceholders(): SmsPlaceholderPublic[] {
  return SMS_PLACEHOLDERS.map((p) => ({ ...p, token: `{${p.key}}` }));
}
