// The follow-ups side panel: what's waiting on this person, with one-click
// Call back / Text. Both buttons only PREFILL the dialer, through the same
// router as a clicked number (background.ts) — nothing here dials or sends.

import { forgetEmail, rememberEmail, showCount } from './badge';
import { GROUPS, detail, formatNumber, subtitle } from './panelFormat';
import { SignInError, apiGet, clearSession, getSession, signIn, type FollowUpItem, type FollowUps } from './session';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const REFRESH_MS = 60_000;

const ICONS = {
  phone:
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
};

function icon(path: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

function show(which: 'signed-out' | 'empty' | 'error' | 'list'): void {
  for (const id of ['signed-out', 'empty', 'error']) $(id).hidden = id !== which;
  $('list').hidden = which !== 'list';
  $('refresh').hidden = which === 'signed-out';
  $('footer').hidden = which === 'signed-out';
  if (which === 'signed-out') $('sub').textContent = ' ';
}

function actionButton(it: FollowUpItem, action: 'call' | 'sms', label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `act ${action === 'call' ? 'call' : 'text'}`;
  b.title = label;
  b.setAttribute('aria-label', `${label} ${it.name ?? formatNumber(it.number)}`);
  b.appendChild(icon(action === 'call' ? ICONS.phone : ICONS.message));
  b.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'ace-open', to: it.number, action });
  });
  return b;
}

function row(it: FollowUpItem): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  const who = document.createElement('div');
  who.className = 'who';
  const name = document.createElement('div');
  name.className = 'name';
  // Server values only ever go in through textContent — a saved name is user
  // input, and this page has extension privileges.
  name.textContent = it.name ?? formatNumber(it.number);
  const d = document.createElement('div');
  d.className = 'detail';
  // What happened and when gets its own line so it never truncates away; a
  // saved name adds the number underneath rather than in front of it.
  // Keep "4 hr ago" together when the line wraps.
  d.textContent = detail(it).replace(/(\d+) (min|hr|days) ago/, '$1\u00a0$2\u00a0ago');
  d.title = d.textContent;
  who.append(name, d);
  if (it.name) {
    const n = document.createElement('div');
    n.className = 'num';
    n.textContent = formatNumber(it.number);
    who.append(n);
  }
  r.append(who);
  // Lead with the way they reached out: reply to a text by text, return a call by calling.
  if (it.kind === 'text') r.append(actionButton(it, 'sms', 'Text'), actionButton(it, 'call', 'Call back'));
  else r.append(actionButton(it, 'call', 'Call back'), actionButton(it, 'sms', 'Text'));
  return r;
}

function render(f: FollowUps): void {
  $('sub').textContent = subtitle(f.count);
  $('days').textContent = String(f.days);
  void showCount(f.count);
  if (f.count === 0) {
    show('empty');
    return;
  }
  const list = $('list');
  list.replaceChildren();
  for (const g of GROUPS) {
    // Oldest first within a group: the one who's waited longest gets answered first.
    const items = f.items.filter((i) => i.kind === g.kind).sort((a, b) => a.since.localeCompare(b.since));
    if (!items.length) continue;
    const h = document.createElement('h2');
    h.textContent = `${g.title} · ${items.length}`;
    const group = document.createElement('div');
    group.className = 'group';
    group.append(...items.map(row));
    list.append(h, group);
  }
  show('list');
}

let loading = false;
async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  $('refresh').classList.add('spin');
  try {
    const s = await getSession();
    if (!s) {
      void showCount(null);
      show('signed-out');
      return;
    }
    $('who').textContent = s.firstName || s.email;
    const r = await apiGet<FollowUps>('/me/follow-ups');
    if (r.ok) render(r.data);
    else if (r.signedOut) {
      void showCount(null);
      show('signed-out');
    } else if ($('list').hidden) show('error'); // keep a stale list over an error screen
  } finally {
    loading = false;
    $('refresh').classList.remove('spin');
  }
}

$('sign-in').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('sign-in');
  const err = $('sign-in-err');
  err.textContent = '';
  btn.disabled = true;
  try {
    const s = await signIn(true);
    await rememberEmail(s.email);
    await load();
  } catch (e) {
    err.textContent = e instanceof SignInError ? e.message : 'Sign-in didn’t complete. Try again.';
  } finally {
    btn.disabled = false;
  }
});

$('sign-out').addEventListener('click', async () => {
  // Forget the hint too, or the next alarm would silently sign straight back in.
  await clearSession();
  await forgetEmail();
  await showCount(null);
  show('signed-out');
});

$('refresh').addEventListener('click', () => void load());
$('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());

setInterval(() => {
  if (document.visibilityState === 'visible') void load();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load();
});

void load();
