#!/usr/bin/env node
// v0.10.195 - Message reactions (MVP).
//
// FEATURE
//   Hover an SMS/MMS bubble to reveal a small smile-face "+" button.
//   Click it → small popover with 6 quick reactions (iMessage-style:
//   ❤️ 👍 👎 😂 ‼️ ❓) plus a "Send to recipient as text" checkbox.
//   Click an emoji → it appears as a chip below the bubble. Click your
//   own chip to remove it. Reactions persist in localStorage per
//   device — local-only by default. The "Send to recipient as text"
//   checkbox, when enabled, ALSO sends an SMS like ❤️ to: "<preview>"
//   so the other party knows you reacted (iMessage-tapback-style
//   interop with non-RCS phones).
//
// SCOPE TONIGHT (MVP)
//   - localStorage only, no DB / API changes (see follow-up note below).
//   - 6 quick reactions, no full emoji picker integration yet.
//   - Works on inbound AND outbound bubbles.
//
// FOLLOW-UP — v0.10.196 (deferred, see project memory)
//   - Integrate the existing composer emoji picker as a "More…" button
//     so any emoji can be a reaction.
//   - Optionally migrate to a server-side reactions table so reactions
//     sync across devices and are visible to other ACE users on the
//     same thread (e.g., shared inbox scenarios). Today they're per
//     device.
//
// FILES TOUCHED
//   NEW   apps/web/src/lib/messageReactions.ts
//   EDIT  apps/web/src/pages/Messages.tsx
//         - import the helper
//         - state for picker open + send-as-text toggle
//         - handler functions
//         - bubble JSX (chip row, add button, picker popover)
//   EDIT  apps/web/src/styles.css   — new bubble-reaction-* rules
//
// VERSION BUMP: 0.10.194 -> 0.10.195

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v195] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v195] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v195] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v195] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeNewFile(relPath, body) {
  const fp = join(ROOT, relPath);
  if (existsSync(fp)) {
    console.error(`[apply-v195] FATAL: refusing to overwrite existing file: ${fp}`);
    process.exit(1);
  }
  // Use CRLF to match the rest of the repo's Windows convention.
  const normalized = body.replace(/\r?\n/g, '\r\n');
  writeFileSync(fp, normalized, 'utf8');
  console.log(`  CREATE ${relPath}: ${normalized.length} bytes`);
}

// =====================================================================
// NEW FILE: apps/web/src/lib/messageReactions.ts
// =====================================================================
const REACTIONS_LIB = `// v0.10.195 — Message reactions persistence helper.
//
// Stores a per-message list of emoji reactions in localStorage. MVP is
// local-only (per device, per user account on this device). The shape:
//
//   { "<messageId>": ["❤️", "👍"], "<messageId>": ["😂"], ... }
//
// keyed under \`ace_message_reactions_v1\`.
//
// Future v0.10.196+: same API surface but backed by a server-side
// reactions table so reactions sync across devices and are visible to
// other ACE users on the same thread.

const STORAGE_KEY = 'ace_message_reactions_v1';

type ReactionMap = Record<string, string[]>;

function load(): ReactionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Best-effort validation: keep only string[] values.
      const out: ReactionMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          out[k] = v;
        }
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function save(map: ReactionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable in private windows / Electron edge
    // cases; reactions silently revert to in-memory-only for this session.
  }
}

/** Returns the user's current reactions for a given message id. */
export function getMessageReactions(messageId: number | string): string[] {
  const map = load();
  return map[String(messageId)] ?? [];
}

/** Adds an emoji reaction. No-op if the user has already reacted with
 *  this emoji (one of each per user, like iMessage). */
export function addMessageReaction(messageId: number | string, emoji: string): void {
  const map = load();
  const id = String(messageId);
  const existing = map[id] ?? [];
  if (existing.includes(emoji)) return;
  map[id] = [...existing, emoji];
  save(map);
}

/** Removes a specific emoji reaction. */
export function removeMessageReaction(messageId: number | string, emoji: string): void {
  const map = load();
  const id = String(messageId);
  const existing = map[id];
  if (!existing) return;
  const next = existing.filter((e) => e !== emoji);
  if (next.length === 0) {
    delete map[id];
  } else {
    map[id] = next;
  }
  save(map);
}

/** Convenience: returns true if the user has the given reaction on a
 *  message. Currently unused but exported for future call sites. */
export function hasMessageReaction(messageId: number | string, emoji: string): boolean {
  return getMessageReactions(messageId).includes(emoji);
}

/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover. Matches the iMessage Tapback set. The full
 *  emoji picker integration is deferred to v0.10.196+. */
export const QUICK_REACTIONS: readonly string[] = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
`;

