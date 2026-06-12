// ===========================================================================
// find-trial-users.ts - resolve a batch of emails to their full TeXML-trial
// readiness picture: User row, all UserDids, SIP username, current greeting
// config, and current TeXML-migration status.
//
// PURPOSE: before expanding the TeXML voicemail trial from 1 user to N, we
// need to surface ambiguity / missing data EARLY rather than discover it
// halfway through a migration. This script prints everything you need to
// eyeball before running any migrate endpoints.
//
// Usage:
//   npm --workspace=packages/db run find-trial-users -- \
//     nileshd@aptask.com ravindra@aptask.com stefan@aptask.com \
//     himankj@aptask.com mansiv@aptask.com eelak@aptask.com \
//     rahuls@aptask.com rajatp@aptask.com
//
// Output:
//   - One section per email, showing User row + ALL of their UserDids
//   - Per-DID: number, connectionId, texmlMigratedAt, callControlMigratedAt
//   - Per-user: sipUsername (required for TeXML <Dial><Sip> bridge),
//               voicemailGreetingMode / Url / Text
//   - WARN lines for: not found, no DID, multiple DIDs, no sipUsername,
//     already migrated
//   - At the end: a copy-paste TEXML_TRIAL_DIDS env-var string covering all
//     resolved DIDs (one per user, picking the first/only one — multi-DID
//     users get flagged so you choose manually)
//
// READ-ONLY. Does NOT modify the database. Safe to run anytime.
// ===========================================================================

import { PrismaClient } from '@prisma/client';

