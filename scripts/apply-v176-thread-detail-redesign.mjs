#!/usr/bin/env node
// v0.10.176 - Conversation thread (Messages tab detail view) redesign.
//
// SCOPE
//   * Thread header replaced with: back + initials avatar + name + inline
//     activity badges (chat-bubble count, phone count, voicemail count)
//     and a phone subtitle. Block + green Call icons stay on the right.
//   * Activity badges are clickable to navigate to that contact's log:
//       - Messages badge (chat icon): no-op, informational only.
//       - Calls badge (phone icon): /recents?phone=X&from=/messages?to=X.
//       - Voicemails badge (voicemail icon): /voicemail?phone=X&from=...
//   * "Your line" pill moved BELOW the header as its own bar, now backed
//     by the existing DidSwitcher component (real switcher, persists via
//     POST /me/active-did just like the global one).
//   * Thread-history-bar removed - the counts now live in the header.
//     The history MODAL itself is left intact in the codebase as dead
//     code for now (no trigger), removable in a follow-up cleanup.
//   * Bubble stream restructured:
//       - Day separator pills (Today / Yesterday / Mon / Jun 1) between
//         days.
//       - Consecutive same-direction messages are grouped into "runs".
//       - Inbound runs render the contact's small initials avatar before
//         the first bubble.
//       - Each run shows ONE timestamp at the bottom, time-of-day only.
//   * Outbound bubbles restyled to solid indigo with white text; inbound
//     bubbles to a soft gray. Bubble-meta hidden (timestamps now grouped).
//   * Compose row restyled: send button is a round indigo circle with
//     a white paper-plane glyph. Schedule-send button kept.
//
// LOCKED BEHAVIORS PRESERVED
//   * Thread-mark-as-read on mount + after send (v0.10.26 + v0.10.67).
//   * Quick-replies popover, emoji picker, template picker, schedule
//     send modal - all kept 1:1.
//   * Telnyx error blurb on failed bubbles (v0.10.72).
//   * Auto-scroll on send + on inbound arrival (the scrollRef pattern).
//   * Paste-to-attach (v0.10.55), MMS upload pipeline.
//
// NO BACKEND OR SCHEMA CHANGES. Reuses existing /me/active-did endpoint
// via the DidSwitcher component already shipped.
//
// VERSION BUMP: 0.10.175 -> 0.10.176

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v176] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v176] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v176] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v176] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Messages.tsx - all anchor edits
// =====================================================================

// 1a. Add lucide icons used by new header (Voicemail icon for VM badge)
//     + DidSwitcher import for the new Your-line bar.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1a: add Voicemail + MessageSquare icons + DidSwitcher import',
    find: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil } from 'lucide-react';`,
    replace: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil, MessageSquare, Voicemail as VoicemailIcon } from 'lucide-react';
// v0.10.176 - DidSwitcher reused as the "Your line" pill below the
// thread header. Same component as the global header switcher; talks
// to POST /me/active-did, so switching here switches the user's active
// outbound DID everywhere.
import DidSwitcher from '../components/DidSwitcher';`,
  },
]);

// 1b. Add helper functions (formatDayLabel, formatTimeOnly,
//     initialsFromLabel) right after the existing formatRelative —
//     anchored to the end of formatRelative's closing brace + the
//     v0.10.59 formatScheduledFor comment that follows it.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1b: add formatDayLabel + formatTimeOnly + initialsFromLabel helpers',
    find: `  return \`\${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}, \${timeStr}\`;
}

// v0.10.59 — "Will fire at..." labels for scheduled messages.`,
    replace: `  return \`\${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}, \${timeStr}\`;
}

// v0.10.176 — Time-of-day only formatter, used by the per-run
// timestamps in the new grouped bubble layout. Date context is
// already shown by the day separator pill above.
function formatTimeOnly(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// v0.10.176 — Relative day label for the separator pills.
//   Today / Yesterday / Mon (weekday for 2-6 days back) /
//   Jun 1 (same year) / Jun 1, 2025 (older).
function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startTarget.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

// v0.10.176 — Initials from a contact label, used by the header avatar
// AND the small avatar that appears before the first bubble of each
// inbound run. Mirrors the helper used in Voicemail.tsx (v0.10.175).
function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

// v0.10.59 — "Will fire at..." labels for scheduled messages.`,
  },
]);

