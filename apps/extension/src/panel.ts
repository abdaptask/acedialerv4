// The side panel: a dialer front-end. Keypad, Recents, Messages, Contacts and
// Follow-ups — every Call / Text button only PREFILLS the desktop app or web
// dialer, through the same router as a clicked number (background.ts).
// Nothing here dials, sends, or holds calling credentials: the panel's token
// is scoped to reading these lists (apps/api lib/extensionAuth.ts), and the
// lists carry who and when, never what anyone said.

import { forgetEmail, rememberEmail, showCount } from './badge';
import {
  GROUPS,
  canDial,
  detail,
  formatNumber,
  keypadValue,
  recentDetail,
  subtitle,
  threadDetail,
  when,
} from './panelFormat';
import {
  SignInError,
  apiGet,
  clearSession,
  getSession,
  signIn,
  type FollowUpItem,
  type FollowUps,
  type PanelContact,
  type PanelRecent,
  type PanelThread,
} from './session';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const REFRESH_MS = 60_000;
const TAB_KEY = 'panelTab';

type View = 'followups' | 'recents' | 'keypad' | 'messages' | 'contacts';
const VIEWS: View[] = ['followups', 'recents', 'keypad', 'messages', 'contacts'];
const TITLES: Record<View, string> = {
  followups: 'Follow-ups',
  recents: 'Recents',
  keypad: 'Keypad',
  messages: 'Messages',
  contacts: 'Favorites',
};

const ICONS = {
  phone:
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  outgoing: 'M7 17 17 7M7 7h10v10',
  incoming: 'M17 7 7 17M17 17H7V7',
};

function icon(path: string, size = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

/** Hand a number to the dialer. The background worker trusts this only
 *  because it comes from panel.html (fromOwnPanel). */
function openInDialer(number: string, action: 'call' | 'sms'): void {
  void chrome.runtime.sendMessage({ type: 'ace-open', to: number, action });
}

function actionButton(number: string, label: string, action: 'call' | 'sms', who: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `act ${action === 'call' ? 'call' : 'text'}`;
  b.title = action === 'call' ? 'Call' : 'Text';
  b.setAttribute('aria-label', `${action === 'call' ? label : 'Text'} ${who}`);
  b.appendChild(icon(action === 'call' ? ICONS.phone : ICONS.message));
  b.addEventListener('click', () => openInDialer(number, action));
  return b;
}

interface RowSpec {
  number: string;
  name: string | null;
  detail: string;
  /** Red detail line: a missed or declined call, a text that didn't deliver. */
  warn?: boolean;
  /** The dialer's direction arrow. */
  arrow?: 'inbound' | 'outbound';
  /** Shown under the detail; defaults to the formatted number when a name is shown. */
  sub?: string;
  time?: string;
  unread?: boolean;
  /** Which button leads: reply the way they reached you. */
  lead: 'call' | 'sms';
  callLabel?: string;
}

function row(s: RowSpec): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  if (s.unread) {
    const d = document.createElement('span');
    d.className = 'dot';
    d.setAttribute('aria-label', 'Unread');
    r.append(d);
  }
  const who = document.createElement('div');
  who.className = 'who';
  const label = s.name ?? formatNumber(s.number);
  // Server values only ever go in through textContent — a saved name is user
  // input, and this page has extension privileges.
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = label;
  const d = document.createElement('div');
  d.className = s.warn ? 'detail warn' : 'detail';
  if (s.arrow) d.append(icon(s.arrow === 'outbound' ? ICONS.outgoing : ICONS.incoming, 12));
  const text = document.createElement('span');
  // Keep "4 hr ago" together when the line wraps.
  text.textContent = s.detail.replace(/(\d+) (min|hr|days) ago/, '$1 $2 ago');
  d.append(text);
  d.title = s.detail;
  who.append(name, d);
  const sub = s.sub ?? (s.name ? formatNumber(s.number) : '');
  if (sub) {
    const n = document.createElement('div');
    n.className = 'num';
    n.textContent = sub;
    who.append(n);
  }
  r.append(who);
  if (s.time) {
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = s.time;
    r.append(t);
  }
  const call = actionButton(s.number, s.callLabel ?? 'Call', 'call', label);
  const sms = actionButton(s.number, 'Text', 'sms', label);
  r.append(...(s.lead === 'sms' ? [sms, call] : [call, sms]));
  return r;
}

function group(rows: HTMLElement[]): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  g.append(...rows);
  return g;
}

function emptyState(title: string, body: string): HTMLElement {
  const s = document.createElement('section');
  s.className = 'state';
  const t = document.createElement('strong');
  t.textContent = title;
  s.append(t, body);
  return s;
}

// ── Views ───────────────────────────────────────────────────────────────

let current: View = 'keypad';

function setSub(text: string): void {
  $('sub').textContent = text;
}

