#!/usr/bin/env node
// v0.10.169 - UX quick-wins batch (8 items, all CSS or single-line JSX).
// All frontend-only. Lowest possible regression surface.
//
//   UX-026  .app-content has TWO declarations (layout at L219, overflow at L1099).
//           Consolidate into the first; remove the second.
//   UX-028  DID dropdown menu width max-width: 360px overflows on narrow
//           viewports. Make responsive: min(360px, calc(100vw - 24px)).
//   UX-035  Theme picker segmented control buttons (.theme-picker-btn) have
//           no focus indicator (combined with UX-001 global focus ring).
//           Add :focus-visible outline.
//   UX-036  .held-line-strip declared twice (L1797 group + L5492 standalone).
//           Both are dead code (no JSX references) but per scope-control we
//           only remove the second (lines 5492-5508 :hover) since that's the
//           literal duplicate the audit called out.
//   UX-047  Auth-divider <span>or</span> is decorative — screen readers
//           read it as content. Add aria-hidden="true" so it's announced
//           as a separator, not a word.
//   UX-048  Dial button aria-label binary ("Call" / "Recall last number")
//           — when input is empty AND no last-dialed number, the button is
//           disabled but still says "Recall last number" which is wrong.
//           Make tri-state: dialable=Call, last-dialed=Recall, empty=Dial.
//   UX-052  audio-picker close button has NO base CSS rule — it inherits
//           browser default <button> styling and looks like a text link.
//           Add a proper button rule that matches the existing .modal-close
//           visual language (rounded background, hover state).
//   UX-054  .pending-status-pill-letter has no :hover or :focus-visible
//           state — looks static even though it has a title tooltip.
//           Add subtle hover/focus brightness.
//
// VERSION BUMP: 0.10.168 -> 0.10.169

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v169] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v169] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v169] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v169] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// All CSS edits to apps/web/src/styles.css
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  // --------------------------------------------------------------
  // UX-026 - consolidate .app-content (two declarations into one).
  // The first block (L219) holds layout. The second block (L1099)
  // adds overflow + flex. Merge into the first; delete the second.
  // --------------------------------------------------------------
  {
    label: 'UX-026 merge .app-content overflow/display into the primary declaration',
    find: `.app-content {
  /* v0.10.144 - UX-016 - widened from 1280 to 1480 so QHD+ displays
     don't waste 50% of their width on gutters. Settings tables and
     content actually breathe now. Anything <= 900px is still 100%
     wide (the existing mobile media query below kicks in). */
  max-width: 1480px;
  margin: 0 auto;
  width: 100%;
}`,
    replace: `.app-content {
  /* v0.10.144 - UX-016 - widened from 1280 to 1480 so QHD+ displays
     don't waste 50% of their width on gutters. Settings tables and
     content actually breathe now. Anything <= 900px is still 100%
     wide (the existing mobile media query below kicks in). */
  max-width: 1480px;
  margin: 0 auto;
  width: 100%;
  /* v0.10.169 - UX-026 - merged from a second .app-content {} block
     that previously lived ~880 lines below this one. Two declarations
     of the same selector with different semantics fragments the cascade
     and breaks "find the rule" in DevTools. */
  overflow-y: auto;
  display: flex;
  justify-content: center;
}`,
  },
  {
    label: 'UX-026 remove the now-duplicate .app-content block',
    find: `.logout-btn:hover { color: #fff; }
.app-content {
  overflow-y: auto;
  display: flex;
  justify-content: center;
}

/* ============ DIALPAD ============ */`,
    replace: `.logout-btn:hover { color: #fff; }

/* v0.10.169 - UX-026 - the second .app-content {} declaration that
   used to live here (overflow-y/display/justify-content) was merged
   into the primary .app-content rule near the top of this file. */

/* ============ DIALPAD ============ */`,
  },

  // --------------------------------------------------------------
  // UX-028 - DID dropdown menu max-width: 360px overflows on narrow.
  // --------------------------------------------------------------
  {
    label: 'UX-028 DID dropdown max-width responsive on narrow viewports',
    find: `  min-width: max(260px, 100%);
  max-width: 360px;
  /* IMPORTANT: solid opaque background. --surface in this project is`,
    replace: `  min-width: max(260px, 100%);
  /* v0.10.169 - UX-028 - was a flat 360px which clipped past the
     right edge of the viewport on narrow Electron windows or mobile.
     min() lets the menu cap at 360px on wide, but shrink to fit the
     viewport minus 24px gutter on narrow. */
  max-width: min(360px, calc(100vw - 24px));
  /* IMPORTANT: solid opaque background. --surface in this project is`,
  },

  // --------------------------------------------------------------
  // UX-035 - theme-picker-btn focus indicator.
  // --------------------------------------------------------------
  {
    label: 'UX-035 theme-picker-btn focus-visible outline',
    find: `.theme-picker-btn.active {
  background: #2a2a2c;
  color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}`,
    replace: `.theme-picker-btn.active {
  background: #2a2a2c;
  color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
/* v0.10.169 - UX-035 - segmented theme control needs a visible focus
   ring for keyboard navigation. Uses the same --accent token as the
   global focus-visible rules so it matches the rest of the app. */
.theme-picker-btn:focus-visible {
  outline: 2px solid var(--accent, #0a84ff);
  outline-offset: 2px;
  border-radius: 7px;
}`,
  },

  // --------------------------------------------------------------
  // UX-036 - remove the duplicate .held-line-strip declaration.
  // Both blocks are dead (no JSX references anywhere) - the dual-call
  // view uses .call-pill / .calls-strip per the comment at L5323.
  // Conservative fix: delete the LATER duplicate (5492 + 5508 :hover)
  // and leave the earlier block in case anything dynamically references
  // it. Removes the cascade ambiguity the audit flagged.
  // --------------------------------------------------------------
  {
    label: 'UX-036 remove duplicate .held-line-strip + :hover declarations',
    find: `.held-line-strip {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 0;
  background: linear-gradient(90deg, #1f2937 0%, #374151 100%);
  color: #e5e7eb;
  border: none;
  border-radius: 12px;
  padding: 10px 14px;
  margin: 0 12px 8px;
  width: calc(100% - 24px);
  max-width: 440px;
  cursor: pointer;
  text-align: left;
}
.held-line-strip:hover { background: linear-gradient(90deg, #374151 0%, #4b5563 100%); }`,
    replace: `/* v0.10.169 - UX-036 - the duplicate .held-line-strip declaration that
   used to live here was removed. The primary declaration is in the HELD
   LINE STRIP section ~3700 lines above. The dual-call view (which is
   what this duplicate was originally for) now uses .call-pill /
   .calls-strip per the comment 200 lines above. No JSX references
   .held-line-strip directly anywhere in the codebase. */`,
  },

  // --------------------------------------------------------------
  // UX-052 - audio-picker close button proper styling.
  // The button currently has NO base rule, only a light-theme override
  // at L2883 that sets bg+color. We add a proper button rule below
  // the audio-picker-label declaration so it looks like a real button.
  // --------------------------------------------------------------
  {
    label: 'UX-052 audio-picker-close proper button styling',
    find: `.audio-picker-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}`,
    replace: `.audio-picker-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* v0.10.169 - UX-052 - the bottom Close button on the audio-output
   picker had no base CSS rule, so it inherited browser-default <button>
   styling that looked like a text link. Given proper button styling
   that mirrors the rest of the modal-close family (rounded bg, hover).
   Kept as a TEXT button (not an X icon) because it sits at the bottom
   of the popover, not in a header alongside a title. */
.audio-picker-close {
  align-self: center;
  margin-top: 4px;
  padding: 8px 18px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.audio-picker-close:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.22);
}
.audio-picker-close:focus-visible {
  outline: 2px solid var(--accent, #0a84ff);
  outline-offset: 2px;
}`,
  },

  // --------------------------------------------------------------
  // UX-054 - pending status pill hover/focus state.
  // --------------------------------------------------------------
  {
    label: 'UX-054 pending-status-pill-letter hover/focus brightness',
    find: `/* Letter-only status pill inside each row — same square-ish shape as the
   legend swatch, color comes from the existing .pending-{status} rules. */
.pending-status-pill-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
}`,
    replace: `/* Letter-only status pill inside each row — same square-ish shape as the
   legend swatch, color comes from the existing .pending-{status} rules. */
.pending-status-pill-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  /* v0.10.169 - UX-054 - the pill has a title tooltip explaining the
     status, but no hover affordance to hint at it. Subtle brightness
     bump on hover/focus. Cursor stays default (the pill isn't a
     button, just a labeled indicator), but the brightness signals
     "look at me" while the tooltip is appearing. */
  transition: filter 0.12s ease, transform 0.12s ease;
}
.pending-status-pill-letter:hover,
.pending-status-pill-letter:focus-visible {
  filter: brightness(1.12);
  transform: scale(1.05);
}`,
  },
]);

