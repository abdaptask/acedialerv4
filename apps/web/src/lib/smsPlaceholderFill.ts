// v0.10.216 — Client-side placeholder resolution for template insertion.
//
// Before this, resolution was two hardcoded regexes in Messages.tsx:
//   {firstName} -> first word of the contact's display name
//   {recruiter} -> the signed-in user's first name
// Everything else was left literal. This module generalises that to the
// server-served registry, so adding a field is a registry edit rather than a
// component edit.
//
// ── What is deliberately NOT resolved ──────────────────────────────────
// 'manual' fields ({role}, {rate}, {client}, …) are left as literal
// `{placeholder}` text on purpose: they're the ones the recruiter fills in per
// message, and blanking them would silently send "the  role at " to a
// candidate. A visible `{role}` is a prompt to type; an empty gap is a bug the
// user won't notice until after they've hit send.
//
// Likewise, a 'contact' field with no known value stays literal rather than
// becoming an empty string — same reasoning, and it matches the pre-existing
// behaviour where an unknown number left {firstName} in place.
import type { JobDivaContact, SmsPlaceholder } from '../api';

export interface FillContext {
  /** Favourites/JobDiva display name for the conversation, if any. */
  displayName?: string | null;
  /** JobDiva enrichment for this number, if the lookup succeeded. */
  jobDiva?: JobDivaContact | null;
  /** Signed-in user's first name. */
  recruiterFirstName?: string | null;
}

/**
 * Best-effort first/last name for the contact.
 *
 * JobDiva is preferred because it has real structured fields; the display name
 * is a fallback that gets split on whitespace. A display name with no letters
 * is a formatted phone number (an unknown contact), so it yields nothing —
 * carried over from the pre-v0.10.216 behaviour, which deliberately left
 * {firstName} literal rather than inserting "+1 732…" as someone's name.
 */
function contactNames(ctx: FillContext): { first?: string; last?: string } {
  const jd = ctx.jobDiva;
  if (jd?.firstName || jd?.lastName) {
    return { first: jd.firstName?.trim() || undefined, last: jd.lastName?.trim() || undefined };
  }
  const display = (ctx.displayName ?? '').trim();
  if (!display || !/[a-zA-Z]/.test(display)) return {};
  const parts = display.split(/\s+/);
  return {
    first: parts[0],
    last: parts.length > 1 ? parts[parts.length - 1] : undefined,
  };
}

/** Resolve one canonical key, or undefined to leave it literal. */
export function resolvePlaceholder(
  key: string,
  ctx: FillContext,
  registry: SmsPlaceholder[],
): string | undefined {
  const def = registry.find((p) => p.key === key);
  if (!def || def.source === 'manual') return undefined;

  const names = contactNames(ctx);
  const jd = ctx.jobDiva;

  switch (key) {
    case 'firstName':
      return names.first;
    case 'lastName':
      return names.last;
    case 'jobTitle':
      return jd?.jobTitle?.trim() || undefined;
    // companyName and its pre-v0.10.216 spelling both mean "the contact's
    // current employer", which is what JobDiva's `company` field holds.
    case 'companyName':
    case 'currentCompany':
      return jd?.company?.trim() || undefined;
    case 'recruiterName':
    case 'recruiter':
      return ctx.recruiterFirstName?.trim() || undefined;
    default:
      return undefined;
  }
}

/**
 * Fill a template body for insertion into the compose box. Unresolvable
 * placeholders are preserved verbatim so the user can see what still needs
 * typing.
 */
export function fillTemplateBody(
  body: string,
  ctx: FillContext,
  registry: SmsPlaceholder[],
): string {
  return body.replace(/\{([^{}]+)\}/g, (whole, rawKey: string) => {
    // The stored body is already canonicalised server-side, but a
    // case-insensitive lookup costs nothing and makes this robust against a
    // body written before normalisation existed.
    const def =
      registry.find((p) => p.key === rawKey) ??
      registry.find((p) => p.key.toLowerCase() === rawKey.toLowerCase());
    if (!def) return whole;
    return resolvePlaceholder(def.key, ctx, registry) ?? whole;
  });
}

/** Canonical keys still unresolved in `text`, for the "needs filling" hint. */
export function remainingPlaceholders(text: string, registry: SmsPlaceholder[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
    const def =
      registry.find((p) => p.key === m[1]) ??
      registry.find((p) => p.key.toLowerCase() === m[1].toLowerCase());
    if (def) found.add(def.key);
  }
  return [...found];
}

/** Sample-value preview, for the template editor's live preview line. */
export function previewTemplateBody(
  body: string,
  ctx: FillContext,
  registry: SmsPlaceholder[],
): string {
  return body.replace(/\{([^{}]+)\}/g, (whole, rawKey: string) => {
    const def =
      registry.find((p) => p.key === rawKey) ??
      registry.find((p) => p.key.toLowerCase() === rawKey.toLowerCase());
    if (!def) return whole;
    return resolvePlaceholder(def.key, ctx, registry) ?? def.sample;
  });
}
