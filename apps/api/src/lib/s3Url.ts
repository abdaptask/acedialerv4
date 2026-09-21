/**
 * Resolve an object key to the public URL we persist in the database.
 *
 * Kept pure and parameterised so it is testable without env, and so the
 * publicBase indirection means a future CloudFront/custom domain is a config
 * change rather than a code change. Note the resolved URL still lands in DB
 * rows — that is the accepted tradeoff of spec §4.1.
 */
export function buildPublicUrl(
  key: string,
  opts: { bucket?: string; region?: string; publicBase?: string },
): string {
  const base = opts.publicBase
    ? opts.publicBase.replace(/\/+$/, '')
    : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com`;
  return `${base}/${key}`;
}
