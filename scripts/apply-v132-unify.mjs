#!/usr/bin/env node
// v0.10.132 - Unify incoming-call UI across main window + floater.
//
// USER FEEDBACK on v0.10.131:
//   1. Floater: Reply with Text sits slightly higher than Decline and
//      Accept because its 2-line label is taller than 1-line labels and
//      the row uses center alignment.
//   2. Main window stacked-call (already on a call): currently shows
//      Decline + Hold&Accept(amber phone-forward) + plain Accept(green).
//      The plain Accept would merge call audio (same bug we fixed on
//      the floater in v0.10.120). Remove it.
//   3. Reply with Text was explicitly hidden in stacked mode via
//      `canReply = !canHoldAndAccept && ...` - unhide so it appears in
//      stacked mode too on BOTH surfaces.
//   4. Main window Hold & Accept icon should match the floater's new
//      style (green Phone with orange pause badge top-right) instead of
//      the current amber PhoneForwarded.
//
// CHANGES:
//   apps/desktop/src/main.ts:
//     - Add `align-items: flex-start;` to .row CSS (fixes alignment)
//     - Remove `!hasActiveCall &&` from canReply (shows Reply in stacked)
//   apps/web/src/components/IncomingCall.tsx:
//     - Line 149: remove `!canHoldAndAccept &&` from canReply
//     - JSX: reorder to Decline / Reply / Accept-or-HoldAndAccept
//     - Hold & Accept icon = Phone + <span class="incoming-pause-badge">
//     - Hide plain Accept when canHoldAndAccept (was rendering both)
//   apps/web/src/styles.css:
//     - .incoming-btn.hold-accept: green #22c55e (was amber #f59e0b)
//     - 72x72 (was 64x64) - same size as Decline + Accept
//     - Add .incoming-pause-badge (absolute top-right, 24px orange disc
//       with 2.5px green border, white pause bars inside)
//
// USAGE:
//   1. Copy to acedialerv4\scripts\apply-v132-unify.mjs
//   2. cd acedialerv4
//   3. node scripts/apply-v132-unify.mjs
//   4. node scripts/strip-null-bytes.mjs
//   5. npx tsc --noEmit -p apps/desktop/tsconfig.json
//   6. npx tsc --noEmit -p apps/web/tsconfig.json
//   7. git diff --stat
//   8. git add -A && git commit -m "v0.10.132: unify main window + floater incoming-call UI" && git push

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v132] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v132] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v132] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v132] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// 1. Floater fixes: row alignment + Reply with Text in stacked mode
// ===========================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'add align-items: flex-start to .row to top-align buttons',
    find: `  .row { display: flex; justify-content: space-around; gap: 16px;
    margin-top: 14px; -webkit-app-region: no-drag; }`,
    replace: `  .row { display: flex; justify-content: space-around; gap: 16px;
    align-items: flex-start;
    margin-top: 14px; -webkit-app-region: no-drag; }`,
  },
  {
    label: 'unhide Reply with Text in stacked-call floater (remove !hasActiveCall gate)',
    find: `  const replyableDigits = (callerNumber ?? '').replace(/[\\s()+\\-]/g, '');
  const canReply = !hasActiveCall && /^\\d+$/.test(replyableDigits);`,
    replace: `  const replyableDigits = (callerNumber ?? '').replace(/[\\s()+\\-]/g, '');
  // v0.10.132 - Reply with Text is now shown in both no-call and
  // already-on-call modes. Floater stacked layout becomes 3 buttons
  // (Decline / Reply / Hold&Accept) matching the main window.
  const canReply = /^\\d+$/.test(replyableDigits);`,
  },
]);

