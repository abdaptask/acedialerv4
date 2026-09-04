// S3 object storage for voicemail recordings.
//
// Duplicate of apps/api/src/lib/s3.ts on purpose — CLAUDE.md §1.4 forbids
// shared code in packages/ outside db and forbids importing from apps/api.
// Reads process.env directly rather than a config module because that is
// how this service already reads its Telnyx settings.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

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
    env('S3_BUCKET', 'apt-dialer') &&
      env('S3_REGION', 'us-east-1') &&
      env('S3_ACCESS_KEY_ID') &&
      env('S3_SECRET_ACCESS_KEY'),
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env('S3_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: env('S3_ACCESS_KEY_ID'),
        secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

/**
 * Upload one object and return its public URL.
 *
 * No ACL is sent: public read comes from the bucket policy on media/*, and
 * Block Public Access rejects ACLs outright.
 */
export async function putObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ publicUrl: string }> {
  const bucket = env('S3_BUCKET', 'apt-dialer');
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return {
    publicUrl: buildPublicUrl(args.key, {
      bucket,
      region: env('S3_REGION', 'us-east-1'),
      publicBase: env('S3_PUBLIC_BASE'),
    }),
  };
}
