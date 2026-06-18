#!/usr/bin/env node
// v0.10.191 - WhatsApp-style delivery status ticks on every outbound
// SMS/MMS bubble + clickable "Failed" pill with collapsible details.
//
// SCOPE — UI-only. The data has been wired up since the early webhook
// work (apps/webhooks/src/main.ts handles message.sent / .delivered /
// .finalized / .sending_failed / .failed and writes status +
// deliveredAt + errors[] onto the Message row). This release surfaces
// that data in the thread view.
//
// NEW VISUAL
//   Every outbound bubble gets a tiny status icon in its bottom-right
//   corner:
//     queued / sending   →  Clock        (subtle)
//     sent               →  Check        (subtle)
//     delivered          →  CheckCheck   (brighter, full opacity)
//   Failed bubbles keep the existing red treatment AND now show a small
//   clickable "Failed" pill. Clicking the pill toggles a details panel
//   below the bubble that shows the Telnyx error code + description
//   (rendered from telnyxErrorBlurb() — same source as the old inline
//   blurb, just now collapsed by default).
//
// REMOVED
//   The redundant " · failed" caption that used to appear under the run
//   (in .bubble-run-time). The per-bubble pill replaces it.
//
// FILES TOUCHED
//   apps/web/src/pages/Messages.tsx — imports, helpers, ThreadView state,
//                                     bubble JSX
//   apps/web/src/styles.css         — new tick + fail-pill rules
//
// VERSION BUMP: 0.10.190 -> 0.10.191

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v191] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v191] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v191] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v191] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// Messages.tsx
// =====================================================================
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1: extend lucide-react import with Check / CheckCheck / AlertCircle',
    find: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil, MessageSquare, Voicemail as VoicemailIcon, Download } from 'lucide-react';`,
    replace: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil, MessageSquare, Voicemail as VoicemailIcon, Download, Check, CheckCheck, AlertCircle } from 'lucide-react';`,
  },
  {
    label: '2: add module-level helpers (renderStatusIcon / getStatusLabel / getStatusTickClass) just before formatNumber',
    find: `function formatNumber(raw: string): string {
  return formatPhone(raw);`,
    replace: `// v0.10.191 — Outbound bubble status mapping. Telnyx event flow:
//   message.queued / message.sent      → status='sent'
//   message.delivered                  → status='delivered'
//   message.finalized                  → status='delivered' | 'sent' | etc.
//   message.sending_failed / .failed   → status='failed' | 'delivery_failed'
function getStatusTickClass(status: string | undefined | null): string {
  if (!status) return 'queued';
  const s = String(status).toLowerCase();
  if (s === 'delivered') return 'delivered';
  if (s === 'sent') return 'sent';
  if (s === 'queued' || s === 'sending' || s === 'accepted') return 'queued';
  return 'sent';
}
function getStatusLabel(status: string | undefined | null): string {
  if (!status) return 'Queued';
  const s = String(status).toLowerCase();
  if (s === 'delivered') return 'Delivered';
  if (s === 'sent') return 'Sent';
  if (s === 'queued' || s === 'sending') return 'Sending…';
  if (s === 'accepted') return 'Accepted';
  if (s === 'failed' || s === 'delivery_failed') return 'Failed';
  // Anything unexpected — surface it raw so the user / support can see it.
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function renderStatusIcon(status: string | undefined | null): JSX.Element {
  const cls = getStatusTickClass(status);
  if (cls === 'delivered') return <CheckCheck size={12} strokeWidth={2.5} />;
  if (cls === 'sent') return <Check size={12} strokeWidth={2.5} />;
  // 'queued' / 'sending' / unknown — clock
  return <Clock size={12} strokeWidth={2.5} />;
}

function formatNumber(raw: string): string {
  return formatPhone(raw);`,
  },
  {
    label: '3: add expandedErrorIds state inside ThreadView (right after blocked state)',
    find: `  // Has the user already blocked this number? Hides the Block button
  // and shows a small "Blocked" badge instead. (#159)
  const [blocked, setBlocked] = useState(false);`,
    replace: `  // Has the user already blocked this number? Hides the Block button
  // and shows a small "Blocked" badge instead. (#159)
  const [blocked, setBlocked] = useState(false);

  // v0.10.191 — Which failed bubbles currently have their error details
  // expanded. Default: collapsed (just a "Failed" pill). Click toggles.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<string>>(new Set());`,
  },
  {
    label: '4: replace failBlurb JSX + bubble-run-time block (per-bubble Failed pill + tick + simplified time)',
    find: `                        {failBlurb && (
                          <div className="bubble-fail-blurb" title={failBlurb.detail}>
                            <strong>{failBlurb.short}.</strong>{' '}
                            <span className="muted">{failBlurb.detail}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="bubble-run-time">
                    {formatTimeOnly(lastItem.createdAt)}
                    {lastItem.direction === 'outbound' && (lastItem.status === 'failed' || lastItem.status === 'delivery_failed') && (
                      <span className="bubble-status"> · {lastItem.status}</span>
                    )}
                  </div>`,
    replace: `                        {failBlurb && (
                          <>
                            {/* v0.10.191 — Clickable "Failed" pill replaces the
                                always-on inline blurb. Click toggles a details
                                panel under the bubble with the Telnyx error
                                code + description. */}
                            <button
                              type="button"
                              className="bubble-fail-pill"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedErrorIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(m.id)) next.delete(m.id);
                                  else next.add(m.id);
                                  return next;
                                });
                              }}
                              aria-expanded={expandedErrorIds.has(m.id)}
                              title="Click to see details"
                            >
                              <AlertCircle size={11} />
                              <span>Failed</span>
                            </button>
                            {expandedErrorIds.has(m.id) && (
                              <div className="bubble-fail-details">
                                <div className="bubble-fail-details-short">{failBlurb.short}</div>
                                <div className="bubble-fail-details-detail">{failBlurb.detail}</div>
                              </div>
                            )}
                          </>
                        )}
                        {/* v0.10.191 — Delivery status tick on every successful
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
                  })}
                  <div className="bubble-run-time">
                    {formatTimeOnly(lastItem.createdAt)}
                  </div>`,
  },
]);

