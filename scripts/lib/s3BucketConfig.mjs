// Merge helpers for scripts/setup-s3-bucket.mjs.
//
// Extracted and tested separately because these three functions are the only
// place the provisioning script can cause damage. put-bucket-policy,
// put-bucket-lifecycle-configuration and put-bucket-cors REPLACE the bucket's
// entire configuration; whatever these return is what survives. apt-dialer
// already carries a PublicReadSpecificUpdates statement for the `updates`
// prefix, so "append, never replace" is a correctness requirement, not a
// style preference — same reasoning as the URL mapper in rewriteMediaUrls.mjs.
//
// All three are pure and never mutate their input.

/**
 * Append a statement to a bucket policy, preserving every existing one.
 * Returns { next, skipped, keptSids }. `skipped` is true when a statement
 * with the same Sid is already present, which is what makes a re-run a no-op.
 */
export function mergePolicyStatement(current, statement) {
  const base = current ?? { Version: '2012-10-17', Statement: [] };
  const statements = base.Statement ?? [];
  const keptSids = statements.map((s) => s.Sid).filter(Boolean);

  if (keptSids.includes(statement.Sid)) {
    return { next: base, skipped: true, keptSids };
  }
  return {
    next: { ...base, Version: base.Version ?? '2012-10-17', Statement: [...statements, statement] },
    skipped: false,
    keptSids,
  };
}

/**
 * Append a lifecycle rule, preserving existing rules.
 * Returns { next, skipped, legacyIds }.
 *
 * `legacyIds` names any existing rule using the pre-2019 top-level `Prefix`
 * field. S3 rejects a put that mixes those with a Filter-style rule, and the
 * error names neither rule — the caller surfaces them instead of letting the
 * API fail opaquely.
 */
export function mergeLifecycleRule(currentRules, rule) {
  const rules = currentRules ?? [];
  const legacyIds = rules.filter((r) => r.Prefix !== undefined).map((r) => r.ID ?? '(unnamed)');

  if (rules.some((r) => r.ID === rule.ID)) {
    return { next: { Rules: rules }, skipped: true, legacyIds };
  }
  return { next: { Rules: [...rules, rule] }, skipped: false, legacyIds };
}

/**
 * Append a CORS rule unless an existing one already permits the methods we
 * need from any origin. Returns { next, satisfied }.
 *
 * Matching is by capability, not equality: a hand-written rule that allows
 * GET/HEAD from `*` already does the job, and stacking a near-duplicate on
 * top of it would just make the config harder to read.
 */
export function mergeCorsRule(currentRules, desired) {
  const rules = currentRules ?? [];
  const satisfied = rules.some(
    (r) =>
      (r.AllowedOrigins ?? []).includes('*') &&
      (desired.AllowedMethods ?? []).every((m) => (r.AllowedMethods ?? []).includes(m)),
  );
  if (satisfied) return { next: { CORSRules: rules }, satisfied: true };
  return { next: { CORSRules: [...rules, desired] }, satisfied: false };
}
