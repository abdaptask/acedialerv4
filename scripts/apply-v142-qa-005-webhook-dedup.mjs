#!/usr/bin/env node
// v0.10.142 - QA-005: Postgres-backed webhook dedup (multi-replica unblock).
//
// Replaces (alongside, for safety) the in-memory `sentMissedCallCards`
// and `sentVoicemailCards` Sets in teamsNotifier.ts with a Postgres-
// backed dedup table. With this, ace-dialer-webhooks can scale to >1
// replica without duplicate Teams cards being sent.
//
// CHANGES:
//   1. Prisma model `WebhookDedup` added to schema.prisma.
//   2. New file: apps/webhooks/src/webhookDedup.ts (claimSend helper
//      with graceful fallback if the table doesn't exist yet).
//   3. teamsNotifier.ts: notifyMissedCall + notifyVoicemail call
//      claimSend() BEFORE sending the card. In-memory Sets stay as
//      a fast-path optimization within a single replica.
//   4. webhooks/main.ts: hourly TTL cleanup deleting rows older than 7 days.
//
// DEPLOYMENT SEQUENCE (IMPORTANT):
//   After running this script and BEFORE git push:
//     cd packages/db
//     npx prisma generate
//     npm run db:push    # applies the schema migration to Supabase
//   THEN commit + push. If you skip db:push, the webhooks service will
//   still run (claimSend falls back gracefully) but won't actually dedup
//   across replicas until the table exists.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v142] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v142] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');

  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v142] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v142] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeNewFile(relPath, content) {
  const fp = join(ROOT, relPath);
  if (existsSync(fp)) {
    console.error(`[apply-v142] FATAL: ${fp} already exists. Aborting to avoid overwrite.`);
    process.exit(1);
  }
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, content, 'utf8');
  console.log(`  ✓ NEW ${relPath} (${content.length} bytes)`);
}

// ===========================================================
// 1. Prisma schema - add WebhookDedup model
// ===========================================================
applyEdits('packages/db/prisma/schema.prisma', [
  {
    label: 'Append WebhookDedup model after SystemSetting',
    find: `model SystemSetting {
  /// Setting name. Globally unique. Snake_case by convention.
  key       String   @id
  /// Setting value. May be a short string or a multi-MB base64 blob.
  /// Postgres TEXT type accommodates both; we don't enforce limits here.
  value     String
  /// ACE user id of the admin who last set this. Null for system defaults.
  updatedBy Int?     @map("updated_by")
  updatedAt DateTime @updatedAt @map("updated_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("system_settings")
}`,
    replace: `model SystemSetting {
  /// Setting name. Globally unique. Snake_case by convention.
  key       String   @id
  /// Setting value. May be a short string or a multi-MB base64 blob.
  /// Postgres TEXT type accommodates both; we don't enforce limits here.
  value     String
  /// ACE user id of the admin who last set this. Null for system defaults.
  updatedBy Int?     @map("updated_by")
  updatedAt DateTime @updatedAt @map("updated_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("system_settings")
}

/// v0.10.142 — QA-005 — Cross-replica webhook dedup.
///
/// Each card-send (Teams missed-call, Teams voicemail, future
/// inbound-SMS) reserves a unique key in this table BEFORE sending.
/// If the INSERT fails with a unique-violation (P2002), another
/// replica has already claimed the key and we skip the send. A
/// background sweep purges rows older than 7 days so the table
/// stays small.
///
/// Key convention: \`<channel>:<event>:<entityId>\`, e.g.
///   teams:missedCall:1234        - call.id
///   teams:voicemail:567          - voicemail.id
///   email:voicemail:567          - voicemail.id (email channel)
model WebhookDedup {
  /// Composite key like \`teams:missedCall:1234\`. The application
  /// builds these from a known-stable identifier per event class.
  key    String   @id
  /// When the claim was made. Used by the hourly TTL sweep.
  sentAt DateTime @default(now()) @map("sent_at")

  @@index([sentAt])
  @@map("webhook_dedup")
}`,
  },
]);

