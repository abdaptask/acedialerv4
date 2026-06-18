#!/usr/bin/env node
// v0.10.183 - Fix three composer issues introduced or surfaced by v0.10.182.
//
// REPORTED ISSUES
//   1. Send button rendered as a small circle with overflowing "Send" text.
//      Caused by a pre-existing global `.send-btn { width: 36px;
//      border-radius: 50% }` rule at styles.css:6403 that wasn't overridden
//      explicitly for width in the v182 pill rewrite. Specificity-correct
//      override needs an explicit `width: auto` (and !important to beat
//      any cascade order). Adding `min-width: 90px` ensures a baseline
//      pill size even when the inner "Send" label is short.
//   2. `.compose-input` (the textarea) has hardcoded `background: #1f2937`
//      and `color: #fff` with no light-theme override. In light mode the
//      input pops out as dark on light. Make it theme-aware using the
//      same pattern `.compose-action-pill` uses.
//   3. The three popovers (Quick replies, Emoji picker, Templates) can
//      all be open at once because each button only toggles its own
//      state. Mutual exclusion: opening any one closes the other two.
//
// VERSION BUMP: 0.10.182 -> 0.10.183

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v183] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v183] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v183] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v183] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. styles.css - .send-btn pill width fix + theme-aware .compose-input
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1a: .send-btn pill - explicit width:auto !important + min-width 90px so the global .send-btn rule cannot squish it back to a 36px circle',
    find: `.compose-row .send-btn {
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  background: #4f46e5;
  color: #fff;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  transition: background 0.12s ease, transform 0.08s ease;
}
.compose-row .send-btn:hover { background: #4338ca; }
.compose-row .send-btn:active { transform: scale(0.96); }
.compose-row .send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}`,
    replace: `.compose-row .send-btn {
  /* v0.10.183 — explicit width:auto + min-width !important to defeat
     the legacy global \`.send-btn { width: 36px }\` at line ~6403 which
     was squishing this pill into a 36px circle. */
  width: auto !important;
  min-width: 90px !important;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px !important;
  background: #4f46e5;
  color: #fff;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  transition: background 0.12s ease, transform 0.08s ease;
}
.compose-row .send-btn:hover:not(:disabled) { background: #4338ca; }
.compose-row .send-btn:active:not(:disabled) { transform: scale(0.96); }
.compose-row .send-btn:disabled {
  /* v0.10.183 — use a lighter solid background instead of opacity so the
     "Send" label stays readable in the disabled state. */
  background: #c7c5f0;
  color: #fff;
  opacity: 1;
  cursor: not-allowed;
}`,
  },
  {
    label: '1b: .compose-input made theme-aware (was hardcoded #1f2937 background / #fff text — bad in light mode)',
    find: `.compose-input {
  flex: 1;
  /* v0.9.15 — Chat uses <textarea> for multi-line support. <textarea>
     defaults to font-family: monospace in every browser, which is what
     made the Chat compose row look "horrible" in the screenshots —
     placeholder rendered as Courier. Inherit the page's font stack
     instead so the input matches the rest of the dialer.
     v0.10.29 — SMS compose is also a textarea now (was input). Height
     auto-grows up to a cap so multi-line drafts (Shift+Enter) read
     naturally. min-height matches the prior 38px so the row layout
     stays consistent for short messages. */
  font-family: inherit;
  min-height: 38px;
  /* v0.10.54 — Bumped from 160px to 220px. JS auto-resize (Messages.tsx)
     caps at 200px and toggles overflow-y. Without this CSS bump, CSS
     was clamping the box at 160px even when a template needed 180px to
     show fully — leaving the user scrolling inside a tiny box. */
  max-height: 220px;
  padding: 8px 14px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #1f2937;
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  resize: none;
  overflow-y: auto;
}
.compose-input:focus { border-color: #3b82f6; }`,
    replace: `.compose-input {
  flex: 1;
  font-family: inherit;
  min-height: 38px;
  max-height: 220px;
  padding: 8px 14px;
  border-radius: 18px;
  /* v0.10.183 — was hardcoded #1f2937 background / #fff text which
     looked off in light mode (popped as dark on a light page). Theme-
     aware now: subtle surface in both modes, var(--text) so the typed
     content uses the page's text color. Border matches the
     .compose-action-pill rest state for visual consistency. */
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  resize: none;
  overflow-y: auto;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.compose-input::placeholder {
  color: var(--text-dim);
  opacity: 0.7;
}
.compose-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(255, 255, 255, 0.10);
}
[data-theme="light"] .compose-input {
  border-color: rgba(0, 0, 0, 0.08);
  background: #f1f3f7;
  color: #111827;
}
[data-theme="light"] .compose-input::placeholder {
  color: #9ca3af;
  opacity: 1;
}
[data-theme="light"] .compose-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: #eaecf2;
}`,
  },
]);