writeNewFile('apps/web/src/lib/messageReactions.ts', REACTIONS_LIB);

// =====================================================================
// Messages.tsx
//   Edit 1: import the helper.
//   Edit 2: add component state (reactPickerMsgId, reactSendAsText,
//           reactionsBumpKey) just after expandedErrorIds.
//   Edit 3: add handler functions just above the existing handleSend.
//   Edit 4: add JSX (reactions chip row + add button + picker popover)
//           inside each bubble, right after the status-tick block.
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: import reactions helper next to other lib imports',
    find: `import { telnyxErrorBlurb } from '../lib/telnyxErrorBlurb';`,
    replace: `import { telnyxErrorBlurb } from '../lib/telnyxErrorBlurb';
import {
  getMessageReactions,
  addMessageReaction,
  removeMessageReaction,
  QUICK_REACTIONS,
} from '../lib/messageReactions';`,
  },
  {
    label: '2: add reactPickerMsgId / reactSendAsText / reactionsBumpKey state',
    find: `  // v0.10.191 — Which failed bubbles currently have their error details
  // expanded. Default: collapsed (just a "Failed" pill). Click toggles.
  // v0.10.192 — Set<number> not Set<string>: MessageRecord.id is number.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<number>>(new Set());`,
    replace: `  // v0.10.191 — Which failed bubbles currently have their error details
  // expanded. Default: collapsed (just a "Failed" pill). Click toggles.
  // v0.10.192 — Set<number> not Set<string>: MessageRecord.id is number.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<number>>(new Set());

  // v0.10.195 — Reactions state. \`reactPickerMsgId\` is the message id
  // whose reaction picker is currently open (null = none). \`reactSendAsText\`
  // is the "also send as SMS" toggle inside the picker. \`reactionsBumpKey\`
  // is a no-op state value we increment after addReaction/removeReaction
  // so the render re-reads from localStorage.
  const [reactPickerMsgId, setReactPickerMsgId] = useState<number | null>(null);
  const [reactSendAsText, setReactSendAsText] = useState<boolean>(false);
  const [reactionsBumpKey, setReactionsBumpKey] = useState<number>(0);`,
  },
  {
    label: '3: add handleReact + sendReactionAsText helpers above handleSend',
    find: `  const handleSend = async () => {
    if (!draft.trim() && attached.length === 0) return;`,
    replace: `  // v0.10.195 — Add an emoji reaction to a message, optionally also
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
  };

  const sendReactionAsText = async (text: string): Promise<void> => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    try {
      const saved = await sendMessage(token, { to: number, body: text });
      setMessages((prev) => [...prev, saved]);
    } catch (e) {
      console.warn('[reactions] send-as-text failed', e);
    }
  };

  const handleSend = async () => {
    if (!draft.trim() && attached.length === 0) return;`,
  },
  {
    label: '4: add bubble reactions JSX (chip row + add button + picker) inside bubble',
    find: `                        {/* v0.10.191 — Delivery status tick on every successful
                            outbound bubble. queued/sent → faint tick; delivered
                            → bright double-tick. Failed bubbles use the pill
                            above instead. */}
                        {m.direction === 'outbound' && !isFailedStatus && (
                          <span
                            className={\`bubble-status-tick bubble-status-tick-\${getStatusTickClass(m.status)}\`}
                            title={getStatusLabel(m.status)}
                            aria-label={getStatusLabel(m.status)}
                          >
                            {renderStatusIcon(m.status)}
                          </span>
                        )}
                      </div>
                    );
                  })}`,
    replace: `                        {/* v0.10.191 — Delivery status tick on every successful
                            outbound bubble. queued/sent → faint tick; delivered
                            → bright double-tick. Failed bubbles use the pill
                            above instead. */}
                        {m.direction === 'outbound' && !isFailedStatus && (
                          <span
                            className={\`bubble-status-tick bubble-status-tick-\${getStatusTickClass(m.status)}\`}
                            title={getStatusLabel(m.status)}
                            aria-label={getStatusLabel(m.status)}
                          >
                            {renderStatusIcon(m.status)}
                          </span>
                        )}
                        {/* v0.10.195 — Reaction chips (rendered below
                            text + media + fail-pill, above the tick).
                            Read from localStorage; \`reactionsBumpKey\`
                            forces re-read after add/remove. */}
                        {(() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                          reactionsBumpKey;
                          const rxs = getMessageReactions(m.id);
                          if (rxs.length === 0) return null;
                          return (
                            <div className="bubble-reactions-row">
                              {rxs.map((emoji, i) => (
                                <button
                                  key={\`\${emoji}-\${i}\`}
                                  type="button"
                                  className="bubble-reaction-chip"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeMessageReaction(m.id, emoji);
                                    setReactionsBumpKey((n) => n + 1);
                                  }}
                                  title="Click to remove your reaction"
                                  aria-label={\`Remove reaction \${emoji}\`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                        {/* v0.10.195 — Hover-reveal "add reaction" button.
                            CSS handles opacity (0 by default, 1 on
                            bubble:hover) so the bubble stays clean. */}
                        <button
                          type="button"
                          className="bubble-add-reaction-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReactPickerMsgId((prev) => (prev === m.id ? null : m.id));
                            setReactSendAsText(false);
                          }}
                          aria-label="Add reaction"
                          aria-expanded={reactPickerMsgId === m.id}
                          title="Add reaction"
                        >
                          <Smile size={13} />
                        </button>
                        {/* v0.10.195 — Reaction picker popover. Anchored
                            above the bubble via CSS. Six quick reactions
                            (iMessage Tapback set) + optional "Send to
                            recipient as text" checkbox. */}
                        {reactPickerMsgId === m.id && (
                          <div className="bubble-reaction-picker" role="dialog" aria-label="Add reaction">
                            <div className="bubble-reaction-picker-row">
                              {QUICK_REACTIONS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="bubble-reaction-quickpick"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReact(m, emoji);
                                  }}
                                  aria-label={\`React with \${emoji}\`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                            <label className="bubble-reaction-send-toggle">
                              <input
                                type="checkbox"
                                checked={reactSendAsText}
                                onChange={(e) => setReactSendAsText(e.target.checked)}
                              />
                              <span>Send to recipient as text</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}`,
  },
]);