// ===========================================================
// 2. NEW file: apps/webhooks/src/webhookDedup.ts
// ===========================================================
writeNewFile('apps/webhooks/src/webhookDedup.ts', `// v0.10.142 — QA-005 — Cross-replica webhook dedup.
//
// Replaces module-local Set<id> dedup in teamsNotifier.ts /
// emailNotifier.ts. Set-based dedup ONLY works when there's a single
// replica (each process has its own Set, so the same event delivered
// to two replicas would fire two cards). The Postgres-backed dedup
// here is a single source of truth across all replicas.
//
// USAGE:
//   if (!(await claimSend(\`teams:missedCall:\${callDbId}\`))) {
//     // Another replica (or earlier event in this replica) already
//     // sent the card. Skip.
//     return;
//   }
//   // proceed with send
//
// GRACEFUL DEGRADATION:
// If the WebhookDedup table doesn't exist yet (db:push hasn't been
// run), the helper logs a warning and returns true (treats the
// claim as successful). This lets you deploy the code BEFORE the
// migration runs without breaking the service. The in-memory Set
// fallback in teamsNotifier.ts still works within a single replica.

import { prisma } from '@ace/db';

/**
 * Attempt to claim a dedup key. Returns true if the claim succeeded
 * (this is the first time we've seen this key), false if it's already
 * been claimed by another sender.
 *
 * Falls back to true (claim succeeded) if the WebhookDedup table
 * doesn't exist yet (degrades to in-memory-only dedup during the
 * migration window).
 */
export async function claimSend(key: string): Promise<boolean> {
  try {
    await prisma.webhookDedup.create({ data: { key } });
    return true;
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    const code = err?.code;
    if (code === 'P2002') {
      // Unique violation - another replica already claimed this key.
      return false;
    }
    if (code === 'P2021' || code === 'P2022') {
      // Table doesn't exist yet (db:push hasn't run). Degrade gracefully.
      console.warn(
        '[webhookDedup] table missing - falling back to in-memory only. Run db:push to enable cross-replica dedup.',
      );
      return true;
    }
    // Unexpected error - log but don't block the send; the in-memory
    // Set in the caller is the backup defense.
    console.warn(
      '[webhookDedup] claim failed unexpectedly - proceeding with send',
      err?.message ?? err,
    );
    return true;
  }
}
`);

// ===========================================================
// 3. teamsNotifier.ts - add claimSend gates to notifyMissedCall + notifyVoicemail
// ===========================================================
applyEdits('apps/webhooks/src/teamsNotifier.ts', [
  {
    label: 'QA-005: add import for claimSend helper',
    find: `const sentMissedCallCards = new Set<number>();`,
    replace: `import { claimSend } from './webhookDedup.js';

const sentMissedCallCards = new Set<number>();`,
  },
  {
    label: 'QA-005: gate notifyMissedCall behind claimSend',
    find: `  // Dedup — skip if we've already sent a card for this call row in
  // this process lifetime. See file header for the full rationale.
  if (sentMissedCallCards.has(opts.callDbId)) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId },
      '[teams] missed-call already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race when Telnyx fires two
  // call.hangup events back-to-back.
  sentMissedCallCards.add(opts.callDbId);`,
    replace: `  // Dedup — skip if we've already sent a card for this call row in
  // this process lifetime. See file header for the full rationale.
  if (sentMissedCallCards.has(opts.callDbId)) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId },
      '[teams] missed-call already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race when Telnyx fires two
  // call.hangup events back-to-back.
  sentMissedCallCards.add(opts.callDbId);
  // v0.10.142 — QA-005 — cross-replica claim. Falls back to true if
  // the webhook_dedup table isn't deployed yet (graceful degradation).
  if (!(await claimSend(\`teams:missedCall:\${opts.callDbId}\`))) {
    consoleLog(
      { userId: opts.userId, callDbId: opts.callDbId },
      '[teams] missed-call card already claimed by another replica — skipping',
    );
    return;
  }`,
  },
  {
    label: 'QA-005: gate notifyVoicemail behind claimSend',
    find: `  if (sentVoicemailCards.has(opts.voicemailId)) {
    consoleLog(
      { voicemailId: opts.voicemailId, reason: opts.reason },
      '[teams] voicemail card already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race between transcribed + timeout.
  sentVoicemailCards.add(opts.voicemailId);`,
    replace: `  if (sentVoicemailCards.has(opts.voicemailId)) {
    consoleLog(
      { voicemailId: opts.voicemailId, reason: opts.reason },
      '[teams] voicemail card already sent — skipping duplicate',
    );
    return;
  }
  // Reserve immediately to avoid a race between transcribed + timeout.
  sentVoicemailCards.add(opts.voicemailId);
  // v0.10.142 — QA-005 — cross-replica claim. The Set above is the
  // fast-path within this process; this is the cross-replica guard.
  if (!(await claimSend(\`teams:voicemail:\${opts.voicemailId}\`))) {
    consoleLog(
      { voicemailId: opts.voicemailId, reason: opts.reason },
      '[teams] voicemail card already claimed by another replica — skipping',
    );
    return;
  }`,
  },
]);

