#!/usr/bin/env node
// v0.10.167 - UX polish batch: tasks #11 (component-level) + #12 (multi-monitor).
//
// 7 ITEMS, ALL FRONTEND OR ELECTRON-MAIN:
//   UX-020: Dialpad input gets aria-label so screen readers describe it.
//   UX-021: Recents + Messages empty states get icon + heading + CTA.
//   UX-023: .incoming-fullscreen overflow-y so Accept button never clipped.
//   UX-025: Recents row icons get more padding so Block isn't adjacent to Star.
//   UX-041: Dialpad input preserves caret position when typing mid-number.
//   UX-045: Floater scales up on high-DPI monitors (4K @ 200%).
//   UX-046: Floater opens on the same monitor as the main window.
//
// NO API, NO BACKEND, NO SCHEMA. Pure UI work.
//
// VERSION BUMP: 0.10.166 -> 0.10.167

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v167] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v167] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v167] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v167] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// UX-020 + UX-041 - Dialpad.tsx
// =====================================================================
applyEdits('apps/web/src/pages/Dialpad.tsx', [
  {
    label: 'UX-020 + UX-041: aria-label + caret-position preservation',
    find: `              type="tel"
              inputMode="tel"
              className="number-display-input"
              value={formatNumber(number)}
              placeholder="Enter phone number"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                // Store raw chars; let formatter re-format on next render.
                // smartNormalize prepends '+' when a complete international
                // number is recognized (e.g., 12 digits starting with 91 → India).
                const raw = e.target.value.replace(/[^\\d*#+]/g, '');
                setNumber(smartNormalize(raw) || '');
              }}`,
    replace: `              type="tel"
              inputMode="tel"
              className="number-display-input"
              value={formatNumber(number)}
              placeholder="Enter phone number"
              /* v0.10.167 UX-020 - explicit aria-label so screen readers
                 announce "Phone number to dial" instead of just the
                 (typed digits) with no context. */
              aria-label="Phone number to dial"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                // v0.10.167 UX-041 - preserve caret position across the
                // re-format that happens when smartNormalize prepends '+'
                // or formatNumber inserts spaces/parens. Previously
                // typing a digit in the middle of an existing number
                // jumped the cursor to the end. We measure the number
                // of DIGIT characters before the caret, run the format,
                // then put the caret back at the same digit-index.
                const inputEl = e.target;
                const caretBefore = inputEl.selectionStart ?? inputEl.value.length;
                const digitsBeforeCaret = inputEl.value
                  .slice(0, caretBefore)
                  .replace(/[^\\d*#+]/g, '').length;
                // Store raw chars; let formatter re-format on next render.
                // smartNormalize prepends '+' when a complete international
                // number is recognized (e.g., 12 digits starting with 91 → India).
                const raw = inputEl.value.replace(/[^\\d*#+]/g, '');
                setNumber(smartNormalize(raw) || '');
                requestAnimationFrame(() => {
                  const formatted = formatNumber(smartNormalize(raw) || '');
                  let pos = 0;
                  let seen = 0;
                  while (pos < formatted.length && seen < digitsBeforeCaret) {
                    if (/[\\d*#+]/.test(formatted[pos])) seen++;
                    pos++;
                  }
                  try { inputEl.setSelectionRange(pos, pos); } catch { /* noop */ }
                });
              }}`,
  },
]);

// =====================================================================
// UX-021 - Recents empty state
// =====================================================================
applyEdits('apps/web/src/pages/Recents.tsx', [
  {
    label: 'UX-021: import Clock icon from lucide-react',
    find: `import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, RefreshCcw, Play, Search, X, MessageSquare, ArrowLeft, Star, Ban } from 'lucide-react';`,
    replace: `import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, RefreshCcw, Play, Search, X, MessageSquare, ArrowLeft, Star, Ban, Clock } from 'lucide-react';`,
  },
  {
    label: 'UX-021: Recents empty state with icon + heading + CTA',
    find: `      {!loading && calls.length === 0 && !error && (
        <div className="empty-state">
          <p>No calls yet.</p>
          <p className="muted">Calls you make will show up here.</p>
        </div>
      )}`,
    replace: `      {!loading && calls.length === 0 && !error && (
        // v0.10.167 UX-021 - empty state with icon + heading + CTA.
        // Previously two text lines with no clear next action. Now
        // a Clock icon, an h2-style heading, body copy, and an "Open
        // keypad" button so a new user has something concrete to do.
        <div className="empty-state">
          <Clock size={40} className="empty-state-icon" />
          <h2>No recent calls</h2>
          <p>Your call history will appear here.</p>
          <button
            type="button"
            className="device-action primary"
            onClick={() => navigate('/keypad')}
          >
            Open keypad
          </button>
        </div>
      )}`,
  },
]);

// =====================================================================
// UX-021 - Messages empty state
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: 'UX-021: Messages empty state with icon + heading + CTA (uses already-imported MessageSquarePlus)',
    find: `          {!loading && threads.length === 0 && !error && (
            <div className="empty-state">
              <p>No conversations yet.</p>
              <p className="muted">Tap the compose icon to start one.</p>
            </div>
          )}`,
    replace: `          {!loading && threads.length === 0 && !error && (
            // v0.10.167 UX-021 - empty state with icon + heading + CTA.
            // MessageSquarePlus is already imported at the top of this
            // file - reuse it instead of adding another lucide icon.
            <div className="empty-state">
              <MessageSquarePlus size={40} className="empty-state-icon" />
              <h2>No conversations yet</h2>
              <p>Your text-message threads will appear here.</p>
              <button
                type="button"
                className="device-action primary"
                onClick={() => setShowCompose(true)}
              >
                Compose new message
              </button>
            </div>
          )}`,
  },
]);

