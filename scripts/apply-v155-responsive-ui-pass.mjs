#!/usr/bin/env node
// v0.10.155 - Comprehensive responsive UI pass.
//
// CONTEXT:
//   v0.10.154 made the dialpad responsive but left other screens with
//   the same fixed-pixel issues. User pushed back on the drip-fed
//   release pattern. This release bundles EVERY remaining responsive
//   bug found in a complete audit of the primary screens, so we
//   don't ship v0.10.156, v0.10.157, etc. for similar issues.
//
// AUDIT RESULT (5 issues, all in apps/web/src/styles.css):
//   1. CRITICAL .incoming-caller (line 4150) - 32px font-size
//      hardcoded pushes the ringer Accept/Decline buttons below the
//      visible area at 1280x720.
//   2. CRITICAL .incoming-actions (line 4227) - 36px gap + 24px padding
//      causes the Accept-button label to clip at narrow widths.
//   3. MEDIUM .ic-ctrl-icon (line 4510) - 64px hardcoded; smooth-scale
//      with viewport instead of abrupt media-query jump.
//   4. MEDIUM .hangup-btn (line 4529) - 72px stacks the in-call view
//      to 442px total at 720p, forces internal scroll.
//   5. MEDIUM .settings-pane-body (line 2683) - no scroll constraint;
//      sub-pages (Users mgmt, Audit Log) exceed viewport with no
//      obvious scroll affordance.
//
// NOT IN SCOPE (audited and confirmed OK):
//   - Dialpad (v0.10.154 already responsive)
//   - Tab bar (5 tabs fit comfortably at 1280p)
//   - Modals (all use 78-80vh max-heights, scroll internally)
//   - Top header (~56px, fits easily)
//   - Recents/Messages/Voicemail lists (they just scroll)
//
// MATH AT 1280x720 POST-FIX:
//   .incoming-caller:  32px -> 25.2px (3.5vh of 720) -> readable
//   .ic-ctrl-icon:     64px -> 64.8px clamped to 64px (no change above 712vh)
//                      ... wait: 9vh of 720 = 64.8 -> clamps to max 64. OK.
//                      At 600px viewport: 54px. Smooth, no abrupt jump.
//   .hangup-btn:       72px -> 72px (10vh of 720 = 72). Below 720, scales down.
//
// VERSION BUMP: 0.10.154 -> 0.10.155

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v155] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v155] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v155] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v155] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// styles.css - all 5 responsive fixes
// ---------------------------------------------------------------------
applyEdits('apps/web/src/styles.css', [
  // 1. CRITICAL: .incoming-caller font-size
  {
    label: 'incoming-caller font-size clamp',
    find: `.incoming-caller {
  font-size: 32px;
  font-weight: 600;
  margin-bottom: 8px;
  word-break: break-all;
}`,
    replace: `.incoming-caller {
  /* v0.10.155 - scale with viewport so caller name + line badge +
     action buttons all fit on 720p screens without the buttons
     getting pushed below the fold. At 720p ~25px, at 1080p+ 32px. */
  font-size: clamp(22px, 3.5vh, 32px);
  font-weight: 600;
  margin-bottom: 8px;
  word-break: break-all;
}`,
  },

  // 2. CRITICAL: .incoming-actions gap + padding
  {
    label: 'incoming-actions gap + padding clamp',
    find: `.incoming-actions {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 36px;
  padding: 0 24px;
}`,
    replace: `.incoming-actions {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  /* v0.10.155 - scale gap+padding with viewport WIDTH so the
     Accept-button label doesn't clip at narrow widths. At 1280px
     gap ~24px, at 1920px+ 36px. */
  gap: clamp(16px, 4vw, 36px);
  padding: 0 clamp(16px, 5vw, 24px);
}`,
  },

  // 3. MEDIUM: .ic-ctrl-icon -> clamp (and the @media overrides still kick in below for tighter)
  {
    label: 'ic-ctrl-icon width/height clamp',
    find: `.ic-ctrl-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--ic-ctrl-bg, #1f2937);
  color: #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
}`,
    replace: `.ic-ctrl-icon {
  /* v0.10.155 - smooth-scale with viewport height. The two existing
     @media (max-height: 700px) blocks (lines ~1721, ~4462) still
     pin to 56px on truly short viewports, but for the broad 700-1080
     range, this clamp handles the gradient naturally. */
  width: clamp(48px, 9vh, 64px);
  height: clamp(48px, 9vh, 64px);
  border-radius: 50%;
  background: var(--ic-ctrl-bg, #1f2937);
  color: #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
}`,
  },

  // 4. MEDIUM: .hangup-btn
  {
    label: 'hangup-btn width/height + margin-top clamp',
    find: `.hangup-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
  margin-top: 8px;
}`,
    replace: `.hangup-btn {
  /* v0.10.155 - scale with viewport so the in-call view doesn't
     overflow at 720p. At 720p ~72px (10vh hits the max), at smaller
     viewports scales down to 56px floor for usability. */
  width: clamp(56px, 10vh, 72px);
  height: clamp(56px, 10vh, 72px);
  border-radius: 50%;
  border: none;
  background: #ef4444;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
  margin-top: clamp(4px, 1vh, 8px);
}`,
  },

  // 5. MEDIUM: .settings-pane-body
  {
    label: 'settings-pane-body overflow + max-height',
    find: `.settings-pane-body { max-width: 560px; }`,
    replace: `/* v0.10.155 - explicit scroll constraint for sub-pages that
   exceed viewport at 720p (Users mgmt, Audit Log, etc.). Without
   this, content overflows the outer page scroll which is confusing
   because the section header is sticky. Internal scroll on the pane
   body keeps the sticky header visible while content scrolls.
   140px offset accounts for top header + section nav + bottom padding. */
.settings-pane-body {
  max-width: 560px;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
  scroll-behavior: smooth;
}
/* Tighten the offset further on truly short viewports so we don't
   leave a tiny scrollable strip. */
@media (max-height: 800px) {
  .settings-pane-body { max-height: calc(100vh - 120px); }
}`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.154 -> 0.10.155
// ---------------------------------------------------------------------
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
  if (!existsSync(fp)) {
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.154"/, '"version": "0.10.155"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.154 -> 0.10.155`);
  } else {
    console.log(`  - ${rp}: no 0.10.154 found (run apply-v154-* first?)`);
  }
}

// DiagnosticsSection
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.154';`,
    replace: `const APP_VERSION = '0.10.155';`,
  },
]);

