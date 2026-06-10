// ===========================================================================
// apply-sql-migration.ts — apply one of our raw SQL migration files against
// the database referenced by DATABASE_URL. Reads .env at repo root (same as
// db:push), so the same connection string used by the apps gets used here.
//
// Usage:
//   npx tsx packages/db/scripts/apply-sql-migration.ts <relative-sql-path>
//
// Example:
//   npx tsx packages/db/scripts/apply-sql-migration.ts \
//     packages/db/migrations/2026-06-texml-voicemail.sql
//
// We don't use Prisma's migrate engine because this repo's history uses
// raw SQL files under packages/db/migrations/ rather than Prisma Migrate.
// Each migration file should be idempotent (CREATE TABLE IF NOT EXISTS, ADD
// COLUMN IF NOT EXISTS) so re-running is safe.
//
// IMPORTANT: This runs the ENTIRE file as one statement batch. That works
// for our migrations because we use raw multi-statement SQL with semicolons
// and the underlying pg driver accepts that via `Client.query`. If you need
// transactional behavior, wrap the file contents in BEGIN; ... COMMIT;.
// ===========================================================================

import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { PrismaClient } from '@prisma/client';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx apply-sql-migration.ts <path-to-sql-file>');
    process.exit(2);
  }
  const sqlPath = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  let sql: string;
  try {
    sql = readFileSync(sqlPath, 'utf-8');
  } catch (e) {
    console.error(`Failed to read ${sqlPath}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  console.log(`[migration] ${sqlPath} (${sql.length} bytes)`);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Did you forget --env-file=../../.env?');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    // Prisma's $executeRawUnsafe runs arbitrary SQL via the underlying engine.
    // Multi-statement files work because the engine forwards the full string
    // to PostgreSQL's protocol. We don't get per-statement timing but for
    // idempotent migrations this is fine.
    await prisma.$executeRawUnsafe(sql);
    console.log('[migration] applied successfully');
  } catch (e) {
    console.error('[migration] failed:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