function renderFollowUps(f: FollowUps): void {
  const view = $('view-followups');
  if (current === 'followups') setSub(subtitle(f.count));
  if (f.count === 0) {
    view.replaceChildren(emptyState('Nothing waiting', `Every missed call, text and voicemail from the last ${f.days} days has been answered.`));
    return;
  }
  const out: HTMLElement[] = [];
  for (const g of GROUPS) {
    // Oldest first within a group: the one who's waited longest gets answered first.
    const items = f.items.filter((i) => i.kind === g.kind).sort((a, b) => a.since.localeCompare(b.since));
    if (!items.length) continue;
    const h = document.createElement('h2');
    h.textContent = `${g.title} · ${items.length}`;
    out.push(
      h,
      group(
        items.map((it: FollowUpItem) =>
          row({
            number: it.number,
            name: it.name,
            detail: detail(it),
            lead: it.kind === 'text' ? 'sms' : 'call',
            callLabel: 'Call back',
          }),
        ),
      ),
    );
  }
  view.replaceChildren(...out);
}

function renderRecents(items: PanelRecent[]): void {
  const view = $('view-recents');
  if (!items.length) {
    view.replaceChildren(emptyState('No calls yet', 'Calls you make and receive in ACE Dialer show up here.'));
    return;
  }
  view.replaceChildren(
    group(
      items.map((r) =>
        row({
          number: r.number,
          name: r.name,
          detail: recentDetail(r),
          warn: r.red,
          arrow: r.direction,
          time: when(r.at),
          lead: 'call',
        }),
      ),
    ),
  );
}

function renderThreads(items: PanelThread[]): void {
  const view = $('view-messages');
  const unread = items.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);
  if (current === 'messages') setSub(unread ? `${unread} unread` : '');
  if (!items.length) {
    view.replaceChildren(emptyState('No texts yet', 'Text conversations from ACE Dialer show up here.'));
    return;
  }
  view.replaceChildren(
    group(
      items.map((t) =>
        row({
          number: t.number,
          name: t.name,
          detail: threadDetail(t),
          warn: t.failed,
          unread: t.unread > 0,
          time: when(t.lastAt),
          lead: 'sms',
        }),
      ),
    ),
  );
}

let contacts: PanelContact[] = [];

function renderContacts(): void {
  const list = $('contacts-list');
  const q = $<HTMLInputElement>('contact-q').value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  if (current === 'contacts') setSub(contacts.length ? `${contacts.length} saved` : '');
  if (!contacts.length) {
    list.replaceChildren(emptyState('No favorites yet', 'Star someone in ACE Dialer and they’ll appear here.'));
    return;
  }
  const rows: HTMLElement[] = [];
  for (const c of contacts) {
    const nameHit = !q || c.name.toLowerCase().includes(q);
    for (const n of c.numbers) {
      if (!nameHit && !(digits.length >= 2 && n.number.replace(/\D/g, '').includes(digits))) continue;
      rows.push(
        row({
          number: n.number,
          name: c.name,
          detail: n.label ? `${n.label} · ${formatNumber(n.number)}` : formatNumber(n.number),
          sub: '',
          lead: 'call',
        }),
      );
    }
  }
  list.replaceChildren(rows.length ? group(rows) : emptyState('No matches', 'Try part of a name, or a few digits of the number.'));
}

// ── Loading ─────────────────────────────────────────────────────────────

const PATHS: Partial<Record<View, string>> = {
  recents: '/me/panel/recents',
  messages: '/me/panel/threads',
  contacts: '/me/panel/contacts',
};
/** Views that have rendered real data at least once — a failed refresh keeps
 *  a stale list rather than swapping it for an error screen. */
const loaded = new Set<View>();

function showSignedOut(): void {
  void showCount(null);
  $('tab-count').hidden = true;
  $('foot').hidden = true;
  $('refresh').hidden = true;
  $('error').hidden = true;
  loaded.clear();
  if (current !== 'keypad') {
    $(`view-${current}`).hidden = true;
    $('signed-out').hidden = false;
    setSub('');
  }
}

/** The follow-ups list doubles as the tab badge, so it loads whatever tab is open. */
async function loadFollowUps(): Promise<void> {
  const r = await apiGet<FollowUps>('/me/follow-ups');
  if (!r.ok) {
    if (r.signedOut) showSignedOut();
    else if (current === 'followups' && !loaded.has('followups')) showError();
    return;
  }
  loaded.add('followups');
  if (current === 'followups') {
    $('error').hidden = true;
    $('view-followups').hidden = false;
  }
  void showCount(r.data.count);
  const badge = $('tab-count');
  badge.hidden = r.data.count === 0;
  badge.textContent = r.data.count > 99 ? '99+' : String(r.data.count);
  renderFollowUps(r.data);
}

