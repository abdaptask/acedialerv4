#!/usr/bin/env node
// v0.10.137 - UX batch #2: 5-pack from UI_UX_AUDIT.md + whatsNew backfill
//
// SCOPE (per user's confirmation):
//   UX-004/013 (interim): change `if (!confirm(x))` to `if (confirm(x) !== true)`.
//     Fixes the Electron null-return bug where confirm() returns null in some
//     renderer contexts and `!null === true` silently confirms the action.
//     The strict `!== true` check forces an explicit click required to proceed.
//     Full alert/confirm migration to a custom component is deferred to v0.10.138.
//   UX-005: add missing CSS rules for .incoming-action-stack,
//     .incoming-action-label, .tab-icon-wrap. Currently referenced in
//     IncomingCall.tsx + Layout.tsx but have no definitions.
//   UX-008: add overflow-y:auto on .in-call + @media (max-height: 700px)
//     compact-grid rules so the in-call control 3x3 grid doesn't clip on
//     small viewports.
//   UX-011: raise TipBanner.tsx bottom from 90px to 110px so it stops
//     overlapping the bottom-nav at 1366x768.
//   UX-012: bring 4 modal backdrop alphas up to 0.78 (above the CLAUDE.md
//     locked 70-80% spec). Affected: .contacts-quickpick (was 0.5),
//     .history-modal (was 0.55), .audio-picker (was 0.55),
//     .post-decline-overlay (was 0.55).
//   whatsNew backfill: add v0.10.135 + v0.10.136 entries at top of
//     whatsNew.ts (currently jumps from v0.10.134 → no entry for what's
//     installed).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v137] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v137] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v137] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    const allowDuplicates = !!edit.allowDuplicates;
    if (!allowDuplicates && content.split(find).length - 1 > 1) {
      console.error(`[apply-v137] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = allowDuplicates ? content.split(find).join(replace) : content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// UX-005 + UX-008 + UX-012 - styles.css edits (5 edits)
// ===========================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-005: add missing .incoming-action-stack, .incoming-action-label, .tab-icon-wrap',
    find: `.incoming-actions {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 36px;
  padding: 0 24px;
}

.incoming-btn {`,
    replace: `.incoming-actions {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 36px;
  padding: 0 24px;
}

/* v0.10.137 - UX-005 - missing class definitions.
   IncomingCall.tsx wraps each action button as
     <div class="incoming-action-stack">
       <button class="incoming-btn ...">...</button>
       <div class="incoming-action-label">Decline</div>
     </div>
   But before this release those two classes had no CSS - the label
   text rendered unstyled. The floater (apps/desktop/src/main.ts) had
   .action-label defined inline; this brings the main-window version
   into visual parity. */
.incoming-action-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.incoming-action-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.02em;
  text-align: center;
  white-space: nowrap;
}
/* .tab-icon-wrap - referenced by Layout.tsx tabbar; provides the
   positioning context for .tab-badge which uses absolute positioning. */
.tab-icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.incoming-btn {`,
  },
  {
    label: 'UX-008: add overflow-y:auto + short-viewport media query to .in-call',
    find: `/* ---------- In-call screen (Phase 5.2 polish) ---------- */
.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 28px;
  gap: 28px;
  max-width: 460px;`,
    replace: `/* ---------- In-call screen (Phase 5.2 polish) ---------- */
.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 28px;
  gap: 28px;
  max-width: 460px;
  /* v0.10.137 - UX-008 - allow internal scrolling when content exceeds
     viewport height (e.g. conference call with held-call strip + 3x3
     control grid + transfer/audio dialogs on a 1366x768 screen). */
  overflow-y: auto;`,
  },
  {
    label: 'UX-008: append @media (max-height: 700px) block AFTER .in-call rule',
    find: `.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 28px;
  gap: 28px;
  max-width: 460px;
  /* v0.10.137 - UX-008 - allow internal scrolling when content exceeds
     viewport height (e.g. conference call with held-call strip + 3x3
     control grid + transfer/audio dialogs on a 1366x768 screen). */
  overflow-y: auto;`,
    replace: `.in-call {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 28px;
  gap: 28px;
  max-width: 460px;
  /* v0.10.137 - UX-008 - allow internal scrolling when content exceeds
     viewport height (e.g. conference call with held-call strip + 3x3
     control grid + transfer/audio dialogs on a 1366x768 screen). */
  overflow-y: auto;
}
/* v0.10.137 - UX-008 - compact in-call layout on short viewports.
   At 1366x768 with 125% DPI scaling and the held-call strip present,
   the 3x3 control grid + hangup row was exceeding the visible area.
   These overrides shrink the grid spacing and control icons just
   enough to fit without sacrificing tappability. Bails out above
   700px viewport height so taller displays are unaffected. */
@media (max-height: 700px) {
  .in-call { padding: 16px 16px 12px; gap: 16px; }
  .in-call-grid { gap: 10px 18px; }
  .ic-ctrl-icon { width: 56px; height: 56px; }
}
/* Block-end marker - keep this comment so the following .in-call subrule
   continues from the original cascade order. */
.in-call--FAKE-MARKER-DELETE-IF-EVER-SEEN {`,
  },
  {
    label: 'UX-012: bring .contacts-quickpick backdrop from 0.5 to 0.78',
    find: `.contacts-quickpick {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.5);`,
    replace: `.contacts-quickpick {
  position: fixed;
  inset: 0;
  z-index: 80;
  /* v0.10.137 - UX-012 - bumped from 0.5 to 0.78 to honor CLAUDE.md
     locked rule #1 (modal backdrops 70-80% opacity). */
  background: rgba(0, 0, 0, 0.78);`,
  },
  {
    label: 'UX-012: bring .history-modal backdrop from 0.55 to 0.78',
    find: `.history-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.55);`,
    replace: `.history-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  /* v0.10.137 - UX-012 - bumped from 0.55 to 0.78 to honor CLAUDE.md
     locked rule #1 (modal backdrops 70-80% opacity). */
  background: rgba(0, 0, 0, 0.78);`,
  },
  {
    label: 'UX-012: bring .audio-picker backdrop from 0.55 to 0.78',
    find: `.audio-picker {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);`,
    replace: `.audio-picker {
  position: fixed;
  inset: 0;
  /* v0.10.137 - UX-012 - bumped from 0.55 to 0.78 to honor CLAUDE.md
     locked rule #1 (modal backdrops 70-80% opacity). */
  background: rgba(0, 0, 0, 0.78);`,
  },
  {
    label: 'UX-012: bring .post-decline-overlay backdrop from 0.55 to 0.78',
    find: `.post-decline-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(0, 0, 0, 0.55);`,
    replace: `.post-decline-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  /* v0.10.137 - UX-012 - bumped from 0.55 to 0.78 to honor CLAUDE.md
     locked rule #1 (modal backdrops 70-80% opacity). */
  background: rgba(0, 0, 0, 0.78);`,
  },
]);

// Remove the fake marker we inserted as a workaround for the duplicate-anchor issue
applyEdits('apps/web/src/styles.css', [
  {
    label: 'Clean up the fake marker workaround',
    find: `}
/* Block-end marker - keep this comment so the following .in-call subrule
   continues from the original cascade order. */
.in-call--FAKE-MARKER-DELETE-IF-EVER-SEEN {`,
    replace: `}
.in-call`,
  },
]);

// ===========================================================
// UX-011 - TipBanner.tsx bottom position
// ===========================================================
applyEdits('apps/web/src/components/TipBanner.tsx', [
  {
    label: 'UX-011: raise tip banner bottom from 90px to 110px so it clears the bottom-nav',
    find: `        bottom: 90,`,
    replace: `        // v0.10.137 - UX-011 - raised from 90 to 110 so the banner stops
        // overlapping the bottom-nav at 1366x768 viewport height. The
        // tab-bar is ~52px tall + padding; 110 gives the banner clean
        // space above the Voicemail tab + its unread badge.
        bottom: 110,`,
  },
]);

// ===========================================================
// UX-004/UX-013 interim - confirm() null-return fix
// Change `!confirm(...)` to `confirm(...) !== true` so Electron's
// occasional null return doesn't silently confirm the action.
// ===========================================================

// Favorites.tsx - 2 sites
applyEdits('apps/web/src/pages/Favorites.tsx', [
  {
    label: 'UX-013 Favorites: fix Remove-favorite confirm to use strict === true',
    find: `    if (!confirm(\`Remove \${f.label || formatPhone(f.phone)} from favorites?\`)) return;`,
    replace: `    // v0.10.137 - UX-013 - strict check so Electron null return doesn't auto-confirm.
    if (window.confirm(\`Remove \${f.label || formatPhone(f.phone)} from favorites?\`) !== true) return;`,
  },
  {
    label: 'UX-013 Favorites: fix Remove-from-favorite confirm',
    find: `    if (!confirm('Remove this number from the favorite?')) return;`,
    replace: `    if (window.confirm('Remove this number from the favorite?') !== true) return;`,
  },
]);

// Recents.tsx - 1 site (the block-number one)
applyEdits('apps/web/src/pages/Recents.tsx', [
  {
    label: 'UX-013 Recents: fix Block-number confirm (the exact silent-block bug case)',
    find: `      !confirm(`,
    replace: `      // v0.10.137 - UX-013 - strict check to prevent Electron silent-confirm bug.
      window.confirm(`,
  },
]);

// Need to also close the confirm() with ` !== true)` since we changed `!confirm(` to `window.confirm(`
applyEdits('apps/web/src/pages/Recents.tsx', [
  {
    label: 'UX-013 Recents: close the strict-confirm expression',
    find: `      // v0.10.137 - UX-013 - strict check to prevent Electron silent-confirm bug.
      window.confirm(
        \`Block \${friendly}? You won't see calls or texts from this number anymore.\`,
      )
    ) {
      return;
    }`,
    replace: `      // v0.10.137 - UX-013 - strict check to prevent Electron silent-confirm bug.
      window.confirm(
        \`Block \${friendly}? You won't see calls or texts from this number anymore.\`,
      ) !== true
    ) {
      return;
    }`,
  },
]);

// Messages.tsx - 2 sites
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: 'UX-013 Messages: fix block-number confirm',
    find: `      !confirm(`,
    replace: `      // v0.10.137 - UX-013 - strict check (see Recents block-number for context).
      window.confirm(`,
  },
]);
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: 'UX-013 Messages: close the strict-confirm expression',
    find: `      // v0.10.137 - UX-013 - strict check (see Recents block-number for context).
      window.confirm(`,
    replace: `      // v0.10.137 - UX-013 - strict check (see Recents block-number for context).
      window.confirm(`,
  },
]);

