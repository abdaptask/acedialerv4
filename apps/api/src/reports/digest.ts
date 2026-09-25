// Performance email — composed, previewed and sent from the Reports page
// (admin only), optionally on a weekday schedule.
//
// Tuesday–Friday it covers the previous working day. Monday it's a weekly
// recap of the previous Monday–Friday instead (so Friday is never sent on
// its own). Either way it's ONE message for the whole team: the people
// featured in the shout-outs on To, everyone else on BCC. Content is
// team-level only — the leader rejected per-person sections as "sending
// everyone my logs". Shout-outs are top-three, positive measures, never a
// bottom list.
//
// Numbers come from computeReport() — the same function behind the Reports
// page — so the email can never disagree with what people see there.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@ace/db';
import { sendEmail } from '../email/sendgrid.js';
import { recordAudit } from '../lib/audit.js';
import { computeReport } from './reports.routes.js';
import { CARRIER_SHORT_LIMIT, CARRIER_SHORT_SEC } from './compute.js';
import { config } from '../config.js';
import { addDays, dowOfDateKey, etDateKey, etParts, isDateKey } from './etTime.js';

interface JwtPayload {
  sub: number;
  email: string;
  isAdmin: boolean;
}

const SETTING_KEY = 'daily_digest';
const RECENT_DAYS = 28;
// Most improved needs a real baseline, or 3 calls → 9 calls wins.
const IMPROVED_MIN_BASELINE = 50;
const APP_URL = (process.env.WEB_PUBLIC_URL ?? 'https://dialer.aptask.com').replace(/\/$/, '');
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Report = Awaited<ReturnType<typeof computeReport>>;

export interface Schedule {
  enabled: boolean;
  /** Eastern hour to send (5–12). */
  hour: number;
  lastSentDate: string | null;
}

export type DigestKind = 'day' | 'week';

