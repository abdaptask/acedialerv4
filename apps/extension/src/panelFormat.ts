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

export function subtitle(count: number): string {
  if (count === 0) return 'Nothing waiting';
  return count === 1 ? '1 waiting on you' : `${count} waiting on you`;
}

// ── Dialer panel ─────────────────────────────────────────────────────────

/** 0:45, 2:05, 1:02:03 — how a phone shows call length. */
export function talkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Recents-style time: "2:14 PM" today, "Yesterday", "Tuesday" this week,
 *  then "10/14/26". `timeZone` exists for tests; the panel uses the
 *  browser's own zone, which is the user's. */
export function when(iso: string, now = Date.now(), timeZone?: string): string {
  const d = new Date(iso);
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { timeZone });
  if (day(d.getTime()) === day(now)) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  }
  if (day(d.getTime()) === day(now - 86_400_000)) return 'Yesterday';
  if (now - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('en-US', { weekday: 'long', timeZone });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone });
}

const OUTCOME: Record<PanelRecent['outcome'], string> = {
  answered: '',
  missed: 'Missed',
  blocked: 'Blocked',
  forwarded: 'Forwarded',
  no_answer: 'No answer',
  failed: 'Didn’t connect',
};

/** The line under a Recents name: "Outgoing · 2:05", "Missed". */
export function recentDetail(r: PanelRecent): string {
  const label = OUTCOME[r.outcome] || (r.direction === 'inbound' ? 'Incoming' : 'Outgoing');
  return r.talkSeconds ? `${label} · ${talkTime(r.talkSeconds)}` : label;
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
