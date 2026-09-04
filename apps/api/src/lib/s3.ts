// S3 object storage for user media (MMS attachments, voicemail greetings).
//
// This file is duplicated at apps/webhooks/src/s3.ts on purpose. CLAUDE.md
// §1.4 forbids shared code in packages/ outside db, and forbids
// apps/webhooks importing from apps/api — coupling the two deploys is
// worse than sixty duplicated lines, and the Supabase code this replaces
// was already duplicated across the same three call sites.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

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

export function isS3Configured(): boolean {
  return Boolean(
    config.s3Bucket && config.s3Region && config.s3AccessKeyId && config.s3SecretAccessKey,
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKeyId as string,
        secretAccessKey: config.s3SecretAccessKey as string,
      },
    });
  }
  return client;
}

/**
 * Upload one object and return its public URL.
 *
 * Deliberately does NOT send an ACL: public read comes from the bucket
 * policy on media/*, and Block Public Access is configured to reject ACLs
 * outright, so passing one would fail the request.
 *
 * Throws on failure. Callers own the error mapping — the MMS route turns it
 * into an actionable hint, the webhook swallows it.
 */
export async function putObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ publicUrl: string }> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return {
    publicUrl: buildPublicUrl(args.key, {
      bucket: config.s3Bucket,
      region: config.s3Region,
      publicBase: config.s3PublicBase,
    }),
  };
}