// ===========================================================
// 2. Main window IncomingCall.tsx - unhide Reply in stacked, hide
//    plain Accept in stacked, restructure Hold & Accept icon
// ===========================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: 'unhide Reply with Text in stacked mode (remove !canHoldAndAccept gate)',
    find: `  const canReply = !canHoldAndAccept && /^\\+?\\d/.test(replyableNumber);`,
    replace: `  // v0.10.132 - Reply with Text is now shown in both no-call and
  // already-on-call modes. Main window stacked layout becomes 3 buttons
  // (Decline / Reply / Hold&Accept) with plain Accept removed (audio-merge bug).
  const canReply = /^\\+?\\d/.test(replyableNumber);`,
  },
  {
    label: 'restructure incoming-actions JSX: reorder + hide plain Accept in stacked',
    find: `        <div className="incoming-actions">
          <div className="incoming-action-stack">
            <button className="incoming-btn decline" onClick={declineCall} aria-label="Decline">
              <PhoneOff size={32} />
            </button>
            <div className="incoming-action-label">Decline</div>
          </div>
          {canHoldAndAccept && (
            <div className="incoming-action-stack">
              <button
                className="incoming-btn hold-accept"
                onClick={handleHoldAndAccept}
                aria-label="Hold current call and accept"
                title="Hold current call and accept"
              >
                <PhoneForwarded size={30} />
              </button>
              <div className="incoming-action-label">Hold &amp; Accept</div>
            </div>
          )}
          {canReply && (
            <div className="incoming-action-stack">
              <button
                className="incoming-btn reply"
                onClick={handleReplyWithMessage}
                aria-label="Reply with message"
                title="Reply with a text message and decline the call"
              >
                <MessageSquare size={28} />
              </button>
              <div className="incoming-action-label">Reply with Text</div>
            </div>
          )}
          <div className="incoming-action-stack">
            <button className="incoming-btn accept" onClick={handleAccept} aria-label="Accept">
              <Phone size={32} />
            </button>
            <div className="incoming-action-label">Accept</div>
          </div>
        </div>`,
    replace: `        <div className="incoming-actions">
          {/* v0.10.132 - reordered: Decline / Reply with Text / (Accept | Hold & Accept).
              Plain Accept and Hold & Accept are mutually exclusive based on
              canHoldAndAccept (we used to render BOTH which let the user
              tap plain Accept and accidentally merge audio - same bug we
              fixed on the floater in v0.10.120). */}
          <div className="incoming-action-stack">
            <button className="incoming-btn decline" onClick={declineCall} aria-label="Decline">
              <PhoneOff size={32} />
            </button>
            <div className="incoming-action-label">Decline</div>
          </div>
          {canReply && (
            <div className="incoming-action-stack">
              <button
                className="incoming-btn reply"
                onClick={handleReplyWithMessage}
                aria-label="Reply with message"
                title="Reply with a text message and decline the call"
              >
                <MessageSquare size={28} />
              </button>
              <div className="incoming-action-label">Reply with Text</div>
            </div>
          )}
          {canHoldAndAccept ? (
            <div className="incoming-action-stack">
              <button
                className="incoming-btn hold-accept"
                onClick={handleHoldAndAccept}
                aria-label="Hold current call and accept"
                title="Hold current call and accept"
              >
                <Phone size={32} />
                <span className="incoming-pause-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="0.8"/><rect x="14" y="4" width="4" height="16" rx="0.8"/></svg>
                </span>
              </button>
              <div className="incoming-action-label">Hold &amp; Accept</div>
            </div>
          ) : (
            <div className="incoming-action-stack">
              <button className="incoming-btn accept" onClick={handleAccept} aria-label="Accept">
                <Phone size={32} />
              </button>
              <div className="incoming-action-label">Accept</div>
            </div>
          )}
        </div>`,
  },
]);

