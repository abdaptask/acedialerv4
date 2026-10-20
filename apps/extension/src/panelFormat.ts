// Text for the follow-ups panel. Pure, so the wording is testable.

import type { FollowUpItem } from './session';

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
