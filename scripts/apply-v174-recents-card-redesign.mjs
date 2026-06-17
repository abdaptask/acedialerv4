#!/usr/bin/env node
// v0.10.174 - Recents tab card-style redesign.
//
// SCOPE
//   * Recents.tsx fully rewritten to render a clean card-style list:
//     directional-arrow avatar (light indigo / red-pink tinted based on
//     call status), name + inline star, color-coded status label
//     (indigo for normal, red for missed/caller-canceled) + duration,
//     timestamp on the right, 3 action buttons per row (SMS / kebab /
//     green call). Block / Copy / Favorite / Play recording all live
//     inside the kebab menu now.
//   * Filter pills above the list (All / Inbound / Outgoing / Missed)
//     restyled to indigo. Existing recents-filter-chip CSS retuned.
//   * Locked behaviors preserved: row-tap copy + toast (v0.10.55),
//     contact-filter mode `?phone=&from=` with back-bar, AddFav modal
//     with 1Password-resistant honeypot, LineBadge for multi-DID
//     users (now rendered inside the kebab dropdown as a header).
//
// VERSION BUMP: 0.10.173 -> 0.10.174

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v174] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v174] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v174] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v174] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
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
    console.error(`[apply-v174] FATAL: file not found (refuse to create): ${fp}`);
    process.exit(1);
  }
  const existing = readFileSync(fp, 'utf8');
  const usesCRLF = existing.includes('\r\n');
  const out = usesCRLF ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
  writeFileSync(fp, out, 'utf8');
  console.log(`  OK ${relPath}: ${existing.length} -> ${out.length} bytes (full rewrite, ${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. CSS - retune existing recents-filter-chip color to indigo +
//    append the new card layout block.
// =====================================================================

// 1a. Retune the filter-chip active color (existing was blue #3b82f6 /
//     #2563eb; we want indigo to match the new card accent).
applyEdits('apps/web/src/styles.css', [
  {
    label: 'retune .recents-filter-chip.is-active dark mode to indigo',
    find: `.recents-filter-chip.is-active {
  background: #3b82f6;
  color: #fff;
  border-color: #3b82f6;
}`,
    replace: `.recents-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}`,
  },
  {
    label: 'retune .recents-filter-chip.is-active light mode to indigo',
    find: `[data-theme="light"] .recents-filter-chip.is-active {
  background: #2563eb;
  color: #fff;`,
    replace: `[data-theme="light"] .recents-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;`,
  },
]);

