#!/usr/bin/env node
// v0.10.200 - Reactions, two design corrections per Abd's screenshot:
//
// 1. PICKER POSITION — was anchored ABOVE the bubble
//    (`bottom: calc(100% + 6px)`). For inbound bubbles near the top of
//    the scroll area, the picker extended into / behind the thread
//    header, clipping the entire top row (which is where ❤️ lives in
//    the v0.10.198 layout). Flip to BELOW the bubble
//    (`top: calc(100% + 6px)`) so all 5 rows + 25 emojis are visible
//    regardless of where the bubble sits in the scroll viewport.
//
// 2. SEND-AS-TEXT TOGGLE — removed entirely.
//    Per Abd: "if we are anyways sending the emoticons via text make
//    it default.. why do we have to have user chose send to recipient
//    as text? put it in the backend."
//    Every reaction now ALWAYS sends as SMS to the recipient. No
//    checkbox, no UX friction, no opt-out. The local chip still
//    renders on the user's bubble too — both happen.
//    All the supporting machinery (state, localStorage key, checkbox
//    JSX, label, divider, persistence onChange) gets removed.
//
// FILES TOUCHED
//   apps/web/src/styles.css            — picker position bottom→top;
//                                        send-toggle CSS no longer used
//                                        (left in place; harmless, can
//                                        be cleaned in a later pass).
//   apps/web/src/pages/Messages.tsx    — drop state, always call
//                                        sendReactionAsText, remove
//                                        toggle JSX.
//
// VERSION BUMP: 0.10.199 -> 0.10.200

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v200] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v200] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v200] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v200] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — flip picker from bottom→top so it opens below the bubble.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: picker opens BELOW the bubble (bottom:... → top:...)',
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
   v0.10.199 — flipped horizontal anchor from right to left (was
   clipping off the viewport on narrow inbound bubbles).
   v0.10.200 — flipped vertical anchor from top to bottom. The
   original \`bottom: calc(100% + 6px)\` opened ABOVE the bubble, which
   on inbound bubbles near the top of the scroll area clipped the top
   row (where ❤️ lives) behind the thread header. Opening BELOW the
   bubble guarantees the full 5×5 grid is visible regardless of scroll
   position. */
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
  // v0.10.200 — \`reactSendAsText\` and its localStorage persistence
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
  // v0.10.200 — Send-as-text is now ALWAYS on (no toggle, no
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
    replace: `                            {/* v0.10.200 — the "Send to recipient as
                                text" toggle was removed. Reactions
                                always send as SMS. */}`,
  },
]);

// =====================================================================
// Version bumps 0.10.199 -> 0.10.200
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
  c = c.replace(/"version":\s*"0\.10\.199"/, '"version": "0.10.200"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.199 -> 0.10.200`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v200] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.199';`,
    replace: `const APP_VERSION = '0.10.200';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.200 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.199',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.200',
    date: 'June 19, 2026',
    highlight: 'Reactions: always sent to recipient + picker opens below the bubble.',
    changes: [
      { type: 'fixed', text: 'The reaction picker now opens BELOW the bubble instead of above. The previous "open above" behavior was clipping the top row (including ❤️) behind the thread header when reacting to messages near the top of the scroll area.' },
      { type: 'improved', text: 'The "Send to recipient as text" toggle has been removed. Every reaction now sends to the recipient automatically — no checkbox, no extra step. If you want a reaction to stay local-only, that is no longer supported.' },
    ],
  },
  {
    version: '0.10.199',`,
  },
]);

console.log('\n[apply-v200] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.200: Reactions always-send + picker opens below the bubble"');
console.log('  git tag v0.10.200');
console.log('  git push origin main');
console.log('  git push origin v0.10.200');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover an inbound bubble near the top of the thread. Click smile.');
console.log('     Picker opens BELOW the bubble with all 5 rows visible (❤️ on the top-left).');
console.log('  2. Click any emoji. No toggle visible — that\\'s correct.');
console.log('     The recipient should receive an SMS like ❤️ to: "<preview>" immediately.');
console.log('  3. Local chip appears on the bubble (same as before).');
console.log('  4. If the SMS fails to deliver, an error banner surfaces at the top.');