export interface Period {
  kind: DigestKind;
  from: string;
  to: string;
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

/** Monday–Friday of the working week containing `day`. */
export function weekOf(day: string): { from: string; to: string } {
  const monday = addDays(day, -(dowOfDateKey(day) - 1));
  return { from: monday, to: addDays(monday, 4) };
}

/** What the scheduler (and the tab's default) sends on `today`. */
export function defaultPeriod(today: string): Period {
  if (dowOfDateKey(today) === 1) {
    const w = weekOf(addDays(today, -7));
    return { kind: 'week', ...w };
  }
  const d = previousBusinessDay(today);
  return { kind: 'day', from: d, to: d };
}

export function periodFor(kind: DigestKind, date: string): Period {
  return kind === 'week' ? { kind, ...weekOf(date) } : { kind, from: date, to: date };
}

/** The audit/dedup key for a period. */
const periodKey = (p: Period) => (p.kind === 'day' ? p.from : `${p.from}..${p.to}`);

function longDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${DAY_NAMES[dowOfDateKey(key) - 1]}, ${MONTHS[m - 1]} ${d}`;
}

function shortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function periodTitle(p: Period): string {
  if (p.kind === 'day') return longDate(p.from);
  const [, m1] = p.from.split('-').map(Number);
  const [, m2, d2] = p.to.split('-').map(Number);
  return m1 === m2 ? `${shortDate(p.from)}–${d2}` : `${shortDate(p.from)} – ${MONTHS[m2 - 1]} ${d2}`;
}

// ── Formatting ──────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
function talk(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 100 ? `${int(h)} hrs` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
function wait(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} hrs`;
}
function hourLabel(h: number): string {
  if (h === 0 || h === 24) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function change(cur: number, prev: number, vs: string): { text: string; good: boolean | null } {
  if (!prev) return { text: '', good: null };
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return { text: `same as ${vs}`, good: null };
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs ${vs}`, good: d > 0 };
}

// ── Compose ─────────────────────────────────────────────────────────────

export interface Digest {
  period: Period;
  report: Report;
  /** Same period one week earlier. */
  before: Report;
  /** Four weeks ending with the period, for best-time and recipients. */
  recent: Report;
  /** Month to date (to the period's end), for the carrier short-call limit. */
  month: Report;
  recipients: Array<{ id: number; name: string; email: string }>;
}

export async function buildDigest(period: Period): Promise<Digest> {
  const monthStart = `${period.to.slice(0, 8)}01`;
  const [report, before, recent, month] = await Promise.all([
    computeReport({ from: period.from, to: period.to, scopeUserId: null, isAdmin: true }),
    computeReport({ from: addDays(period.from, -7), to: addDays(period.to, -7), scopeUserId: null, isAdmin: true }),
    computeReport({ from: addDays(period.to, -(RECENT_DAYS - 1)), to: period.to, scopeUserId: null, isAdmin: true }),
    computeReport({ from: monthStart, to: period.to, scopeUserId: null, isAdmin: true }),
  ]);
  // "Users of the system": active accounts that called or texted in the
  // last four weeks. Dormant accounts don't get an email about work they
  // aren't doing.
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
  return { period, report, before, recent, month, recipients };
}

export interface ShoutOut {
  key: string;
  /** Emoji: the one "icon" every mail client (Outlook included) renders. */
  icon: string;
  tint: string;
  title: string;
  unit: string;
  winner: { userId: number; name: string; value: string };
  runnersUp: Array<{ userId: number; name: string; value: string }>;
}

/** Top three per positive category. Nobody is ever listed at the bottom. */
export function shoutOuts(d: Digest): ShoutOut[] {
  const people = d.report.people;
  type P = (typeof people)[number];
  const top = (rows: P[], val: (p: P) => number | null) =>
    rows.map((r) => ({ r, v: val(r) })).filter((x): x is { r: P; v: number } => x.v != null && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
  const build = (key: string, icon: string, tint: string, title: string, unit: string, ranked: Array<{ r: P; v: number }>, show: (r: P, v: number) => string): ShoutOut | null => {
    if (ranked.length === 0) return null;
    const [first, ...rest] = ranked;
    return {
      key, icon, tint, title, unit,
      winner: { userId: first.r.userId, name: first.r.name, value: show(first.r, first.v) },
      runnersUp: rest.map((x) => ({ userId: x.r.userId, name: x.r.name, value: show(x.r, x.v) })),
    };
  };
  const out = [
    build('conversations', '🏆', '#fff4d6', 'Most conversations', 'over 2 minutes', top(people, (p) => p.conversations), (p) => int(p.conversations)),
    build('reach', '📞', '#e3efff', 'Most people called', 'different numbers', top(people, (p) => p.uniqueDialled), (p) => int(p.uniqueDialled)),
    // Fastest needs at least 3 returned calls, or one lucky callback wins.
    build('callbacks', '⚡', '#e6f6ea', 'Fastest callbacks', 'median time to call back', top(people.filter((p) => p.missedReturned >= 3), (p) => (p.medianCallbackSec == null ? null : 1 / (1 + p.medianCallbackSec))), (p) => wait(p.medianCallbackSec)),
  ];
  if (d.period.kind === 'week') {
    const before = new Map(d.before.people.map((p) => [p.userId, p.callsOut]));
    out.push(build(
      'improved', '🚀', '#f1e8ff', 'Most improved', 'more calls than the week before',
      top(people.filter((p) => (before.get(p.userId) ?? 0) >= IMPROVED_MIN_BASELINE), (p) => {
        const b = before.get(p.userId)!;
        const g = (p.callsOut - b) / b;
        return g > 0.1 ? g : null;
      }),
      (_p, v) => `+${Math.round(v * 100)}%`,
    ));
  }
  return out.filter((x): x is ShoutOut => x !== null);
}

/**
 * One message for everyone: the people named in the shout-outs on To, the
 * rest of the team on BCC, so nobody sees a 78-name recipient list.
 */
export function addressees(d: Digest, shouts: ShoutOut[]) {
  const named = new Set(shouts.flatMap((s) => [s.winner.userId, ...s.runnersUp.map((r) => r.userId)]));
  const to = d.recipients.filter((r) => named.has(r.id));
  const bcc = d.recipients.filter((r) => !named.has(r.id));
  return { to, bcc };
}

export interface ShortCalls {
  /** Month to date, answered calls of ≤6s as a share of answered calls. */
  monthShare: number | null;
  monthShort: number;
  monthAnswered: number;
  periodShort: number;
  periodAnswered: number;
  tone: 'good' | 'warn' | 'bad';
}

/**
 * Telnyx flags an account when more than 15% of its answered calls in a
 * month last 6 seconds or less, and may then surcharge all of them. Shown
 * as a team figure only — never who made them.
 */
export function shortCalls(d: Digest): ShortCalls {
  const m = d.month.totals;
  const share = m.connected ? m.carrierShortCalls / m.connected : null;
  return {
    monthShare: share,
    monthShort: m.carrierShortCalls,
    monthAnswered: m.connected,
    periodShort: d.report.totals.carrierShortCalls,
    periodAnswered: d.report.totals.connected,
    tone: share == null ? 'good' : share > CARRIER_SHORT_LIMIT ? 'bad' : share > CARRIER_SHORT_LIMIT - 0.02 ? 'warn' : 'good',
  };
}

export interface Practice {
  icon: string;
  title: string;
  body: string;
}

// General practices: one appears in every email, rotated by date, so the
// advice keeps changing even when the numbers look the same day to day.
// About 20 of them: each comes back roughly once a month.
const GENERAL: Practice[] = [
  { icon: '🎯', title: 'Open with why you’re calling', body: 'Name the role, the company and why you thought of them in the first ten seconds. People stay on the line when they know it’s worth their time.' },
  { icon: '✅', title: 'Agree the next step before you hang up', body: 'A time for the next call, a resume to send, an interview slot. A call that ends with a date moves the candidate forward; one that ends with “talk soon” usually doesn’t.' },
  { icon: '📝', title: 'Write notes while it’s fresh', body: 'Put the key points in JobDiva right after the call. The next person who calls this candidate, maybe you, will know exactly where things stand.' },
  { icon: '🗓️', title: 'Block time for calls', body: 'Put two focused calling blocks on your calendar at the hours when candidates pick up most. Calling in bursts beats fitting calls between everything else.' },
  { icon: '👋', title: 'Use their name in texts', body: 'Start texts with the candidate’s first name (templates can fill {firstName} for you). A personal first line gets more replies than a generic one.' },
  { icon: '🎙️', title: 'Leave a voicemail worth returning', body: 'Twenty seconds: your name, the role in one line, your number said slowly twice. Then send a short text so they can reply without calling.' },
  { icon: '👂', title: 'Ask, then listen', body: 'Ask what would make them move and let them talk. Candidates tell you exactly how to place them if you give them the room.' },
  { icon: '🔁', title: 'Follow up within a day', body: 'After a good call, send a quick text or email the same day recapping the next step. It shows you were listening and keeps you top of mind.' },
  { icon: '🙂', title: 'Smile when you dial', body: 'It sounds small, but it carries in your voice. Stand up or sit up for important calls; energy is audible.' },
  { icon: '⏳', title: 'Respect their time', body: 'Ask “is now a good time?” in the first sentence. If it isn’t, book a specific slot instead of pushing through a rushed call.' },
  { icon: '📍', title: 'Confirm the basics early', body: 'Location, work authorization, availability and pay range in the first few minutes saves both of you a longer call that can’t go anywhere.' },
  { icon: '💡', title: 'Sell the role, not just the job title', body: 'Tell them what the team does, who they’d work with and why the role is open. Specifics beat a list of requirements.' },
  { icon: '📵', title: 'Don’t text after hours', body: 'Keep candidate texts to their local business hours. A late-night text can feel intrusive and gets fewer replies the next morning.' },
  { icon: '✍️', title: 'Keep texts short', body: 'One idea per text, under two lines. Long texts get skimmed; a clear question gets answered.' },
  { icon: '🛑', title: 'Honor STOP right away', body: 'If someone replies STOP, don’t text them again. Call instead if you still need to reach them, and note it in JobDiva.' },
  { icon: '🤝', title: 'Close the loop with every candidate', body: 'A quick “we’ve moved forward with someone else” keeps your reputation strong. Candidates remember who got back to them.' },
  { icon: '🔎', title: 'Search before you dial', body: 'Use the search box in Reports to see if a colleague already spoke to this candidate this week, so you can coordinate instead of doubling up.' },
  { icon: '📞', title: 'Pick up on the first rings', body: 'An inbound call is a candidate reaching out to you. Answering in the first three rings beats calling back later every time.' },
  { icon: '🧭', title: 'Plan tomorrow’s first calls tonight', body: 'Pick your first five calls before you log off. Starting the day with a list gets you dialing in minutes, not after your inbox.' },
  { icon: '📊', title: 'Check your own numbers', body: 'Open Reports once a week and compare yourself with the team average. Small changes in talk time or callbacks add up quickly.' },
];

/**
 * Up to four practices: two data-triggered tips (quoting the period's own
 * numbers, rotated when several apply), the best hour to call next, and a
 * general practice from a ~20-item rotation. Short calls have their own
 * box, so they aren't repeated here.
 */
export function bestPractices(d: Digest): Practice[] {
  const t = d.report.totals;
  const weekly = d.period.kind === 'week';
  const when = weekly ? 'Last week' : 'Yesterday';
  const whenLower = weekly ? 'last week' : 'yesterday';
  const out: Practice[] = [];

  const returnRate = t.missedReturnable ? t.missedReturned / t.missedReturnable : null;
  if (t.missedReturnable >= 10 && returnRate != null && returnRate < 0.6) {
    out.push({
      icon: '⏱️',
      title: 'Call back missed calls within the hour',
      body: `${when} ${int(t.missedReturned)} of ${int(t.missedReturnable)} missed calls got a call back within 24 hours. Someone who calls you is the warmest lead you have; Reports, Follow-ups lists exactly who is waiting.`,
    });
  }

  const peak = [...d.report.inbound.byHour].sort((a, b) => b.unanswered - a.unanswered)[0];
  if (peak && peak.unanswered >= (weekly ? 40 : 10)) {
    out.push({
      icon: '🕐',
      title: `Cover the ${hourLabel(peak.hour)}–${hourLabel(peak.hour + 1)} hour`,
      body: `${int(peak.unanswered)} inbound calls went unanswered between ${hourLabel(peak.hour)} and ${hourLabel(peak.hour + 1)} Eastern ${whenLower}, the most of any hour. Stagger breaks so someone is always free, or turn on call forwarding.`,
    });
  }

  const replyRate = t.smsRepliable ? t.smsReplied / t.smsRepliable : null;
  if (t.smsRepliable >= 20 && replyRate != null && replyRate < 0.75) {
    out.push({
      icon: '💬',
      title: 'Reply to texts the same day',
      body: `${int(t.smsRepliable - t.smsReplied)} incoming text conversations didn’t get a reply within 24 hours ${whenLower}. In Reports, Activity, Texts, “Waiting on reply” shows yours.`,
    });
  }

  if (d.report.outbound.invalidNumber >= (weekly ? 40 : 10)) {
    out.push({
      icon: '🧹',
      title: 'Fix bad numbers at the source',
      body: `${int(d.report.outbound.invalidNumber)} calls ${whenLower} went to numbers that aren’t in service. Correct or remove them in JobDiva so nobody dials them again.`,
    });
  }

  const landline = d.report.sms.failureReasons.find((f) => f.code === '40001');
  if (landline && landline.count >= 5) {
    out.push({
      icon: '☎️',
      title: 'Call landlines, don’t text them',
      body: `${int(landline.count)} texts ${whenLower} failed because the number can’t receive texts, usually a landline. When a text fails, call instead.`,
    });
  }

  // Two of the relevant data tips, rotated by date: when the same problem
  // persists (returned calls below 60% most days) it still shows up often,
  // but not at the top of every single email.
  const dayNum = Math.floor(Date.parse(`${d.period.to}T12:00:00Z`) / 86_400_000);
  const picked: Practice[] = [];
  for (let i = 0; i < Math.min(2, out.length); i += 1) picked.push(out[(dayNum + i) % out.length]);

  // Best hour to call on the next working day, from four weeks of calls.
  const next = nextBusinessDay(d.period.to);
  const row = d.recent.insights.bestTime[dowOfDateKey(next) - 1];
  const cells = row
    .map((c, h) => ({ h, r: c.attempts >= d.recent.insights.bestTimeMinAttempts ? c.reached / c.attempts : null }))
    .filter((c): c is { h: number; r: number } => c.r != null && c.h >= 8 && c.h <= 19);
  if (cells.length >= 3) {
    const best = [...cells].sort((a, b) => b.r - a.r)[0];
    const worst = [...cells].sort((a, b) => a.r - b.r)[0];
    picked.push({
      icon: '📈',
      title: `Best time to call ${DAY_NAMES[dowOfDateKey(next) - 1]}: ${hourLabel(best.h)}–${hourLabel(best.h + 1)}`,
      body: `Over the last four ${DAY_NAMES[dowOfDateKey(next) - 1]}s, calls in that hour reached someone ${Math.round(best.r * 100)}% of the time, against ${Math.round(worst.r * 100)}% between ${hourLabel(worst.h)} and ${hourLabel(worst.h + 1)} Eastern.`,
    });
  }

  // Always one general practice (two on a quiet day), rotated by date.
  const general = picked.length >= 3 ? 1 : 2;
  for (let i = 0; i < general; i += 1) picked.push(GENERAL[(dayNum * 7 + i) % GENERAL.length]);
  return picked;
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export function renderDigest(d: Digest, sender: string): Rendered {
  const p = d.period;
  const weekly = p.kind === 'week';
  const t = d.report.totals;
  const w = d.before.totals;
  const worked = t.callsOut + t.callsIn > 0;
  const shouts = shoutOuts(d);
  const sc = shortCalls(d);
  const practices = bestPractices(d);
  const vs = weekly ? 'the week before' : 'last week';

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

  const kicker = weekly ? 'ACE Dialer · Weekly recap' : 'ACE Dialer · Daily';
  const title = weekly ? `Week of ${periodTitle(p)}` : periodTitle(p);
  const greeting = !worked
    ? (weekly ? 'No calls were made that week.' : 'No calls were made on this day.')
    : weekly ? 'Good morning, team. Here’s last week, and the people who led it.' : 'Good morning, team. Here’s how we did.';
  const subject = !worked
    ? `${weekly ? 'ACE weekly' : 'ACE daily'} · ${periodTitle(p)}`
    : `${weekly ? 'ACE weekly' : 'ACE daily'} · ${periodTitle(p)}: ${int(t.callsOut)} calls, ${int(t.conversations)} real conversations`;

  // ── HTML (table layout + inline styles: email clients ignore <style>) ──
  const C = { ink: '#1c1c1e', dim: '#545458', muted: '#8e8e93', line: '#e5e5ea', bg: '#f2f2f7', card: '#ffffff', accent: '#0a7aff', good: '#1f8a47', warn: '#b26a00', bad: '#c9342a' };
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const section = (heading: string, inner: string) => `
    <tr><td style="padding:24px 28px 0">
      <div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:0 0 10px">${esc(heading)}</div>
      ${inner}
    </td></tr>`;

  // Shout-out boxes: rows of three (two per row when there are four).
  const perRow = shouts.length === 4 ? 2 : 3;
  const box = (s: ShoutOut) => `<td width="${Math.floor(100 / perRow)}%" valign="top" style="background:${s.tint};border-radius:14px;padding:16px 14px;text-align:center">
      <div style="font-size:30px;line-height:1">${s.icon}</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${C.dim};margin-top:8px">${esc(s.title)}</div>
      <div style="font-size:30px;font-weight:800;color:${C.ink};margin-top:8px;line-height:1.1">${esc(s.winner.value)}</div>
      <div style="font-size:11px;color:${C.muted}">${esc(s.unit)}</div>
      <div style="font-size:15px;font-weight:700;color:${C.ink};margin-top:8px">${esc(s.winner.name)}</div>
      ${s.runnersUp.length ? `<div style="font-size:11px;color:${C.dim};margin-top:8px;line-height:1.5">${s.runnersUp.map((r, i) => `${i + 2}. ${esc(r.name)} · ${esc(r.value)}`).join('<br>')}</div>` : ''}
    </td>`;
  const rows: ShoutOut[][] = [];
  for (let i = 0; i < shouts.length; i += perRow) rows.push(shouts.slice(i, i + perRow));
  const shoutHtml = rows.map((r) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 8px;margin:-8px -8px 0">
      <tr>${r.map(box).join('')}</tr></table>`).join('');

  const tileHtml = tiles.map((x) => {
    const ch = change(x.cur, x.prev, vs);
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

  // Short calls: the carrier's 15% limit, month to date.
  const scColor = sc.tone === 'bad' ? C.bad : sc.tone === 'warn' ? C.warn : C.good;
  const scBg = sc.tone === 'bad' ? '#fdecea' : sc.tone === 'warn' ? '#fff4e0' : '#e6f6ea';
  const scShare = sc.monthShare == null ? '—' : `${(sc.monthShare * 100).toFixed(1)}%`;
  const scHeadline = sc.tone === 'bad'
    ? 'We’re over the carrier’s limit this month'
    : sc.tone === 'warn' ? 'We’re close to the carrier’s limit this month' : 'We’re under the carrier’s limit this month';
  const scHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${scBg};border-radius:14px;border-collapse:separate">
    <tr>
      <td width="120" valign="middle" align="center" style="padding:16px 8px 16px 16px">
        <div style="font-size:28px;line-height:1">✂️</div>
        <div style="font-size:26px;font-weight:800;color:${scColor};margin-top:6px">${esc(scShare)}</div>
        <div style="font-size:11px;color:${C.dim}">limit ${Math.round(CARRIER_SHORT_LIMIT * 100)}%</div>
      </td>
      <td valign="middle" style="padding:16px 16px 16px 8px">
        <div style="font-size:14px;font-weight:700;color:${C.ink}">${esc(scHeadline)}</div>
        <div style="font-size:13px;color:${C.dim};line-height:1.5;margin-top:4px">
          Calls that connect and end within ${CARRIER_SHORT_SEC} seconds don’t help anyone. Our carrier, Telnyx, flags us when they pass ${Math.round(CARRIER_SHORT_LIMIT * 100)}% of answered calls in a month, and can then charge extra for every one of them. This month so far: ${int(sc.monthShort)} of ${int(sc.monthAnswered)} answered calls. ${weekly ? 'Last week' : 'Yesterday'}: ${int(sc.periodShort)} of ${int(sc.periodAnswered)}.
        </div>
        <div style="font-size:13px;color:${C.ink};line-height:1.5;margin-top:6px">
          <b>Instead:</b> if you reach voicemail, leave a short message rather than hanging up; if it’s a wrong number, fix it in JobDiva instead of redialing; and give a screening service a couple of seconds to finish before you speak.
        </div>
      </td>
    </tr>
  </table>`;

  const practiceHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${practices.map((x, i) => `<tr>
      <td width="44" valign="top" style="padding:12px 12px 12px 0;${i ? `border-top:1px solid ${C.line};` : ''}">
        <div style="width:36px;height:36px;border-radius:18px;background:${C.bg};text-align:center;line-height:36px;font-size:18px">${x.icon}</div>
      </td>
      <td valign="top" style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ''}">
        <div style="font-size:14px;font-weight:700;color:${C.ink}">${esc(x.title)}</div>
        <div style="font-size:13px;color:${C.dim};line-height:1.5;margin-top:2px">${esc(x.body)}</div>
      </td>
    </tr>`).join('')}
  </table>`;
  const button = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">${esc(label)}</a>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};font-family:${font}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${C.card};border-radius:16px;border-collapse:separate">
  <tr><td style="padding:28px 28px 0">
    <div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.accent}">${esc(kicker)}</div>
    <div style="font-size:24px;font-weight:700;color:${C.ink};margin-top:6px">${esc(title)}</div>
    <div style="font-size:14px;color:${C.dim};margin-top:4px">${esc(greeting)}</div>
  </td></tr>
  ${shouts.length ? section(weekly ? 'This week’s shout-outs 🎉' : 'Shout-outs 🎉', shoutHtml) : ''}
  ${worked ? section('The team', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tileHtml}</tr></table>
      <div style="font-size:11px;color:${C.muted}">Compared with ${esc(weekly ? `the week of ${periodTitle({ kind: 'week', from: addDays(p.from, -7), to: addDays(p.to, -7) })}` : longDate(addDays(p.from, -7)))}.</div>`) : ''}
  ${sc.monthAnswered ? section('Short calls', scHtml) : ''}
  ${worked ? section('How responsive we were', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${respHtml}</tr></table>`) : ''}
  ${practices.length ? section('Best practices 💡', practiceHtml) : ''}
  <tr><td style="padding:24px 28px 28px">
    ${button(`${APP_URL}/reports/overview`, 'Open Reports')}
    <div style="font-size:11px;color:${C.muted};line-height:1.5;margin-top:18px">Sent by ${esc(sender)} to ACE Dialer users. Each call counts once; talk time excludes ringing; times are Eastern.</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  // ── Plain text ──
  const lines: string[] = [`${kicker} — ${title}`, '', greeting];
  if (shouts.length) {
    lines.push('', weekly ? 'THIS WEEK’S SHOUT-OUTS' : 'SHOUT-OUTS');
    for (const s of shouts) {
      lines.push(`  ${s.icon} ${s.title}: ${s.winner.name} — ${s.winner.value} ${s.unit}`);
      s.runnersUp.forEach((r, i) => lines.push(`     ${i + 2}. ${r.name} — ${r.value}`));
    }
  }
  if (worked) {
    lines.push('', 'THE TEAM');
    for (const x of tiles) {
      const ch = change(x.cur, x.prev, vs);
      lines.push(`  ${x.label}: ${x.value}${ch.text ? ` (${ch.text})` : ''}`);
    }
  }
  if (sc.monthAnswered) {
    lines.push('', 'SHORT CALLS');
    lines.push(`  ${scHeadline}: ${scShare} of answered calls lasted ${CARRIER_SHORT_SEC}s or less (limit ${Math.round(CARRIER_SHORT_LIMIT * 100)}%).`);
    lines.push('  Telnyx can charge extra for every short call once we pass the limit. Leave a voicemail instead of hanging up, fix wrong numbers in JobDiva, and give screening services a moment.');
  }
  if (worked) {
    lines.push('', 'HOW RESPONSIVE WE WERE');
    for (const x of resp) lines.push(`  ${x.label}: ${x.value} (${x.note})`);
  }
  if (practices.length) {
    lines.push('', 'BEST PRACTICES');
    for (const x of practices) lines.push(`  ${x.icon} ${x.title}`, `     ${x.body}`);
  }
  lines.push('', `Open Reports: ${APP_URL}/reports`, `Sent by ${sender} to ACE Dialer users.`);

  return { subject, html, text: lines.join('\n') };
}

