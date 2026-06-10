// ===========================================================================
// apply-sql-migration.ts - apply one of our raw SQL migration files against
// the database referenced by DATABASE_URL. Reads .env at repo root (same as
// db:push), so the same connection string used by the apps gets used here.
//
// Usage (any one of these works):
//   npx tsx packages/db/scripts/apply-sql-migration.ts migrations/2026-06-texml-voicemail.sql
//   npx tsx packages/db/scripts/apply-sql-migration.ts packages/db/migrations/2026-06-texml-voicemail.sql
//   npx tsx packages/db/scripts/apply-sql-migration.ts /abs/path/to/file.sql
//
// We resolve the path by trying multiple candidates (cwd-relative, repo-
// root-relative, and absolute), since npm workspaces sets cwd to the
// workspace dir which makes "packages/db/migrations/..." double-path.
//
// We do NOT use Prisma migrate engine because this repo's history uses raw
// SQL files under packages/db/migrations/. Each migration should be
// idempotent (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS) so
// re-running is safe.
// ===========================================================================

import { existsSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { PrismaClient } from '@prisma/client';

function findSqlFile(arg: string): string | null {
  // Try (in order):
  //  1. absolute path verbatim
  //  2. relative to cwd
  //  3. relative to cwd with leading "packages/db/" stripped (npm workspace cwd quirk)
  //  4. relative to "<cwd>/../.." (repo root) if cwd is packages/db
  const candidates: string[] = [];
  if (isAbsolute(arg)) {
    candidates.push(arg);
  } else {
    candidates.push(resolve(process.cwd(), arg));
    if (arg.startsWith('packages/db/')) {
      candidates.push(resolve(process.cwd(), arg.slice('packages/db/'.length)));
    }
    candidates.push(resolve(process.cwd(), '..', '..', arg));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx apply-sql-migration.ts <path-to-sql-file>');
    process.exit(2);
  }
  const sqlPath = findSqlFile(arg);
  if (!sqlPath) {
    console.error(`Failed to locate \"${arg}\" - tried cwd-relative + repo-root-relative + absolute.`);
    console.error(`cwd: ${process.cwd()}`);
    process.exit(2);
  }
  const sql = readFileSync(sqlPath, 'utf-8');
  console.log(`[migration] ${sqlPath} (${sql.length} bytes)`);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Did you forget --env-file=../../.env?');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    // Prisma's $executeRawUnsafe runs arbitrary SQL via the engine. Multi-
    // statement files work because the engine forwards the full string to
    // PostgreSQL's protocol.
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
