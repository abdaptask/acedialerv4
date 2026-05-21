// Phase 6.13 — Dedupe call legs in Recents.
//
// Telnyx fires multiple webhooks for the same inbound call (PSTN leg + SIP
// delivery leg), so a single physical call ends up as two rows with
// different call_control_ids — that's why a blocked call was showing as
// both "Missed" and "Blocked".
//
// This script edits apps/api/src/calls/calls.routes.ts to:
//   1. Inject a STATUS_RANK + dedupeCallLegs<T>() helper above callsRoutes.
//   2. Bump GET /calls `take` from 100 → 200.
//   3. Return dedupeCallLegs(calls) instead of calls.
//
// We use readFileSync/writeFileSync with literal string matches (validated by
// count) instead of the Edit tool — the Edit tool has truncated this file
// once already.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const filePath = resolve(repoRoot, 'apps/api/src/calls/calls.routes.ts');

let src = readFileSync(filePath, 'utf8');

// ─── Step 1: inject helper above `export async function callsRoutes` ───
const helperAnchor = 'export async function callsRoutes(app: FastifyInstance) {';
const helperBlock = `// Phase 6.13 — Dedupe call legs in Recents.
//
// Telnyx fires multiple webhooks for the same inbound call: one for the PSTN
// leg and one for the SIP-delivery leg to our WebRTC client. Each has a
// distinct \`call_control_id\`, so naive \`findMany\` returns two rows per
// physical call — that's why a single blocked call was showing as "Missed"
// AND "Blocked" in Recents.
//
// Solution: group by \`sessionId\` (Telnyx's call_session_id is shared across
// legs of the same call) and keep the row with the most meaningful status.
// Ties on rank fall back to the most recent \`startedAt\`.
const STATUS_RANK: Record<string, number> = {
  blocked: 100,
  answered: 90,
  completed: 80,
  forwarded: 70,
  rejected: 60,
  no_answer: 50,
  missed: 40,
  failed: 30,
  initiated: 20,
};

function dedupeCallLegs<T extends { sessionId?: string | null; status?: string | null; startedAt?: Date | string | null }>(
  rows: T[],
): T[] {
  const bySession = new Map<string, T>();
  const standalone: T[] = [];
  for (const row of rows) {
    const sid = row.sessionId;
    if (!sid) {
      // No session id — can't dedupe, keep as-is (e.g. outbound rows recorded
      // before webhook arrived).
      standalone.push(row);
      continue;
    }
    const existing = bySession.get(sid);
    if (!existing) {
      bySession.set(sid, row);
      continue;
    }
    const existingRank = STATUS_RANK[existing.status ?? ''] ?? 0;
    const candidateRank = STATUS_RANK[row.status ?? ''] ?? 0;
    if (candidateRank > existingRank) {
      bySession.set(sid, row);
    } else if (candidateRank === existingRank) {
      // Same rank — prefer the more recent row.
      const existingTs = existing.startedAt ? new Date(existing.startedAt as string | Date).getTime() : 0;
      const candidateTs = row.startedAt ? new Date(row.startedAt as string | Date).getTime() : 0;
      if (candidateTs > existingTs) bySession.set(sid, row);
    }
  }
  const merged = [...bySession.values(), ...standalone];
  // Preserve descending startedAt order.
  merged.sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt as string | Date).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt as string | Date).getTime() : 0;
    return tb - ta;
  });
  return merged;
}

`;

function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

const helperAnchorCount = countOf(src, helperAnchor);
if (helperAnchorCount !== 1) {
  console.error(`✗ Helper anchor occurs ${helperAnchorCount} times — expected exactly 1.`);
  process.exit(1);
}

if (src.includes('function dedupeCallLegs<')) {
  console.log('• Helper already present — skipping insertion.');
} else {
  src = src.replace(helperAnchor, helperBlock + helperAnchor);
  console.log('✓ Inserted STATUS_RANK + dedupeCallLegs helper.');
}

// ─── Step 2: bump take 100 → 200 + return dedupeCallLegs(calls) ───
const oldBlock = `      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return calls;
  });`;

const newBlock = `      orderBy: { startedAt: 'desc' },
      // Bumped from 100 → 200 so dedupe (which collapses 2 legs into 1) still
      // leaves a healthy ~100-row history in the UI.
      take: 200,
    });
    return dedupeCallLegs(calls);
  });`;

const oldBlockCount = countOf(src, oldBlock);
if (oldBlockCount === 0) {
  if (src.includes('return dedupeCallLegs(calls)')) {
    console.log('• GET /calls already returns dedupeCallLegs — skipping.');
  } else {
    console.error('✗ Could not locate the GET /calls return block to patch.');
    process.exit(1);
  }
} else if (oldBlockCount > 1) {
  console.error(`✗ GET /calls return block matched ${oldBlockCount} times — ambiguous.`);
  process.exit(1);
} else {
  src = src.replace(oldBlock, newBlock);
  console.log('✓ Bumped take 100 → 200 and switched return to dedupeCallLegs(calls).');
}

writeFileSync(filePath, src, 'utf8');

// Validate syntax via tsc.
try {
  execSync('npx tsc --noEmit -p apps/api', { cwd: repoRoot, stdio: 'pipe' });
  console.log('✓ TypeScript check passed.');
} catch (e) {
  console.error('✗ tsc failed:');
  console.error(e.stdout?.toString());
  console.error(e.stderr?.toString());
  process.exit(1);
}

console.log('\nDone. Next:');
console.log('  git diff apps/api/src/calls/calls.routes.ts');
console.log('  git add apps/api/src/calls/calls.routes.ts');
console.log('  git commit -m "Dedupe call legs in Recents (group by sessionId)"');
console.log('  git push');