// 1c. Replace the thread-header block (and the "Your line" indicator
//     that lived inside it, which now becomes the standalone DidSwitcher
//     bar BELOW the header).
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1c: replace thread-header with new layout (avatar + name + phone + activity badges + actions) + add Your-line bar',
    find: `      <div className="thread-header">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="thread-header-name">
          {/* v0.10.30 — Reorganized for clarity. Contact name on top with
              their phone number directly below; "Your line:" pill below
              that so users can tell at a glance which is theirs vs the
              contact's. Previously the line pill was sandwiched between
              the name and contact number, which looked like it belonged
              to the contact. */}
          <span className="thread-header-contact">
            <span className="thread-header-contact-name">{displayName}</span>
            {displayName !== formatNumber(number) && (
              <span className="thread-header-sub">{formatNumber(number)}</span>
            )}
          </span>
          {(() => {
            const lastWithDid = [...messages].reverse().find((m) => m.userDid);
            if (!lastWithDid?.userDid) return null;
            return (
              <span className="thread-header-your-line">
                <span className="thread-header-your-line-label">Your line:</span>
                <LineBadge userDid={lastWithDid.userDid} variant="header" />
              </span>
            );
          })()}
        </div>
        {blocked && (
          <span
            className="thread-blocked-badge"
            title="You blocked this number. Manage in Settings → Blocked numbers."
          >
            <Ban size={14} /> Blocked
          </span>
        )}
        <button
          className={\`icon-btn thread-fav-btn \${favorited ? 'active' : ''}\`}
          onClick={handleToggleFav}
          aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
          title={favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={18} fill={favorited ? 'currentColor' : 'none'} />
        </button>
        {!blocked && (
          <button
            className="icon-btn thread-block-btn"
            onClick={handleBlock}
            aria-label="Block this number"
            title="Block this number"
          >
            <Ban size={18} />
          </button>
        )}
        <button
          className="icon-btn thread-call-btn"
          onClick={handleCall}
          aria-label="Call this number"
          title="Call"
          disabled={sipState !== 'registered'}
        >
          <Phone size={18} />
        </button>
      </div>`,
    replace: `      {/* v0.10.176 — Redesigned thread header. Avatar on the left,
          name + (optional star) + phone subtitle with inline activity
          counts as the middle column, Block + green Call icons on the
          right. Activity badges:
            - Messages count: informational, non-clickable (user is
              already viewing this thread's messages).
            - Calls count: navigates to /recents filtered for this contact.
            - Voicemails count: navigates to /voicemail filtered for this
              contact.
          Both navigations include from= so the back-bar returns here. */}
      <div className="thread-header thread-header-v2">
        <button className="icon-btn thread-back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <span className="thread-header-avatar" aria-hidden="true">
          {initialsFromLabel(displayName)}
        </span>
        <div className="thread-header-meta">
          <div className="thread-header-line1">
            <span className="thread-header-name-v2">{displayName}</span>
            {favorited && (
              <button
                type="button"
                className="thread-header-fav-inline"
                onClick={handleToggleFav}
                aria-label="Remove from favorites"
                title="Remove from favorites"
              >
                <Star size={16} fill="currentColor" strokeWidth={0} />
              </button>
            )}
            {!favorited && (
              <button
                type="button"
                className="thread-header-fav-inline thread-header-fav-empty"
                onClick={handleToggleFav}
                aria-label="Add to favorites"
                title="Add to favorites"
              >
                <Star size={16} strokeWidth={1.75} />
              </button>
            )}
            {blocked && (
              <span
                className="thread-blocked-badge"
                title="You blocked this number. Manage in Settings → Blocked numbers."
              >
                <Ban size={12} /> Blocked
              </span>
            )}
          </div>
          <div className="thread-header-line2">
            {displayName !== formatNumber(number) && (
              <span className="thread-header-sub-v2">{formatNumber(number)}</span>
            )}
            {history && (
              <span className="thread-header-badges">
                {history.summary.messageCount > 0 && (
                  <span
                    className="thread-header-badge"
                    title={\`\${history.summary.messageCount} messages with this contact\`}
                  >
                    <MessageSquare size={13} aria-hidden="true" />
                    {history.summary.messageCount}
                  </span>
                )}
                {history.summary.callCount > 0 && (
                  <button
                    type="button"
                    className="thread-header-badge clickable"
                    onClick={() => navigate(\`/recents?phone=\${encodeURIComponent(number)}&from=\${encodeURIComponent('/messages?to=' + number)}\`)}
                    title={\`\${history.summary.callCount} calls — open call log filtered to this contact\`}
                  >
                    <Phone size={13} aria-hidden="true" />
                    {history.summary.callCount}
                  </button>
                )}
                {history.summary.voicemailCount > 0 && (
                  <button
                    type="button"
                    className="thread-header-badge clickable"
                    onClick={() => navigate(\`/voicemail?phone=\${encodeURIComponent(number)}&from=\${encodeURIComponent('/messages?to=' + number)}\`)}
                    title={\`\${history.summary.voicemailCount} voicemails — open voicemail log filtered to this contact\`}
                  >
                    <VoicemailIcon size={13} aria-hidden="true" />
                    {history.summary.voicemailCount}
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        {!blocked && (
          <button
            className="icon-btn thread-block-btn-v2"
            onClick={handleBlock}
            aria-label="Block this number"
            title="Block this number"
          >
            <Ban size={18} />
          </button>
        )}
        <button
          className="icon-btn thread-call-btn-v2"
          onClick={handleCall}
          aria-label="Call this number"
          title="Call"
          disabled={sipState !== 'registered'}
        >
          <Phone size={18} fill="currentColor" strokeWidth={0} />
        </button>
      </div>

      {/* v0.10.176 — Your-line bar (the outbound DID switcher). Same
          DidSwitcher component used in the app header. Switching here
          calls POST /me/active-did, so it persists across sessions and
          applies to all outbound (not just this thread). */}
      <div className="thread-your-line-bar">
        <span className="thread-your-line-label">Your line</span>
        <DidSwitcher />
      </div>`,
  },
]);

