// Daily performance email — composed, previewed and sent from the Reports
// page (admin only), optionally on a weekday schedule.
//
// Everyone gets the same team picture plus a private section: their own
// numbers against the team average and what's waiting on them. Recognition
// is top-three only, by name; nobody is ever listed at the bottom. A person's
// follow-up list goes to that person alone.
//
// Numbers come from computeReport() — the same function behind the Reports
// page — so the email can never disagree with what people see there.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { sendEmail } from '../email/sendgrid.js';
import { recordAudit } from '../lib/audit.js';
import { computeReport } from './reports.routes.js';
import { computeFollowUps } from './lookup.js';
import { addDays, dowOfDateKey, etDateKey, etParts, isDateKey } from './etTime.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

const SETTING_KEY = 'daily_digest';
const RECENT_DAYS = 28;
const APP_URL = (process.env.WEB_PUBLIC_URL ?? 'https://dialer.aptask.com').replace(/\/$/, '');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Report = Awaited<ReturnType<typeof computeReport>>;
type FollowUps = Awaited<ReturnType<typeof computeFollowUps>>;

export interface Schedule {
  enabled: boolean;
  /** Eastern hour to send (0–23). */
  hour: number;
  lastSentDate: string | null;
}

// ── Dates ───────────────────────────────────────────────────────────────

/** The working day before `today`: Monday looks back to Friday. */
export function previousBusinessDay(today: string): string {
  let d = addDays(today, -1);
  while (dowOfDateKey(d) > 5) d = addDays(d, -1);
  return d;
}

function nextBusinessDay(day: string): string {
  let d = addDays(day, 1);
  while (dowOfDateKey(d) > 5) d = addDays(d, 1);
  return d;
}

function longDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${DAY_NAMES[dowOfDateKey(key) - 1]}, ${MONTHS[m - 1]} ${d}`;
}

// ── Formatting ──────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
function talk(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function wait(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} hrs`;
}
function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function fmtPhone(n: string): string {
  const d = n.replace(/\D/g, '');
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : n;
}
function change(cur: number, prev: number): { text: string; good: boolean | null } {
  if (!prev) return { text: '', good: null };
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return { text: 'same as last week', good: null };
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs last week`, good: d > 0 };
}

// ── Compose ─────────────────────────────────────────────────────────────

export interface Digest {
  date: string;
  report: Report;
  lastWeek: Report;
  recent: Report;
  followUps: FollowUps;
  recipients: Array<{ id: number; name: string; email: string }>;
}

export async function buildDigest(date: string): Promise<Digest> {
  const [report, lastWeek, recent, followUps] = await Promise.all([
    computeReport({ from: date, to: date, scopeUserId: null, isAdmin: true }),
    computeReport({ from: addDays(date, -7), to: addDays(date, -7), scopeUserId: null, isAdmin: true }),
    computeReport({ from: addDays(date, -(RECENT_DAYS - 1)), to: date, scopeUserId: null, isAdmin: true }),
    computeFollowUps(null),
  ]);
  // "Users of the system": active accounts that called or texted in the
  // last four weeks. Dormant accounts don't get a daily email about work
  // they aren't doing.
  const users = await prisma.user.findMany({
    where: { isActive: true, email: { not: { endsWith: '@deleted.ace.local' } } },
    select: { id: true, email: true },
  });
  const active = new Set(recent.people.filter((p) => p.callsOut + p.callsIn + p.smsSent > 0).map((p) => p.userId));
  const nameOf = new Map(recent.users.map((u) => [u.id, u.name]));
  const recipients = users
    .filter((u) => active.has(u.id) && u.email.includes('@'))
    .map((u) => ({ id: u.id, email: u.email, name: nameOf.get(u.id) ?? u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { date, report, lastWeek, recent, followUps, recipients };
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export function renderDigest(d: Digest, recipient: { id: number; name: string } | null, sender: string): Rendered {
  const t = d.report.totals;
  const w = d.lastWeek.totals;
  const people = d.report.people;
  const dayWorked = t.callsOut + t.callsIn > 0;

  // Team tiles.
  const tiles: Array<{ label: string; value: string; cur: number; prev: number }> = [
    { label: 'Calls made', value: int(t.callsOut), cur: t.callsOut, prev: w.callsOut },
    { label: 'Different people called', value: int(t.uniqueDialled), cur: t.uniqueDialled, prev: w.uniqueDialled },
    { label: 'Conversations over 2 min', value: int(t.conversations), cur: t.conversations, prev: w.conversations },
    { label: 'Talk time', value: talk(t.talkSec), cur: t.talkSec, prev: w.talkSec },
  ];
  const resp = [
    { label: 'Calls answered', value: pct(t.answeredIn, t.answeredIn + t.unansweredIn), note: `${int(t.answeredIn)} of ${int(t.answeredIn + t.unansweredIn)} inbound` },
    { label: 'Missed calls returned', value: pct(t.missedReturned, t.missedReturnable), note: `median ${wait(t.medianCallbackSec)} to call back` },
    { label: 'Texts replied to', value: pct(t.smsReplied, t.smsRepliable), note: `median ${wait(t.medianReplySec)}` },
  ];

  // Shout-outs: top three, only positive measures, only people above zero.
  const top = <T,>(rows: T[], val: (r: T) => number | null, n = 3) =>
    rows.map((r) => ({ r, v: val(r) })).filter((x): x is { r: T; v: number } => x.v != null && x.v > 0).sort((a, b) => b.v - a.v).slice(0, n);
  const shout = [
    { title: 'Most conversations over 2 minutes', rows: top(people, (p) => p.conversations).map((x) => [x.r.name, int(x.v)] as const) },
    { title: 'Most different people called', rows: top(people, (p) => p.uniqueDialled).map((x) => [x.r.name, int(x.v)] as const) },
    { title: 'Fastest to return missed calls', rows: top(people.filter((p) => p.missedReturned >= 3), (p) => (p.medianCallbackSec == null ? null : 1 / (1 + p.medianCallbackSec))).map((x) => [x.r.name, wait(x.r.medianCallbackSec)] as const) },
  ].filter((s) => s.rows.length > 0);

  // Personal section.
  const me = recipient ? people.find((p) => p.userId === recipient.id) : undefined;
  const callers = people.filter((p) => p.callsOut > 0);
  const avg = (f: (p: (typeof people)[number]) => number) => (callers.length ? callers.reduce((a, p) => a + f(p), 0) / callers.length : 0);
  const mine = me ? [
    { label: 'Calls made', you: int(me.callsOut), team: int(avg((p) => p.callsOut)) },
    { label: 'Different people called', you: int(me.uniqueDialled), team: int(avg((p) => p.uniqueDialled)) },
    { label: 'Conversations over 2 min', you: int(me.conversations), team: int(avg((p) => p.conversations)) },
    { label: 'Talk time', you: talk(me.talkSec), team: talk(avg((p) => p.talkSec)) },
  ] : [];
  const fu = recipient ? d.followUps.items.filter((i) => i.userId === recipient.id) : [];
  const fuCounts = {
    missed: fu.filter((i) => i.kind === 'missed_call').length,
    texts: fu.filter((i) => i.kind === 'text').length,
    vms: fu.filter((i) => i.kind === 'voicemail').length,
  };

  // Tip: the best hour to call on the next working day, from four weeks of calls.
  const next = nextBusinessDay(d.date);
  const row = d.recent.insights.bestTime[dowOfDateKey(next) - 1];
  let tip: string | null = null;
  const cells = row
    .map((c, h) => ({ h, n: c.attempts, r: c.attempts >= d.recent.insights.bestTimeMinAttempts ? c.reached / c.attempts : null }))
    .filter((c): c is { h: number; n: number; r: number } => c.r != null && c.h >= 8 && c.h <= 19);
  if (cells.length >= 3) {
    const best = [...cells].sort((a, b) => b.r - a.r)[0];
    const worst = [...cells].sort((a, b) => a.r - b.r)[0];
    tip = `Over the last four ${DAY_NAMES[dowOfDateKey(next) - 1]}s, calls between ${hourLabel(best.h)} and ${hourLabel(best.h + 1)} Eastern reached someone ${Math.round(best.r * 100)}% of the time, against ${Math.round(worst.r * 100)}% between ${hourLabel(worst.h)} and ${hourLabel(worst.h + 1)}.`;
  }

  const subject = dayWorked
    ? `ACE daily · ${longDate(d.date)}: ${int(t.callsOut)} calls, ${int(t.conversations)} real conversations`
    : `ACE daily · ${longDate(d.date)}`;

  // ── HTML (table layout + inline styles: email clients ignore <style>) ──
  const C = { ink: '#1c1c1e', dim: '#545458', muted: '#8e8e93', line: '#e5e5ea', bg: '#f2f2f7', card: '#ffffff', accent: '#0a7aff', good: '#1f8a47', bad: '#c9342a' };
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const section = (title: string, inner: string) => `
    <tr><td style="padding:24px 28px 0">
      <div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:0 0 10px">${esc(title)}</div>
      ${inner}
    </td></tr>`;
  const tileHtml = tiles.map((x) => {
    const ch = change(x.cur, x.prev);
    return `<td width="25%" valign="top" style="padding:12px 10px 12px 0">
      <div style="font-size:12px;color:${C.dim}">${esc(x.label)}</div>
      <div style="font-size:24px;font-weight:700;color:${C.ink};margin-top:2px">${esc(x.value)}</div>
      ${ch.text ? `<div style="font-size:11px;color:${ch.good == null ? C.muted : ch.good ? C.good : C.bad};margin-top:2px">${esc(ch.text)}</div>` : ''}
    </td>`;
  }).join('');
  const respHtml = resp.map((x) => `<td width="33%" valign="top" style="padding:10px 10px 4px 0">
      <div style="font-size:12px;color:${C.dim}">${esc(x.label)}</div>
      <div style="font-size:20px;font-weight:700;color:${C.ink}">${esc(x.value)}</div>
      <div style="font-size:11px;color:${C.muted}">${esc(x.note)}</div>
    </td>`).join('');
  const shoutHtml = shout.map((s) => `
      <div style="font-size:13px;font-weight:600;color:${C.ink};margin:12px 0 4px">${esc(s.title)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${s.rows.map(([n, v], i) => `<tr><td style="padding:5px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.ink}">${i + 1}. ${esc(n)}</td><td align="right" style="padding:5px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.dim}">${esc(v)}</td></tr>`).join('')}
      </table>`).join('');
  const mineHtml = me ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr><td style="font-size:11px;color:${C.muted};padding-bottom:4px"></td><td align="right" style="font-size:11px;color:${C.muted};padding-bottom:4px">You</td><td align="right" style="font-size:11px;color:${C.muted};padding-bottom:4px">Team average</td></tr>
        ${mine.map((m) => `<tr><td style="padding:6px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.ink}">${esc(m.label)}</td><td align="right" style="padding:6px 0;border-top:1px solid ${C.line};font-size:14px;font-weight:600;color:${C.ink}">${esc(m.you)}</td><td align="right" style="padding:6px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.dim}">${esc(m.team)}</td></tr>`).join('')}
      </table>` : `<div style="font-size:13px;color:${C.dim}">No calls from you on ${esc(longDate(d.date))}.</div>`;
  const fuHtml = fu.length === 0
    ? `<div style="font-size:13px;color:${C.good};margin-top:14px">Nothing waiting on you. Nice work.</div>`
    : `<div style="font-size:13px;color:${C.ink};margin-top:14px"><b>Waiting on you:</b> ${[
        fuCounts.missed ? `${fuCounts.missed} missed ${fuCounts.missed === 1 ? 'call' : 'calls'} not returned` : '',
        fuCounts.texts ? `${fuCounts.texts} ${fuCounts.texts === 1 ? 'text' : 'texts'} awaiting a reply` : '',
        fuCounts.vms ? `${fuCounts.vms} ${fuCounts.vms === 1 ? 'voicemail' : 'voicemails'} not returned` : '',
      ].filter(Boolean).join(', ')}.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px">
        ${fu.slice(0, 3).map((i) => `<tr><td style="padding:5px 0;border-top:1px solid ${C.line};font-size:12px;color:${C.ink}">${esc(i.name ?? fmtPhone(i.number))}</td><td align="right" style="padding:5px 0;border-top:1px solid ${C.line};font-size:12px;color:${C.dim}">${i.kind === 'missed_call' ? 'Missed call' : i.kind === 'text' ? 'Text waiting' : 'Voicemail'} · since ${esc(longDate(etDateKey(Date.parse(i.since))).replace(/^\w+, /, ''))}</td></tr>`).join('')}
      </table>`;
  const button = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">${esc(label)}</a>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};font-family:${font}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border-radius:16px;border-collapse:separate">
  <tr><td style="padding:28px 28px 0">
    <div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.accent}">ACE Dialer · Daily</div>
    <div style="font-size:24px;font-weight:700;color:${C.ink};margin-top:6px">${esc(longDate(d.date))}</div>
    <div style="font-size:14px;color:${C.dim};margin-top:4px">${recipient ? `Good morning, ${esc(recipient.name.split(' ')[0])}. ` : ''}${dayWorked ? `Here's how the team did, and your own numbers.` : 'No calls were made on this day.'}</div>
  </td></tr>
  ${dayWorked ? section('The team', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tileHtml}</tr></table>
      <div style="font-size:11px;color:${C.muted}">Compared with ${esc(longDate(addDays(d.date, -7)))}.</div>`) : ''}
  ${dayWorked ? section('How responsive we were', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${respHtml}</tr></table>`) : ''}
  ${shout.length ? section('Shout-outs', shoutHtml) : ''}
  ${recipient ? section('Your day', mineHtml + fuHtml) : ''}
  ${tip ? section(`Tip for ${DAY_NAMES[dowOfDateKey(next) - 1]}`, `<div style="font-size:13px;color:${C.ink};line-height:1.5">${esc(tip)}</div>`) : ''}
  <tr><td style="padding:24px 28px 28px">
    ${button(`${APP_URL}/reports/${recipient && fu.length ? 'follow-ups' : 'overview'}`, recipient && fu.length ? 'See what’s waiting on you' : 'Open Reports')}
    <div style="font-size:11px;color:${C.muted};line-height:1.5;margin-top:18px">Sent by ${esc(sender)} to ACE Dialer users. Each call counts once; talk time excludes ringing; times are Eastern. Your own section is only in your copy.</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  // ── Plain text ──
  const lines: string[] = [`ACE Dialer · Daily — ${longDate(d.date)}`, ''];
  if (dayWorked) {
    lines.push('THE TEAM');
    for (const x of tiles) lines.push(`  ${x.label}: ${x.value}${change(x.cur, x.prev).text ? ` (${change(x.cur, x.prev).text})` : ''}`);
    lines.push('', 'HOW RESPONSIVE WE WERE');
    for (const x of resp) lines.push(`  ${x.label}: ${x.value} (${x.note})`);
  }
  if (shout.length) {
    lines.push('', 'SHOUT-OUTS');
    for (const s of shout) {
      lines.push(`  ${s.title}`);
      s.rows.forEach(([n, v], i) => lines.push(`    ${i + 1}. ${n} — ${v}`));
    }
  }
  if (recipient) {
    lines.push('', 'YOUR DAY');
    if (me) for (const m of mine) lines.push(`  ${m.label}: ${m.you} (team average ${m.team})`);
    else lines.push('  No calls from you on this day.');
    lines.push(fu.length ? `  Waiting on you: ${fuCounts.missed} missed calls, ${fuCounts.texts} texts, ${fuCounts.vms} voicemails.` : '  Nothing waiting on you.');
  }
  if (tip) lines.push('', `TIP: ${tip}`);
  lines.push('', `Open Reports: ${APP_URL}/reports`, `Sent by ${sender} to ACE Dialer users.`);

  return { subject, html, text: lines.join('\n') };
}

