#!/usr/bin/env node
// v0.10.201 - Re-ship of the broken v0.10.200.
//
// WHAT HAPPENED
//   The v0.10.200 apply-script had a syntax error in a final
//   console.log (over-escaped apostrophe). Node failed at module
//   load, so NONE of the v200 edits ran. The user committed and
//   tagged v0.10.200 against a clean working tree, so the
//   v0.10.200 git tag and the .exe built from it both carry the
//   v200 label but contain v199 code internally. Downloading the
//   v0.10.200 installer shows v0.10.199 in the Diagnostics panel.
//
// FIX
//   Re-apply the v200 logic under a fresh version number to avoid
//   collision with the broken v0.10.200 tag. (Force-deleting and
//   re-creating the tag is possible but riskier — CI is bound to
//   tags and rewriting them tends to surface stale artifacts.)
//
// THE THREE CHANGES (same as broken v200)
//   1. .bubble-reaction-picker — open BELOW the bubble
//      (top: calc(100% + 6px)) instead of above
//      (bottom: calc(100% + 6px)). v199's right-to-left fix is
//      preserved; this change is vertical-only.
//   2. Drop the reactSendAsText state, the localStorage key, the
//      no-reset-on-open comment block, and the entire toggle JSX.
//   3. handleReact always calls sendReactionAsText (no conditional).
//
// VERSION BUMP: 0.10.199 -> 0.10.201 (skipping 0.10.200 deliberately).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v201] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v201] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v201] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v201] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — picker opens BELOW the bubble.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: picker open BELOW bubble (bottom -> top vertical anchor)',
    find: `/* Picker popover — anchored above the bubble.
   v0.10.199 — was \`right: 0\` (extends leftward from bubble's right
   edge). For inbound (left-aligned, often narrow) bubbles that pushed
   the 5×5 grid off the left edge of the viewport and clipped the
   "Send to recipient as text" toggle. v0.10.196 made reactions
   inbound-only, so anchor LEFT — picker now extends rightward from
   the bubble's left edge, where there's plenty of room. */
.bubble-reaction-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 1000;`,
    replace: `/* Picker popover — anchored BELOW the bubble.
   v0.10.199 — horizontal anchor flipped right -> left (was clipping
   off the viewport on narrow inbound bubbles).
   v0.10.201 — vertical anchor flipped top -> bottom (originally
   v0.10.200 but that release was broken). Opening BELOW guarantees
   the full 5x5 grid is visible regardless of scroll position; the
   previous top-anchored layout was clipping the top row (with the
   heart) behind the thread header on small short threads. */
.bubble-reaction-picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 1000;`,
  },
]);