// =====================================================================
// styles.css — new bubble-reaction-* rules.
// Anchored on the v0.10.191 bubble-fail-details light-mode block so the
// new rules sit immediately after the related delivery-tick/fail-pill
// styles (logical grouping).
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '5: append v0.10.195 reaction styles after the bubble-fail-details light-mode block',
    find: `[data-theme="light"] .bubble-fail-details {
  background: rgba(127, 29, 29, 0.10);
  color: #7f1d1d;
}`,
    replace: `[data-theme="light"] .bubble-fail-details {
  background: rgba(127, 29, 29, 0.10);
  color: #7f1d1d;
}

/* ====================================================================
   v0.10.195 — Message reactions.
   ==================================================================== */

/* Bubble already has position: relative (set by v0.10.191 for the tick).
   The add-reaction button sits at top-right, hidden by default and
   revealed on hover. */
.bubble-add-reaction-btn {
  position: absolute;
  top: 4px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  color: #ffffff;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
  -webkit-appearance: none;
}
.msg-stream .bubble:hover .bubble-add-reaction-btn,
.bubble-add-reaction-btn[aria-expanded="true"] {
  opacity: 1;
}
.bubble-add-reaction-btn:hover {
  background: rgba(0, 0, 0, 0.5);
}
[data-theme="light"] .bubble-add-reaction-btn {
  background: rgba(255, 255, 255, 0.85);
  color: #4f46e5;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
[data-theme="light"] .bubble-add-reaction-btn:hover {
  background: #ffffff;
}
/* Incoming bubbles use dark text on a darker background — invert the
   add-button so it's still readable. */
.msg-stream .bubble.in .bubble-add-reaction-btn {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
}
[data-theme="light"] .msg-stream .bubble.in .bubble-add-reaction-btn {
  background: rgba(255, 255, 255, 0.9);
  color: #374151;
}

/* Row of reaction chips, rendered below text/media. */
.bubble-reactions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.bubble-reaction-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 7px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: inherit;
  font-size: 14px;
  line-height: 1.1;
  cursor: pointer;
  -webkit-appearance: none;
  transition: background 120ms ease;
}
.bubble-reaction-chip:hover {
  background: rgba(0, 0, 0, 0.42);
}
[data-theme="light"] .bubble-reaction-chip {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(0, 0, 0, 0.08);
  color: #111827;
}
[data-theme="light"] .bubble-reaction-chip:hover {
  background: #ffffff;
}

/* Picker popover — anchored above the bubble, horizontally centered. */
.bubble-reaction-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 1000;
  background: rgba(17, 24, 39, 0.96);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 14px;
  padding: 8px 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
}
[data-theme="light"] .bubble-reaction-picker {
  background: #ffffff;
  color: #111827;
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.bubble-reaction-picker-row {
  display: flex;
  gap: 4px;
  justify-content: space-between;
}
.bubble-reaction-quickpick {
  flex: 1 0 0;
  min-width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
  -webkit-appearance: none;
}
.bubble-reaction-quickpick:hover {
  background: rgba(255, 255, 255, 0.10);
  transform: scale(1.15);
}
[data-theme="light"] .bubble-reaction-quickpick:hover {
  background: rgba(0, 0, 0, 0.05);
}
.bubble-reaction-send-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  padding: 4px 2px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  user-select: none;
}
.bubble-reaction-send-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #4f46e5;
  cursor: pointer;
}
[data-theme="light"] .bubble-reaction-send-toggle {
  color: #374151;
  border-top-color: rgba(0, 0, 0, 0.08);
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.194 -> 0.10.195
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
  c = c.replace(/"version":\s*"0\.10\.194"/, '"version": "0.10.195"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.194 -> 0.10.195`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v195] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.194';`,
    replace: `const APP_VERSION = '0.10.195';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.195 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.194',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.195',
    date: 'June 19, 2026',
    highlight: 'React to messages with one tap.',
    changes: [
      { type: 'new', text: 'Hover any message bubble to reveal a smile-face icon. Click it for a quick set of reactions (heart, thumbs-up, thumbs-down, laugh, exclamation, question). Reactions appear as small chips below the bubble — click your own chip to remove it.' },
      { type: 'new', text: 'Optional "Send to recipient as text" toggle inside the picker sends an iPhone-tapback-style SMS like ❤️ to: "<message preview>" so the other party knows you reacted. Off by default — reactions are local to your dialer unless you opt in.' },
    ],
  },
  {
    version: '0.10.194',`,
  },
]);

console.log('\n[apply-v195] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.195: Message reactions (localStorage, 6 quick emojis, optional send-as-text)"');
console.log('  git tag v0.10.195');
console.log('  git push origin main');
console.log('  git push origin v0.10.195');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Hover any bubble in a thread. Smile-face button appears top-right.');
console.log('  2. Click it. Popover opens with 6 emojis + "Send to recipient as text" checkbox.');
console.log('  3. Click an emoji. Picker closes; the emoji appears as a chip below the bubble.');
console.log('  4. Click the chip to remove your reaction.');
console.log('  5. Open the picker again, check "Send to recipient as text", click an emoji.');
console.log('     The recipient should receive an SMS like ❤️ to: "<message preview>".');
console.log('  6. Reload the page. Reactions persist (localStorage).');
console.log('  7. Open the picker on a different bubble while one is already open — the');
console.log('     previous picker should close (state is single-bubble).');