// 1d. Remove the now-redundant thread-history-bar block.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1d: remove thread-history-bar (counts now live in the header)',
    find: `      {history && (history.summary.callCount > 0 || history.summary.voicemailCount > 0 || history.summary.messageCount > 0) && (
        <button
          type="button"
          className="thread-history-bar"
          onClick={() => setShowHistory(true)}
          title="See full interaction history"
        >
          <History size={14} />
          <span className="thread-history-counts">
            {history.summary.messageCount > 0 && (
              <span><strong>{history.summary.messageCount}</strong>{' '}
                {history.summary.messageCount === 1 ? 'message' : 'messages'}
              </span>
            )}
            {history.summary.callCount > 0 && (
              <span><strong>{history.summary.callCount}</strong>{' '}
                {history.summary.callCount === 1 ? 'call' : 'calls'}
              </span>
            )}
            {history.summary.voicemailCount > 0 && (
              <span><strong>{history.summary.voicemailCount}</strong>{' '}
                {history.summary.voicemailCount === 1 ? 'voicemail' : 'voicemails'}
              </span>
            )}
          </span>
          <span className="thread-history-action">View timeline</span>
        </button>
      )}

      {error && <div className="error" style={{ margin: '0 1rem' }}>{error}</div>}`,
    replace: `      {/* v0.10.176 — thread-history-bar removed; counts now live in the
          header as small inline badges. The interaction-timeline modal
          (setShowHistory) is still defined but no longer has a trigger
          on this page; removable in a follow-up cleanup. */}

      {error && <div className="error" style={{ margin: '0 1rem' }}>{error}</div>}`,
  },
]);