// =====================================================================
// UX-047 - auth-divider <span>or</span> announced as content.
// Mark decorative so screen readers treat as a visual separator.
// =====================================================================
applyEdits('apps/web/src/pages/Login.tsx', [
  {
    label: 'UX-047 auth-divider span aria-hidden so SR treats as separator',
    find: `        {/* Break-glass: tucked-away password form */}
        <div className="auth-divider">
          <span>or</span>
        </div>`,
    replace: `        {/* Break-glass: tucked-away password form */}
        {/* v0.10.169 - UX-047 - the divider line + "or" is purely visual.
            Screen readers were reading "or" as content between the SSO
            and password-form sections. role="separator" + aria-hidden
            on the inner span tells assistive tech to announce a divider
            rather than the literal word. */}
        <div className="auth-divider" role="separator" aria-orientation="horizontal">
          <span aria-hidden="true">or</span>
        </div>`,
  },
]);

// =====================================================================
// UX-048 - dial button aria-label tri-state.
// =====================================================================
applyEdits('apps/web/src/pages/Dialpad.tsx', [
  {
    label: 'UX-048 dial button aria-label tri-state (dialable/recall/disabled)',
    find: `          aria-label={hasDialableInput ? 'Call' : 'Recall last number'}`,
    replace: `          /* v0.10.169 - UX-048 - was a binary ternary that said
             "Recall last number" even when the input was empty AND no
             last-dialed number existed (so the button was disabled).
             Now three states so SR users hear what the button actually
             does in its current state. */
          aria-label={
            hasDialableInput
              ? 'Call'
              : hasLastDialed
                ? 'Recall last number'
                : 'Type a number to call'
          }`,
  },
]);