// ── Sending ─────────────────────────────────────────────────────────────

/** One SendGrid message. Test mode goes to the sender alone. */
async function sendDigestEmail(d: Digest, sender: string, testTo?: { email: string; name: string }) {
  const out = renderDigest(d, sender);
  if (testTo) {
    const res = await sendEmail({ toEmail: testTo.email, toName: testTo.name, subject: `[Test] ${out.subject}`, html: out.html, text: out.text });
    return { ok: res.ok, to: 1, bcc: 0, error: res.ok ? null : typeof res.error === 'string' ? res.error : `HTTP ${res.status}` };
  }
  const { to, bcc } = addressees(d, shoutOuts(d));
  // No shout-outs (a period nobody called) → nobody to feature on To:
  // address it to our own sending address and keep the whole team on BCC.
  const visible = to.length > 0 ? to : [{ id: 0, email: config.sendGridFromEmail ?? 'noreply@aptask.com', name: 'ACE Dialer' }];
  const hidden = to.length > 0 ? bcc : d.recipients;
  const [first, ...rest] = visible;
  const res = await sendEmail({
    toEmail: first.email,
    toName: first.name,
    alsoTo: rest.map((r) => ({ email: r.email, name: r.name })),
    bcc: hidden.map((r) => ({ email: r.email, name: r.name })),
    subject: out.subject,
    html: out.html,
    text: out.text,
  });
  return { ok: res.ok, to: to.length, bcc: hidden.length, error: res.ok ? null : typeof res.error === 'string' ? res.error : `HTTP ${res.status}` };
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
    const m = (r.metadata ?? {}) as { date?: string; kind?: string; mode?: string; sent?: number; failed?: number; to?: number; bcc?: number };
    return {
      at: r.createdAt.toISOString(),
      date: m.date ?? null,
      kind: m.kind ?? 'day',
      mode: m.mode ?? null,
      sent: m.sent ?? ((m.to ?? 0) + (m.bcc ?? 0)),
      failed: m.failed ?? 0,
      to: m.to ?? null,
      bcc: m.bcc ?? null,
      by: r.actor ? (`${r.actor.firstName ?? ''} ${r.actor.lastName ?? ''}`.trim() || r.actor.email) : 'Automatic',
    };
  });
}

