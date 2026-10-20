// The toolbar count of follow-ups still waiting. It's the nudge that works
// whether or not the panel is open, so it's refreshed on a 2-minute alarm
// (MV3 workers can't hold timers) and whenever the panel loads data.

import { apiGet, getSession, signIn } from './session';

export const BADGE_ALARM = 'ace-follow-ups';
const LAST_EMAIL = 'aceLastEmail';
const LAST_SILENT = 'aceLastSilentSignIn';
const SILENT_EVERY_MS = 30 * 60_000;

export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export async function showCount(count: number | null): Promise<void> {
  // Same red as the app's tab badges (styles.css) — an unread count, not an alarm.
  await chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
  await chrome.action.setBadgeText({ text: count === null ? '' : badgeText(count) });
  await chrome.action.setTitle({
    title: count === null
      ? 'ACE Dialer — sign in to see follow-ups'
      : count === 0
        ? 'ACE Dialer — nothing waiting'
        : `ACE Dialer — ${count} waiting on you`,
  });
}

/** Remembered so a silent sign-in renews THIS person's session. Without a
 *  hint, prompt=none would take whichever Microsoft account the browser has —
 *  on a shared machine, possibly someone else. */
export async function rememberEmail(email: string): Promise<void> {
  if (email) await chrome.storage.local.set({ [LAST_EMAIL]: email });
}

export async function forgetEmail(): Promise<void> {
  await chrome.storage.local.remove(LAST_EMAIL);
}

async function trySilentSignIn(): Promise<boolean> {
  const { [LAST_EMAIL]: email, [LAST_SILENT]: last } = await chrome.storage.local.get([LAST_EMAIL, LAST_SILENT]);
  if (typeof email !== 'string' || !email) return false;
  if (typeof last === 'number' && Date.now() - last < SILENT_EVERY_MS) return false;
  await chrome.storage.local.set({ [LAST_SILENT]: Date.now() });
  try {
    await signIn(false, email);
    return true;
  } catch {
    return false; // needs the user — the panel shows "Sign in"
  }
}

export async function refreshBadge(): Promise<void> {
  if (!(await getSession()) && !(await trySilentSignIn())) {
    await showCount(null);
    return;
  }
  const r = await apiGet<{ count: number }>('/me/follow-ups/count');
  if (r.ok) await showCount(r.data.count);
  else if (r.signedOut) await showCount(null);
  // A network blip leaves the last count up rather than flashing it away.
}