// =====================================================================
// UX-023 + UX-025 - styles.css
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-021 helper class: .empty-state-icon',
    find: `/* v0.10.166 - Users admin row: status dot + name + role pill inline
   on the first line inside the User cell. Replaces the previous
   standalone Email/Role/Status columns. */`,
    replace: `/* v0.10.167 UX-021 - empty-state pages get a centered muted icon
   above the heading. Used by Recents and Messages (and consistent
   with Voicemail/Favorites which already had similar icons inline). */
.empty-state-icon {
  color: rgba(255, 255, 255, 0.35);
  margin: 0 auto 1rem;
  opacity: 0.7;
  display: block;
}
[data-theme="light"] .empty-state-icon {
  color: rgba(0, 0, 0, 0.35);
}

/* v0.10.166 - Users admin row: status dot + name + role pill inline
   on the first line inside the User cell. Replaces the previous
   standalone Email/Role/Status columns. */`,
  },
  {
    label: 'UX-023: .incoming-fullscreen overflow-y so Accept never clips',
    find: `.incoming-fullscreen {
  position: fixed;
  inset: 0;`,
    replace: `.incoming-fullscreen {
  /* v0.10.167 UX-023 - allow internal scroll on very short windows
     (~480px height with title bar + taskbar) so the Accept button
     never falls below the viewport. padding around the inner block
     gives the scroll a comfortable margin. */
  overflow-y: auto;
  padding: 20px 0;
  position: fixed;
  inset: 0;`,
  },
  {
    label: 'UX-025: .callback-ico extra padding + margin so Block isn\'t tight against Star',
    find: `.callback-ico {
  color: #007aff;
  opacity: 0.85;
  background: transparent;
  border: none;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}`,
    replace: `.callback-ico {
  color: #007aff;
  opacity: 0.85;
  background: transparent;
  border: none;
  /* v0.10.167 UX-025 - bumped padding 4px -> 8px and added horizontal
     margin so Recents row icons aren't packed tight. Reduces mis-taps
     where users hit Block when reaching for the Star icon. The icons
     inside (Star/Block/Phone at size={16}) still render at the same
     visual pixel size; only the click hitbox + visual gap changed. */
  padding: 8px;
  margin: 0 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}`,
  },
]);

// =====================================================================
// UX-045 + UX-046 - apps/desktop/src/main.ts
// =====================================================================
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'UX-045 + UX-046: floater multi-monitor + DPI scaling',
    find: `  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const w = 440;
  const h = 240;
  const x = wa.x + wa.width - w - 24;
  const y = wa.y + wa.height - h - 24;`,
    replace: `  // v0.10.167 UX-046 - open the floater on the SAME monitor as the
  // main dialer window, not always the primary monitor. Multi-monitor
  // users were getting the ringer popped up on the wrong screen.
  const mainBounds = mainWindow?.getBounds();
  const display = mainBounds
    ? screen.getDisplayNearestPoint({
        x: mainBounds.x + Math.floor(mainBounds.width / 2),
        y: mainBounds.y + Math.floor(mainBounds.height / 2),
      })
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  // v0.10.167 UX-045 - scale floater size with the display's DPI so
  // it doesn't look tiny on 4K monitors at 200% scaling. 440x240 is
  // the baseline for 100% scaling; on >1.5x displays bump to 560x300
  // so effective CSS pixels stay roughly constant.
  const scale = display.scaleFactor || 1;
  const w = scale > 1.5 ? 560 : 440;
  const h = scale > 1.5 ? 300 : 240;
  const x = wa.x + wa.width - w - 24;
  const y = wa.y + wa.height - h - 24;`,
  },
]);

// =====================================================================
// Version bumps 0.10.166 -> 0.10.167
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
  c = c.replace(/"version":\s*"0\.10\.166"/, '"version": "0.10.167"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.166 -> 0.10.167`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.166';`,
    replace: `const APP_VERSION = '0.10.167';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.167 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.166',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.167',
    date: 'June 16, 2026',
    highlight: 'UX polish across the dialer.',
    changes: [
      { type: 'improved', text: 'Empty Recents and Messages views now show a clearer icon + heading + button to get started, instead of just two short sentences.' },
      { type: 'improved', text: 'Typing a digit in the middle of an existing phone number no longer jumps the cursor to the end.' },
      { type: 'improved', text: 'Block button on each Recents row got a little more breathing room so its not easy to confuse with the Favorite (star) icon.' },
      { type: 'improved', text: 'Incoming-call full-screen view scrolls internally on very short windows, so the Accept button is always reachable.' },
      { type: 'improved', text: 'Floating ringer window now opens on the same monitor as the main dialer (not always the primary monitor), and scales larger on 4K screens.' },
      { type: 'improved', text: 'Accessibility: phone-number input now announces itself properly to screen readers.' },
    ],
  },
  {
    version: '0.10.166',`,
  },
]);

console.log('\n[apply-v167] DONE');
console.log('');
console.log('IMPORTS NEEDED - check that Recents.tsx imports Clock and Messages.tsx imports MessageSquare:');
console.log('  grep -E "import.*\\{[^}]*\\b(Clock|MessageSquare)\\b" apps/web/src/pages/Recents.tsx apps/web/src/pages/Messages.tsx');
console.log('  If either is missing, add it from \'lucide-react\' before pushing.');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.167: UX polish - empty states, caret position, floater multi-monitor + DPI, Block padding"');
console.log('  git tag v0.10.167');
console.log('  git push origin main');
console.log('  git push origin v0.10.167');
