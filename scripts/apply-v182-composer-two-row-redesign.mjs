#!/usr/bin/env node
// v0.10.182 - Message composer restructured into two rows.
//
// SCOPE
//   Current composer is one horizontal flex row with icon-only buttons
//   followed by the textarea, then clock + round Send icon.
//   New layout (per Abd's screenshot):
//     - Row 1: textarea + Clock (schedule) + Send pill ("Send" + arrow)
//     - Row 2: labeled action pills [📷 MMS] [⚡ Quick reply] [😊] [📄 Templates]
//   Only JSX restructure + CSS. All handlers identical
//   (handleAttach, setShowQuickReplies, setShowEmojiPicker,
//   setShowTemplatePicker, setShowScheduleModal, handleSend).
//
// LOCKED BEHAVIORS PRESERVED
//   * Quick replies popover still anchored above the composer
//   * Emoji picker popover still positions over the textarea caret
//   * Templates popover still renders below the composer
//   * Schedule modal still triggered by Clock button
//   * Paste-to-attach (v0.10.55) still works on the textarea
//   * Enter sends / Shift+Enter newline (v0.10.29) preserved
//   * Auto-resize textarea (v0.10.54) preserved
//
// VERSION BUMP: 0.10.181 -> 0.10.182

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v182] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v182] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v182] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v182] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Messages.tsx - restructure the compose-row block into two rows
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: replace compose-row block with two-row layout (input/clock/send on top, action pills below)',
    find: `      <div className="compose-row">
        <button
          type="button"
          className="icon-btn"
          onClick={handleAttach}
          disabled={uploading}
          aria-label="Attach image"
        >
          <ImageIcon size={20} />
        </button>
        {quickReplies.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowQuickReplies((v) => !v)}
            aria-label="Quick replies"
            title="Quick replies"
          >
            <Zap size={20} />
          </button>
        )}
        {/* v0.10.29 — Emoji picker. Click → small grid of common emojis;
            click an emoji to insert at cursor position. */}
        <button
          type="button"
          className={\`icon-btn\${showEmojiPicker ? ' active' : ''}\`}
          onClick={() => setShowEmojiPicker((v) => !v)}
          aria-label="Emoji"
          title="Insert emoji"
        >
          <Smile size={20} />
        </button>
        {/* v0.10.52 — SMS templates picker. Click → popover grouped by
            category. Picking a template inserts its body with
            {firstName} pre-filled from the contact (if known); other
            placeholders stay as \`{varName}\` for the user to fill before
            sending. Hidden if no templates exist (admin hasn't seeded). */}
        {templates.length > 0 && (
          <button
            type="button"
            className={\`icon-btn\${showTemplatePicker ? ' active' : ''}\`}
            onClick={() => {
              setShowTemplatePicker((v) => !v);
              setShowEmojiPicker(false);
            }}
            aria-label="Templates"
            title="Insert template"
          >
            <FileText size={20} />
          </button>
        )}
        {/* v0.10.29 — Textarea (not input) for multi-line drafts.
            Enter sends; Shift+Enter inserts a newline. Browser-native
            autoCorrect / spellCheck / autoCapitalize for typing assistance. */}
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
          }}
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
          autoComplete="on"
        />
        {uploading && <span className="muted" style={{ fontSize: 12 }}>uploading…</span>}
        {attached.length > 0 && (
          <span className="attach-pill" title={attached.join('\\n')}>
            📎 {attached.length}
          </span>
        )}
        {/* v0.10.59 — Schedule button. Disabled when there's no draft +
            no attachments (nothing to schedule). Opens the date/time
            picker; on confirm, calls POST /me/scheduled-messages with the
            current draft + attached, then clears the compose row same
            as Send does. */}
        <button
          type="button"
          className="icon-btn compose-icon-btn"
          onClick={() => setShowScheduleModal({ mode: 'create' })}
          disabled={sending || (!draft.trim() && attached.length === 0)}
          aria-label="Schedule send"
          title="Schedule send"
        >
          <Clock size={18} />
        </button>
        <button
          type="button"
          className="send-btn"
          onClick={handleSend}
          disabled={sending || (!draft.trim() && attached.length === 0)}
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>`,
    replace: `      {/* v0.10.182 — Two-row composer. Row 1 holds the textarea and the
          "send-side" controls (Clock for scheduled send + Send pill).
          Row 2 holds the labeled action pills (MMS / Quick reply /
          Emoji / Templates). Same handlers as before — only layout +
          visual change. */}
      <div className="compose-area">
        <div className="compose-row compose-row-input">
          {/* v0.10.29 — Textarea (not input) for multi-line drafts.
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
            }}
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={true}
            autoComplete="on"
          />
          {uploading && <span className="muted" style={{ fontSize: 12 }}>uploading…</span>}
          {attached.length > 0 && (
            <span className="attach-pill" title={attached.join('\\n')}>
              📎 {attached.length}
            </span>
          )}
          {/* v0.10.59 Schedule. Disabled when there's nothing to schedule. */}
          <button
            type="button"
            className="icon-btn compose-icon-btn"
            onClick={() => setShowScheduleModal({ mode: 'create' })}
            disabled={sending || (!draft.trim() && attached.length === 0)}
            aria-label="Schedule send"
            title="Schedule send"
          >
            <Clock size={18} />
          </button>
          {/* v0.10.182 — Send is now a pill with "Send" text + arrow icon. */}
          <button
            type="button"
            className="send-btn"
            onClick={handleSend}
            disabled={sending || (!draft.trim() && attached.length === 0)}
            aria-label="Send"
          >
            <span className="send-btn-label">Send</span>
            <Send size={16} />
          </button>
        </div>
        <div className="compose-row-actions">
          <button
            type="button"
            className="compose-action-pill"
            onClick={handleAttach}
            disabled={uploading}
            aria-label="Attach image"
            title="Attach image"
          >
            <ImageIcon size={16} />
            <span>MMS</span>
          </button>
          {quickReplies.length > 0 && (
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
          )}
          {/* v0.10.29 Emoji picker. Icon-only pill — opens a grid of common emojis. */}
          <button
            type="button"
            className={\`compose-action-pill is-icon-only\${showEmojiPicker ? ' is-active' : ''}\`}
            onClick={() => setShowEmojiPicker((v) => !v)}
            aria-label="Insert emoji"
            title="Insert emoji"
          >
            <Smile size={16} />
          </button>
          {/* v0.10.52 Templates. Hidden when admin hasn't seeded any. */}
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
          )}
        </div>
      </div>`,
  },
]);

