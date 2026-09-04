// URL classification for the Supabase → S3 backfill.
//
// Operator-tool code. Never imported by anything under apps/ (CLAUDE.md
// §1.4); the direction is one-way.
//
// Message.mediaUrls mixes our own Supabase uploads with Telnyx's inbound
// media URLs in a single array. Everything here exists to make sure only
// the former are ever touched.

const PUBLIC_SEGMENT = '/storage/v1/object/public/';

/** True only for a public object URL belonging to OUR Supabase project. */
export function isSupabaseMediaUrl(url, supabaseBase) {
  if (!url || typeof url !== 'string') return false;
  const base = supabaseBase.replace(/\/+$/, '');
  return url.startsWith(`${base}${PUBLIC_SEGMENT}`);
}

/**
 * Pull the in-bucket object key out of a Supabase public URL.
 * Returns null for anything that isn't one, so callers can pass through.
 */
export function supabaseUrlToKey(url, supabaseBase, bucket) {
  if (!isSupabaseMediaUrl(url, supabaseBase)) return null;
  const base = supabaseBase.replace(/\/+$/, '');
  const prefix = `${base}${PUBLIC_SEGMENT}${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return key.length > 0 ? key : null;
}

/**
 * Map over an array of URLs, replacing only the entries the mapper resolves.
 *
 * A null from mapFn means "leave this one alone" — used both for Telnyx
 * entries and for entries whose copy failed. Order is preserved because
 * MMS renders attachments in array order.
 */
export function rewriteArray(urls, mapFn) {
  let changed = 0;
  const next = urls.map((u) => {
    const replacement = mapFn(u);
    if (replacement) {
      changed += 1;
      return replacement;
    }
    return u;
  });
  return { next, changed };
}