// ── Sending ─────────────────────────────────────────────────────────────

async function sendAll(d: Digest, sender: string, onlyTo?: { id: number; name: string; email: string }) {
  const targets = onlyTo ? [onlyTo] : d.recipients;
  let sent = 0;
  const failed: Array<{ email: string; error: string }> = [];
  // Five at a time: fast enough for ~80 people, gentle on SendGrid.
  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5);
    const results = await Promise.all(batch.map(async (r) => {
      const me = d.recipients.find((x) => x.id === r.id) ?? r;
      const out = renderDigest(d, me, sender);
      return { r, res: await sendEmail({ toEmail: r.email, toName: r.name, subject: onlyTo ? `[Test] ${out.subject}` : out.subject, html: out.html, text: out.text }) };
    }));
    for (const { r, res } of results) {
      if (res.ok) sent += 1;
      else failed.push({ email: r.email, error: typeof res.error === 'string' ? res.error : `HTTP ${res.status}` });
    }
  }
  return { sent, failed };
}

async function readSchedule(): Promise<Schedule> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  const fallback: Schedule = { enabled: false, hour: 8, lastSentDate: null };
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as Partial<Schedule>) };
  } catch {
    return fallback;
  }
}

async function history() {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'reports.digest_sent' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { createdAt: true, metadata: true, actor: { select: { firstName: true, lastName: true, email: true } } },
  });
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as { date?: string; mode?: string; sent?: number; failed?: number };
    return {
      at: r.createdAt.toISOString(),
      date: m.date ?? null,
      mode: m.mode ?? null,
      sent: m.sent ?? 0,
      failed: m.failed ?? 0,
      by: r.actor ? (`${r.actor.firstName ?? ''} ${r.actor.lastName ?? ''}`.trim() || r.actor.email) : 'Automatic',
    };
  });
}

