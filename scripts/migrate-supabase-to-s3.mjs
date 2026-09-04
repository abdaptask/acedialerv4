// One-off backfill: copy every object we own out of Supabase Storage into
// the apt-dialer S3 bucket and repoint the five DB columns that hold their
// URLs. Operator tool — run by hand, never imported (CLAUDE.md §1.4).
//
//   node --env-file=.env scripts/migrate-supabase-to-s3.mjs            # dry run
//   node --env-file=.env scripts/migrate-supabase-to-s3.mjs --commit   # writes
//
// Idempotent: re-running finds no Supabase-prefixed URLs left and reports
// zero rewrites, so a partial or failed run is always safe to repeat.
import { writeFileSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  isSupabaseMediaUrl,
  rewriteArray,
  supabaseUrlToKey,
} from './lib/rewriteMediaUrls.mjs';

const COMMIT = process.argv.includes('--commit');
const SUPABASE_BASE = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_BUCKET = (process.env.SUPABASE_MEDIA_BUCKET ?? 'ace-media').trim();
const S3_BUCKET = (process.env.S3_BUCKET ?? 'apt-dialer').trim();
const S3_REGION = (process.env.S3_REGION ?? 'us-east-1').trim();
const S3_PUBLIC_BASE = (process.env.S3_PUBLIC_BASE ?? '').trim();

if (!SUPABASE_BASE) {
  console.error('SUPABASE_URL is not set — nothing to migrate from.');
  process.exit(1);
}

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: (process.env.S3_ACCESS_KEY_ID ?? '').trim(),
    secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY ?? '').trim(),
  },
});

const manifest = [];
const stats = {};

function bump(column, field) {
  stats[column] ??= { scanned: 0, rewritten: 0, skipped: 0, failed: 0 };
  stats[column][field] += 1;
}

function publicUrlFor(key) {
  const base = S3_PUBLIC_BASE
    ? S3_PUBLIC_BASE.replace(/\/+$/, '')
    : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
  return `${base}/${key}`;
}

function contentTypeFor(key) {
  const ext = (key.split('?')[0].match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? '').toLowerCase();
  const map = {
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

// Map an old Supabase key onto the new media/ layout. Keys are preserved
// verbatim under a type prefix rather than renamed: the old key already
// carries the user id and timestamp, and re-deriving them risks collisions.
function newKeyFor(oldKey, kind) {
  if (kind === 'voicemail') return `media/voicemails/legacy/${oldKey}`;
  if (kind === 'greeting') return `media/greetings/legacy/${oldKey}`;
  return `media/mms/out/legacy/${oldKey}`;
}

/** Copy one object. Returns the new public URL, or null on any failure. */
async function copyOne(url, kind, context) {
  const oldKey = supabaseUrlToKey(url, SUPABASE_BASE, SUPABASE_BUCKET);
  if (!oldKey) return null;
  const newKey = newKeyFor(oldKey, kind);
  const newUrl = publicUrlFor(newKey);

  if (!COMMIT) {
    manifest.push({ ...context, kind, oldUrl: url, newUrl, action: 'would-copy' });
    return newUrl;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! download ${res.status} for ${oldKey}`);
      manifest.push({ ...context, kind, oldUrl: url, newUrl: null, action: 'download-failed', status: res.status });
      return null;
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) {
      console.warn(`  ! empty object ${oldKey}`);
      manifest.push({ ...context, kind, oldUrl: url, newUrl: null, action: 'empty' });
      return null;
    }
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: newKey, Body: body, ContentType: contentTypeFor(oldKey),
    }));
    manifest.push({ ...context, kind, oldUrl: url, newUrl, action: 'copied', bytes: body.length });
    return newUrl;
  } catch (e) {
    console.warn(`  ! upload failed for ${oldKey}: ${e.message}`);
    manifest.push({ ...context, kind, oldUrl: url, newUrl: null, action: 'upload-failed', error: e.message });
    return null;
  }
}

async function migrateVoicemails() {
  const rows = await prisma.voicemail.findMany({ select: { id: true, recordingUrl: true } });
  for (const row of rows) {
    bump('Voicemail.recordingUrl', 'scanned');
    if (!isSupabaseMediaUrl(row.recordingUrl, SUPABASE_BASE)) {
      bump('Voicemail.recordingUrl', 'skipped');
      continue;
    }
    const newUrl = await copyOne(row.recordingUrl, 'voicemail', { table: 'Voicemail', id: row.id });
    if (!newUrl) { bump('Voicemail.recordingUrl', 'failed'); continue; }
    if (COMMIT) {
      await prisma.voicemail.update({ where: { id: row.id }, data: { recordingUrl: newUrl } });
    }
    bump('Voicemail.recordingUrl', 'rewritten');
  }
}

async function migrateGreetings() {
  const rows = await prisma.user.findMany({
    select: { id: true, voicemailGreetingUrl: true, voicemailBusyGreetingUrl: true },
  });
  for (const row of rows) {
    for (const col of ['voicemailGreetingUrl', 'voicemailBusyGreetingUrl']) {
      const label = `User.${col}`;
      bump(label, 'scanned');
      const url = row[col];
      if (!isSupabaseMediaUrl(url, SUPABASE_BASE)) { bump(label, 'skipped'); continue; }
      const newUrl = await copyOne(url, 'greeting', { table: 'User', id: row.id, column: col });
      if (!newUrl) { bump(label, 'failed'); continue; }
      if (COMMIT) {
        await prisma.user.update({ where: { id: row.id }, data: { [col]: newUrl } });
      }
      bump(label, 'rewritten');
    }
  }
}

// The array columns. Only Supabase-prefixed entries are touched; Telnyx
// inbound URLs in the same array must survive verbatim.
async function migrateArrayColumn(model, label) {
  const rows = await prisma[model].findMany({ select: { id: true, mediaUrls: true } });
  for (const row of rows) {
    bump(label, 'scanned');
    if (!row.mediaUrls?.some((u) => isSupabaseMediaUrl(u, SUPABASE_BASE))) {
      bump(label, 'skipped');
      continue;
    }
    const resolved = new Map();
    for (const u of row.mediaUrls) {
      if (isSupabaseMediaUrl(u, SUPABASE_BASE)) {
        resolved.set(u, await copyOne(u, 'mms', { table: label, id: row.id }));
      }
    }
    const { next, changed } = rewriteArray(row.mediaUrls, (u) => resolved.get(u) ?? null);
    if (changed === 0) { bump(label, 'failed'); continue; }
    if (COMMIT) {
      await prisma[model].update({ where: { id: row.id }, data: { mediaUrls: next } });
    }
    bump(label, 'rewritten');
  }
}

async function main() {
  console.log(COMMIT ? '=== COMMIT MODE — writing ===' : '=== DRY RUN — pass --commit to write ===');
  console.log(`  from: ${SUPABASE_BASE}/storage/v1/object/public/${SUPABASE_BUCKET}/`);
  console.log(`  to:   ${publicUrlFor('media/…')}`);

  await migrateVoicemails();
  await migrateGreetings();
  await migrateArrayColumn('message', 'Message.mediaUrls');
  await migrateArrayColumn('scheduledMessage', 'ScheduledMessage.mediaUrls');

  console.table(stats);
  mkdirSync('scripts/out', { recursive: true });
  const out = `scripts/out/supabase-to-s3-manifest${COMMIT ? '' : '-dryrun'}.json`;
  writeFileSync(out, JSON.stringify({ stats, entries: manifest }, null, 2));
  console.log(`manifest: ${out} (${manifest.length} entries)`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
