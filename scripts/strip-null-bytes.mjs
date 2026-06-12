#!/usr/bin/env node
// scripts/strip-null-bytes.mjs
//
// Defensive cleanup tool that recursively walks the repo and strips null
// bytes (\x00) from text source files. Added in v0.10.128 after the Cowork
// workspace-sync bridge bug repeatedly padded files with null bytes during
// our v0.10.122-v0.10.127 release cycle, breaking npm install (JSON parse
// errors) and tsc (TS1127 'Invalid character').
//
// Run manually:   npm run strip-null-bytes
// Run via npm pre-build hook automatically before every monorepo build:
//   "scripts": { "prebuild": "node scripts/strip-null-bytes.mjs" }
//
// Cross-platform: works on Windows/Mac/Linux via Node. No shell deps.
//
// Exits 0 on success (even when no nulls found). Reports stats to stdout.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.html', '.css',
  '.yml', '.yaml', '.prisma', '.sql', '.sh', '.env', '.toml',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.next', 'out']);

let filesScanned = 0;
let filesFixed = 0;
let nullBytesRemoved = 0;

async function processFile(fp) {
  const raw = await fs.readFile(fp);
  filesScanned++;
  let count = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === 0) count++;
  if (count === 0) return;
  const cleaned = Buffer.from(raw.filter(b => b !== 0));
  // Trim trailing whitespace and ensure single trailing newline
  let trimEnd = cleaned.length;
  while (trimEnd > 0 && (cleaned[trimEnd - 1] === 0x20 || cleaned[trimEnd - 1] === 0x09 ||
                          cleaned[trimEnd - 1] === 0x0A || cleaned[trimEnd - 1] === 0x0D)) {
    trimEnd--;
  }
  const out = Buffer.concat([cleaned.subarray(0, trimEnd), Buffer.from('\n')]);
  await fs.writeFile(fp, out);
  filesFixed++;
  nullBytesRemoved += count;
  console.log(`  stripped ${count} null bytes from ${fp}`);
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(fp);
    } else if (e.isFile() && EXTENSIONS.has(path.extname(e.name))) {
      try {
        await processFile(fp);
      } catch (err) {
        console.warn(`  warning: failed to process ${fp}: ${err.message}`);
      }
    }
  }
}

const start = Date.now();
await walk('.');
const ms = Date.now() - start;
console.log(`strip-null-bytes: scanned ${filesScanned} files, fixed ${filesFixed}, removed ${nullBytesRemoved} bytes in ${ms}ms`);
if (filesFixed > 0) {
  console.log(`  ⚠ ${filesFixed} files had null bytes - they have been cleaned.`);
}
