// Formatting + range helpers for the Reports page.

const TZ = 'America/New_York';
const nf = new Intl.NumberFormat('en-US');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtInt = (n: number) => nf.format(Math.round(n));
export const fmtMoney = (n: number) => (Math.abs(n) >= 1000 ? money0.format(n) : money.format(n));

/** "38%" — a ratio, or an em dash when the denominator is zero. */
export function fmtPct(num: number, den: number, digits = 0): string {
  if (!den) return '—';
  return `${((num / den) * 100).toFixed(digits)}%`;
}

export function pct(num: number, den: number): number | null {
  return den ? num / den : null;
}

/** Call length: "0:38", "1:35", "1:02:10". */
export function fmtClockDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Total talk time: "725 hrs", "12h 03m", "41m". */
export function fmtTalk(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 100) return `${fmtInt(h)} hrs`;
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A wait: "45s", "11 min", "14.6 hrs", "2.1 days". */
export function fmtWait(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400 * 2) return `${(sec / 3600).toFixed(1)} hrs`;
  return `${(sec / 86400).toFixed(1)} days`;
}

/** Minute-of-day → "9:48 AM". */
export function fmtTimeOfDay(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtHour(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-15" → "Sep 15". */
export function fmtDay(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function fmtRange(from: string, to: string): string {
  if (from === to) return `${fmtDay(from)}, ${from.slice(0, 4)}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDay(from)}${sameYear ? '' : `, ${from.slice(0, 4)}`} – ${fmtDay(to)}, ${to.slice(0, 4)}`;
}

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

const agoFmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
export function fmtAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const sec = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(sec);
  if (abs < 3600) return agoFmt.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return agoFmt.format(Math.round(sec / 3600), 'hour');
  return agoFmt.format(Math.round(sec / 86400), 'day');
}

/** Change vs the previous period, as a fraction; null when there's no base. */
export function change(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return (cur - prev) / prev;
}

// ── Ranges ──────────────────────────────────────────────────────────────

const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayEt = () => keyFmt.format(new Date());

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

export type PresetKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

export function presetRange(key: PresetKey): { from: string; to: string } {
  const t = todayEt();
  switch (key) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
    case '7d': return { from: addDays(t, -6), to: t };
    case 'month': return { from: `${t.slice(0, 8)}01`, to: t };
    case 'lastMonth': {
      const firstThis = `${t.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    case '30d':
    default: return { from: addDays(t, -29), to: t };
  }
}

export function matchPreset(from: string, to: string): PresetKey {
  for (const p of PRESETS) {
    const r = presetRange(p.key);
    if (r.from === from && r.to === to) return p.key;
  }
  return 'custom';
}

// ── CSV ─────────────────────────────────────────────────────────────────

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>): void {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    // A leading = + - @ makes Excel evaluate the cell as a formula.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