// 1e. Replace the bubble rendering loop with a grouped renderer:
//     - Group consecutive same-day messages and insert day separators.
//     - Group consecutive same-direction messages into "runs".
//     - Render an inbound avatar before the first bubble of an inbound run.
//     - Render one timestamp at the bottom of each run.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1e: replace bubble-rendering map with grouped-by-day + grouped-by-direction renderer',
    find: `      <div className="msg-stream" ref={scrollRef}>
        {loading && messages.length === 0 && <div className="muted">Loading…</div>}
        {messages.map((m) => {
          // v0.10.72 — Surface a friendly blurb on failed / delivery_failed
          // bubbles. The \`errors\` JSON column holds the Telnyx error
          // envelope (when present); telnyxErrorBlurb extracts the code
          // and returns a short label + detail. Renders as a small red
          // info strip below the bubble text.
          const isFailedStatus =
            m.direction === 'outbound' &&
            (m.status === 'failed' || m.status === 'delivery_failed');
          const failBlurb = isFailedStatus
            ? telnyxErrorBlurb(m.errors ?? m.status)
            : null;
          return (
            <div
              key={m.id}
              className={\`bubble \${m.direction === 'outbound' ? 'out' : 'in'}\${isFailedStatus ? ' bubble-failed' : ''}\`}
            >
              {m.body && <div className="bubble-text">{m.body}</div>}
              {m.mediaUrls?.length > 0 && (
                <div className="bubble-media">
                  {m.mediaUrls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer">
                      <img src={u} alt="attachment" />
                    </a>
                  ))}
                </div>
              )}
              {failBlurb && (
                <div
                  className="bubble-fail-blurb"
                  title={failBlurb.detail}
                >
                  <strong>{failBlurb.short}.</strong>{' '}
                  <span className="muted">{failBlurb.detail}</span>
                </div>
              )}
              <div className="bubble-meta">
                {formatRelative(m.createdAt)}
                {m.direction === 'outbound' && (
                  <span className="bubble-status"> · {m.status}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>`,
    replace: `      {/* v0.10.176 - Grouped bubble renderer.
          Walks the messages in order, emitting:
            (a) a day-separator pill whenever the calendar day changes,
            (b) a "run" wrapper that groups consecutive same-direction
                messages. Inbound runs render the sender's initials
                avatar to the left of the bubble stack. Each run shows
                ONE timestamp at the bottom (time-of-day only, since
                the day context is already in the separator above).
          Bubble DOM stays the same (.bubble.out / .bubble.in) so the
          existing CSS for body / media / fail-blurb still applies. */}
      <div className="msg-stream" ref={scrollRef}>
        {loading && messages.length === 0 && <div className="muted">Loading…</div>}
        {(() => {
          type Group =
            | { kind: 'day'; key: string; label: string }
            | { kind: 'run'; key: string; dir: 'in' | 'out'; items: MessageRecord[] };
          const groups: Group[] = [];
          let lastDayKey = '';
          let currentRun: { dir: 'in' | 'out'; items: MessageRecord[] } | null = null;
          for (const m of messages) {
            const d = new Date(m.createdAt);
            const dayKey = Number.isNaN(d.getTime()) ? 'unknown' : d.toDateString();
            if (dayKey !== lastDayKey) {
              if (currentRun) {
                groups.push({ kind: 'run', key: \`run-\${currentRun.items[0]!.id}\`, dir: currentRun.dir, items: currentRun.items });
                currentRun = null;
              }
              groups.push({ kind: 'day', key: \`day-\${dayKey}\`, label: formatDayLabel(m.createdAt) });
              lastDayKey = dayKey;
            }
            const dir: 'in' | 'out' = m.direction === 'outbound' ? 'out' : 'in';
            if (!currentRun || currentRun.dir !== dir) {
              if (currentRun) {
                groups.push({ kind: 'run', key: \`run-\${currentRun.items[0]!.id}\`, dir: currentRun.dir, items: currentRun.items });
              }
              currentRun = { dir, items: [] };
            }
            currentRun.items.push(m);
          }
          if (currentRun) {
            groups.push({ kind: 'run', key: \`run-\${currentRun.items[0]!.id}\`, dir: currentRun.dir, items: currentRun.items });
          }
          const avatarInitials = initialsFromLabel(displayName);
          return groups.map((g) => {
            if (g.kind === 'day') {
              return (
                <div key={g.key} className="msg-day-sep" role="separator">
                  <span className="msg-day-sep-pill">{g.label}</span>
                </div>
              );
            }
            const lastItem = g.items[g.items.length - 1]!;
            return (
              <div key={g.key} className={\`bubble-run \${g.dir}\`}>
                {g.dir === 'in' && (
                  <span className="bubble-run-avatar" aria-hidden="true">
                    {avatarInitials}
                  </span>
                )}
                <div className="bubble-stack">
                  {g.items.map((m) => {
                    const isFailedStatus =
                      m.direction === 'outbound' &&
                      (m.status === 'failed' || m.status === 'delivery_failed');
                    const failBlurb = isFailedStatus
                      ? telnyxErrorBlurb(m.errors ?? m.status)
                      : null;
                    return (
                      <div
                        key={m.id}
                        className={\`bubble \${m.direction === 'outbound' ? 'out' : 'in'}\${isFailedStatus ? ' bubble-failed' : ''}\`}
                      >
                        {m.body && <div className="bubble-text">{m.body}</div>}
                        {m.mediaUrls?.length > 0 && (
                          <div className="bubble-media">
                            {m.mediaUrls.map((u, i) => (
                              <a key={i} href={u} target="_blank" rel="noreferrer">
                                <img src={u} alt="attachment" />
                              </a>
                            ))}
                          </div>
                        )}
                        {failBlurb && (
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
                  </div>
                </div>
              </div>
            );
          });
        })()}
      </div>`,
  },
]);

