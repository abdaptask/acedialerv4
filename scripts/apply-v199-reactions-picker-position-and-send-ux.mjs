#!/usr/bin/env node
// v0.10.199 - Two reaction-picker fixes after Abd's screenshot review:
//
// 1. PICKER POSITIONING — broken on inbound bubbles.
//    The popover was anchored with `right: 0`, which means "align the
//    picker's right edge with the bubble's right edge, extend leftward."
//    That works fine for outbound bubbles (right-aligned, plenty of
//    room to the left). For INBOUND bubbles (left-aligned and often
//    narrow — "Liked '...'" tapbacks are tiny), the picker extends
//    leftward off the screen edge. The 5×5 grid Abd saw in the
//    screenshot was clipped to ~3 columns and the "Send to recipient
//    as text" toggle was completely off-screen — which is most likely
//    WHY the toggle was never checked and reactions never went out.
//    Fix: since v0.10.196 made reactions inbound-only, anchor with
//    `left: 0` so the picker extends RIGHTWARD from the bubble's left
//    edge. Plenty of room in that direction.
//
// 2. SEND-AS-TEXT TOGGLE — reset every picker open.
//    The toggle defaults to false AND was reset to false on every
//    picker open (`setReactSendAsText(false)`). So even if the user
//    eventually saw the toggle and checked it, the next reaction
//    silently reverted to "local only." Fix: persist last value to
//    localStorage; restore on init; save on each change; STOP
//    resetting when opening the picker.
//    Also: when send-as-text is true and the send fails, surface the
//    error via setError (existing failure surface) so the user sees
//    why the recipient didn't get the reaction. Previous code just
//    console.warn'd, which was invisible.
//
// FILES TOUCHED
//   apps/web/src/styles.css            — picker position swap
//   apps/web/src/pages/Messages.tsx    — useState init + onChange persist
//                                        + remove reset-on-open + better
//                                        error reporting
//
// VERSION BUMP: 0.10.198 -> 0.10.199

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v199] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v199] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v199] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v199] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// styles.css — flip picker anchor from right to left
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '1: picker anchor right:0 -> left:0 (inbound-only context)',
    find: `/* Picker popover — anchored above the bubble, horizontally centered. */
.bubble-reaction-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 1000;`,
    replace: `/* Picker popover — anchored above the bubble.
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
  },
]);

// =====================================================================
// Messages.tsx
//   Edit 2: persist reactSendAsText from localStorage
//   Edit 3: do NOT reset reactSendAsText to false on picker open
//   Edit 4: save reactSendAsText to localStorage on checkbox change
//   Edit 5: surface send-as-text errors via setError (existing UI)
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '2: useState init from localStorage for sendAsText preference',
    find: `  // v0.10.195 — Reactions state. \`reactPickerMsgId\` is the message id
  // whose reaction picker is currently open (null = none). \`reactSendAsText\`
  // is the "also send as SMS" toggle inside the picker. \`reactionsBumpKey\`
  // is a no-op state value we increment after addReaction/removeReaction
  // so the render re-reads from localStorage.
  const [reactPickerMsgId, setReactPickerMsgId] = useState<number | null>(null);
  const [reactSendAsText, setReactSendAsText] = useState<boolean>(false);
  const [reactionsBumpKey, setReactionsBumpKey] = useState<number>(0);`,
    replace: `  // v0.10.195 — Reactions state. \`reactPickerMsgId\` is the message id
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
  },
  {
    label: '3: drop the setReactSendAsText(false) reset when opening picker',
    find: `                        <button
                          type="button"
                          className="bubble-add-reaction-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReactPickerMsgId((prev) => (prev === m.id ? null : m.id));
                            setReactSendAsText(false);
                          }}`,
    replace: `                        <button
                          type="button"
                          className="bubble-add-reaction-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReactPickerMsgId((prev) => (prev === m.id ? null : m.id));
                            // v0.10.199 — do NOT reset reactSendAsText here.
                            // The user's persisted preference (from localStorage)
                            // should carry forward across picker opens.
                          }}`,
  },
  {
    label: '4: onChange of send-as-text checkbox persists to localStorage',
    find: `                            <label className="bubble-reaction-send-toggle">
                              <input
                                type="checkbox"
                                checked={reactSendAsText}
                                onChange={(e) => setReactSendAsText(e.target.checked)}
                              />
                              <span>Send to recipient as text</span>
                            </label>`,
    replace: `                            <label className="bubble-reaction-send-toggle">
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
  },
  {
    label: '5: surface send-as-text failures via setError instead of silent console.warn',
    find: `  const sendReactionAsText = async (text: string): Promise<void> => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    try {
      const saved = await sendMessage(token, { to: number, body: text });
      setMessages((prev) => [...prev, saved]);
    } catch (e) {
      console.warn('[reactions] send-as-text failed', e);
    }
  };`,
    replace: `  const sendReactionAsText = async (text: string): Promise<void> => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    try {
      const saved = await sendMessage(token, { to: number, body: text });
      setMessages((prev) => [...prev, saved]);
    } catch (e) {
      // v0.10.199 — Surface failures so the user knows the reaction-as-
      // SMS didn't reach the recipient. Mirrors handleSend's error path:
      // SendMessageError → friendly telnyx blurb; plain Error → message.
      if (e instanceof SendMessageError) {
        const blurb = telnyxErrorBlurb(e.details ?? e.code);
        setError(\`Reaction send failed: \${blurb.short}. \${blurb.detail}\`);
      } else {
        setError(\`Reaction send failed: \${(e as Error).message}\`);
      }
      console.warn('[reactions] send-as-text failed', e);
    }
  };`,
  },
]);