// ===========================================================
// 3. styles.css - hold-accept restyle + pause badge
// ===========================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'restyle .incoming-btn.hold-accept (green 72px) + add pause badge CSS',
    find: `.incoming-btn.hold-accept {
  background: #f59e0b;
  width: 64px;
  height: 64px;
  position: relative;
  flex-direction: column;
  gap: 2px;
  /* No pulse — the accept button already pulses; two pulsing buttons reads
     as noisy. */
}`,
    replace: `.incoming-btn.hold-accept {
  /* v0.10.132 - same green as plain Accept (#22c55e) and same 72px size.
     The orange pause badge in the top-right is the only visual difference
     between this and plain Accept, matching the floater design.
     Bug it fixes: previously amber #f59e0b at 64px which looked like a
     completely different action. Users couldn't tell it was an Accept
     variant from the icon alone. */
  background: #22c55e;
  width: 72px;
  height: 72px;
  position: relative;
  /* No pulse - the regular accept already pulses; this version doesn't
     pulse because it's a more deliberate action (hold current first). */
}

/* v0.10.132 - orange pause badge layered on top-right of Hold & Accept.
   The orange (#f97316) matches Reply with Text so "orange = modifier
   action" is consistent across the floater and main window. The 2.5px
   green border separates the badge visually from the button background. */
.incoming-pause-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #f97316;
  border: 2.5px solid #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
}
.incoming-pause-badge svg {
  width: 13px;
  height: 13px;
  fill: #ffffff;
}`,
  },
  {
    label: 'remove now-unused .incoming-btn.hold-accept.small (no longer needed)',
    find: `.incoming-btn.hold-accept.small {
  width: 40px;
  height: 40px;
  flex-direction: row;
}`,
    replace: `.incoming-btn.hold-accept.small {
  /* v0.10.132 - small variant retained for any place that still uses it;
     keeps the new green styling but at compact size. */
  width: 40px;
  height: 40px;
}`,
  },
]);

// ===========================================================
// 4. Remove unused PhoneForwarded import (no longer used after this change)
// ===========================================================
applyEdits('apps/web/src/components/IncomingCall.tsx', [
  {
    label: 'drop unused PhoneForwarded import',
    find: `import { Phone, PhoneOff, PhoneForwarded, MessageSquare } from 'lucide-react';`,
    replace: `import { Phone, PhoneOff, MessageSquare } from 'lucide-react';`,
  },
]);

// ===========================================================
// 5. Version bumps to 0.10.132
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
  c = c.replace(/"version":\s*"0\.10\.131"/, '"version": "0.10.132"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.131 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.131 → 0.10.132`);
  }
}

// ===========================================================
// 6. DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.132',
    find: `const APP_VERSION = '0.10.131';`,
    replace: `const APP_VERSION = '0.10.132';`,
  },
]);

// ===========================================================
// 7. whatsNew.ts v0.10.132 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.132 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.131',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.132',\n    date: 'June 12, 2026',\n    highlight: 'Incoming-call UI unified across main window and floater - clearer, safer, consistent',\n    changes: [\n      { type: 'improved', text: 'When already on a call and a second call rings, the main window now shows exactly three buttons: Decline, Reply with Text, Hold and Accept (in that order). Previously it showed four buttons including a plain Accept that would merge the two calls audio - the same bug we fixed on the floater popup in v0.10.120 has now been fixed on the main window too. Plain Accept is automatically hidden whenever Hold and Accept is the safe option.' },\n      { type: 'improved', text: 'Reply with Text is now available even when you are already on a call. Previously it was only offered when you had no active call. Available on both the main window and the floating popup.' },\n      { type: 'improved', text: 'Hold and Accept on the main window now uses the same green-circle-with-orange-pause-badge icon as the floater. Previously it was amber with a phone-forward arrow icon, which looked completely different from the floater. Now both surfaces share the same icon vocabulary, just at different sizes.' },\n      { type: 'fixed', text: 'Floater button alignment: Reply with Text was sitting slightly higher than Decline and Accept because its two-line label was taller than the one-line labels. Switched the floater row to top-align all buttons, so they now sit at the same vertical position regardless of label length.' },\n    ],\n  },\n  {\n    version: '0.10.131',`,
  },
]);

console.log('\n[apply-v132] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  3. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  4. git diff --stat');
console.log('  5. git add -A && git commit -m "v0.10.132: unify incoming-call UI across main window and floater"');
console.log('  6. git push');
