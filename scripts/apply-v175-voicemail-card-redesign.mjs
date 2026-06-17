#!/usr/bin/env node
// v0.10.175 - Voicemail tab card-style redesign + Pin (Saved) feature.
//
// SCOPE
//   * Voicemail.tsx fully rewritten as a card list: initials avatar +
//     purple unread dot + name + timestamp on the top row; large indigo
//     play button + decorative SVG waveform + duration + speed chip +
//     kebab on the bottom row. Bulk-select mode still works (checkboxes
//     replace the avatar; toolbar shows Mark read / Mark unread / Delete).
//   * Filter pills above the list: All / Unread / Saved / Auto-deleting
//     soon. "Auto-deleting soon" surfaces rows with <= 7 days remaining.
//   * Per-row 30-day countdown badge KEPT but only rendered when <= 7
//     days remain (orange/red soft pill on the right of the bottom row).
//     Reduces visual clutter on rows that are nowhere near expiry.
//   * Pin feature: kebab menu has Pin / Unpin. Pinning sets
//     Voicemail.savedAt = now() (new column). Pinned rows match the
//     "Saved" filter. Auto-delete still applies to pinned rows per
//     the agreed semantics (Pin is a tag, not a retention extender);
//     the kebab tooltip says so.
//   * Locked behaviors PRESERVED: B1 fresh-URL on expand, B2 single-
//     click-play (deps stay [expanded, audioUrl]), v0.10.103 onPlay
//     failsafe markListened, v0.10.67 unreadCountChanged dispatch,
//     auto-poll for missing transcripts, real-duration probe.
//
// SCHEMA CHANGE
//   * packages/db/prisma/schema.prisma — adds `savedAt DateTime? @map("saved_at")`
//   * Required follow-up after this script: `npm run db:push -w packages/db`
//
// NEW ENDPOINTS
//   * POST /voicemails/:id/pin   -> sets savedAt = now()
//   * POST /voicemails/:id/unpin -> sets savedAt = null
//
// VERSION BUMP: 0.10.174 -> 0.10.175

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v175] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v175] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v175] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v175] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeFile(relPath, content) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v175] FATAL: file not found (refuse to create): ${fp}`);
    process.exit(1);
  }
  const existing = readFileSync(fp, 'utf8');
  const usesCRLF = existing.includes('\r\n');
  const out = usesCRLF ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
  writeFileSync(fp, out, 'utf8');
  console.log(`  OK ${relPath}: ${existing.length} -> ${out.length} bytes (full rewrite, ${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Prisma schema - add Voicemail.savedAt column
// =====================================================================
applyEdits('packages/db/prisma/schema.prisma', [
  {
    label: 'add savedAt column to Voicemail model (pin / Saved filter, v0.10.175)',
    find: `  listenedAt      DateTime? @map("listened_at")`,
    replace: `  listenedAt      DateTime? @map("listened_at")
  /// v0.10.175 — user-pinned voicemails surface in the Saved filter.
  /// Pin sets this to now(); Unpin sets it back to null. Pinning is a
  /// tag, NOT a retention extender — the 30-day auto-delete in
  /// purgeExpired() still applies. This matches the chosen semantics.
  savedAt         DateTime? @map("saved_at")`,
  },
]);

// =====================================================================
// 2. API routes - add POST /voicemails/:id/pin + /unpin
//    Inject right before the closing `}` of voicemailsRoutes().
// =====================================================================
applyEdits('apps/api/src/voicemails/voicemails.routes.ts', [
  {
    label: 'add POST /voicemails/:id/pin and /unpin endpoints before close of voicemailsRoutes()',
    find: `  // DELETE /voicemails/:id
  app.delete('/voicemails/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.voicemail.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}`,
    replace: `  // DELETE /voicemails/:id
  app.delete('/voicemails/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.voicemail.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  // v0.10.175 — POST /voicemails/:id/pin
  // Marks a voicemail as Saved by stamping savedAt=now(). Pinned rows
  // show up under the "Saved" filter in the Voicemail tab. Pinning is
  // a tag only — the 30-day auto-delete cron still applies (per the
  // agreed UX: pin doesn't extend retention).
  app.post('/voicemails/:id/pin', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const updated = await prisma.voicemail.update({
      where: { id: existing.id },
      data: { savedAt: new Date() },
    });
    return updated;
  });

  // v0.10.175 — POST /voicemails/:id/unpin
  // Clears the Saved tag (sets savedAt back to null).
  app.post('/voicemails/:id/unpin', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params as { id: string };
    const existing = await prisma.voicemail.findFirst({
      where: { id: Number(id), userId: user.sub },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const updated = await prisma.voicemail.update({
      where: { id: existing.id },
      data: { savedAt: null },
    });
    return updated;
  });
}`,
  },
]);

// =====================================================================
// 3. apps/web/src/api.ts - add savedAt field + pin/unpin helpers
// =====================================================================
applyEdits('apps/web/src/api.ts', [
  {
    label: 'add savedAt field to VoicemailRecord interface',
    find: `export interface VoicemailRecord {
  id: number;
  fromNumber: string;
  toNumber: string;
  recordingUrl: string;
  durationSeconds: number;
  transcription: string | null;
  receivedAt: string;
  listenedAt: string | null;
  userDid?: RowUserDid | null;
}`,
    replace: `export interface VoicemailRecord {
  id: number;
  fromNumber: string;
  toNumber: string;
  recordingUrl: string;
  durationSeconds: number;
  transcription: string | null;
  receivedAt: string;
  listenedAt: string | null;
  // v0.10.175 — null when not pinned, ISO timestamp when pinned.
  // Pinning is a tag; auto-delete still applies to pinned rows.
  savedAt: string | null;
  userDid?: RowUserDid | null;
}`,
  },
  {
    label: 'add pin/unpin client helpers after deleteVoicemail()',
    find: `export async function deleteVoicemail(token: string, id: number): Promise<void> {
  await fetch(\`\${API_URL}/voicemails/\${id}\`, {
    method: 'DELETE',
    headers: { Authorization: \`Bearer \${token}\` },
  });
}`,
    replace: `export async function deleteVoicemail(token: string, id: number): Promise<void> {
  await fetch(\`\${API_URL}/voicemails/\${id}\`, {
    method: 'DELETE',
    headers: { Authorization: \`Bearer \${token}\` },
  });
}

// v0.10.175 — pin / unpin a voicemail. Pinning stamps savedAt=now() so
// the row matches the "Saved" filter. Pin does NOT extend retention —
// the 30-day auto-delete cron still runs on pinned rows.
export async function pinVoicemail(token: string, id: number): Promise<void> {
  const res = await fetch(\`\${API_URL}/voicemails/\${id}/pin\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
}

export async function unpinVoicemail(token: string, id: number): Promise<void> {
  const res = await fetch(\`\${API_URL}/voicemails/\${id}/unpin\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
}`,
  },
]);

// =====================================================================
// 4. styles.css - append voicemail card-redesign block
// =====================================================================
const CSS_BLOCK = `
/* v0.10.175 - Voicemail tab card-style redesign.
   Each row has two visual lines:
     1. avatar (initials, light indigo) + unread dot + name + timestamp
     2. big indigo play button + decorative SVG waveform + duration chip
        + speed chip + kebab
   Bulk-select replaces the avatar with a checkbox cell. */

.vm-card-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}
.vm-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  transition: background 0.12s ease;
  position: relative;
}
.vm-card:last-child { border-bottom: none; }
.vm-card:hover { background: rgba(255, 255, 255, 0.03); }
[data-theme="light"] .vm-card {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
[data-theme="light"] .vm-card:hover {
  background: rgba(0, 0, 0, 0.02);
}
.vm-card.selected {
  background: rgba(79, 70, 229, 0.06);
}
[data-theme="light"] .vm-card.selected {
  background: rgba(79, 70, 229, 0.05);
}

/* Top row: avatar + dot + name + timestamp. */
.vm-card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vm-card-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  user-select: none;
}
[data-theme="light"] .vm-card-avatar {
  background: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
}
.vm-card-checkbox {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
}
[data-theme="light"] .vm-card-checkbox {
  background: rgba(0, 0, 0, 0.04);
  color: #4b5563;
}
.vm-card-checkbox.is-checked {
  background: rgba(79, 70, 229, 0.18);
  color: #4f46e5;
}
.vm-card-unread-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6366f1;
  box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.5);
}
.vm-card-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.98rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vm-card-name.is-unread { color: var(--text); }
.vm-card-name.is-read { color: var(--text); opacity: 0.85; }
.vm-card-time {
  flex-shrink: 0;
  font-size: 0.82rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Bottom row: play + waveform + duration/speed + kebab. */
.vm-card-bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 52px; /* align under the avatar column */
}
.vm-card-play {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #4f46e5;
  border: none;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, transform 0.08s ease;
  padding: 0;
}
.vm-card-play:hover { background: #4338ca; }
.vm-card-play:active { transform: scale(0.96); }
.vm-card-play.is-playing { background: #4338ca; }

/* Decorative SVG waveform. CSS sizes the SVG. */
.vm-card-waveform {
  flex: 1;
  min-width: 60px;
  height: 28px;
  display: block;
  color: #6366f1;
  opacity: 0.85;
}
[data-theme="light"] .vm-card-waveform {
  opacity: 0.85;
}

.vm-card-bottom-meta {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.vm-card-duration {
  white-space: nowrap;
}
.vm-card-speed-chip {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  transition: background 0.12s ease;
}
.vm-card-speed-chip:hover {
  background: rgba(255, 255, 255, 0.12);
}
[data-theme="light"] .vm-card-speed-chip {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.10);
  color: #111827;
}
[data-theme="light"] .vm-card-speed-chip:hover {
  background: rgba(0, 0, 0, 0.08);
}
.vm-card-speed-chip.is-active-rate {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.30);
  color: #4f46e5;
}

/* Expiry warning soft pill - red when <=1 day, amber when 2-7. Not
   rendered when > 7 days (the "Auto-deleting soon" filter pill
   surfaces those rows; per-row clutter avoided). */
.vm-card-expires {
  font-size: 0.74rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.vm-card-expires.warn {
  background: rgba(245, 158, 11, 0.18);
  color: #b45309;
}
.vm-card-expires.danger {
  background: rgba(239, 68, 68, 0.18);
  color: #dc2626;
}

/* Kebab dropdown (mirrors the Recents one). */
.vm-card-kebab-wrap {
  position: relative;
  flex-shrink: 0;
}
.vm-card-kebab-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0;
}
.vm-card-kebab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
[data-theme="light"] .vm-card-kebab-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}
.vm-card-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 220px;
  z-index: 30;
  background: var(--bg-elevated, #1f1f22);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  padding: 6px;
  display: flex;
  flex-direction: column;
}
[data-theme="light"] .vm-card-menu {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.10);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.10);
}
.vm-card-menu-header {
  padding: 6px 10px 8px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
}
[data-theme="light"] .vm-card-menu-header {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
.vm-card-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: var(--text);
  font-family: inherit;
  font-size: 0.88rem;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
  width: 100%;
}
.vm-card-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .vm-card-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.vm-card-menu-item.danger { color: #ef4444; }
.vm-card-menu-item .menu-icon {
  flex-shrink: 0;
  opacity: 0.85;
}
.vm-card-menu-note {
  padding: 4px 10px 8px;
  font-size: 0.72rem;
  color: var(--text-dim);
  line-height: 1.4;
}

/* Filter pill row above the list - reuses Recents pill chrome. */
.vm-filter-row {
  display: flex;
  gap: 0.4rem;
  padding: 0.4rem 1rem 0.6rem;
  overflow-x: auto;
  scrollbar-width: none;
}
.vm-filter-row::-webkit-scrollbar { display: none; }
.vm-filter-chip {
  flex-shrink: 0;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-dim);
  font-size: 0.82rem;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.vm-filter-chip:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.vm-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}
[data-theme="light"] .vm-filter-chip {
  background: rgba(0, 0, 0, 0.05);
  color: #444;
  border-color: rgba(0, 0, 0, 0.08);
}
[data-theme="light"] .vm-filter-chip:hover {
  background: rgba(0, 0, 0, 0.09);
  color: #111;
}
[data-theme="light"] .vm-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}

/* Inline player + transcript when row is expanded. */
.vm-card-player {
  padding: 6px 16px 12px 68px; /* line up with bottom row */
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .vm-card-player {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
.vm-card-transcript {
  margin: 10px 0 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--text);
}
[data-theme="light"] .vm-card-transcript {
  background: rgba(0, 0, 0, 0.03);
}
.vm-card-transcript-tag {
  display: inline-block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  margin-right: 8px;
  font-weight: 600;
}

/* Saved (pinned) star indicator next to name. */
.vm-card-pin-indicator {
  flex-shrink: 0;
  color: #f59e0b;
  display: inline-flex;
  margin-left: 6px;
}

/* Narrow viewport: stack the bottom row meta below. */
@media (max-width: 440px) {
  .vm-card-bottom {
    flex-wrap: wrap;
  }
  .vm-card-waveform {
    flex-basis: 100%;
    order: 3;
  }
}
`;

// Anchor: Voicemail-related styles live alongside Messages/Recents.
// Append at a stable anchor — the last well-known voicemail-existing
// rule. We append after the global modal styles block (line ~3964
// in the current file). Use the END of styles.css as the anchor: the
// final closing `}` of the last existing rule is unsafe (file may
// grow), so use a known late-file landmark. We grep for the
// recents-card-recording closing brace which we just added in
// v0.10.174 (so this anchor was uniquely placed by the prior run).
applyEdits('apps/web/src/styles.css', [
  {
    label: 'append v0.10.175 voicemail card-redesign styles after the v0.10.174 recents-card-recording rule',
    find: `[data-theme="light"] .recents-card-recording {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}`,
    replace: `[data-theme="light"] .recents-card-recording {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
` + CSS_BLOCK,
  },
]);

// =====================================================================
// 5. Voicemail.tsx - full file rewrite
// =====================================================================
const VOICEMAIL_TSX = `// v0.10.175 — Voicemail tab redesigned as a card list. Each row has
// two lines: avatar+dot+name+timestamp on top, big play+waveform+
// duration+speed+kebab on bottom. Pin (Saved) feature via kebab menu.
// Locked behaviors preserved: B1 fresh-URL, B2 single-click-play,
// v0.10.103 onPlay failsafe, v0.10.67 unreadCountChanged dispatch.
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Phone,
  Trash2,
  RefreshCcw,
  Play,
  Pause,
  Voicemail as VoicemailIcon,
  Search,
  X,
  Circle,
  CheckCircle2,
  CheckSquare,
  Square,
  MessageSquare,
  ArrowLeft,
  MoreHorizontal,
  Bookmark,
  BookmarkX,
} from 'lucide-react';
import {
  getVoicemails,
  markVoicemailListened,
  bulkMarkVoicemails,
  deleteVoicemail,
  getVoicemailRetentionDays,
  pinVoicemail,
  unpinVoicemail,
  type VoicemailRecord,
} from '../api';
import { useSip } from '../contexts/SipContext';
import { useJobDivaContact, getCachedJobDivaName } from '../hooks/useJobDivaContact';
import { formatPhone } from '../lib/phone';
import { getFavoriteName } from '../lib/userPrefs';

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return \`\${m}:\${s.toString().padStart(2, '0')}\`;
}

function formatNumber(raw: string): string {
  return formatPhone(raw) || '—';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return \`Yesterday, \${timeStr}\`;
  return \`\${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}, \${timeStr}\`;
}

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

// v0.10.175 — decorative SVG waveform. 24 bars, varied heights, indigo
// stroke. Deterministic per-id so the same row always renders the same
// pattern (avoids re-render flicker). Pure presentation; not tied to
// the audio file. Real-audio waveforms can come later behind a flag.
function Waveform({ seed }: { seed: number }) {
  const bars = 28;
  const heights = useMemo(() => {
    const out: number[] = [];
    let v = (seed * 9301 + 49297) % 233280;
    for (let i = 0; i < bars; i++) {
      v = (v * 9301 + 49297) % 233280;
      const t = v / 233280;
      // Bias toward the middle of the row so the waveform looks like
      // speech — taller in the middle, shorter at the edges.
      const taper = 1 - Math.pow(Math.abs(i - bars / 2) / (bars / 2), 1.5);
      out.push(0.25 + 0.75 * t * taper);
    }
    return out;
  }, [seed]);
  return (
    <svg
      className="vm-card-waveform"
      viewBox={\`0 0 \${bars * 4} 28\`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {heights.map((h, i) => {
        const barH = Math.max(2, h * 26);
        const y = (28 - barH) / 2;
        return (
          <rect
            key={i}
            x={i * 4}
            y={y}
            width={2.4}
            height={barH}
            rx={1.2}
            fill="currentColor"
            opacity={0.5 + 0.5 * h}
          />
        );
      })}
    </svg>
  );
}

type VmFilter = 'all' | 'unread' | 'saved' | 'expiring';
const VM_FILTER_KEY = 'ace.voicemail.filter';
function readSavedVmFilter(): VmFilter {
  try {
    const v = localStorage.getItem(VM_FILTER_KEY);
    if (v === 'all' || v === 'unread' || v === 'saved' || v === 'expiring') return v;
  } catch { /* ignore */ }
  return 'all';
}

export default function Voicemail() {
  const [items, setItems] = useState<VoicemailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [vmFilter, setVmFilter] = useState<VmFilter>(readSavedVmFilter);
  useEffect(() => {
    try { localStorage.setItem(VM_FILTER_KEY, vmFilter); } catch { /* ignore */ }
  }, [vmFilter]);

  const [, setFavTick] = useState(0);
  useEffect(() => {
    const refresh = () => setFavTick((t) => t + 1);
    window.addEventListener('ace:favoritesChanged', refresh);
    return () => window.removeEventListener('ace:favoritesChanged', refresh);
  }, []);

  const [retentionDays, setRetentionDays] = useState(30);
  useEffect(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    getVoicemailRetentionDays(token).then(setRetentionDays).catch(() => undefined);
  }, []);

  const { sipState, call } = useSip();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactFilter = searchParams.get('phone');
  const fromUrl = searchParams.get('from');
  const contactWant = contactFilter ? (contactFilter.replace(/[^\\d]/g, '').slice(-10)) : '';

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllFiltered(ids: number[]) { setSelected(new Set(ids)); }
  function clearSelection() { setSelected(new Set()); }
  function exitSelectMode() { setSelectMode(false); setSelected(new Set()); }

  const filtered = useMemo(() => {
    let base = items;
    if (contactWant) {
      base = items.filter((vm) => (vm.fromNumber || '').replace(/[^\\d]/g, '').slice(-10) === contactWant);
    }
    if (vmFilter === 'unread') {
      base = base.filter((vm) => !vm.listenedAt);
    } else if (vmFilter === 'saved') {
      base = base.filter((vm) => !!vm.savedAt);
    } else if (vmFilter === 'expiring') {
      const cutoffMs = 7 * 24 * 60 * 60 * 1000;
      base = base.filter((vm) => {
        const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
        return expiresAt - Date.now() <= cutoffMs;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const qDigits = q.replace(/[^\\d]/g, '');
    return base.filter((vm) => {
      const digits = (vm.fromNumber || '').replace(/[^\\d]/g, '');
      if (qDigits && digits.includes(qDigits)) return true;
      if ((vm.transcription ?? '').toLowerCase().includes(q)) return true;
      const favName = getFavoriteName(vm.fromNumber);
      if (favName && favName.toLowerCase().includes(q)) return true;
      const cachedName = getCachedJobDivaName(vm.fromNumber);
      if (cachedName && cachedName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, search, contactWant, vmFilter, retentionDays]);

  // Live counts for the filter pills.
  const filterCounts = useMemo(() => {
    const expiringCutoff = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let unread = 0, saved = 0, expiring = 0;
    for (const vm of items) {
      if (!vm.listenedAt) unread++;
      if (vm.savedAt) saved++;
      const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
      if (expiresAt - now <= expiringCutoff) expiring++;
    }
    return { all: items.length, unread, saved, expiring };
  }, [items, retentionDays]);

  const contactLabel = contactFilter
    ? getFavoriteName(contactFilter)
      ?? getCachedJobDivaName(contactFilter)
      ?? formatNumber(contactFilter)
    : '';

  function goBack() {
    if (fromUrl) navigate(fromUrl); else navigate('/voicemail');
  }

  const load = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setLoading(true);
    setError(null);
    getVoicemails(token)
      .then(setItems)
      .catch((e) => setError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-poll while any voicemail is missing a transcript. Preserved
  // from the prior implementation (2s interval, 120s timeout).
  useEffect(() => {
    const missing = items.some((vm) => !vm.transcription);
    if (!missing) return;
    let cancelled = false;
    let elapsed = 0;
    const id = window.setInterval(() => {
      elapsed += 2000;
      if (elapsed > 120_000 || cancelled) {
        window.clearInterval(id);
        return;
      }
      const token = sessionStorage.getItem('ace_token');
      if (!token) return;
      getVoicemails(token).then(setItems).catch(() => undefined);
    }, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [items]);

  // Click-outside closes the kebab.
  useEffect(() => {
    if (menuOpenId == null) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.vm-card-kebab-wrap')) return;
      setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  async function handleExpand(vm: VoicemailRecord) {
    const next = expandedId === vm.id ? null : vm.id;
    setExpandedId(next);
    if (next && !vm.listenedAt) {
      const token = sessionStorage.getItem('ace_token');
      if (!token) return;
      try {
        await markVoicemailListened(token, vm.id, true);
        setItems((prev) =>
          prev.map((p) => (p.id === vm.id ? { ...p, listenedAt: new Date().toISOString() } : p)),
        );
        // v0.10.67 — Refresh badge count immediately.
        window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
      } catch { /* ignore */ }
    }
  }

  async function handleDelete(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    if (!confirm('Delete this voicemail?')) return;
    try {
      await deleteVoicemail(token, vm.id);
      setItems((prev) => prev.filter((p) => p.id !== vm.id));
    } catch { /* ignore */ }
  }

  async function handleBulkDelete() {
    const token = sessionStorage.getItem('ace_token');
    if (!token || selected.size === 0) return;
    if (!confirm(\`Delete \${selected.size} voicemail\${selected.size === 1 ? '' : 's'}?\`)) return;
    const ids = Array.from(selected);
    setItems((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    await Promise.allSettled(ids.map((id) => deleteVoicemail(token, id)));
  }

  async function handleBulkMark(listened: boolean) {
    const token = sessionStorage.getItem('ace_token');
    if (!token || selected.size === 0) return;
    const ids = Array.from(selected);
    const nowIso = listened ? new Date().toISOString() : null;
    setItems((prev) => prev.map((p) => (selected.has(p.id) ? { ...p, listenedAt: nowIso } : p)));
    setSelected(new Set());
    try {
      await bulkMarkVoicemails(token, ids, listened);
      window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
    } catch { /* ignore */ }
  }

  async function handleToggleUnread(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    const nowListened = !vm.listenedAt;
    try {
      await markVoicemailListened(token, vm.id, nowListened);
      setItems((prev) => prev.map((p) =>
        p.id === vm.id ? { ...p, listenedAt: nowListened ? new Date().toISOString() : null } : p,
      ));
      window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
    } catch { /* ignore */ }
  }

  async function handleTogglePin(vm: VoicemailRecord) {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    const wasPinned = !!vm.savedAt;
    // Optimistic UI flip first.
    setItems((prev) => prev.map((p) =>
      p.id === vm.id ? { ...p, savedAt: wasPinned ? null : new Date().toISOString() } : p,
    ));
    try {
      if (wasPinned) await unpinVoicemail(token, vm.id);
      else await pinVoicemail(token, vm.id);
    } catch {
      // Rollback on failure.
      setItems((prev) => prev.map((p) =>
        p.id === vm.id ? { ...p, savedAt: wasPinned ? new Date().toISOString() : null } : p,
      ));
    }
  }

  function handleCallBack(vm: VoicemailRecord) {
    if (!vm.fromNumber) return;
    if (sipState !== 'registered') {
      alert(\`SIP not ready (\${sipState}). Try again in a moment.\`);
      return;
    }
    call(vm.fromNumber);
    navigate('/in-call');
  }
  function handleSendSms(vm: VoicemailRecord) {
    if (!vm.fromNumber) return;
    navigate(\`/messages?to=\${encodeURIComponent(vm.fromNumber)}\`);
  }

  return (
    <div className="voicemail">
      {contactFilter && (
        <button
          type="button"
          className="contact-filter-bar"
          onClick={goBack}
          aria-label={\`Back to \${contactLabel || 'previous page'}\`}
        >
          <ArrowLeft size={16} />
          <span className="contact-filter-text">
            <span className="contact-filter-tag">Showing voicemails from</span>
            <span className="contact-filter-name">{contactLabel}</span>
          </span>
          <span className="contact-filter-back">← Back</span>
        </button>
      )}
      <div className="voicemail-header">
        <h2>{contactFilter ? 'Voicemails' : 'Voicemail'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!selectMode && items.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSelectMode(true)}
              aria-label="Select"
              title="Select multiple"
            >
              <CheckSquare size={18} />
            </button>
          )}
          {selectMode && (
            <button
              type="button"
              className="icon-btn"
              onClick={exitSelectMode}
              aria-label="Cancel selection"
              title="Cancel"
            >
              <X size={18} />
            </button>
          )}
          <button className="icon-btn" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCcw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="search-bar">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          className="search-input"
          placeholder="Search voicemails"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="search-clear"
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* v0.10.175 — Filter pills (All / Unread / Saved / Auto-deleting soon). */}
      {!selectMode && (
        <div className="vm-filter-row" role="tablist" aria-label="Voicemail filter">
          {(
            [
              { v: 'all',     label: 'All',                 count: filterCounts.all },
              { v: 'unread',  label: 'Unread',              count: filterCounts.unread },
              { v: 'saved',   label: 'Saved',               count: filterCounts.saved },
              { v: 'expiring',label: 'Auto-deleting soon',  count: filterCounts.expiring },
            ] as Array<{ v: VmFilter; label: string; count: number }>
          ).map((opt) => {
            const active = vmFilter === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                role="tab"
                aria-selected={active}
                className={\`vm-filter-chip\${active ? ' is-active' : ''}\`}
                onClick={() => setVmFilter(opt.v)}
              >
                {opt.label}
                {opt.count > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>({opt.count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="error" style={{ margin: '0 1rem 1rem' }}>{error}</div>}

      {!loading && items.length === 0 && !error && (
        <div className="empty-state">
          <VoicemailIcon size={32} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
          <p>No voicemails yet.</p>
          <p className="muted">Missed-call voicemails will appear here.</p>
        </div>
      )}

      {!loading && items.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <p>No voicemails match the current filter.</p>
        </div>
      )}

      {selectMode && (
        <div className="vm-select-bar">
          <span className="vm-select-count">{selected.size} selected</span>
          <div className="vm-select-actions">
            <button
              type="button"
              className="device-action"
              onClick={() => selectAllFiltered(filtered.map((v) => v.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="device-action"
              onClick={clearSelection}
              disabled={selected.size === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="device-action"
              onClick={() => handleBulkMark(true)}
              disabled={selected.size === 0}
              title="Mark selected as read"
            >
              <CheckCircle2 size={14} /> Mark read
            </button>
            <button
              type="button"
              className="device-action"
              onClick={() => handleBulkMark(false)}
              disabled={selected.size === 0}
              title="Mark selected as unread"
            >
              <Circle size={14} /> Mark unread
            </button>
            <button
              type="button"
              className="device-action primary danger"
              onClick={handleBulkDelete}
              disabled={selected.size === 0}
            >
              <Trash2 size={14} /> Delete ({selected.size})
            </button>
          </div>
        </div>
      )}

      <div className="vm-card-list" role="list">
        {filtered.map((vm) => (
          <VoicemailCard
            key={vm.id}
            vm={vm}
            retentionDays={retentionDays}
            expanded={expandedId === vm.id}
            menuOpen={menuOpenId === vm.id}
            selectMode={selectMode}
            checked={selected.has(vm.id)}
            onToggleSelect={() => toggleSelected(vm.id)}
            onExpand={() => handleExpand(vm)}
            onOpenMenu={() => setMenuOpenId(menuOpenId === vm.id ? null : vm.id)}
            onCloseMenu={() => setMenuOpenId(null)}
            onCallBack={() => handleCallBack(vm)}
            onSendSms={() => handleSendSms(vm)}
            onDelete={() => handleDelete(vm)}
            onToggleUnread={() => handleToggleUnread(vm)}
            onTogglePin={() => handleTogglePin(vm)}
          />
        ))}
      </div>
    </div>
  );
}

function VoicemailCard({
  vm,
  retentionDays,
  expanded,
  menuOpen,
  selectMode,
  checked,
  onToggleSelect,
  onExpand,
  onOpenMenu,
  onCloseMenu,
  onCallBack,
  onSendSms,
  onDelete,
  onToggleUnread,
  onTogglePin,
}: {
  vm: VoicemailRecord;
  retentionDays: number;
  expanded: boolean;
  menuOpen: boolean;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onExpand: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onCallBack: () => void;
  onSendSms: () => void;
  onDelete: () => void;
  onToggleUnread: () => void;
  onTogglePin: () => void;
}) {
  const jd = useJobDivaContact(vm.fromNumber);
  const label = getFavoriteName(vm.fromNumber) ?? jd?.name ?? formatNumber(vm.fromNumber);
  const unread = !vm.listenedAt;
  const pinned = !!vm.savedAt;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [actualDuration, setActualDuration] = useState<number | null>(null);
  // v0.10.163 - <audio src> backing. Defaults to vm.recordingUrl.
  // On row expand we fetch a fresh signed URL via /voicemails/:id/fresh-url.
  const [audioUrl, setAudioUrl] = useState<string>(vm.recordingUrl);
  // Local playing state for the big play/pause button glyph.
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, expanded]);

  // B1 — Fresh URL on expand. Stored Telnyx URLs lapse after 10 min.
  useEffect(() => {
    if (!expanded) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { getFreshVoicemailUrl } = await import('../api');
        const fresh = await getFreshVoicemailUrl(token, vm.id);
        if (!cancelled && fresh) setAudioUrl(fresh);
      } catch { /* keep audioUrl = vm.recordingUrl */ }
    })();
    return () => { cancelled = true; };
  }, [expanded, vm.id]);

  // B2 — Single-click-play. Dep array MUST stay [expanded, audioUrl]
  // so when the fresh URL arrives we re-fire play() with the valid src.
  useEffect(() => {
    if (!expanded || !audioRef.current) return;
    const el = audioRef.current;
    const onLoaded = () => {
      if (isFinite(el.duration) && el.duration > 0) setActualDuration(el.duration);
    };
    const onPlayEv = () => setIsPlaying(true);
    const onPauseEv = () => setIsPlaying(false);
    const onEndedEv = () => setIsPlaying(false);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('play', onPlayEv);
    el.addEventListener('pause', onPauseEv);
    el.addEventListener('ended', onEndedEv);
    el.play().catch(() => { /* autoplay may be blocked */ });
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('play', onPlayEv);
      el.removeEventListener('pause', onPauseEv);
      el.removeEventListener('ended', onEndedEv);
    };
  }, [expanded, audioUrl]);

  // Lightweight duration probe for collapsed rows.
  useEffect(() => {
    if (!vm.recordingUrl || actualDuration !== null) return;
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = vm.recordingUrl;
    const onLoaded = () => {
      if (isFinite(probe.duration) && probe.duration > 0) setActualDuration(probe.duration);
    };
    probe.addEventListener('loadedmetadata', onLoaded);
    return () => {
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.src = '';
    };
  }, [vm.recordingUrl, actualDuration]);

  const displaySeconds = actualDuration ?? vm.durationSeconds;

  // Days remaining for auto-delete countdown badge (only renders <= 7).
  const expiresAt = new Date(vm.receivedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const msLeft = expiresAt - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  let expiresEl: JSX.Element | null = null;
  if (daysLeft > 0 && daysLeft <= 7) {
    const cls = daysLeft <= 1 ? 'vm-card-expires danger' : 'vm-card-expires warn';
    const text = daysLeft === 1 ? 'Auto-deletes tomorrow' : \`Deletes in \${daysLeft}d\`;
    expiresEl = <span className={cls}>{text}</span>;
  }

  const lineLabel = vm.userDid?.label || vm.userDid?.didNumber || null;

  // Play button: in collapsed state, clicking expands + auto-plays. In
  // expanded state, clicking toggles play/pause on the audio element.
  function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded) {
      onExpand();
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }

  // Cycle speed: 1 -> 1.5 -> 2 -> 0.5 -> 1
  function cycleSpeed() {
    setPlaybackRate((r) =>
      r === 1 ? 1.5 :
      r === 1.5 ? 2 :
      r === 2 ? 0.5 : 1,
    );
  }

  return (
    <>
      <div
        className={\`vm-card\${checked ? ' selected' : ''}\`}
        role="listitem"
        onClick={selectMode ? onToggleSelect : undefined}
      >
        {/* Top row */}
        <div className="vm-card-top">
          {selectMode ? (
            <span
              className={\`vm-card-checkbox\${checked ? ' is-checked' : ''}\`}
              aria-hidden="true"
            >
              {checked ? <CheckSquare size={18} /> : <Square size={18} />}
            </span>
          ) : (
            <span className="vm-card-avatar" aria-hidden="true">
              {initialsFromLabel(label)}
            </span>
          )}
          {!selectMode && unread && (
            <span className="vm-card-unread-dot" aria-label="Unread" />
          )}
          <span className={\`vm-card-name \${unread ? 'is-unread' : 'is-read'}\`}>
            {label}
            {pinned && (
              <span className="vm-card-pin-indicator" aria-label="Saved">
                <Bookmark size={13} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
          <span className="vm-card-time">{formatTime(vm.receivedAt)}</span>
        </div>

        {/* Bottom row - hidden in select mode for less visual noise */}
        {!selectMode && (
          <div className="vm-card-bottom" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={\`vm-card-play\${isPlaying ? ' is-playing' : ''}\`}
              aria-label={isPlaying ? 'Pause voicemail' : 'Play voicemail'}
              title={isPlaying ? 'Pause' : 'Play'}
              onClick={handlePlayClick}
            >
              {isPlaying
                ? <Pause size={18} fill="currentColor" strokeWidth={0} />
                : <Play size={18} fill="currentColor" strokeWidth={0} />}
            </button>
            <Waveform seed={vm.id} />
            <div className="vm-card-bottom-meta">
              <span className="vm-card-duration">
                {formatDuration(Math.round(displaySeconds || 0))}
              </span>
              <button
                type="button"
                className={\`vm-card-speed-chip\${playbackRate !== 1 ? ' is-active-rate' : ''}\`}
                onClick={cycleSpeed}
                title="Click to cycle playback speed"
                aria-label={\`Playback speed \${playbackRate}x. Click to cycle.\`}
              >
                {playbackRate}×
              </button>
              {expiresEl}
            </div>
            <div className="vm-card-kebab-wrap">
              <button
                type="button"
                className="vm-card-kebab-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="More actions"
                onClick={onOpenMenu}
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="vm-card-menu" role="menu">
                  {lineLabel && (
                    <div className="vm-card-menu-header">On {lineLabel}</div>
                  )}
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onTogglePin(); }}
                  >
                    {pinned
                      ? <BookmarkX size={15} className="menu-icon" />
                      : <Bookmark size={15} className="menu-icon" />}
                    {pinned ? 'Unpin' : 'Pin (Saved)'}
                  </button>
                  {!pinned && (
                    <div className="vm-card-menu-note">
                      Pinning tags this voicemail so you can find it in the Saved filter.
                      It still auto-deletes after {retentionDays} days.
                    </div>
                  )}
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onToggleUnread(); }}
                  >
                    {unread
                      ? <CheckCircle2 size={15} className="menu-icon" />
                      : <Circle size={15} className="menu-icon" />}
                    {unread ? 'Mark as read' : 'Mark as unread'}
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onCallBack(); }}
                  >
                    <Phone size={15} className="menu-icon" />
                    Call back
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onSendSms(); }}
                  >
                    <MessageSquare size={15} className="menu-icon" />
                    Send message
                  </button>
                  <button
                    type="button"
                    className="vm-card-menu-item danger"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onDelete(); }}
                  >
                    <Trash2 size={15} className="menu-icon" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {expanded && !selectMode && (
        <div className="vm-card-player">
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            preload="metadata"
            style={{ width: '100%' }}
            onPlay={async () => {
              // v0.10.103 - Failsafe: mark as listened on actual play.
              if (vm.listenedAt) return;
              const token = sessionStorage.getItem('ace_token');
              if (!token) return;
              try {
                const { markVoicemailListened } = await import('../api');
                await markVoicemailListened(token, vm.id, true);
                window.dispatchEvent(new CustomEvent('ace:unreadCountChanged'));
                window.dispatchEvent(new CustomEvent('ace:voicemailMarkedListened', { detail: { id: vm.id } }));
              } catch { /* silent */ }
            }}
          />
          {vm.transcription ? (
            <p className="vm-card-transcript">
              <span className="vm-card-transcript-tag">Transcript</span>
              {vm.transcription}
            </p>
          ) : (
            <p className="vm-card-transcript">
              <span className="vm-card-transcript-tag">Transcript</span>
              <em style={{ opacity: 0.7 }}>Transcribing…</em>
            </p>
          )}
        </div>
      )}
    </>
  );
}
`;

writeFile('apps/web/src/pages/Voicemail.tsx', VOICEMAIL_TSX);

// =====================================================================
// 6. Version bumps 0.10.174 -> 0.10.175
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
  c = c.replace(/"version":\s*"0\.10\.174"/, '"version": "0.10.175"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.174 -> 0.10.175`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.174 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v175] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.174';`,
    replace: `const APP_VERSION = '0.10.175';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.175 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.174',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.175',
    date: 'June 17, 2026',
    highlight: 'Voicemail tab: redesigned as cards + new Saved (Pin) feature.',
    changes: [
      { type: 'improved', text: 'Voicemail rows are now two-line cards: avatar (initials in light indigo) + unread dot + name + timestamp on top; large indigo play button + waveform + duration + speed chip + ⋯ on the bottom.' },
      { type: 'new', text: 'Filter pills above the list: All / Unread / Saved / Auto-deleting soon. Each shows a live count.' },
      { type: 'new', text: 'Pin (Saved) — the ⋯ menu has a Pin action that tags a voicemail so you can find it later under the Saved filter. Pinning does NOT extend retention; the 30-day auto-delete still applies (the menu spells this out under the Pin action).' },
      { type: 'improved', text: 'Per-row auto-delete countdown is now a small soft pill that only appears when 7 days or less remain (amber 2-7, red ≤1). Less visual clutter on rows that are nowhere near expiry.' },
      { type: 'improved', text: 'Playback-speed selector is now a single chip next to the duration that cycles 1× → 1.5× → 2× → 0.5× → 1× on click.' },
      { type: 'improved', text: 'Bulk-select mode still works (checkboxes replace the avatar; toolbar has Mark read / Mark unread / Delete).' },
      { type: 'fixed', text: 'Locked behaviors preserved: single-click-play (B2), fresh-URL on expand for older voicemails (B1), real audio duration probe, mark-as-listened on actual play.' },
    ],
  },
  {
    version: '0.10.174',`,
  },
]);

console.log('\n[apply-v175] DONE');
console.log('');
console.log('NEXT STEPS (CRITICAL - schema change requires db push):');
console.log('');
console.log('  # 1. Generate the Prisma client locally so TS sees the new field');
console.log('  npm run db:generate');
console.log('');
console.log('  # 2. Push the schema change to your Supabase Postgres');
console.log('  npm run db:push -w packages/db');
console.log('');
console.log('  # 3. Compile-check');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('');
console.log('  # 4. Diff + commit + tag + push');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.175: Voicemail redesign - card rows + Pin/Saved feature + db migration"');
console.log('  git tag v0.10.175');
console.log('  git push origin main');
console.log('  git push origin v0.10.175');
console.log('');
console.log('  # 5. On Render API service: redeploy will run Prisma generate again');
console.log('  #    (the db push above already applied to prod Postgres).');
