// The side panel: a dialer front-end. Keypad, Recents, Messages, Contacts and
// Follow-ups — every Call / Text button only PREFILLS the desktop app or web
// dialer, through the same router as a clicked number (background.ts).
// Nothing here dials, sends, or holds calling credentials: the panel's token
// is scoped to reading these lists and marking a follow-up Done (apps/api
// lib/extensionAuth.ts), and the lists carry who and when, never what anyone said.

import { forgetEmail, rememberEmail, showCount } from './badge';
import {
  GROUPS,
  canDial,
  detail,
  formatNumber,
  initials,
  keypadValue,
  recentDetail,
  subtitle,
  threadDetail,
  when,
} from './panelFormat';
import {
  describePhoneType,
  inferPhoneType,
  refineWithFullMetadata,
  shouldLookUp,
  type LineType,
  type LookupState,
  type PhoneTypeDisplay,
} from './phoneType';
import {
  API_BASE,
  SignInError,
  apiGet,
  apiRead,
  apiSend,
  clearSession,
  getSession,
  signIn,
  type FollowUpItem,
  type FollowUps,
  type PanelContact,
  type PanelHistory,
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
  // lucide badge-check: the dialer's mark for a carrier-verified line type.
  verified:
    'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76ZM9 12l2 2 4-4',
  alert: 'M12 8v4M12 16h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  incoming: 'M17 7 7 17M17 17H7V7',
  done: 'M20 6 9 17l-5-5',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2z',
  chevron: 'm6 9 6 6 6-6',
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

/** 640px+ is the two-pane layout (panel.html); below it a row has no detail. */
const wide = matchMedia('(min-width: 640px)');

const last10 = (n: string) => n.replace(/\D/g, '').slice(-10);

/** Who the detail pane is showing. */
interface Person {
  number: string;
  name: string | null;
}
let selected: Person | null = null;

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
  /** Follow-ups only: clears the item without calling or texting back. */
  onDone?: () => void;
}

// ── The "…" menu: where a compact row keeps its second action and Done ──

let openMenu: { row: HTMLElement; menu: HTMLElement; button: HTMLElement } | null = null;

