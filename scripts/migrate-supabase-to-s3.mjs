// One-off backfill: copy every object we own out of Supabase Storage into
// the apt-dialer S3 bucket and repoint the five DB columns that hold their
// URLs. Operator tool — run by hand, never imported (CLAUDE.md §1.4).
//
//   node --env-file=.env scripts/migrate-supabase-to-s3.mjs            # dry run
//   node --env-file=.env scripts/migrate-supabase-to-s3.mjs --commit   # writes
//
// Idempotent: re-running finds no Supabase-prefixed URLs left and reports
// zero rewrites, so a partial or failed run is always safe to repeat. If a
// --commit run is interrupted partway through, re-running picks up where it
// left off — see the journal note below for how progress from the first
// run stays recoverable even though the second run reports it as skipped.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

// Two output artifacts, two different jobs:
//   - SUMMARY_PATH is the end-of-run report a human reads: stats table plus
//     every entry, written once at the end (and now also on interruption).
//   - JOURNAL_PATH is the durable, append-only rollback record. It is
//     written to per-entry, in real time, and is NEVER truncated — a
//     second run appends to the same file rather than starting over. That
//     is what makes a two-run (interrupted, then resumed) migration fully
//     rollbackable: the first run's copies are still in the journal even
//     though the second run finds them already migrated and reports them
//     as skipped, not copied. The rollback script (see the plan's
//     "Appendix: Rollback") reads this file, not the summary.
// Dry runs get their own filenames for both, so a dry run can never mix
// into — or be mistaken for — the real commit-mode record.
const SUMMARY_PATH = `scripts/out/supabase-to-s3-manifest${COMMIT ? '' : '-dryrun'}.json`;
const JOURNAL_PATH = `scripts/out/supabase-to-s3-journal${COMMIT ? '' : '-dryrun'}.ndjson`;