function showError(): void {
  $(`view-${current}`).hidden = true;
  $('error').hidden = false;
}

let loading = false;
async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  const view = current;
  $('refresh').classList.add('spin');
  try {
    const s = await getSession();
    if (!s) {
      showSignedOut();
      return;
    }
    $('who').textContent = s.firstName || s.email;
    $('foot').hidden = view === 'keypad';
    $('refresh').hidden = view === 'keypad';
    $('signed-out').hidden = true;
    const followUps = loadFollowUps();
    const path = PATHS[view];
    if (path) {
      const r = await apiGet<{ items: unknown[] }>(path);
      if (current !== view) return; // the user moved on while this loaded
      if (!r.ok) {
        if (r.signedOut) showSignedOut();
        else if (!loaded.has(view)) showError();
        return;
      }
      loaded.add(view);
      $('error').hidden = true;
      $(`view-${view}`).hidden = false;
      if (view === 'recents') renderRecents(r.data.items as PanelRecent[]);
      else if (view === 'messages') renderThreads(r.data.items as PanelThread[]);
      else {
        contacts = r.data.items as PanelContact[];
        renderContacts();
      }
    }
    await followUps;
  } finally {
    loading = false;
    $('refresh').classList.remove('spin');
  }
}

function select(view: View): void {
  current = view;
  void chrome.storage.local.set({ [TAB_KEY]: view });
  for (const v of VIEWS) {
    $(`tab-${v}`).setAttribute('aria-selected', String(v === view));
    // A list stays hidden until its first answer, so nothing flashes empty.
    $(`view-${v}`).hidden = v !== view || (v !== 'keypad' && !loaded.has(v));
  }
  $('title').textContent = TITLES[view];
  $('error').hidden = true;
  $('signed-out').hidden = true;
  setSub('');
  if (view === 'keypad') {
    $('foot').hidden = true;
    $('refresh').hidden = true;
    $<HTMLInputElement>('entry').focus();
  }
  void load();
}

// ── Keypad ──────────────────────────────────────────────────────────────

const KEYS: Array<[string, string]> = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const entry = $<HTMLInputElement>('entry');

function syncKeypad(): void {
  const v = entry.value;
  $<HTMLButtonElement>('kp-call').disabled = !canDial(v);
  $('kp-back').hidden = v.length === 0;
  $('kp-text').hidden = !canDial(v);
  // Show the formatted form only when it adds something.
  const pretty = formatNumber(v);
  $('pretty').textContent = pretty !== v ? pretty : '';
}

function press(ch: string): void {
  entry.value = keypadValue(entry.value + ch);
  syncKeypad();
  entry.focus();
}

for (const [digit, letters] of KEYS) {
  const b = document.createElement('button');
  b.className = 'key';
  b.setAttribute('aria-label', digit === '0' ? '0, hold for +' : digit);
  const big = document.createElement('b');
  big.textContent = digit;
  const small = document.createElement('small');
  small.textContent = letters;
  b.append(big, small);
  if (digit === '0') {
    // Hold 0 for +, as on a phone keypad.
    let timer: number | undefined;
    let held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = window.setTimeout(() => {
        held = true;
        press('+');
      }, 500);
    });
    const cancel = () => window.clearTimeout(timer);
    b.addEventListener('pointerleave', cancel);
    b.addEventListener('click', () => {
      cancel();
      if (!held) press('0');
    });
  } else {
    b.addEventListener('click', () => press(digit));
  }
  $('keys').append(b);
}

entry.addEventListener('input', () => {
  const clean = keypadValue(entry.value);
  if (clean !== entry.value) entry.value = clean;
  syncKeypad();
});
entry.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && canDial(entry.value)) openInDialer(entry.value, 'call');
});
$('kp-back').addEventListener('click', () => {
  entry.value = entry.value.slice(0, -1);
  syncKeypad();
  entry.focus();
});
$('kp-call').addEventListener('click', () => openInDialer(entry.value, 'call'));
$('kp-text').addEventListener('click', () => openInDialer(entry.value, 'sms'));

// ── Chrome ──────────────────────────────────────────────────────────────

for (const v of VIEWS) $(`tab-${v}`).addEventListener('click', () => select(v));

$('contact-q').addEventListener('input', renderContacts);

$('sign-in').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('sign-in');
  const err = $('sign-in-err');
  err.textContent = '';
  btn.disabled = true;
  try {
    const s = await signIn(true);
    await rememberEmail(s.email);
    select(current);
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
  showSignedOut();
});

$('refresh').addEventListener('click', () => void load());
$('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());

setInterval(() => {
  if (document.visibilityState === 'visible') void load();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load();
});

syncKeypad();
void chrome.storage.local.get(TAB_KEY).then(({ [TAB_KEY]: saved }) => {
  select(VIEWS.includes(saved as View) ? (saved as View) : 'keypad');
});