// =====================================================================
// styles.css — add tick + fail-pill + fail-details styles right after
// the existing bubble-failed light-mode rule.
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '5: append v0.10.191 styles after the bubble-failed light-mode block',
    find: `[data-theme="light"] .msg-stream .bubble.bubble-failed .bubble-text {
  color: #7f1d1d;
}`,
    replace: `[data-theme="light"] .msg-stream .bubble.bubble-failed .bubble-text {
  color: #7f1d1d;
}

/* ====================================================================
   v0.10.191 — Delivery status ticks + clickable Failed pill.
   ==================================================================== */

/* Outbound bubbles get extra right + bottom padding so the absolutely-
   positioned tick doesn't overlap the text. */
.msg-stream .bubble.out {
  position: relative;
  padding-right: 28px;
  padding-bottom: 16px;
}

.bubble-status-tick {
  position: absolute;
  right: 8px;
  bottom: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none; /* tooltip only — no click target */
}
/* Faint by default — sent / queued. */
.bubble-status-tick-queued,
.bubble-status-tick-sent {
  color: rgba(255, 255, 255, 0.6);
}
/* Bright when the carrier confirmed delivery. */
.bubble-status-tick-delivered {
  color: #ffffff;
  opacity: 1;
}

/* The "Failed" pill — clickable, sits inside the bubble. Compact red
   chip with an alert icon. */
.bubble-fail-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 3px 8px;
  border: 1px solid rgba(220, 38, 38, 0.5);
  border-radius: 999px;
  background: rgba(220, 38, 38, 0.18);
  color: #fecaca;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.1;
  -webkit-appearance: none;
}
.bubble-fail-pill:hover { background: rgba(220, 38, 38, 0.28); }
.bubble-fail-pill:focus-visible {
  outline: 2px solid rgba(220, 38, 38, 0.7);
  outline-offset: 1px;
}
[data-theme="light"] .bubble-fail-pill {
  background: rgba(220, 38, 38, 0.10);
  border-color: rgba(220, 38, 38, 0.45);
  color: #991b1b;
}
[data-theme="light"] .bubble-fail-pill:hover { background: rgba(220, 38, 38, 0.18); }

/* Expanded error details panel — drops in below the failed bubble when
   the pill is clicked. */
.bubble-fail-details {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.30);
  font-size: 12px;
  line-height: 1.35;
}
.bubble-fail-details-short {
  font-weight: 600;
  margin-bottom: 2px;
}
.bubble-fail-details-detail {
  opacity: 0.85;
  word-break: break-word;
}
[data-theme="light"] .bubble-fail-details {
  background: rgba(127, 29, 29, 0.10);
  color: #7f1d1d;
}`,
  },
]);

// =====================================================================
// Version bumps 0.10.190 -> 0.10.191
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
  c = c.replace(/"version":\s*"0\.10\.190"/, '"version": "0.10.191"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.190 -> 0.10.191`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v191] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.190';`,
    replace: `const APP_VERSION = '0.10.191';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.191 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.190',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.191',
    date: 'June 18, 2026',
    highlight: 'Delivery status ticks on every outbound message.',
    changes: [
      { type: 'new', text: 'Every outbound SMS/MMS now shows a small status tick in the bottom-right corner of its bubble — a clock while sending, a single check once sent, and a brighter double-check when the carrier confirms delivery.' },
      { type: 'improved', text: 'Failed messages now show a compact red "Failed" pill instead of the always-visible inline error. Click the pill to expand the Telnyx error code and description.' },
    ],
  },
  {
    version: '0.10.190',`,
  },
]);

console.log('\n[apply-v191] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.191: Delivery status ticks on outbound bubbles + click-for-details failed pill"');
console.log('  git tag v0.10.191');
console.log('  git push origin main');
console.log('  git push origin v0.10.191');
console.log('');
console.log('MANUAL TEST:');
console.log('  1. Send a fresh SMS in any thread. Bubble should appear with a Clock');
console.log('     icon in the bottom-right that flips to a single Check, then to a');
console.log('     brighter double-Check within a few seconds (Telnyx delivery webhook).');
console.log('  2. Send to an invalid number to force a failure. The bubble should');
console.log('     show a red "Failed" pill. Click it — details panel expands with');
console.log('     the Telnyx error code + description. Click again to collapse.');
console.log('  3. Existing successful messages should now show a double-check tick.');