// 1b. Append the new card-layout CSS block. Anchor: the v0.10.108 chip
//     block ends with a [data-theme="light"] is-active rule; we append
//     immediately after that block (which ends at the }; line that
//     closes the border-color rule).
const CSS_BLOCK = `
/* v0.10.174 - Recents tab card-style redesign.
   Each row is a horizontal card with: directional-arrow avatar (light
   indigo for normal, light red-pink for missed/caller-canceled), bold
   name + inline favorite star, color-coded status text + duration on
   the second line, timestamp on the right, and 3 action buttons (SMS,
   kebab, green call). Block / Copy / Favorite / Play recording all
   live inside the kebab dropdown. */

.recents-card-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}
.recents-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  transition: background 0.12s ease;
  position: relative;
}
.recents-card:last-child { border-bottom: none; }
.recents-card:hover { background: rgba(255, 255, 255, 0.03); }
[data-theme="light"] .recents-card {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
[data-theme="light"] .recents-card:hover {
  background: rgba(0, 0, 0, 0.02);
}

/* Directional-arrow avatar. Indigo tint for normal calls; red-pink
   tint for missed / caller-canceled. SVG arrow rotates per direction. */
.recents-avatar-circle {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.14);
  color: #4f46e5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
[data-theme="light"] .recents-avatar-circle {
  background: rgba(99, 102, 241, 0.12);
  color: #4f46e5;
}
.recents-avatar-circle.danger {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}
[data-theme="light"] .recents-avatar-circle.danger {
  background: rgba(254, 226, 226, 0.85);
  color: #dc2626;
}

/* Card body (middle column - flex 1 so the right metadata stays
   flush on the right edge no matter the row width). */
.recents-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recents-card-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text);
}
.recents-card-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.recents-card-star-inline {
  flex-shrink: 0;
  color: #f59e0b;
  display: inline-flex;
}
.recents-card-status {
  font-size: 0.82rem;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.recents-card-status .status-text {
  font-weight: 500;
}
.recents-card-status.status-outgoing .status-text,
.recents-card-status.status-inbound .status-text,
.recents-card-status.status-forwarded .status-text {
  color: #4f46e5;
}
[data-theme="light"] .recents-card-status.status-outgoing .status-text,
[data-theme="light"] .recents-card-status.status-inbound .status-text,
[data-theme="light"] .recents-card-status.status-forwarded .status-text {
  color: #4f46e5;
}
.recents-card-status.status-missed .status-text,
.recents-card-status.status-canceled .status-text,
.recents-card-status.status-blocked .status-text,
.recents-card-status.status-failed .status-text,
.recents-card-status.status-busy .status-text {
  color: #dc2626;
}

/* Right column: timestamp + action buttons stacked. On narrow widths
   the buttons wrap below the timestamp. */
.recents-card-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.recents-card-time {
  font-size: 0.82rem;
  color: var(--text-dim);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.recents-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* The three round-square action buttons. Default = light gray with a
   subtle border; .call variant = solid green. */
.recents-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  padding: 0;
}
.recents-action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text);
}
[data-theme="light"] .recents-action-btn {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.10);
  color: #4b5563;
}
[data-theme="light"] .recents-action-btn:hover {
  background: #f9fafb;
  color: #111827;
}
.recents-action-btn.call {
  background: #22c55e;
  border-color: #22c55e;
  color: #fff;
}
.recents-action-btn.call:hover {
  background: #16a34a;
  border-color: #16a34a;
  color: #fff;
}

/* Kebab menu (popover). Anchored under the kebab button with a
   small offset. Click-outside listener in the React component
   closes it. */
.recents-card-kebab-wrap {
  position: relative;
}
.recents-card-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 200px;
  z-index: 30;
  background: var(--bg-elevated, #1f1f22);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  padding: 6px;
  display: flex;
  flex-direction: column;
}
[data-theme="light"] .recents-card-menu {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.10);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.10);
}
.recents-card-menu-header {
  padding: 6px 10px 8px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
}
[data-theme="light"] .recents-card-menu-header {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
.recents-card-menu-item {
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
.recents-card-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .recents-card-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.recents-card-menu-item.danger {
  color: #ef4444;
}
.recents-card-menu-item .menu-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

/* Inline recording playback row (when user clicks Play in kebab). */
.recents-card-recording {
  padding: 10px 16px 14px 68px; /* 16+40+12 = align with body column */
  margin-top: -10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
[data-theme="light"] .recents-card-recording {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

/* Narrow viewport: collapse the meta column under the body. */
@media (max-width: 440px) {
  .recents-card {
    flex-wrap: wrap;
  }
  .recents-card-meta {
    width: 100%;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding-left: 52px; /* indent under avatar */
  }
}
`;

applyEdits('apps/web/src/styles.css', [
  {
    label: 'append v0.10.174 card-redesign styles after the existing recents-filter-chip block',
    find: `[data-theme="light"] .recents-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: #2563eb;
}`,
    replace: `[data-theme="light"] .recents-filter-chip.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: #2563eb;
}
` + CSS_BLOCK,
  },
]);

console.log('  CSS additions + chip retune done.');

// =====================================================================
// 2. Recents.tsx - full file rewrite (cleaner than 8+ anchor edits).
//    Functional behavior preserved 1:1; only the row-render structure
//    and a new kebab dropdown change.
// =====================================================================