async function alreadySentToEveryone(p: Period): Promise<boolean> {
  const n = await prisma.auditLog.count({
    where: { action: 'reports.digest_sent', metadata: { path: ['date'], equals: periodKey(p) }, AND: { metadata: { path: ['mode'], equals: 'everyone' } } },
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

/** Validate a requested period: it must be fully in the past. */
function resolvePeriod(kind: unknown, date: unknown, today: string): Period | string {
  const k: DigestKind = kind === 'week' ? 'week' : 'day';
  if (date === undefined) {
    const def = defaultPeriod(today);
    if (k === def.kind) return def;
    return k === 'week' ? { kind: 'week', ...weekOf(addDays(today, -7)) } : { kind: 'day', from: previousBusinessDay(today), to: previousBusinessDay(today) };
  }
  if (!isDateKey(date)) return 'Dates must be in YYYY-MM-DD format.';
  const p = periodFor(k, date);
  if (p.to >= today) return k === 'week' ? 'Pick a week that has finished.' : 'Pick a day before today.';
  return p;
}

export async function digestRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { date?: string; kind?: string } }>(
    '/reports/digest',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const me = request.user as JwtPayload;
      const today = etDateKey(Date.now());
      const kind = request.query.kind ?? defaultPeriod(today).kind;
      const period = resolvePeriod(kind, request.query.date, today);
      if (typeof period === 'string') return reply.code(400).send({ error: period });
      const d = await buildDigest(period);
      const out = renderDigest(d, await senderName(me.sub));
      const { to, bcc } = addressees(d, shoutOuts(d));
      return {
        period,
        date: period.from,
        subject: out.subject,
        html: out.html,
        recipients: d.recipients,
        to,
        bccCount: bcc.length,
        alreadySent: await alreadySentToEveryone(period),
        schedule: await readSchedule(),
        history: await history(),
        defaultPeriod: defaultPeriod(today),
      };
    },
  );

  app.post<{ Body: { date?: string; kind?: string; mode?: string; expectedCount?: number; force?: boolean } }>(
    '/reports/digest/send',
    { onRequest: [app.authenticate, requireAdmin] },
    async (request, reply) => {
      const me = request.user as JwtPayload;
      const { date, kind, mode, expectedCount, force } = request.body ?? {};
      const today = etDateKey(Date.now());
      if (date === undefined) return reply.code(400).send({ error: 'Pick a day or a week.' });
      const period = resolvePeriod(kind, date, today);
      if (typeof period === 'string') return reply.code(400).send({ error: period });
      if (mode !== 'test' && mode !== 'everyone') return reply.code(400).send({ error: 'mode must be test or everyone.' });
      const d = await buildDigest(period);
      const sender = await senderName(me.sub);
      const meta = { date: periodKey(period), kind: period.kind };
      if (mode === 'test') {
        const self = await prisma.user.findUnique({ where: { id: me.sub }, select: { id: true, email: true } });
        if (!self) return reply.code(404).send({ error: 'Your account was not found.' });
        const res = await sendDigestEmail(d, sender, { email: self.email, name: sender });
        await recordAudit(me.sub, 'reports.digest_sent', null, { ...meta, mode, sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1 });
        if (!res.ok) return reply.code(502).send({ error: `The test didn't send: ${res.error}` });
        return { ok: true, to: self.email };
      }
      // Sending to everyone is irreversible, so the client must state how
      // many people it expects — a stale page can't mail a different list.
      if (expectedCount !== d.recipients.length) {
        return reply.code(409).send({ error: `The recipient list changed to ${d.recipients.length} people. Review it and send again.`, recipients: d.recipients.length });
      }
      if (!force && (await alreadySentToEveryone(period))) {
        return reply.code(409).send({ error: `This ${period.kind === 'week' ? 'weekly recap' : 'day'} was already sent to everyone.`, alreadySent: true });
      }
      const res = await sendDigestEmail(d, sender);
      if (!res.ok) {
        request.log.error({ period, error: res.error }, '[digest] send failed');
        return reply.code(502).send({ error: `SendGrid refused the email: ${res.error}. Nothing was sent.` });
      }
      await recordAudit(me.sub, 'reports.digest_sent', null, { ...meta, mode, to: res.to, bcc: res.bcc, recipients: d.recipients.length });
      request.log.info({ period, to: res.to, bcc: res.bcc }, '[digest] sent to everyone');
      return { ok: true, to: res.to, bcc: res.bcc };
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
 * a restart or a second process can never send the same day twice. Monday
 * sends the weekly recap; Tuesday–Friday the previous day. A failed send
 * gives the day back so the next tick retries.
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
      const claimedValue = JSON.stringify({ ...s, lastSentDate: et.date });
      const claimed = await prisma.systemSetting.updateMany({ where: { key: SETTING_KEY, value: row.value }, data: { value: claimedValue } });
      if (claimed.count === 0) return;
      const release = () => prisma.systemSetting.updateMany({ where: { key: SETTING_KEY, value: claimedValue }, data: { value: row.value } });
      const period = defaultPeriod(et.date);
      if (await alreadySentToEveryone(period)) return;
      const d = await buildDigest(period);
      const res = await sendDigestEmail(d, 'ACE Dialer');
      if (!res.ok) {
        log.error({ period, error: res.error }, '[digest] automatic send failed; will retry');
        await release();
        return;
      }
      await recordAudit(null, 'reports.digest_sent', null, { date: periodKey(period), kind: period.kind, mode: 'everyone', to: res.to, bcc: res.bcc, recipients: d.recipients.length, automatic: true });
      log.info({ period, to: res.to, bcc: res.bcc }, '[digest] automatic send');
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, '[digest] scheduler tick failed');
    }
  };
  setInterval(() => { void tick(); }, 5 * 60_000);
  setTimeout(() => { void tick(); }, 60_000);
}