async function alreadySentToEveryone(date: string): Promise<boolean> {
  const n = await prisma.auditLog.count({
    where: { action: 'reports.digest_sent', metadata: { path: ['date'], equals: date }, AND: { metadata: { path: ['mode'], equals: 'everyone' } } },
  });
  return n > 0;
}

async function senderName(userId: number | null): Promise<string> {
  if (userId == null) return 'ACE Dialer';
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } });
  return u ? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email) : 'ACE Dialer';
}

// ── Routes ──────────────────────────────────────────────────────────────

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!(request.user as JwtPayload | undefined)?.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
}

export async function digestRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { date?: string; as?: string } }>(
    '/reports/digest',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const me = request.user as JwtPayload;
      const today = etDateKey(Date.now());
      const date = request.query.date ?? previousBusinessDay(today);
      if (!isDateKey(date) || date >= today) return reply.code(400).send({ error: 'Pick a day before today.' });
      const d = await buildDigest(date);
      const asId = request.query.as ? Number(request.query.as) : me.sub;
      const as = d.recipients.find((r) => r.id === asId) ?? { id: asId, name: (await senderName(asId)), email: '' };
      const out = renderDigest(d, as, await senderName(me.sub));
      return {
        date,
        subject: out.subject,
        html: out.html,
        recipients: d.recipients,
        previewAs: { id: as.id, name: as.name },
        alreadySent: await alreadySentToEveryone(date),
        schedule: await readSchedule(),
        history: await history(),
        defaultDate: previousBusinessDay(today),
      };
    },
  );

  app.post<{ Body: { date?: string; mode?: string; expectedCount?: number; force?: boolean } }>(
    '/reports/digest/send',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const me = request.user as JwtPayload;
      const { date, mode, expectedCount, force } = request.body ?? {};
      const today = etDateKey(Date.now());
      if (!isDateKey(date) || date >= today) return reply.code(400).send({ error: 'Pick a day before today.' });
      if (mode !== 'test' && mode !== 'everyone') return reply.code(400).send({ error: 'mode must be test or everyone.' });
      const d = await buildDigest(date);
      const sender = await senderName(me.sub);
      if (mode === 'test') {
        const self = await prisma.user.findUnique({ where: { id: me.sub }, select: { id: true, email: true } });
        if (!self) return reply.code(404).send({ error: 'Your account was not found.' });
        const res = await sendAll(d, sender, { id: self.id, email: self.email, name: sender });
        await recordAudit(me.sub, 'reports.digest_sent', null, { date, mode, sent: res.sent, failed: res.failed.length });
        return { ...res, to: self.email };
      }
      // Sending to everyone is irreversible, so the client must state how
      // many people it expects — a stale page can't mail a different list.
      if (expectedCount !== d.recipients.length) {
        return reply.code(409).send({ error: `The recipient list changed to ${d.recipients.length} people. Review it and send again.`, recipients: d.recipients.length });
      }
      if (!force && (await alreadySentToEveryone(date))) {
        return reply.code(409).send({ error: `The email for ${longDate(date)} was already sent to everyone.`, alreadySent: true });
      }
      const res = await sendAll(d, sender);
      await recordAudit(me.sub, 'reports.digest_sent', null, { date, mode, sent: res.sent, failed: res.failed.length, recipients: d.recipients.length });
      request.log.info({ date, sent: res.sent, failed: res.failed.length }, '[digest] sent to everyone');
      return res;
    },
  );

  app.put<{ Body: { enabled?: boolean; hour?: number } }>(
    '/reports/digest/schedule',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const me = request.user as JwtPayload;
      const cur = await readSchedule();
      const hour = request.body?.hour ?? cur.hour;
      if (!Number.isInteger(hour) || hour < 5 || hour > 12) return reply.code(400).send({ error: 'Pick a send time between 5am and noon Eastern.' });
      const next: Schedule = { ...cur, enabled: !!request.body?.enabled, hour };
      await prisma.systemSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy: me.sub },
        update: { value: JSON.stringify(next), updatedBy: me.sub },
      });
      await recordAudit(me.sub, 'reports.digest_schedule', null, { enabled: next.enabled, hour: next.hour });
      return next;
    },
  );
}