// =====================================================================
// 2. Messages.tsx - popover mutual exclusion
// =====================================================================
// Replace the three independent toggle onClick handlers with handlers
// that open ONLY the clicked popover (closing the other two). Each
// button still toggles itself when clicked while already open.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '2a: Quick reply pill click - open only this; close emoji + templates',
    find: `          {quickReplies.length > 0 && (
            <button
              type="button"
              className="compose-action-pill"
              onClick={() => setShowQuickReplies((v) => !v)}
              aria-label="Quick replies"
              title="Quick replies"
            >
              <Zap size={16} />
              <span>Quick reply</span>
            </button>
          )}`,
    replace: `          {quickReplies.length > 0 && (
            <button
              type="button"
              className={\`compose-action-pill\${showQuickReplies ? ' is-active' : ''}\`}
              onClick={() => {
                // v0.10.183 — mutual exclusion. Open this popover ONLY;
                // close the other two. If already open, just close it.
                const next = !showQuickReplies;
                setShowQuickReplies(next);
                if (next) {
                  setShowEmojiPicker(false);
                  setShowTemplatePicker(false);
                }
              }}
              aria-label="Quick replies"
              title="Quick replies"
            >
              <Zap size={16} />
              <span>Quick reply</span>
            </button>
          )}`,
  },
  {
    label: '2b: Emoji pill click - open only this; close quick replies + templates',
    find: `          {/* v0.10.29 Emoji picker. Icon-only pill — opens a grid of common emojis. */}
          <button
            type="button"
            className={\`compose-action-pill is-icon-only\${showEmojiPicker ? ' is-active' : ''}\`}
            onClick={() => setShowEmojiPicker((v) => !v)}
            aria-label="Insert emoji"
            title="Insert emoji"
          >
            <Smile size={16} />
          </button>`,
    replace: `          {/* v0.10.29 Emoji picker. Icon-only pill — opens a grid of common emojis. */}
          <button
            type="button"
            className={\`compose-action-pill is-icon-only\${showEmojiPicker ? ' is-active' : ''}\`}
            onClick={() => {
              // v0.10.183 — mutual exclusion.
              const next = !showEmojiPicker;
              setShowEmojiPicker(next);
              if (next) {
                setShowQuickReplies(false);
                setShowTemplatePicker(false);
              }
            }}
            aria-label="Insert emoji"
            title="Insert emoji"
          >
            <Smile size={16} />
          </button>`,
  },
  {
    label: '2c: Templates pill click - open only this; close quick replies + emoji',
    find: `          {/* v0.10.52 Templates. Hidden when admin hasn't seeded any. */}
          {templates.length > 0 && (
            <button
              type="button"
              className={\`compose-action-pill\${showTemplatePicker ? ' is-active' : ''}\`}
              onClick={() => {
                setShowTemplatePicker((v) => !v);
                setShowEmojiPicker(false);
              }}
              aria-label="Templates"
              title="Insert template"
            >
              <FileText size={16} />
              <span>Templates</span>
            </button>
          )}`,
    replace: `          {/* v0.10.52 Templates. Hidden when admin hasn't seeded any. */}
          {templates.length > 0 && (
            <button
              type="button"
              className={\`compose-action-pill\${showTemplatePicker ? ' is-active' : ''}\`}
              onClick={() => {
                // v0.10.183 — mutual exclusion (was previously only
                // closing emoji; now also closes quick replies).
                const next = !showTemplatePicker;
                setShowTemplatePicker(next);
                if (next) {
                  setShowQuickReplies(false);
                  setShowEmojiPicker(false);
                }
              }}
              aria-label="Templates"
              title="Insert template"
            >
              <FileText size={16} />
              <span>Templates</span>
            </button>
          )}`,
  },
]);

// =====================================================================
// 3. Version bumps 0.10.182 -> 0.10.183
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
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.182"/, '"version": "0.10.183"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.182 -> 0.10.183`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.182 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v183] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.182';`,
    replace: `const APP_VERSION = '0.10.183';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.183 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.182',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.183',
    date: 'June 18, 2026',
    highlight: 'Composer fixes: proper Send pill, themed input, one popover at a time.',
    changes: [
      { type: 'fixed', text: 'Send button now renders as a proper "Send" pill with the paper-plane icon instead of getting squished into a 36px circle by a lingering global rule.' },
      { type: 'fixed', text: 'Message text input now uses the dialer\\'s theme colors (light surface in light mode, dark surface in dark mode) instead of being hardcoded dark even in light mode.' },
      { type: 'fixed', text: 'Quick reply / Emoji / Templates popovers are now mutually exclusive — clicking any one of them closes the other two. No more all-three-stacked-on-screen.' },
    ],
  },
  {
    version: '0.10.182',`,
  },
]);

console.log('\n[apply-v183] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.183: Composer fixes - proper Send pill, themed input, mutually-exclusive popovers"');
console.log('  git tag v0.10.183');
console.log('  git push origin main');
console.log('  git push origin v0.10.183');