// =====================================================================
// 2. styles.css - restyle .send-btn to a pill, add .compose-area /
//    .compose-row-actions / .compose-action-pill.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '2a: .send-btn changes from round-icon to pill with text + arrow',
    find: `.compose-row .send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #4f46e5;
  color: #fff;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.12s ease, transform 0.08s ease;
}
.compose-row .send-btn:hover { background: #4338ca; }
.compose-row .send-btn:active { transform: scale(0.96); }
.compose-row .send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.compose-row .send-btn svg { transform: translateX(1px); /* nudge paper plane visually */ }`,
    replace: `/* v0.10.182 — Send button changes from round icon-only to a pill
   with "Send" text + paper-plane icon. Wider (~80px) than the round
   version; sits next to the Clock schedule icon on the top compose row. */
.compose-row .send-btn {
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
}
.compose-row .send-btn svg { transform: translateX(1px) translateY(-1px); /* visual nudge */ }
.compose-row .send-btn .send-btn-label { line-height: 1; }`,
  },
  {
    label: '2b: append .compose-area + .compose-row-actions + .compose-action-pill rules after the new .send-btn block',
    find: `.compose-row .send-btn .send-btn-label { line-height: 1; }`,
    replace: `.compose-row .send-btn .send-btn-label { line-height: 1; }

/* v0.10.182 — Two-row composer container. Row 1 (.compose-row-input)
   holds the textarea + schedule clock + Send pill. Row 2
   (.compose-row-actions) holds the labeled action pills (MMS /
   Quick reply / emoji / Templates). */
.compose-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .compose-area {
  border-top-color: rgba(0, 0, 0, 0.06);
}
/* The .compose-row inherits its existing styles for the top row, but we
   undo the border-top + padding since the parent .compose-area provides
   them, and we don't want a double border between rows. */
.compose-area .compose-row {
  border-top: none;
  padding: 0;
}
.compose-row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.compose-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  height: 32px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  transition: background 0.12s ease, color 0.12s ease;
}
.compose-action-pill:hover {
  background: rgba(255, 255, 255, 0.12);
}
.compose-action-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.compose-action-pill.is-icon-only {
  padding: 6px 10px;
}
.compose-action-pill.is-active {
  background: rgba(99, 102, 241, 0.18);
  color: #4f46e5;
}
[data-theme="light"] .compose-action-pill {
  background: #f1f3f7;
  color: #374151;
}
[data-theme="light"] .compose-action-pill:hover {
  background: #e5e7ee;
}
[data-theme="light"] .compose-action-pill.is-active {
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
}
.compose-action-pill svg {
  flex-shrink: 0;
  opacity: 0.85;
}`,
  },
]);

// =====================================================================
// 3. Version bumps 0.10.181 -> 0.10.182
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
  c = c.replace(/"version":\s*"0\.10\.181"/, '"version": "0.10.182"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.181 -> 0.10.182`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.181 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v182] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.181';`,
    replace: `const APP_VERSION = '0.10.182';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.182 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.181',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.182',
    date: 'June 18, 2026',
    highlight: 'Message composer redesigned into a cleaner two-row layout.',
    changes: [
      { type: 'improved', text: 'Message composer is now two rows. Top row: text box, the schedule-send clock, and a "Send" pill (with the paper-plane icon — same one-click send, just clearer label). Bottom row: labeled action pills — MMS / Quick reply / 😊 / Templates — replacing the unlabeled icon strip.' },
      { type: 'improved', text: 'No behavior changes. Schedule-send, quick replies, emoji picker, template picker, paste-to-attach, Enter-to-send, Shift+Enter for newline — all work exactly as before.' },
    ],
  },
  {
    version: '0.10.181',`,
  },
]);

console.log('\n[apply-v182] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.182: Two-row message composer with labeled action pills"');
console.log('  git tag v0.10.182');
console.log('  git push origin main');
console.log('  git push origin v0.10.182');