// ===========================================================
// 4. webhooks/main.ts - hourly TTL cleanup
// ===========================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'QA-005: hourly TTL cleanup of webhook_dedup rows older than 7 days',
    find: `process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));`,
    replace: `process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// v0.10.142 — QA-005 — hourly TTL sweep of webhook_dedup. Keeps the
// table small (<1MB under realistic load). 7-day retention is a
// generous window vs. the worst-case Telnyx replay-after-failure
// timeline (<24h in practice). If the table doesn't exist yet
// (db:push hasn't run), the sweep silently no-ops.
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await prisma.webhookDedup.deleteMany({
      where: { sentAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      app.log.info(
        { count: result.count },
        '[webhookDedup] hourly TTL sweep — deleted old rows',
      );
    }
  } catch (e) {
    // Table missing or other transient error - log and continue.
    app.log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      '[webhookDedup] hourly TTL sweep failed (non-fatal)',
    );
  }
}, 60 * 60 * 1000);`,
  },
]);

// ===========================================================
// Version bumps to 0.10.142
// ===========================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.141"/, '"version": "0.10.142"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.141 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.141 → 0.10.142`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.142',
    find: `const APP_VERSION = '0.10.141';`,
    replace: `const APP_VERSION = '0.10.142';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.142 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.141',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.142',\n    date: 'June 12, 2026',\n    highlight: 'Backend hardening — Teams card dedup now works across multiple webhook replicas',\n    changes: [\n      { type: 'fixed', text: 'Teams notification dedup is now backed by a Postgres webhook_dedup table instead of an in-memory Set per process. Previously if the ace-dialer-webhooks service scaled beyond one replica (or restarted between the recording-completed and the 30-second timeout fallback paths), the same Teams card could fire twice. Now every send-card path reserves a unique key in the database first; only the first replica to claim a key sends the card.' },\n      { type: 'fixed', text: 'Server-only change. No user-facing impact in the current single-replica configuration, but enables future horizontal scaling of the webhooks service without duplicate notifications.' },\n    ],\n  },\n  {\n    version: '0.10.141',`,
  },
]);

console.log('\n[apply-v142] ALL EDITS APPLIED SUCCESSFULLY');
console.log('');
console.log('CRITICAL NEXT STEPS — schema migration MUST run before git push:');
console.log('  1. cd packages/db');
console.log('  2. npx prisma generate');
console.log('  3. npm run db:push  # creates webhook_dedup table in Supabase');
console.log('  4. cd ../..');
console.log('  5. npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  6. git diff --stat');
console.log('  7. git add -A && git commit && git push');
console.log('');
console.log('If you skip db:push, the webhooks service will still run (claimSend');
console.log('falls back gracefully) but cross-replica dedup will be a no-op until');
console.log('the table exists.');