// =====================================================================
// 2. styles.css - new CSS for the redesigned thread detail
// =====================================================================
const CSS_BLOCK = `
/* v0.10.176 - Conversation thread (detail view) redesign.
   New header with avatar + inline activity badges, dedicated "Your line"
   bar below it, day-separator pills + bubble runs with sender avatars
   in the message stream, and a restyled compose row with a round indigo
   send button. */

/* --- Header v2 ----------------------------------------------------- */
.thread-header.thread-header-v2 {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .thread-header.thread-header-v2 {
  border-bottom-color: rgba(0, 0, 0, 0.06);
  background: #fff;
}
.thread-back-btn { flex-shrink: 0; }

.thread-header-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.18);
  color: #4f46e5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  user-select: none;
}
[data-theme="light"] .thread-header-avatar {
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
}

.thread-header-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.thread-header-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.thread-header-name-v2 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.thread-header-fav-inline {
  background: transparent;
  border: none;
  padding: 2px;
  color: #f59e0b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.thread-header-fav-inline.thread-header-fav-empty {
  color: var(--text-dim);
  opacity: 0.55;
}
.thread-header-fav-inline:hover { opacity: 1; }

.thread-header-line2 {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.thread-header-sub-v2 {
  font-size: 0.85rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.thread-header-badges {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.thread-header-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.82rem;
  color: var(--text-dim);
  background: transparent;
  border: none;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.thread-header-badge.clickable {
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.thread-header-badge.clickable:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}
[data-theme="light"] .thread-header-badge.clickable:hover {
  background: rgba(99, 102, 241, 0.08);
  color: #4f46e5;
}

.thread-block-btn-v2 {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.10);
  color: var(--text-dim);
  cursor: pointer;
}
.thread-block-btn-v2:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}
[data-theme="light"] .thread-block-btn-v2 {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.10);
}
[data-theme="light"] .thread-block-btn-v2:hover {
  background: #f9fafb;
}
.thread-call-btn-v2 {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #22c55e;
  border: 1px solid #22c55e;
  color: #fff;
  cursor: pointer;
}
.thread-call-btn-v2:hover { background: #16a34a; border-color: #16a34a; }
.thread-call-btn-v2:disabled { opacity: 0.55; cursor: not-allowed; }

/* --- Your-line bar ------------------------------------------------- */
.thread-your-line-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
[data-theme="light"] .thread-your-line-bar {
  background: #f8f9fb;
  border-bottom-color: rgba(0, 0, 0, 0.05);
}
.thread-your-line-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #4f46e5;
  letter-spacing: 0.01em;
}
[data-theme="light"] .thread-your-line-label {
  color: #4f46e5;
}
/* The reused DidSwitcher inherits its own styling; the parent bar
   provides the labeled context. */
.thread-your-line-bar .did-switcher {
  flex-shrink: 0;
}

/* --- Day separator + bubble runs ----------------------------------- */
.msg-day-sep {
  display: flex;
  justify-content: center;
  margin: 16px 0 8px;
}
.msg-day-sep-pill {
  font-size: 0.78rem;
  padding: 3px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-dim);
  font-weight: 600;
  letter-spacing: 0.01em;
}
[data-theme="light"] .msg-day-sep-pill {
  background: rgba(0, 0, 0, 0.05);
  color: #6b7280;
}

.bubble-run {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 8px;
}
.bubble-run.in {
  justify-content: flex-start;
  padding-right: 60px; /* leave room on the right so inbound runs don't fill the line */
}
.bubble-run.out {
  justify-content: flex-end;
  padding-left: 60px; /* mirror for outbound */
}
.bubble-run-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.18);
  color: #4f46e5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  user-select: none;
  align-self: flex-start;
  margin-top: 4px;
}
[data-theme="light"] .bubble-run-avatar {
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
}
.bubble-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: calc(100% - 36px);
}
.bubble-run.out .bubble-stack { align-items: flex-end; }
.bubble-run.in  .bubble-stack { align-items: flex-start; }

.bubble-run-time {
  font-size: 0.74rem;
  color: var(--text-dim);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.bubble-run.out .bubble-run-time { text-align: right; }
.bubble-run.in  .bubble-run-time { text-align: left; }
.bubble-run-time .bubble-status {
  color: #dc2626;
  font-weight: 600;
}

/* --- Bubble look (override existing .bubble.out / .bubble.in) ------ */
.msg-stream .bubble {
  margin: 0;
  padding: 8px 12px;
  max-width: 100%;
  border-radius: 18px;
  word-break: break-word;
  line-height: 1.35;
}
.msg-stream .bubble.in {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  border-bottom-left-radius: 6px;
}
[data-theme="light"] .msg-stream .bubble.in {
  background: #f0f1f5;
  color: #111827;
}
.msg-stream .bubble.out {
  background: #4f46e5;
  color: #fff;
  border-bottom-right-radius: 6px;
}
[data-theme="light"] .msg-stream .bubble.out {
  background: #4f46e5;
  color: #fff;
}
.msg-stream .bubble.out .bubble-text { color: #fff; }
.msg-stream .bubble.in  .bubble-text { color: var(--text); }
[data-theme="light"] .msg-stream .bubble.in .bubble-text { color: #111827; }
.msg-stream .bubble .bubble-meta { display: none; } /* timestamps are grouped at end of run now */
.msg-stream .bubble.bubble-failed {
  background: rgba(239, 68, 68, 0.18);
  color: var(--text);
  border: 1px solid rgba(239, 68, 68, 0.32);
}
.msg-stream .bubble.bubble-failed .bubble-text {
  color: var(--text);
}
[data-theme="light"] .msg-stream .bubble.bubble-failed {
  background: #fee2e2;
  color: #7f1d1d;
  border-color: rgba(239, 68, 68, 0.35);
}
[data-theme="light"] .msg-stream .bubble.bubble-failed .bubble-text {
  color: #7f1d1d;
}

/* --- Compose row + send button restyle ----------------------------- */
.compose-row .send-btn {
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
.compose-row .send-btn svg { transform: translateX(1px); /* nudge paper plane visually */ }
`;