// =====================================================================
// Version bumps 0.10.198 -> 0.10.199
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
  c = c.replace(/"version":\s*"0\.10\.198"/, '"version": "0.10.199"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.198 -> 0.10.199`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v199] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.198';`,
    replace: `const APP_VERSION = '0.10.199';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.199 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.198',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.199',
    date: 'June 19, 2026',
    highlight: 'Reactions picker: fits on screen, remembers your "send to recipient" choice.',
    changes: [
      { type: 'fixed', text: 'The reaction picker was extending off the left edge of the viewport on small inbound bubbles, clipping most of the 5×5 grid AND the "Send to recipient as text" toggle. Picker now opens RIGHTWARD from the bubble so the full grid + toggle are always visible.' },
      { type: 'fixed', text: 'The "Send to recipient as text" checkbox used to reset to off every time the picker opened — so a user who checked it for one reaction would silently revert to local-only for the next. Your choice now persists across picker opens and page reloads.' },
      { type: 'fixed', text: 'If the recipient-text SMS fails to send (carrier rejection, invalid number, etc.), the error now surfaces in the thread banner instead of failing silently in the console.' },
    ],
  },
  {
    version: '0.10.198',`,
  },
]);

console.log('\n[apply-v199] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.199: Reactions picker fits on-screen + send-as-text choice persists"');
console.log('  git tag v0.10.199');
console.log('  git push origin main');
console.log('  git push origin v0.10.199');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover any inbound bubble. Click the smile icon.');
console.log('     Picker now opens to the RIGHT of the bubble (not the left).');
console.log('     Full 5×5 grid visible. "Send to recipient as text" toggle visible.');
console.log('  2. Check the "Send to recipient as text" box. Click ❤️.');
console.log('     Recipient should receive an SMS: ❤️ to: "<message preview>"');
console.log('     If the send fails, an error banner appears at the top of the thread.');
console.log('  3. Click the smile icon again on another inbound bubble.');
console.log('     The "Send to recipient as text" box should STILL be checked');
console.log('     (your previous choice is remembered).');
console.log('  4. Refresh the page. Open the picker again — checkbox still remembered.');
