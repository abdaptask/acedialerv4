// Text for the follow-ups panel. Pure, so the wording is testable.

import type { FollowUpItem, PanelRecent, PanelThread } from './session';

/** (732) 200-1305 for NANP; anything else as stored (already E.164). */
export function formatNumber(e164: string): string {
  const d = e164.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 ? d : null;
  return ten ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : e164;
}

/** "just now", "12 min ago", "3 hr ago", "yesterday", "4 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function detail(it: FollowUpItem, now = Date.now()): string {
  if (it.kind === 'missed_call') {
    const tries = it.count > 1 ? `Called ${it.count} times` : 'Missed call';
    const vm = it.voicemails > 0 ? ' · left a voicemail' : '';
    return `${tries}${vm} · ${ago(it.lastAt, now)}`;
  }
  if (it.kind === 'text') {
    return `${it.count === 1 ? '1 text' : `${it.count} texts`} waiting · ${ago(it.since, now)}`;
  }
  return `Voicemail · ${ago(it.since, now)}`;
}

export const GROUPS: Array<{ kind: FollowUpItem['kind']; title: string }> = [
  { kind: 'missed_call', title: 'Missed calls' },
  { kind: 'text', title: 'Texts' },
  { kind: 'voicemail', title: 'Voicemails' },
];

/** The letters in a row's circle: first and last word of a saved name, "#"
 *  for a bare number (a favorite with no name is stored under its number). */
export function initials(name: string | null): string {
  const words = (name ?? '').split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (!words.length) return '#';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function subtitle(count: number): string {
  if (count === 0) return 'Nothing waiting';
  return count === 1 ? '1 waiting on you' : `${count} waiting on you`;
}

// ── Dialer panel ─────────────────────────────────────────────────────────

/** Recents.tsx formatDuration: m:ss, minutes never rolled into hours, so the
 *  panel shows exactly what the dialer shows. */
export function callLength(seconds: number): string {
  if (!seconds) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Recents.tsx formatTime / Messages.tsx formatRelative, copied so the panel
 *  and the dialer print the same time for the same row: "3:07 PM",
 *  "Yesterday, 3:07 PM", "Oct 5, 3:07 PM". The clock is Eastern; which day it
 *  is comes from the computer's own calendar — both exactly as the dialer. */
export function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}, ${timeStr}`;
}

/** The line under a Recents name, as the dialer prints it: "Outgoing · 2:05". */
export function recentDetail(r: PanelRecent): string {
  const len = callLength(r.durationSeconds);
  return len ? `${r.label} · ${len}` : r.label;
}

/** The line under a Messages name. Never the text itself — the panel isn't
 *  sent it — only who spoke last and whether it went through. */
export function threadDetail(t: PanelThread): string {
  if (t.failed) return 'Your last text didn’t deliver';
  if (t.unread > 0) return t.unread === 1 ? '1 new text' : `${t.unread} new texts`;
  return t.lastDirection === 'inbound' ? 'They texted last' : 'You texted last';
}

/** What the keypad may hold: digits, + (leading only), and the post-dial
 *  pause/DTMF characters the dialer understands. Pasted text is filtered
 *  through the same rule, so "(732) 200-1305" becomes dialable. */
export function keypadValue(raw: string): string {
  // "ext 12" / "x12" becomes a pause then 12, not digits glued onto the number.
  const ext = raw.replace(/\s*(?:ext\.?|extension|x)\s*(?=\d)/gi, ',');
  const kept = ext.replace(/[^\d+*#,;]/g, '');
  return kept.replace(/(?!^)\+/g, '');
}

export function canDial(v: string): boolean {
  return (v.match(/\d/g) ?? []).length >= 3;
}
