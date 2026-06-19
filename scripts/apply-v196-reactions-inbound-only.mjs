#!/usr/bin/env node
// v0.10.196 - Restrict reactions to inbound messages only.
//
// v0.10.195 shipped reactions on every bubble (both inbound and
// outbound). Per Abd: "i want to react to any messages that i get..
// not the ones that i sent". This patch gates the add-reaction button,
// the picker popover, AND the existing-reactions chip row on
// m.direction === 'inbound'. Outbound bubbles render exactly as they
// did before v0.10.195.
//
// FILES TOUCHED
//   apps/web/src/pages/Messages.tsx — three small JSX guards.
//
// VERSION BUMP: 0.10.195 -> 0.10.196

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v196] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v196] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v196] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v196] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: gate the chip row on inbound direction',
    find: `                        {/* v0.10.195 — Reaction chips (rendered below
                            text + media + fail-pill, above the tick).
                            Read from localStorage; \`reactionsBumpKey\`
                            forces re-read after add/remove. */}
                        {(() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                          reactionsBumpKey;
                          const rxs = getMessageReactions(m.id);
                          if (rxs.length === 0) return null;
                          return (
                            <div className="bubble-reactions-row">`,
    replace: `                        {/* v0.10.195 — Reaction chips (rendered below
                            text + media + fail-pill, above the tick).
                            Read from localStorage; \`reactionsBumpKey\`
                            forces re-read after add/remove.
                            v0.10.196 — inbound bubbles only. */}
                        {m.direction === 'inbound' && (() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                          reactionsBumpKey;
                          const rxs = getMessageReactions(m.id);
                          if (rxs.length === 0) return null;
                          return (
                            <div className="bubble-reactions-row">`,
  },
  {
    label: '2: gate the add-reaction button on inbound direction',
    find: `                        {/* v0.10.195 — Hover-reveal "add reaction" button.
                            CSS handles opacity (0 by default, 1 on
                            bubble:hover) so the bubble stays clean. */}
                        <button
                          type="button"
                          className="bubble-add-reaction-btn"`,
    replace: `                        {/* v0.10.195 — Hover-reveal "add reaction" button.
                            CSS handles opacity (0 by default, 1 on
                            bubble:hover) so the bubble stays clean.
                            v0.10.196 — inbound bubbles only. */}
                        {m.direction === 'inbound' && (
                        <button
                          type="button"
                          className="bubble-add-reaction-btn"`,
  },
  {
    label: '3: close the inbound-only guard right after the add-reaction button',
    find: `                          title="Add reaction"
                        >
                          <Smile size={13} />
                        </button>
                        {/* v0.10.195 — Reaction picker popover. Anchored
                            above the bubble via CSS. Six quick reactions
                            (iMessage Tapback set) + optional "Send to
                            recipient as text" checkbox. */}
                        {reactPickerMsgId === m.id && (`,
    replace: `                          title="Add reaction"
                        >
                          <Smile size={13} />
                        </button>
                        )}
                        {/* v0.10.195 — Reaction picker popover. Anchored
                            above the bubble via CSS. Six quick reactions
                            (iMessage Tapback set) + optional "Send to
                            recipient as text" checkbox.
                            v0.10.196 — inbound bubbles only. */}
                        {m.direction === 'inbound' && reactPickerMsgId === m.id && (`,
  },
]);

// =====================================================================
// Version bumps 0.10.195 -> 0.10.196
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
  c = c.replace(/"version":\s*"0\.10\.195"/, '"version": "0.10.196"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.195 -> 0.10.196`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v196] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.195';`,
    replace: `const APP_VERSION = '0.10.196';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.196 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.195',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.196',
    date: 'June 19, 2026',
    highlight: 'Reactions now show only on messages you received.',
    changes: [
      { type: 'improved', text: 'The hover-reveal reaction button now appears only on inbound message bubbles (ones you received). Your own outbound messages render as before, without the reaction affordance.' },
    ],
  },
  {
    version: '0.10.195',`,
  },
]);

console.log('\n[apply-v196] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.196: Reactions restricted to inbound bubbles only"');
console.log('  git tag v0.10.196');
console.log('  git push origin main');
console.log('  git push origin v0.10.196');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover an INBOUND bubble — smile-face button appears, picker works.');
console.log('  2. Hover one of YOUR OWN OUTBOUND bubbles — no button, no popover.');
console.log('  3. If you had previously reacted to your own message during v0.10.195');
console.log('     testing, that chip stops rendering after v0.10.196 (localStorage');
console.log('     entry is still there but hidden).');