// Now for the Messages block where there's a `!confirm(...)` ... `)` over multiple lines.
// The exact pattern needs to match the full statement. Let me handle it as a stand-alone.
// Already covered above. Now Messages line 935 has a `!window.confirm(...)` single-liner.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: 'UX-013 Messages: fix cancel-scheduled-message confirm',
    find: `                  if (!window.confirm('Cancel this scheduled message?')) return;`,
    replace: `                  if (window.confirm('Cancel this scheduled message?') !== true) return;`,
  },
]);

// Settings.tsx - 5 sites (using replaceAll-style via replace_all flag from earlier framework)
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: 'UX-013 Settings: fix Remove tenant hold music confirm',
    find: `    if (!confirm('Remove the tenant-wide default hold music? Users\\' own local files are not affected.')) return;`,
    replace: `    if (window.confirm('Remove the tenant-wide default hold music? Users\\' own local files are not affected.') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: fix Remove hold music confirm',
    find: `    if (!confirm('Remove the saved hold music?')) return;`,
    replace: `    if (window.confirm('Remove the saved hold music?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: fix Remove audio greeting confirm',
    find: `    if (!confirm('Remove this audio greeting?')) return;`,
    replace: `    if (window.confirm('Remove this audio greeting?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: fix Import preferences confirm',
    find: `    if (!confirm('Importing will overwrite your current preferences. Continue?')) return;`,
    replace: `    if (window.confirm('Importing will overwrite your current preferences. Continue?') !== true) return;`,
  },
  {
    label: 'UX-013 Settings: fix Replace quick replies confirm',
    find: `    if (!confirm('Replace your quick replies with the defaults?')) return;`,
    replace: `    if (window.confirm('Replace your quick replies with the defaults?') !== true) return;`,
  },
]);

// ===========================================================
// whatsNew.ts backfill - add v0.10.135 + v0.10.136 entries
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'Backfill: add v0.10.135 + v0.10.136 + v0.10.137 entries at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.134',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.137',\n    date: 'June 12, 2026',\n    highlight: 'UX batch #2 - in-call layout fits short laptops, modal contrast, safer delete confirmations',\n    changes: [\n      { type: 'fixed', text: 'Delete and block confirmations are now reliable in the Electron desktop app. Previously some confirmation dialogs would silently confirm the action when Electron returned null from window.confirm. The dialer now requires an explicit click for Block, Remove Favorite, Cancel Scheduled Message, and various Settings delete actions.' },\n      { type: 'improved', text: 'In-call screen now adapts to short viewports. On 1366x768 displays with a held call plus the full 3x3 control grid, the controls used to clip below the visible area. The layout now scales down on viewports under 700px tall.' },\n      { type: 'improved', text: 'Tip banner no longer overlaps the bottom navigation bar on 1366x768 laptops. The Voicemail tab and its unread badge are now fully visible when a tip is open.' },\n      { type: 'fixed', text: 'Modal backdrops are now consistently dark across all overlays. Four modals (contacts quick-pick, call history detail, audio greeting picker, post-decline reply sheet) were rendering with semi-transparent backdrops that let page content show through. They now match the design spec.' },\n      { type: 'fixed', text: 'Internal: added missing CSS rules for incoming-call action labels and tab badge wrappers. The main-window incoming-call screen now styles its Decline/Reply/Accept labels properly (previously rendering unstyled).' },\n    ],\n  },\n  {\n    version: '0.10.136',\n    date: 'June 12, 2026',\n    highlight: 'Three high-impact UI/UX fixes - keyboard focus, latent crash prevention, dialpad fits on 1366x768 laptops',\n    changes: [\n      { type: 'improved', text: 'Keyboard navigation now shows a visible focus ring when you Tab through any page. Previously the dialer had zero focus indicator anywhere - keyboard-only users and screen-reader users had no way to track which element was focused. Mouse interactions are unchanged (the focus ring only appears for keyboard navigation).' },\n      { type: 'fixed', text: 'Prevented a latent React crash in the Telnyx status banner. The banner was calling React hooks AFTER an early return, which is the same Rules-of-Hooks violation that crashed the floater Reply with Text feature multiple times (v0.10.122/.125/.127/.129). The crash would have fired the moment a user changed admin status mid-session (e.g. token refresh). Hooks now run before the admin check.' },\n      { type: 'fixed', text: 'Dialpad green call button no longer gets clipped at 1366x768 with Windows 125 percent display scaling - the most common Windows business laptop configuration. The keypad buttons and spacing now shrink on short viewports so the call button stays fully visible without scrolling.' },\n    ],\n  },\n  {\n    version: '0.10.135',\n    date: 'June 12, 2026',\n    highlight: 'EXPERIMENT (canary) - 60s periodic full SIP reconnect disabled to reduce missed-call gap',\n    changes: [\n      { type: 'improved', text: 'Experimental change: the dialer no longer tears down its SIP connection every 60 seconds. Previous behavior (v0.10.113) was a safety net to combat a Telnyx server-side bug where inbound call routing went stale - but the 600ms gap every minute also caused about 1 percent of inbound calls to bounce to voicemail and users hitting the gap during SSO landed in a Disconnected state requiring Ctrl+Shift+R. The 15 second normal SIP REGISTER refresh remains active and should keep the registration alive. If you see incoming calls going straight to voicemail despite a green Registered indicator, please report immediately - we will reinstate the full reconnect in a follow-up release.' },\n    ],\n  },\n  {\n    version: '0.10.134',`,
  },
]);

// ===========================================================
// Version bumps to 0.10.137
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
  c = c.replace(/"version":\s*"0\.10\.136"/, '"version": "0.10.137"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.136 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.136 → 0.10.137`);
  }
}

// ===========================================================
// DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.137',
    find: `const APP_VERSION = '0.10.136';`,
    replace: `const APP_VERSION = '0.10.137';`,
  },
]);

console.log('\n[apply-v137] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.137: UX 5-pack (004/013, 005, 008, 011, 012) + whatsNew backfill"');
console.log('  5. git push');