interface ResolvedUser {
  inputEmail: string;
  found: boolean;
  userId?: number | string;
  email?: string;
  fullName?: string;
  sipUsername?: string | null;
  greetingMode?: string | null;
  greetingUrl?: string | null;
  greetingText?: string | null;
  dids: Array<{
    id: string;
    didNumber: string;
    telnyxNumberId: string | null;
    connectionId: string | null;
    texmlMigratedAt: Date | null;
    callControlMigratedAt: Date | null;
    preMigrationConnectionId: string | null;
  }>;
}

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) {
    console.error('Usage: tsx find-trial-users.ts <email1> [email2] [email3] ...');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const results: ResolvedUser[] = [];

  try {
    for (const inputEmail of emails) {
      const lc = inputEmail.toLowerCase();
      // Case-insensitive match - some DBs store emails mixed-case.
      const user = await prisma.user.findFirst({
        where: { email: { equals: lc, mode: 'insensitive' } },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          sipUsername: true,
          voicemailGreetingMode: true,
          voicemailGreetingUrl: true,
          voicemailGreetingText: true,
          userDids: {
            select: {
              id: true,
              didNumber: true,
              telnyxNumberId: true,
              connectionId: true,
              texmlMigratedAt: true,
              callControlMigratedAt: true,
              preMigrationConnectionId: true,
            },
          },
        },
      });

      if (!user) {
        results.push({ inputEmail, found: false, dids: [] });
        continue;
      }

      results.push({
        inputEmail,
        found: true,
        userId: user.id,
        email: user.email,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') || '(no name)',
        sipUsername: user.sipUsername,
        greetingMode: user.voicemailGreetingMode,
        greetingUrl: user.voicemailGreetingUrl,
        greetingText: user.voicemailGreetingText,
        dids: user.userDids.map((d) => ({
          id: d.id,
          didNumber: d.didNumber,
          telnyxNumberId: d.telnyxNumberId,
          connectionId: d.connectionId,
          texmlMigratedAt: d.texmlMigratedAt,
          callControlMigratedAt: d.callControlMigratedAt,
          preMigrationConnectionId: d.preMigrationConnectionId,
        })),
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  // -------- Per-user detail --------
  for (const r of results) {
    console.log('');
    console.log('================================================================');
    console.log(`INPUT: ${r.inputEmail}`);
    if (!r.found) {
      console.log('  STATUS: NOT FOUND');
      console.log('  ACTION: double-check spelling. If correct, this user is not in AptLink DB.');
      continue;
    }
    console.log(`  User ID:       ${r.userId}`);
    console.log(`  Email (DB):    ${r.email}`);
    console.log(`  Name:          ${r.fullName}`);
    console.log(`  sipUsername:   ${r.sipUsername ?? '(null)'}`);
    if (!r.sipUsername) {
      console.log('  WARN: no sipUsername - TeXML <Dial><Sip> bridge will fall through to default greeting.');
    }
    console.log(`  Greeting mode: ${r.greetingMode ?? '(default)'}`);
    if (r.greetingMode === 'audio') {
      console.log(`  Greeting URL:  ${r.greetingUrl ?? '(missing!)'}`);
    } else if (r.greetingMode === 'tts') {
      console.log(`  Greeting text: ${(r.greetingText ?? '').slice(0, 80)}${(r.greetingText ?? '').length > 80 ? '...' : ''}`);
    }
    if (r.dids.length === 0) {
      console.log('  DIDs:          NONE');
      console.log('  WARN: this user has no DID assigned - cannot be added to TeXML trial.');
    } else {
      console.log(`  DIDs:          ${r.dids.length}`);
      for (const d of r.dids) {
        console.log(`    - ${d.didNumber}`);
        console.log(`        UserDid.id:               ${d.id}`);
        console.log(`        telnyxNumberId:           ${d.telnyxNumberId ?? '(MISSING - migrate will fail!)'}`);
        console.log(`        connectionId:             ${d.connectionId ?? '(null)'}`);
        console.log(`        texmlMigratedAt:          ${d.texmlMigratedAt?.toISOString() ?? '(not migrated)'}`);
        console.log(`        callControlMigratedAt:    ${d.callControlMigratedAt?.toISOString() ?? '(null)'}`);
        console.log(`        preMigrationConnectionId: ${d.preMigrationConnectionId ?? '(null)'}`);
      }
      if (r.dids.length > 1) {
        console.log('  WARN: user has MULTIPLE DIDs - pick which one to use for TeXML trial.');
      }
      if (r.dids.some((d) => d.texmlMigratedAt)) {
        console.log('  NOTE: at least one DID is already TeXML-migrated.');
      }
    }
  }

  // -------- Summary table --------
  console.log('');
  console.log('================================================================');
  console.log('SUMMARY');
  console.log('================================================================');
  console.log('input email                       | user id    | DID(s)             | sipUser            | TeXML?');
  console.log('----------------------------------|------------|--------------------|--------------------|-------');
  for (const r of results) {
    const email = r.inputEmail.padEnd(33).slice(0, 33);
    if (!r.found) {
      console.log(`${email} | NOT FOUND  |                    |                    |`);
      continue;
    }
    const uid = String(r.userId ?? '').padEnd(10).slice(0, 10);
    const did = (r.dids.map((d) => d.didNumber).join(',') || '(none)').padEnd(18).slice(0, 18);
    const sip = (r.sipUsername ?? '(null)').padEnd(18).slice(0, 18);
    const migrated = r.dids.some((d) => d.texmlMigratedAt) ? 'YES' : 'no';
    console.log(`${email} | ${uid} | ${did} | ${sip} | ${migrated}`);
  }

  // -------- TEXML_TRIAL_DIDS proposal --------
  const trialDids: string[] = [];
  for (const r of results) {
    if (!r.found || r.dids.length === 0) continue;
    if (r.dids.length === 1) {
      trialDids.push(r.dids[0]!.didNumber);
    } else {
      // multi-DID user: append all but mark for manual review
      for (const d of r.dids) trialDids.push(`${d.didNumber} /*MULTI:${r.email}*/`);
    }
  }
  console.log('');
  console.log('PROPOSED TEXML_TRIAL_DIDS env-var value (DO NOT paste comments into Render):');
  console.log(`  TEXML_TRIAL_DIDS=+16467379912,${trialDids.join(',')}`);
  console.log('');
  console.log('(+16467379912 is Abdulla, kept first. Remove any /*MULTI:...*/ markers after picking.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