// =====================================================================
// Messages.tsx — drop the toggle, always send-as-text.
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '2: drop reactSendAsText state (no more toggle)',
    find: `  // v0.10.195 — Reactions state. \`reactPickerMsgId\` is the message id
  // whose reaction picker is currently open (null = none). \`reactSendAsText\`
  // is the "also send as SMS" toggle inside the picker. \`reactionsBumpKey\`
  // is a no-op state value we increment after addReaction/removeReaction
  // so the render re-reads from localStorage.
  // v0.10.199 — \`reactSendAsText\` initializes from localStorage so the
  // user's choice persists across picker opens and page reloads. Without
  // this, a user who checked the box once would silently revert to
  // "local-only" on every subsequent reaction.
  const [reactPickerMsgId, setReactPickerMsgId] = useState<number | null>(null);
  const [reactSendAsText, setReactSendAsText] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ace_react_send_as_text') === 'true';
    } catch {
      return false;
    }
  });
  const [reactionsBumpKey, setReactionsBumpKey] = useState<number>(0);`,
    replace: `  // v0.10.195 — Reactions state. \`reactPickerMsgId\` is the message id
  // whose reaction picker is currently open (null = none).
  // \`reactionsBumpKey\` is a no-op state value we increment after
  // addReaction/removeReaction so the render re-reads from localStorage.
  // v0.10.201 — \`reactSendAsText\` and its localStorage persistence
  // have been removed. Reactions now ALWAYS send as text to the
  // recipient (no opt-out, no UI toggle). The local chip on our side
  // and the outbound SMS both happen on every reaction.
  const [reactPickerMsgId, setReactPickerMsgId] = useState<number | null>(null);
  const [reactionsBumpKey, setReactionsBumpKey] = useState<number>(0);`,
  },
  {
    label: '3: handleReact always sends as text (no conditional)',
    find: `  // v0.10.195 — Add an emoji reaction to a message, optionally also
  // sending it to the remote party as a follow-up SMS (iMessage Tapback-
  // style). Closes the picker on success.
  const handleReact = (m: MessageRecord, emoji: string): void => {
    addMessageReaction(m.id, emoji);
    setReactionsBumpKey((n) => n + 1);
    setReactPickerMsgId(null);
    if (reactSendAsText) {
      const body = (m.body ?? '').replace(/\\s+/g, ' ').trim();
      const preview = body.slice(0, 30);
      const tail = body.length > 30 ? '…' : '';
      const text = preview
        ? \`\${emoji} to: "\${preview}\${tail}"\`
        : \`\${emoji}\`;
      void sendReactionAsText(text);
    }
  };`,
    replace: `  // v0.10.195 — Add an emoji reaction to a message, optionally also
  // sending it to the remote party as a follow-up SMS (iMessage Tapback-
  // style). Closes the picker on success.
  // v0.10.201 — Send-as-text is now ALWAYS on (no toggle, no
  // condition). Every reaction creates a local chip AND fires the SMS.
  const handleReact = (m: MessageRecord, emoji: string): void => {
    addMessageReaction(m.id, emoji);
    setReactionsBumpKey((n) => n + 1);
    setReactPickerMsgId(null);
    const body = (m.body ?? '').replace(/\\s+/g, ' ').trim();
    const preview = body.slice(0, 30);
    const tail = body.length > 30 ? '…' : '';
    const text = preview
      ? \`\${emoji} to: "\${preview}\${tail}"\`
      : \`\${emoji}\`;
    void sendReactionAsText(text);
  };`,
  },
  {
    label: '4: remove the checkbox + label JSX from the picker popover',
    find: `                            <label className="bubble-reaction-send-toggle">
                              <input
                                type="checkbox"
                                checked={reactSendAsText}
                                onChange={(e) => {
                                  // v0.10.199 — persist so the choice
                                  // survives picker close + page reload.
                                  const next = e.target.checked;
                                  setReactSendAsText(next);
                                  try {
                                    localStorage.setItem('ace_react_send_as_text', String(next));
                                  } catch {
                                    /* localStorage unavailable; in-memory only */
                                  }
                                }}
                              />
                              <span>Send to recipient as text</span>
                            </label>`,
    replace: `                            {/* v0.10.201 — the "Send to recipient as
                                text" toggle was removed. Reactions
                                always send as SMS. */}`,
  },
]);

// =====================================================================
// Version bumps 0.10.199 -> 0.10.201 (skipping the broken 0.10.200).
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
  c = c.replace(/"version":\s*"0\.10\.199"/, '"version": "0.10.201"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.199 -> 0.10.201`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v201] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.199';`,
    replace: `const APP_VERSION = '0.10.201';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.201 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.199',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.201',
    date: 'June 19, 2026',
    highlight: 'Reactions: always sent to recipient and picker opens below the bubble.',
    changes: [
      { type: 'fixed', text: 'The reaction picker now opens BELOW the bubble instead of above. The previous behavior was clipping the top row (including the heart) behind the thread header when reacting to messages near the top of the scroll area.' },
      { type: 'improved', text: 'The Send-to-recipient-as-text toggle has been removed. Every reaction now sends to the recipient automatically. No checkbox, no extra step.' },
      { type: 'fixed', text: 'Internal: v0.10.200 was published with the v0.10.201 logic missing due to an apply-script syntax error. The v0.10.200 installer therefore showed v0.10.199 in Diagnostics. v0.10.201 is the corrected release.' },
    ],
  },
  {
    version: '0.10.199',`,
  },
]);

console.log('[apply-v201] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.201: Re-ship of broken v200 (reactions always-send + picker below)"');
console.log('  git tag v0.10.201');
console.log('  git push origin main');
console.log('  git push origin v0.10.201');
console.log('');
console.log('Note: the broken v0.10.200 tag still exists on GitHub. You can leave it');
console.log('(it points at v0.10.199 code which works) or delete it via the GitHub');
console.log('releases page if it confuses users in the dropdown.');