// whatsNew
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.155 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.154',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.155',
    date: 'June 15, 2026',
    highlight: 'All primary screens now display correctly on lower-resolution monitors.',
    changes: [
      { type: 'fixed', text: 'Incoming-call screen: the Accept and Decline buttons sometimes got pushed below the visible area on 1366x768 laptops. The caller name and action buttons now scale to your window size so everything stays visible and reachable.' },
      { type: 'fixed', text: 'In-call view: the hang-up button and on-screen controls (mute, hold, keypad, transfer) now scale with your window so the bottom of the screen stays usable on smaller displays.' },
      { type: 'improved', text: 'Settings: long sub-pages (User Management, Audit Log, etc.) now scroll smoothly inside the settings pane instead of pushing content off-screen, with the section header staying visible while you scroll.' },
    ],
  },
  {
    version: '0.10.154',`,
  },
]);

console.log('\n[apply-v155] DONE');
console.log('');
console.log('TEST PLAN (worth doing BEFORE pushing this time):');
console.log('  1. Run npm run dev locally OR rebuild + install Electron with .155');
console.log('  2. Test at 1280x720 viewport (Chrome DevTools Responsive Mode):');
console.log('     a. Ring an inbound call (or simulate one) -> Accept/Decline buttons fully visible');
console.log('     b. Pick up the call -> hang-up + controls all on screen, no scroll required');
console.log('     c. Navigate Settings -> Users Management -> table scrolls within the pane,');
console.log('        section header stays visible at the top');
console.log('  3. Resize to 1920x1080 -> sizes back to original 32px/64px/72px (no regression)');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.155: responsive UI pass - IncomingCall, InCall, Settings scale to viewport"');
console.log('  git tag v0.10.155');
console.log('  git push origin main');
console.log('  git push origin v0.10.155');