const RECENTS_TSX = `import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  RefreshCcw,
  Search,
  X,
  ArrowLeft,
  Star,
  Ban,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Copy,
  Play,
} from 'lucide-react';
import { getCalls, addBlockedNumber, type CallRecord } from '../api';
import { useSip } from '../contexts/SipContext';
import { useJobDivaContact, getCachedJobDivaName } from '../hooks/useJobDivaContact';
import { formatPhone, toE164 } from '../lib/phone';
import { addFavorite, isFavorite, removeFavorite, getFavoriteName } from '../lib/userPrefs';

function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return \`\${m}:\${s.toString().padStart(2, '0')}\`;
}

function formatNumber(raw: string): string {
  return formatPhone(raw) || '—';
}

function formatTime(iso: string): string {
  // v0.10.55 — Always include time-of-day so users can tell WHEN a call/SMS/VM
  // landed, not just which day. v0.10.60 — Invalid-date guard.
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

// v0.10.108 — finer-grained call classification. Backward-compat: old rows
// with status='missed' and hangupCause='originator_cancel' are treated as
// caller_canceled in the UI.
function effectiveStatus(c: CallRecord): string {
  if (
    c.direction === 'inbound' &&
    c.status === 'missed' &&
    (c.hangupCause ?? '').toLowerCase() === 'originator_cancel'
  ) {
    return 'caller_canceled';
  }
  return c.status;
}

function isMissed(c: CallRecord): boolean {
  if (c.direction !== 'inbound') return false;
  const s = effectiveStatus(c);
  return s === 'missed' || s === 'no_answer' || s === 'failed' || s === 'blocked';
}

function isCallerCanceled(c: CallRecord): boolean {
  return c.direction === 'inbound' && effectiveStatus(c) === 'caller_canceled';
}

// v0.10.174 - status class for the colored text under the name + the
// avatar tint. Maps the call record to one of a small set of strings
// that the CSS keys off (status-outgoing, status-inbound, status-missed,
// status-canceled, status-blocked, status-busy, status-failed,
// status-forwarded).
function statusClass(c: CallRecord): string {
  const s = effectiveStatus(c);
  if (s === 'blocked') return 'status-blocked';
  if (isMissed(c)) return 'status-missed';
  if (isCallerCanceled(c)) return 'status-canceled';
  if (c.direction === 'inbound' && (s === 'busy' || s === 'rejected')) return 'status-busy';
  if (c.direction === 'inbound' && s === 'forwarded') return 'status-forwarded';
  if (c.direction === 'inbound' && s === 'failed') return 'status-failed';
  if (c.direction === 'inbound') return 'status-inbound';
  return 'status-outgoing';
}

// v0.10.174 - whether the avatar should use the danger (red-pink) tint
// instead of the default indigo. Tracks the same logic as statusClass()
// but collapsed to a binary - any non-success status is danger.
function isDangerStatus(c: CallRecord): boolean {
  const sc = statusClass(c);
  return sc === 'status-missed' ||
    sc === 'status-canceled' ||
    sc === 'status-blocked' ||
    sc === 'status-busy' ||
    sc === 'status-failed';
}

function statusLabel(c: CallRecord): string {
  const s = effectiveStatus(c);
  if (s === 'blocked') return 'Blocked';
  if (c.direction === 'inbound') {
    if (s === 'rejected') return 'Declined';
    if (s === 'busy') return 'Busy';
    if (s === 'caller_canceled') return 'Caller canceled';
    if (s === 'forwarded') return 'Forwarded';
    if (s === 'missed' || s === 'no_answer') return 'Missed';
    if (s === 'failed') return 'Failed';
    return 'Inbound';
  }
  return 'Outgoing';
}

// Last-10-digit normalization for phone matching (matches the API's helper).
function last10(s: string | undefined | null): string {
  return (s ?? '').replace(/[^\\d]/g, '').slice(-10);
}

// v0.10.108 — Call-direction filter. Lets users narrow Recents to
// just inbound, outgoing, or missed calls. Persists in localStorage
// so the filter survives tab switches and app restarts.
type DirectionFilter = 'all' | 'inbound' | 'outgoing' | 'missed';

const DIRECTION_FILTER_KEY = 'ace.recents.directionFilter';

function readSavedDirectionFilter(): DirectionFilter {
  try {
    const v = localStorage.getItem(DIRECTION_FILTER_KEY);
    if (v === 'all' || v === 'inbound' || v === 'outgoing' || v === 'missed') return v;
  } catch {
    /* ignore — localStorage unavailable in some sandboxes */
  }
  return 'all';
}

export default function Recents() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // v0.10.174 - kebab menu open state. Only one kebab open at a time.
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>(readSavedDirectionFilter);

  useEffect(() => {
    try {
      localStorage.setItem(DIRECTION_FILTER_KEY, directionFilter);
    } catch {
      /* ignore */
    }
  }, [directionFilter]);

  const [addFavTarget, setAddFavTarget] = useState<
    | null
    | { phone: string; firstName: string; lastName: string }
  >(null);
  const favFirstNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addFavTarget) {
      const handle = window.setTimeout(() => {
        favFirstNameRef.current?.focus();
        favFirstNameRef.current?.select();
      }, 50);
      return () => window.clearTimeout(handle);
    }
  }, [addFavTarget?.phone]);

  const [, setFavTick] = useState(0);
  useEffect(() => {
    const refresh = () => setFavTick((t) => t + 1);
    window.addEventListener('ace:favoritesChanged', refresh);
    return () => window.removeEventListener('ace:favoritesChanged', refresh);
  }, []);

  const [blockedThisSession, setBlockedThisSession] = useState<Set<string>>(new Set());
  // v0.10.55 — Copy-on-tap toast.
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const { sipState, call } = useSip();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contactFilter = searchParams.get('phone');
  const fromUrl = searchParams.get('from');
  const contactWant = contactFilter ? last10(contactFilter) : '';

  const load = useCallback(() => {
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    setLoading(true);
    setError(null);
    getCalls(token)
      .then(setCalls)
      .catch((e) => setError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // v0.10.174 - global click-outside listener to close the kebab menu.
  useEffect(() => {
    if (menuOpenId == null) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.recents-card-kebab-wrap')) return;
      setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const filtered = useMemo(() => {
    let base = calls;
    if (contactWant) {
      base = calls.filter((c) => {
        const other = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
        return last10(other) === contactWant;
      });
    }
    if (directionFilter !== 'all') {
      base = base.filter((c) => {
        const answeredInbound = c.direction === 'inbound' && c.answeredAt != null;
        if (directionFilter === 'inbound') return answeredInbound;
        if (directionFilter === 'outgoing') return c.direction === 'outbound';
        if (directionFilter === 'missed') return c.direction === 'inbound' && !answeredInbound;
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const qDigits = q.replace(/[^\\d]/g, '');
    return base.filter((c) => {
      const number = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
      const fromDigits = (c.fromNumber || '').replace(/[^\\d]/g, '');
      const toDigits = (c.toNumber || '').replace(/[^\\d]/g, '');
      if (qDigits && (fromDigits.includes(qDigits) || toDigits.includes(qDigits))) return true;
      if (statusLabel(c).toLowerCase().includes(q)) return true;
      if ((c.hangupCause ?? '').toLowerCase().includes(q)) return true;
      const cachedName = getCachedJobDivaName(number);
      if (cachedName && cachedName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [calls, search, contactWant, directionFilter]);

  const contactLabel = contactFilter
    ? getCachedJobDivaName(contactFilter) ?? formatNumber(contactFilter)
    : '';

  function goBack() {
    if (fromUrl) {
      navigate(fromUrl);
    } else {
      navigate('/recents');
    }
  }

  function handleCallBack(c: CallRecord) {
    const target = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
    if (!target) return;
    if (sipState !== 'registered') {
      alert(\`SIP not ready (\${sipState}). Try again in a moment.\`);
      return;
    }
    call(target);
    navigate('/in-call');
  }

  function handleCopyNumber(c: CallRecord) {
    const target = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
    if (!target) return;
    const pretty = formatPhone(target) || target;
    const writePromise = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(target)
      : Promise.reject(new Error('no async clipboard'));
    writePromise
      .catch(() => {
        try {
          const ta = document.createElement('textarea');
          ta.value = target;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        } catch {
          /* swallow */
        }
      })
      .finally(() => {
        setCopiedNumber(pretty);
        window.setTimeout(() => {
          setCopiedNumber((current) => (current === pretty ? null : current));
        }, 1800);
      });
  }

  function handleSendSms(c: CallRecord) {
    const target = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
    if (!target) return;
    navigate(\`/messages?to=\${encodeURIComponent(target)}\`);
  }

  function handleToggleFavorite(c: CallRecord) {
    const target = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
    if (!target) return;
    if (isFavorite(target)) {
      removeFavorite(target);
      return;
    }
    const cached = getCachedJobDivaName(target) ?? '';
    const parts = cached.trim().split(/\\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    setAddFavTarget({
      phone: toE164(target),
      firstName,
      lastName,
    });
  }

  function saveAddFav() {
    if (!addFavTarget) return;
    addFavorite(addFavTarget.phone, {
      firstName: addFavTarget.firstName.trim() || null,
      lastName: addFavTarget.lastName.trim() || null,
    });
    setAddFavTarget(null);
  }

  async function handleBlock(c: CallRecord) {
    const target = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
    if (!target) return;
    const token = sessionStorage.getItem('ace_token');
    if (!token) return;
    const friendly = getFavoriteName(target) ?? getCachedJobDivaName(target) ?? formatNumber(target);
    if (
      // v0.10.137 - UX-013 - strict check to prevent Electron silent-confirm bug.
      window.confirm(
        \`Block \${friendly}?\\n\\nThey won't be able to call or text you. \` +
          'Unblock anytime in Settings → Blocked numbers.',
      )
    ) {
      return;
    }
    try {
      await addBlockedNumber(token, { number: target, reason: 'Blocked from Recents' });
      const key = last10(target);
      if (key) {
        setBlockedThisSession((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      }
      alert(\`\${friendly} has been blocked.\`);
    } catch (e) {
      alert(\`Could not block: \${(e as Error).message}\`);
    }
  }

  return (
    <div className="recents">
      {copiedNumber && (
        <div className="copy-toast" role="status" aria-live="polite">
          Copied {copiedNumber}
        </div>
      )}
      {contactFilter && (
        <button
          type="button"
          className="contact-filter-bar"
          onClick={goBack}
          aria-label={\`Back to \${contactLabel || 'previous page'}\`}
        >
          <ArrowLeft size={16} />
          <span className="contact-filter-text">
            <span className="contact-filter-tag">Showing calls with</span>
            <span className="contact-filter-name">{contactLabel}</span>
          </span>
          <span className="contact-filter-back">← Back</span>
        </button>
      )}
      <div className="recents-header">
        <h2>{contactFilter ? 'Calls' : 'Recents'}</h2>
        <button className="icon-btn" onClick={load} disabled={loading} aria-label="Refresh">
          <RefreshCcw size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="search-bar">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          className="search-input"
          placeholder="Search by number or status"
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

      {/* v0.10.108 — Call-direction filter chips. */}
      <div className="recents-filter-row" role="tablist" aria-label="Call direction">
        {(
          [
            { v: 'all', label: 'All' },
            { v: 'inbound', label: 'Inbound' },
            { v: 'outgoing', label: 'Outgoing' },
            { v: 'missed', label: 'Missed' },
          ] as Array<{ v: DirectionFilter; label: string }>
        ).map((opt) => {
          const active = directionFilter === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              role="tab"
              aria-selected={active}
              className={\`recents-filter-chip\${active ? ' is-active' : ''}\`}
              onClick={() => setDirectionFilter(opt.v)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {error && <div className="error" style={{ margin: '0 1rem 1rem' }}>{error}</div>}

      {!loading && calls.length === 0 && !error && (
        <div className="empty-state">
          <Clock size={40} className="empty-state-icon" />
          <h2>No recent calls</h2>
          <p>Your call history will appear here.</p>
          <button
            type="button"
            className="device-action primary"
            onClick={() => navigate('/keypad')}
          >
            Open keypad
          </button>
        </div>
      )}

      {!loading && calls.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <p>No results for &ldquo;{search}&rdquo;.</p>
        </div>
      )}

      <div className="recents-card-list" role="list">
        {filtered.map((c) => {
          const num = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
          const sessionBlocked = !!num && blockedThisSession.has(last10(num));
          return (
            <RecentCard
              key={c.id}
              c={c}
              menuOpen={menuOpenId === c.id}
              expanded={expandedId === c.id}
              blockedHere={sessionBlocked}
              onOpenMenu={() => setMenuOpenId(menuOpenId === c.id ? null : c.id)}
              onCloseMenu={() => setMenuOpenId(null)}
              onCallBack={() => handleCallBack(c)}
              onCopy={() => handleCopyNumber(c)}
              onSendSms={() => handleSendSms(c)}
              onToggleFavorite={() => handleToggleFavorite(c)}
              onBlock={() => handleBlock(c)}
              onToggleRecording={() => setExpandedId(expandedId === c.id ? null : c.id)}
            />
          );
        })}
      </div>

      {addFavTarget && (
        <div className="compose-modal" onClick={() => setAddFavTarget(null)}>
          <div
            className="fav-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="fav-modal-title"
          >
            <div className="fav-modal-header">
              <Star size={18} fill="currentColor" className="fav-modal-icon" />
              <h3 id="fav-modal-title">Add to favorites</h3>
            </div>
            <div className="fav-modal-phone">
              {formatPhone(addFavTarget.phone) || addFavTarget.phone}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); saveAddFav(); }}
              autoComplete="off"
            >
              {/* Honeypot — keeps password managers from autofilling. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                style={{ display: 'none' }}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="fav-modal-row">
                <label className="fav-modal-field">
                  <span className="fav-modal-label">First name</span>
                  <input
                    type="text"
                    className="fav-modal-input"
                    placeholder="Optional"
                    value={addFavTarget.firstName}
                    onChange={(e) =>
                      setAddFavTarget({ ...addFavTarget, firstName: e.target.value })
                    }
                    ref={favFirstNameRef}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    name="fav-first"
                  />
                </label>
                <label className="fav-modal-field">
                  <span className="fav-modal-label">Last name</span>
                  <input
                    type="text"
                    className="fav-modal-input"
                    placeholder="Optional"
                    value={addFavTarget.lastName}
                    onChange={(e) =>
                      setAddFavTarget({ ...addFavTarget, lastName: e.target.value })
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    name="fav-last"
                  />
                </label>
              </div>
              <div className="fav-modal-actions">
                <button
                  type="button"
                  className="fav-modal-cancel"
                  onClick={() => setAddFavTarget(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="fav-modal-save">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// v0.10.174 - card row. Tap-to-copy preserved (v0.10.55 lock).
function RecentCard({
  c,
  menuOpen,
  expanded,
  blockedHere,
  onOpenMenu,
  onCloseMenu,
  onCallBack,
  onCopy,
  onSendSms,
  onToggleFavorite,
  onBlock,
  onToggleRecording,
}: {
  c: CallRecord;
  menuOpen: boolean;
  expanded: boolean;
  blockedHere: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onCallBack: () => void;
  onCopy: () => void;
  onSendSms: () => void;
  onToggleFavorite: () => void;
  onBlock: () => void;
  onToggleRecording: () => void;
}) {
  const number = c.direction === 'inbound' ? c.fromNumber : c.toNumber;
  const isFav = !!number && isFavorite(number);
  // Hook call warms the JobDiva cache as rows render so the parent
  // search-by-name filter starts matching on subsequent keystrokes.
  const jd = useJobDivaContact(number);
  const displayName = getFavoriteName(number) ?? jd?.name ?? formatNumber(number);
  const sc = statusClass(c);
  const danger = isDangerStatus(c);
  // Arrow direction: outbound = up-right, inbound = down-left.
  const ArrowIcon = c.direction === 'outbound' ? ArrowUpRight : ArrowDownLeft;
  const showBlock = c.status !== 'blocked' && !blockedHere && !!number;
  const lineLabel = c.userDid?.label || c.userDid?.didNumber || null;

  return (
    <>
      <div
        className="recents-card"
        role="listitem"
        onClick={onCopy}
        title="Tap to copy number"
      >
        <div className={\`recents-avatar-circle\${danger ? ' danger' : ''}\`} aria-hidden="true">
          <ArrowIcon size={20} strokeWidth={2.25} />
        </div>
        <div className="recents-card-body">
          <div className="recents-card-name-row">
            <span className="recents-card-name">{displayName}</span>
            {isFav && (
              <span className="recents-card-star-inline" aria-label="Favorite">
                <Star size={14} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </div>
          <div className={\`recents-card-status \${sc}\`}>
            <span className="status-text">{statusLabel(c)}</span>
            {c.durationSeconds > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(c.durationSeconds)}</span>
              </>
            )}
          </div>
        </div>
        <div className="recents-card-meta">
          <span className="recents-card-time">{formatTime(c.startedAt)}</span>
          <div className="recents-card-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="recents-action-btn"
              aria-label="Send message"
              title="Send message"
              onClick={onSendSms}
            >
              <MessageSquare size={16} />
            </button>
            <div className="recents-card-kebab-wrap">
              <button
                type="button"
                className="recents-action-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="More actions"
                onClick={onOpenMenu}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className="recents-card-menu" role="menu">
                  {lineLabel && (
                    <div className="recents-card-menu-header">
                      On {lineLabel}
                    </div>
                  )}
                  <button
                    type="button"
                    className="recents-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onCopy(); }}
                  >
                    <Copy size={15} className="menu-icon" />
                    Copy number
                  </button>
                  {c.recordingUrl && (
                    <button
                      type="button"
                      className="recents-card-menu-item"
                      role="menuitem"
                      onClick={() => { onCloseMenu(); onToggleRecording(); }}
                    >
                      <Play size={15} className="menu-icon" />
                      {expanded ? 'Hide recording' : 'Play recording'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="recents-card-menu-item"
                    role="menuitem"
                    onClick={() => { onCloseMenu(); onToggleFavorite(); }}
                  >
                    <Star
                      size={15}
                      className="menu-icon"
                      fill={isFav ? 'currentColor' : 'none'}
                    />
                    {isFav ? 'Remove from favorites' : 'Add to favorites'}
                  </button>
                  {showBlock && (
                    <button
                      type="button"
                      className="recents-card-menu-item danger"
                      role="menuitem"
                      onClick={() => { onCloseMenu(); onBlock(); }}
                    >
                      <Ban size={15} className="menu-icon" />
                      Block this number
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="recents-action-btn call"
              aria-label="Call this number"
              title="Call this number"
              onClick={onCallBack}
            >
              <Phone size={16} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>
      {expanded && c.recordingUrl && (
        <div className="recents-card-recording">
          <audio controls src={c.recordingUrl} preload="none" style={{ width: '100%' }} />
        </div>
      )}
    </>
  );
}
`;