function closeMenu(): void {
  if (!openMenu) return;
  openMenu.menu.remove();
  openMenu.row.classList.remove('menu-open');
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu = null;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.row.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

function menuItem(path: string, text: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  const t = document.createElement('span');
  t.textContent = text;
  b.append(icon(path, 18), t);
  b.addEventListener('click', () => {
    closeMenu();
    run();
  });
  return b;
}

function row(s: RowSpec): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  r.dataset.key = last10(s.number);
  if (wide.matches && selected && last10(selected.number) === r.dataset.key) r.classList.add('sel');
  const label = s.name ?? formatNumber(s.number);

  // The row's identity is one button: in the wide layout it opens the detail
  // pane; narrower, focusing it shows the row's actions.
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'open';
  if (s.unread) {
    const d = document.createElement('span');
    d.className = 'dot';
    d.setAttribute('aria-label', 'Unread');
    open.append(d);
  }
  const av = document.createElement('span');
  av.className = 'av';
  av.setAttribute('aria-hidden', 'true');
  av.textContent = initials(s.name);
  const who = document.createElement('span');
  who.className = 'who';
  // Server values only ever go in through textContent — a saved name is user
  // input, and this page has extension privileges.
  const name = document.createElement('span');
  name.className = 'name';
  name.style.display = 'block';
  name.textContent = label;
  const d = document.createElement('span');
  d.className = s.warn ? 'line warn' : 'line';
  if (s.arrow) d.append(icon(s.arrow === 'outbound' ? ICONS.outgoing : ICONS.incoming, 12));
  const text = document.createElement('span');
  // Keep "4 hr ago" together when the line wraps.
  text.textContent = s.detail.replace(/(\d+) (min|hr|days) ago/, '$1 $2 ago');
  d.append(text);
  d.title = s.detail;
  who.append(name, d);
  const sub = s.sub ?? (s.name ? formatNumber(s.number) : '');
  if (sub) {
    const n = document.createElement('span');
    n.className = 'num';
    n.style.display = 'block';
    n.textContent = sub;
    who.append(n);
  }
  open.append(av, who);
  open.addEventListener('click', () => {
    if (wide.matches) showPerson({ number: s.number, name: s.name });
  });
  r.append(open);

  if (s.time) {
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = s.time;
    r.append(t);
  }

  const acts = document.createElement('div');
  acts.className = 'acts';
  const call = actionButton(s.number, s.callLabel ?? 'Call', 'call', label);
  const sms = actionButton(s.number, 'Text', 'sms', label);
  const [first, second] = s.lead === 'sms' ? [sms, call] : [call, sms];
  // A compact row shows only the lead action; the rest move into "…".
  second.classList.add('secondary');
  acts.append(first, second);
  if (s.onDone) {
    const done = document.createElement('button');
    done.className = 'act done secondary';
    done.title = 'Done — no reply needed';
    done.setAttribute('aria-label', `Mark ${label} done`);
    done.appendChild(icon(ICONS.done));
    done.addEventListener('click', s.onDone);
    acts.append(done);
  }
  const more = document.createElement('button');
  more.className = 'act more';
  more.title = 'More';
  more.setAttribute('aria-label', `More for ${label}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.appendChild(icon(ICONS.more));
  more.addEventListener('click', () => {
    const mine = openMenu?.row === r;
    closeMenu();
    if (mine) return;
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.append(
      s.lead === 'sms'
        ? menuItem(ICONS.phone, s.callLabel ?? 'Call', () => openInDialer(s.number, 'call'))
        : menuItem(ICONS.message, 'Text', () => openInDialer(s.number, 'sms')),
    );
    if (s.onDone) menu.append(menuItem(ICONS.done, 'Done — no reply needed', s.onDone));
    for (const item of menu.children) item.setAttribute('role', 'menuitem');
    r.append(menu);
    r.classList.add('menu-open');
    more.setAttribute('aria-expanded', 'true');
    openMenu = { row: r, menu, button: more };
    (menu.firstElementChild as HTMLElement | null)?.focus();
  });
  acts.append(more);
  r.append(acts);
  return r;
}

function group(rows: HTMLElement[]): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  g.append(...rows);
  return g;
}

// Which follow-up groups are folded away; a per-browser convenience only.
const COLLAPSE_KEY = 'aceCollapsedGroups';
const collapsed = new Set<string>(readCollapsed());

function readCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function section(title: string, key: string, rows: HTMLElement[]): HTMLElement {
  const g = group([]);
  const h = document.createElement('button');
  h.type = 'button';
  h.className = 'gh';
  const t = document.createElement('span');
  t.textContent = title;
  h.append(t, icon(ICONS.chevron, 16));
  const paint = () => {
    const open = !collapsed.has(key);
    h.setAttribute('aria-expanded', String(open));
    for (const r of rows) r.hidden = !open;
  };
  h.addEventListener('click', () => {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* storage blocked: the fold just won't be remembered */
    }
    paint();
  });
  g.append(h, ...rows);
  paint();
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
    out.push(
      section(
        `${g.title} · ${items.length}`,
        g.kind,
        items.map((it: FollowUpItem) =>
          row({
            number: it.number,
            name: it.name,
            detail: detail(it),
            lead: it.kind === 'text' ? 'sms' : 'call',
            callLabel: 'Call back',
            onDone: () => void markDone(it),
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
  showFollowUps(r.data);
}

let followUps: FollowUps | null = null;

function showFollowUps(f: FollowUps): void {
  followUps = f;
  void showCount(f.count);
  const badge = $('tab-count');
  badge.hidden = f.count === 0;
  badge.textContent = f.count > 99 ? '99+' : String(f.count);
  renderFollowUps(f);
}

/** Done hides every open item for that number (a missed call and a text from
 *  the same person are one conversation), straight away; the server agrees
 *  on the next load, and anything the number does later reopens it. */
async function markDone(it: FollowUpItem): Promise<void> {
  if (!followUps) return;
  const before = followUps;
  const key = last10(it.number);
  const items = before.items.filter((i) => last10(i.number) !== key);
  showFollowUps({ ...before, items, count: items.length });
  renderPane();
  const r = await apiSend('POST', '/me/follow-ups/done', { number: it.number });
  if (!r.ok) {
    if (r.signedOut) return showSignedOut();
    showFollowUps(before);
    renderPane();
    toast('Couldn’t mark that done. Try again.');
    return;
  }
  toast(`${it.name ?? formatNumber(it.number)} marked done`, async () => {
    const u = await apiSend('DELETE', `/me/follow-ups/done?number=${encodeURIComponent(it.number)}`);
    if (!u.ok && !u.signedOut) toast('Couldn’t undo that. Try again.');
    await loadFollowUps();
    renderPane();
  });
}

// ── Detail pane (wide layout) ───────────────────────────────────────────
// Who, their line type, Call / Text / Done, and every call, text and
// voicemail with them in the last 30 days — outcomes only, never content
// (GET /me/panel/history).

let history: { key: string; data: PanelHistory | null; failed: boolean } | null = null;
let historySeq = 0;

function showPerson(p: Person): void {
  selected = p;
  markSelected();
  closeMenu();
  void loadHistory(p.number);
}

function markSelected(): void {
  const key = selected && wide.matches ? last10(selected.number) : null;
  for (const r of document.querySelectorAll<HTMLElement>('.row')) r.classList.toggle('sel', r.dataset.key === key);
}

async function loadHistory(number: string): Promise<void> {
  const key = last10(number);
  const seq = ++historySeq;
  if (history?.key !== key) history = { key, data: null, failed: false };
  renderPane();
  const r = await apiRead<PanelHistory>(`/me/panel/history?number=${encodeURIComponent(number)}`);
  if (seq !== historySeq) return;
  if (!r.ok && r.signedOut) return showSignedOut();
  history = { key, data: r.ok ? r.data : (history?.key === key ? history.data : null), failed: !r.ok };
  renderPane();
}

function pill(cls: string, path: string, text: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `pill ${cls}`;
  const t = document.createElement('span');
  t.textContent = text;
  b.append(icon(path, 17), t);
  b.addEventListener('click', run);
  return b;
}

function renderPane(): void {
  const pane = $('pane');
  if (!wide.matches) return;
  if (!selected) {
    pane.replaceChildren(emptyState('Select someone', 'Their calls, texts and voicemails with you show up here.'));
    return;
  }
  const p = selected;
  const key = last10(p.number);
  const h = history?.key === key ? history : null;
  const name = p.name ?? h?.data?.name ?? null;
  const label = name ?? formatNumber(p.number);
  const open = followUps?.items.filter((i) => last10(i.number) === key) ?? [];

  const card = document.createElement('div');
  card.className = 'dcard';
  const head = document.createElement('div');
  head.className = 'dhead';
  const av = document.createElement('span');
  av.className = 'av big';
  av.setAttribute('aria-hidden', 'true');
  av.textContent = initials(name);
  const who = document.createElement('div');
  who.style.minWidth = '0';
  const n = document.createElement('div');
  n.className = 'dname';
  n.textContent = label;
  who.append(n);
  if (name) {
    const num = document.createElement('div');
    num.className = 'dnum';
    num.textContent = formatNumber(p.number);
    who.append(num);
  }
  const type = document.createElement('div');
  type.className = 'ptype';
  who.append(type);
  head.append(av, who);
  void updateLineType(p.number, type);

  const btns = document.createElement('div');
  btns.className = 'dbtns';
  const waiting = open.some((i) => i.kind !== 'text');
  btns.append(
    pill('call', ICONS.phone, waiting ? 'Call back' : 'Call', () => openInDialer(p.number, 'call')),
    pill('text', ICONS.message, 'Text', () => openInDialer(p.number, 'sms')),
  );
  if (open.length) btns.append(pill('done', ICONS.done, 'Done', () => void markDone(open[0])));
  card.append(head, btns);

  const hist = group([]);
  hist.classList.add('hcard');
  const hh = document.createElement('div');
  hh.className = 'hhead';
  hh.textContent = `With this number · last ${h?.data?.days ?? 30} days`;
  hist.append(hh);
  if (!h?.data) {
    const note = document.createElement('div');
    note.className = 'hnote';
    note.textContent = h?.failed ? 'Couldn’t load the history. It retries when the list refreshes.' : 'Loading…';
    hist.append(note);
  } else if (!h.data.items.length) {
    const note = document.createElement('div');
    note.className = 'hnote';
    note.textContent = `Nothing with this number in the last ${h.data.days} days.`;
    hist.append(note);
  } else {
    for (const e of h.data.items) {
      const ev = document.createElement('div');
      ev.className = 'ev';
      const dot = document.createElement('span');
      dot.className = `evdot${e.red ? ' red' : e.kind === 'voicemail' ? '' : ` ${e.kind}`}`;
      dot.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      body.style.minWidth = '0';
      const what = document.createElement('div');
      what.className = 'what';
      what.textContent = e.label;
      body.append(what);
      if (e.detail) {
        const how = document.createElement('div');
        how.className = 'how';
        how.textContent = e.detail;
        body.append(how);
      }
      const t = document.createElement('span');
      t.className = 'time';
      t.textContent = when(e.at);
      ev.append(dot, body, t);
      hist.append(ev);
    }
  }
  pane.replaceChildren(card, hist);
}

wide.addEventListener('change', () => {
  markSelected();
  closeMenu();
  if (wide.matches && selected) void loadHistory(selected.number);
  else renderPane();
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(text: string, undo?: () => void): void {
  const t = $('toast');
  $('toast-text').textContent = text;
  const b = $<HTMLButtonElement>('toast-undo');
  b.hidden = !undo;
  b.onclick = undo
    ? () => {
        t.hidden = true;
        undo();
      }
    : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
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
    if (wide.matches && selected && view !== 'keypad') void loadHistory(selected.number);
    else renderPane();
  } finally {
    loading = false;
    $('refresh').classList.remove('spin');
  }
}

function select(view: View): void {
  current = view;
  $('app').dataset.view = view;
  closeMenu();
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
  void updateLineType(v);
}

// ── Line type (Mobile / Landline / VoIP …) ──
// The dialer's Dialpad badge, same rules (phoneType.ts is its copy): the
// numbering-plan inference shows at once; for US/CA numbers a carrier lookup
// (GET /phone-type, shared server cache, daily cap) upgrades it after the
// number settles. Never on the dial path: Call doesn't read any of this.

const LOOKUP_DEBOUNCE_MS = 350;
const VERIFIED_TTL_MS = 30 * 60_000;
const FAILURE_TTL_MS = 60_000;
const NOT_CONFIGURED_BACKOFF_MS = 10 * 60_000;
const typeCache = new Map<string, { state: LookupState; expiresAt: number }>();
let lookupsDisabledUntil = 0;
/** One lookup sequence per badge (the Keypad's, the detail pane's), so a
 *  slow answer for an old number never paints over a newer one. */
const typeSeqs = new WeakMap<HTMLElement, number>();

/** Not apiGet: a refused lookup (an API that predates the extension being
 *  allowed this route) must cost only the badge, never the session. */
async function fetchLineType(e164: string): Promise<LookupState> {
  const s = await getSession();
  if (!s) return { status: 'unavailable', reason: 'signed_out' };
  try {
    const res = await fetch(`${API_BASE}/phone-type?number=${encodeURIComponent(e164)}`, {
      headers: { authorization: `Bearer ${s.token}` },
    });
    if (!res.ok) return { status: 'unavailable', reason: `http_${res.status}` };
    const r = (await res.json()) as
      | { status: 'verified'; lineType: LineType; carrier: string | null; ported: boolean | null; checkedAt: string }
      | { status: 'invalid' }
      | { status: 'unavailable'; reason: string };
    if (r.status === 'verified') {
      return { status: 'verified', result: { lineType: r.lineType, carrier: r.carrier, ported: r.ported, checkedAt: r.checkedAt } };
    }
    return { status: 'unavailable', reason: r.status === 'invalid' ? 'invalid' : r.reason };
  } catch {
    return { status: 'unavailable', reason: 'network' };
  }
}

function paintLineType(d: PhoneTypeDisplay, el: HTMLElement): void {
  el.className = 'ptype';
  el.removeAttribute('title');
  if (d.state === 'hidden') {
    el.replaceChildren();
    return;
  }
  const text = document.createElement('span');
  if (d.state === 'invalid') {
    el.classList.add('invalid');
    text.textContent = d.label;
    el.replaceChildren(icon(ICONS.alert, 12), text);
    return;
  }
  const checking = d.loading && d.lineType === 'unknown';
  text.textContent = checking ? 'Checking…' : d.label;
  if (checking) text.className = 'checking';
  el.title = d.detail;
  if (d.source === 'verified') {
    el.classList.add('verified');
    el.replaceChildren(icon(ICONS.verified, 13), text);
  } else {
    el.replaceChildren(text);
  }
}

async function updateLineType(raw: string, el: HTMLElement = $('ptype')): Promise<void> {
  const seq = (typeSeqs.get(el) ?? 0) + 1;
  typeSeqs.set(el, seq);
  const stale = () => typeSeqs.get(el) !== seq;
  const base = inferPhoneType(raw);
  // International numbers the bundled metadata can't type get the full set.
  const inf = base.kind === 'inferred' && base.typeMissing ? await refineWithFullMetadata(base.e164) : base;
  if (stale()) return;
  if (!shouldLookUp(base)) {
    paintLineType(describePhoneType(inf, { status: 'idle' }), el);
    return;
  }
  const e164 = base.e164;
  if (Date.now() < lookupsDisabledUntil) {
    paintLineType(describePhoneType(inf, { status: 'unavailable', reason: 'not_configured' }), el);
    return;
  }
  const hit = typeCache.get(e164);
  if (hit && hit.expiresAt > Date.now()) {
    paintLineType(describePhoneType(inf, hit.state), el);
    return;
  }
  paintLineType(describePhoneType(inf, { status: 'loading' }), el);
  // A number that's valid for a moment mid-edit shouldn't cost a carrier dip.
  await new Promise((r) => setTimeout(r, LOOKUP_DEBOUNCE_MS));
  if (stale()) return;
  const state = await fetchLineType(e164);
  if (state.status === 'unavailable' && state.reason === 'not_configured') {
    lookupsDisabledUntil = Date.now() + NOT_CONFIGURED_BACKOFF_MS;
  }
  typeCache.set(e164, { state, expiresAt: Date.now() + (state.status === 'verified' ? VERIFIED_TTL_MS : FAILURE_TTL_MS) });
  if (!stale()) paintLineType(describePhoneType(inf, state), el);
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