function bump(column, field) {
  stats[column] ??= { scanned: 0, rewritten: 0, skipped: 0, failed: 0, wrong_bucket: 0 };
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

// Diagnostic only — duplicates the URL shape supabaseUrlToKey already
// parses, just to name the offending bucket in the warning below. Not
// authoritative: the real match/no-match decision still lives solely in
// supabaseUrlToKey (rewriteMediaUrls.mjs).
function bucketSegmentOf(url) {
  const prefix = `${SUPABASE_BASE}/storage/v1/object/public/`;
  if (!url.startsWith(prefix)) return '?';
  return url.slice(prefix.length).split('/')[0] || '?';
}

function appendJournal(entry) {
  mkdirSync('scripts/out', { recursive: true });
  appendFileSync(JOURNAL_PATH, `${JSON.stringify(entry)}\n`);
}

// Every recorded entry goes to both: the in-memory array for the
// end-of-run summary, and immediately to the on-disk journal so it survives
// a crash or Ctrl+C the summary write would otherwise lose.
function recordEntry(entry) {
  manifest.push(entry);
  appendJournal(entry);
}

function writeSummary() {
  mkdirSync('scripts/out', { recursive: true });
  writeFileSync(SUMMARY_PATH, JSON.stringify({ stats, entries: manifest }, null, 2));
  console.log(`manifest: ${SUMMARY_PATH} (${manifest.length} entries)`);
}

/**
 * Copy one object. Returns { url, outcome }:
 *   url     — the new public URL when the object was (or would be) copied,
 *             else null.
 *   outcome — 'would-copy' | 'copied' | 'wrong_bucket' | 'download-failed'
 *             | 'empty' | 'upload-failed'.
 * Callers key off `outcome`, not just a null check on `url`, so a bucket
 * mismatch can be counted and reported separately from a real copy
 * failure — see the wrong_bucket branch below.
 */
async function copyOne(url, kind, context) {
  const oldKey = supabaseUrlToKey(url, SUPABASE_BASE, SUPABASE_BUCKET);
  if (!oldKey) {
    // Every caller only reaches copyOne after isSupabaseMediaUrl(url) was
    // already true, so landing here means the Supabase *project* matched
    // but the bucket didn't — isSupabaseMediaUrl checks project only, by
    // design (rewriteMediaUrls.mjs). That's a config problem (wrong
    // SUPABASE_MEDIA_BUCKET), not a copy failure, and it must not vanish
    // into the same `failed` count a real download/upload error uses —
    // the runbook tells the operator to treat `failed: 0` as the gate.
    const bucket = bucketSegmentOf(url);
    console.warn(`  ! wrong bucket "${bucket}" (expected "${SUPABASE_BUCKET}") for ${url}`);
    recordEntry({ ...context, kind, oldUrl: url, newUrl: null, action: 'wrong-bucket', bucket });
    return { url: null, outcome: 'wrong_bucket' };
  }
  const newKey = newKeyFor(oldKey, kind);
  const newUrl = publicUrlFor(newKey);

  if (!COMMIT) {
    recordEntry({ ...context, kind, oldUrl: url, newUrl, action: 'would-copy' });
    return { url: newUrl, outcome: 'would-copy' };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! download ${res.status} for ${oldKey}`);
      recordEntry({ ...context, kind, oldUrl: url, newUrl: null, action: 'download-failed', status: res.status });
      return { url: null, outcome: 'download-failed' };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) {
      console.warn(`  ! empty object ${oldKey}`);
      recordEntry({ ...context, kind, oldUrl: url, newUrl: null, action: 'empty' });
      return { url: null, outcome: 'empty' };
    }
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: newKey, Body: body, ContentType: contentTypeFor(oldKey),
    }));
    recordEntry({ ...context, kind, oldUrl: url, newUrl, action: 'copied', bytes: body.length });
    return { url: newUrl, outcome: 'copied' };
  } catch (e) {
    console.warn(`  ! upload failed for ${oldKey}: ${e.message}`);
    recordEntry({ ...context, kind, oldUrl: url, newUrl: null, action: 'upload-failed', error: e.message });
    return { url: null, outcome: 'upload-failed' };
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
    const { url: newUrl, outcome } = await copyOne(row.recordingUrl, 'voicemail', { table: 'Voicemail', id: row.id });
    if (!newUrl) { bump('Voicemail.recordingUrl', outcome === 'wrong_bucket' ? 'wrong_bucket' : 'failed'); continue; }
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
      const { url: newUrl, outcome } = await copyOne(url, 'greeting', { table: 'User', id: row.id, column: col });
      if (!newUrl) { bump(label, outcome === 'wrong_bucket' ? 'wrong_bucket' : 'failed'); continue; }
      if (COMMIT) {
        await prisma.user.update({ where: { id: row.id }, data: { [col]: newUrl } });
      }
      bump(label, 'rewritten');
    }
  }
}

// The array columns. Only Supabase-prefixed entries are touched; Telnyx
// inbound URLs in the same array must survive verbatim.
//
// Counts are kept per entry, not per row: a row with 2 of 3 entries copied
// shows up as 2 rewritten + 1 failed, never a single row-level "rewritten"
// that hides the one that didn't — that's what makes `failed: 0` a
// trustworthy gate across this column. `tableName` is the literal Prisma
// model name ('Message' / 'ScheduledMessage') recorded on each journal/
// manifest entry, kept distinct from `label`, which is only the in-memory
// stats key — rollback must not depend on parsing a stats label.
async function migrateArrayColumn(model, tableName, label) {
  const rows = await prisma[model].findMany({ select: { id: true, mediaUrls: true } });
  for (const row of rows) {
    bump(label, 'scanned');
    if (!row.mediaUrls?.some((u) => isSupabaseMediaUrl(u, SUPABASE_BASE))) {
      bump(label, 'skipped');
      continue;
    }
    const resolved = new Map();
    for (const u of row.mediaUrls) {
      if (!isSupabaseMediaUrl(u, SUPABASE_BASE)) continue;
      const result = await copyOne(u, 'mms', { table: tableName, column: 'mediaUrls', id: row.id });
      resolved.set(u, result);
    }
    const { next, changed } = rewriteArray(row.mediaUrls, (u) => resolved.get(u)?.url ?? null);
    if (COMMIT && changed > 0) {
      await prisma[model].update({ where: { id: row.id }, data: { mediaUrls: next } });
    }
    for (const { url, outcome } of resolved.values()) {
      if (url) { bump(label, 'rewritten'); continue; }
      bump(label, outcome === 'wrong_bucket' ? 'wrong_bucket' : 'failed');
    }
  }
}

let shuttingDown = false;

// Guarded so a second SIGINT (or SIGINT racing SIGTERM) can't re-enter mid
// write or double-exit; and ordered so the summary — the thing an operator
// needs to see what happened — is on disk before we even attempt the
// (possibly slow, possibly hanging) Prisma disconnect.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(`\n${signal} received — writing summary for what completed before the interrupt, then exiting.`);
  console.table(stats);
  writeSummary();
  await prisma.$disconnect();
  process.exit(1);
}
process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

async function main() {
  console.log(COMMIT ? '=== COMMIT MODE — writing ===' : '=== DRY RUN — pass --commit to write ===');
  console.log(`  from: ${SUPABASE_BASE}/storage/v1/object/public/${SUPABASE_BUCKET}/`);
  console.log(`  to:   ${publicUrlFor('media/…')}`);
  console.log(`  journal: ${JOURNAL_PATH} (append-only, accumulates across runs)`);

  await migrateVoicemails();
  await migrateGreetings();
  await migrateArrayColumn('message', 'Message', 'Message.mediaUrls');
  await migrateArrayColumn('scheduledMessage', 'ScheduledMessage', 'ScheduledMessage.mediaUrls');

  console.table(stats);
  writeSummary();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  if (!shuttingDown) {
    shuttingDown = true;
    console.table(stats);
    writeSummary();
  }
  await prisma.$disconnect();
  process.exit(1);
});
