#!/usr/bin/env node
// v0.10.190 - Ctrl+Enter (and Cmd+Enter on Mac) inserts a newline in the
// Messages composer textarea. Enter alone still sends. Shift+Enter still
// inserts a newline (was already the behavior; unchanged).
//
// CURRENT BEHAVIOR (before this release)
//   onKeyDown: if (Enter && !shiftKey) -> preventDefault + send.
//   That means Ctrl+Enter ALSO sends today, because Ctrl is not Shift —
//   the guard only excludes Shift.
//
// NEW BEHAVIOR
//   - Enter alone               -> send (unchanged)
//   - Shift+Enter               -> newline (unchanged; browser default)
//   - Ctrl+Enter  / Cmd+Enter   -> newline (NEW; we insert '\n' at the
//                                   cursor explicitly because Chrome /
//                                   Firefox do not insert a newline for
//                                   Ctrl+Enter in a textarea by default)
//
// Also updates the textarea's title tooltip and the inline comment so
// the source matches the new shortcut surface.
//
// SCOPE
//   apps/web/src/pages/Messages.tsx — the thread composer textarea only.
//   The new-conversation modal and in-call SMS quick-input are out of
//   scope per user direction.
//
// VERSION BUMP: 0.10.189 -> 0.10.190

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v190] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v190] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v190] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v190] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// Messages.tsx — replace the textarea block (comment + title + keydown).
// Single anchor that captures all three so they stay in sync.
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: extend onKeyDown so Ctrl/Cmd+Enter inserts a newline (Enter still sends)',
    find: `          {/* v0.10.29 — Textarea (not input) for multi-line drafts.
              Enter sends; Shift+Enter inserts a newline. */}
          <textarea
            ref={composeInputRef}
            className="compose-input"
            placeholder="Text message"
            title="Shift+Enter for new line, Enter to send"
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => void handlePaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}`,
    replace: `          {/* v0.10.190 — Textarea (not input) for multi-line drafts.
              Enter sends; Shift+Enter OR Ctrl+Enter (Cmd+Enter on Mac)
              inserts a newline. */}
          <textarea
            ref={composeInputRef}
            className="compose-input"
            placeholder="Text message"
            title="Shift+Enter or Ctrl+Enter for new line, Enter to send"
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => void handlePaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Ctrl+Enter (Win/Linux) or Cmd+Enter (Mac) — insert a
                // newline at the cursor. Browsers don't do this for us
                // when Ctrl is held, so we do it explicitly.
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart ?? draft.length;
                  const end = ta.selectionEnd ?? draft.length;
                  const next = draft.slice(0, start) + '\\n' + draft.slice(end);
                  setDraft(next);
                  requestAnimationFrame(() => {
                    try { ta.setSelectionRange(start + 1, start + 1); } catch { /* noop */ }
                  });
                  return;
                }
                // Shift+Enter — let the textarea's native newline happen.
                if (e.shiftKey) return;
                // Plain Enter — send.
                e.preventDefault();
                void handleSend();
              }
            }}`,
  },
]);

// =====================================================================
// Version bumps 0.10.189 -> 0.10.190
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
  c = c.replace(/"version":\s*"0\.10\.189"/, '"version": "0.10.190"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.189 -> 0.10.190`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v190] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.189';`,
    replace: `const APP_VERSION = '0.10.190';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.190 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.189',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.190',
    date: 'June 18, 2026',
    highlight: 'Ctrl+Enter now inserts a newline in the message composer.',
    changes: [
      { type: 'improved', text: 'In the Messages thread composer, Ctrl+Enter (or Cmd+Enter on Mac) now inserts a newline. Enter still sends and Shift+Enter still works for newlines, so existing muscle memory is unchanged — this just adds Ctrl+Enter as an extra newline shortcut.' },
    ],
  },
  {
    version: '0.10.189',`,
  },
]);

console.log('\n[apply-v190] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.190: Ctrl+Enter inserts newline in Messages composer"');
console.log('  git tag v0.10.190');
console.log('  git push origin main');
console.log('  git push origin v0.10.190');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Open a thread, focus the composer.');
console.log('  2. Type "line one", press Ctrl+Enter, type "line two".');
console.log('     Expect: two lines in the textarea, message NOT sent.');
console.log('  3. Press Enter (no modifier).');
console.log('     Expect: message sends with the \\n preserved in the body.');