// =====================================================================
// Version bumps 0.10.168 -> 0.10.169
// =====================================================================
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
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.168"/, '"version": "0.10.169"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.168 -> 0.10.169`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.168';`,
    replace: `const APP_VERSION = '0.10.169';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.169 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.168',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.169',
    date: 'June 16, 2026',
    highlight: 'Accessibility + visual polish pass.',
    changes: [
      { type: 'improved', text: 'Theme picker (Light / Dark / Auto buttons in Settings) now shows a clear focus ring when you tab to it.' },
      { type: 'improved', text: 'Audio-output picker close button looks like a proper button now instead of underlined text.' },
      { type: 'improved', text: 'Status pills in the Pending Users table give a subtle visual hint on hover so you know to look for the tooltip.' },
      { type: 'improved', text: 'Outbound-number dropdown no longer clips off the right edge on narrow windows.' },
      { type: 'improved', text: 'Screen readers now announce the dial button label correctly based on whether you have a number typed, a recallable last number, or neither.' },
      { type: 'improved', text: 'Login page divider is now announced to screen readers as a separator instead of reading the word "or" out loud.' },
      { type: 'fixed', text: 'Internal CSS cleanup - consolidated duplicate style declarations that could conflict with each other.' },
    ],
  },
  {
    version: '0.10.168',`,
  },
]);

console.log('\n[apply-v169] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.169: UX quick-wins batch (UX-026/028/035/036/047/048/052/054)"');
console.log('  git tag v0.10.169');
console.log('  git push origin main');
console.log('  git push origin v0.10.169');