writeFile('apps/web/src/pages/Recents.tsx', RECENTS_TSX);

// =====================================================================
// 3. Version bumps 0.10.173 -> 0.10.174
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
  c = c.replace(/"version":\s*"0\.10\.173"/, '"version": "0.10.174"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.173 -> 0.10.174`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.173 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v174] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.173';`,
    replace: `const APP_VERSION = '0.10.174';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.174 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.173',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.174',
    date: 'June 17, 2026',
    highlight: 'Recents tab: redesigned as card rows with directional-arrow avatars.',
    changes: [
      { type: 'improved', text: 'Recents is now a clean card list. Each row has a directional-arrow avatar (indigo for normal calls, red-pink for missed and caller-canceled), name + inline star if favorited, color-coded status + duration, and three action buttons (Message · ⋯ · green Call) flush right.' },
      { type: 'improved', text: 'The ⋯ menu collects Copy number, Play recording (when one exists), Add/Remove favorite, and Block. The line your call touched ("On Main") shows at the top of the menu for multi-line users.' },
      { type: 'improved', text: 'Filter pills (All / Inbound / Outgoing / Missed) restyled to indigo to match the new look.' },
      { type: 'improved', text: 'Tap-to-copy preserved — single-tap on a row still copies the number to the clipboard with a brief toast.' },
    ],
  },
  {
    version: '0.10.173',`,
  },
]);

console.log('\n[apply-v174] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.174: Recents redesign - card rows + kebab menu + indigo accent"');
console.log('  git tag v0.10.174');
console.log('  git push origin main');
console.log('  git push origin v0.10.174');