applyEdits('apps/web/src/styles.css', [
  {
    label: 'append v0.10.176 thread-detail-redesign styles after the v0.10.175 vm-card-pin-indicator block',
    find: `/* Saved (pinned) star indicator next to name. */
.vm-card-pin-indicator {
  flex-shrink: 0;
  color: #f59e0b;
  display: inline-flex;
  margin-left: 6px;
}`,
    replace: `/* Saved (pinned) star indicator next to name. */
.vm-card-pin-indicator {
  flex-shrink: 0;
  color: #f59e0b;
  display: inline-flex;
  margin-left: 6px;
}
` + CSS_BLOCK,
  },
]);

console.log('  CSS additions done.');

// =====================================================================
// 3. Version bumps 0.10.175 -> 0.10.176
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
  c = c.replace(/"version":\s*"0\.10\.175"/, '"version": "0.10.176"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.175 -> 0.10.176`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.175 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v176] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.175';`,
    replace: `const APP_VERSION = '0.10.176';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.176 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.175',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.176',
    date: 'June 17, 2026',
    highlight: 'Conversation thread: redesigned header with clickable activity counts.',
    changes: [
      { type: 'improved', text: 'Thread header redesigned — large initials avatar, contact name with inline favorite star, phone number subtitle, and small inline activity badges showing how many messages / calls / voicemails you have with this contact.' },
      { type: 'new', text: 'Clicking the calls badge jumps to your Recents tab filtered to this contact. Clicking the voicemails badge jumps to your Voicemail tab filtered to this contact. Back-bars return you to the thread.' },
      { type: 'improved', text: '"Your line" pill moved below the header — it is now a real switcher (the same DidSwitcher that lives in the app header), so you can change the outbound line from inside the thread.' },
      { type: 'improved', text: 'Message stream restyled: day-separator pills (Today / Yesterday / Mon / Jun 1) between days, the contact\\'s initials avatar appears before grouped inbound bubbles, one time-of-day stamp at the bottom of each grouped run instead of per-bubble.' },
      { type: 'improved', text: 'Outbound bubbles are now solid indigo with white text; inbound bubbles are a soft gray. Send button is a round indigo circle.' },
      { type: 'fixed', text: 'No backend or schema changes — the Block / Call / favorite / quick replies / emoji / templates / schedule send / paste-to-attach / Telnyx error blurbs all work exactly as before.' },
    ],
  },
  {
    version: '0.10.175',`,
  },
]);

console.log('\n[apply-v176] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.176: Thread detail redesign - header avatar + activity badges + grouped bubbles"');
console.log('  git tag v0.10.176');
console.log('  git push origin main');
console.log('  git push origin v0.10.176');