// ── Automatic weekday send ──────────────────────────────────────────────

/**
 * Checks every 5 minutes. On a weekday at or after the chosen Eastern hour,
 * claims today in the setting row with a compare-and-set before sending, so
 * a restart or a second process can never send the same day twice.
 */
export function startDigestScheduler(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const tick = async () => {
    try {
      const now = Date.now();
      const et = etParts(now);
      if (et.dow > 5) return;
      const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
      if (!row) return;
      const s = { enabled: false, hour: 8, lastSentDate: null, ...(JSON.parse(row.value) as Partial<Schedule>) } as Schedule;
      if (!s.enabled || et.hour < s.hour || s.lastSentDate === et.date) return;
      const claimed = await prisma.systemSetting.updateMany({
        where: { key: SETTING_KEY, value: row.value },
        data: { value: JSON.stringify({ ...s, lastSentDate: et.date }) },
      });
      if (claimed.count === 0) return;
      const date = previousBusinessDay(et.date);
      if (await alreadySentToEveryone(date)) return;
      const d = await buildDigest(date);
      const res = await sendAll(d, 'ACE Dialer');
      await recordAudit(null, 'reports.digest_sent', null, { date, mode: 'everyone', sent: res.sent, failed: res.failed.length, recipients: d.recipients.length, automatic: true });
      log.info({ date, sent: res.sent, failed: res.failed.length }, '[digest] automatic send');
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, '[digest] scheduler tick failed');
    }
  };
  setInterval(() => { void tick(); }, 5 * 60_000);
  setTimeout(() => { void tick(); }, 60_000);
}
