// Eastern-time bucketing for reports.
//
// Every day/hour boundary in a report is US Eastern, because that is the
// working day the team keeps (calls cluster 9am–6pm ET). The old
// /admin/reports/* endpoints split days at UTC midnight — 8pm ET — which
// moved every evening call onto the next day's bar.
//
// Intl formatting is ~50µs per call, far too slow for 100k rows, so we
// cache the UTC offset per UTC hour. DST transitions happen on the hour,
// so an hour-granular cache is exact, not an approximation.

export const REPORT_TZ = 'America/New_York';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const offsetCache = new Map<number, number>();

/** Milliseconds to ADD to a UTC instant to get Eastern wall-clock time. */
export function etOffsetMs(utcMs: number): number {
  const hourKey = Math.floor(utcMs / HOUR_MS);
  const hit = offsetCache.get(hourKey);
  if (hit !== undefined) return hit;
  const probe = hourKey * HOUR_MS;
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(probe))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const off = wall - probe;
  if (offsetCache.size > 50_000) offsetCache.clear();
  offsetCache.set(hourKey, off);
  return off;
}

export interface EtParts {
  /** YYYY-MM-DD in Eastern time. */
  date: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  dow: number;
  hour: number;
  minuteOfDay: number;
}

const dayKeyCache = new Map<number, string>();

function dayKey(dayNum: number): string {
  let k = dayKeyCache.get(dayNum);
  if (k === undefined) {
    k = new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
    if (dayKeyCache.size > 20_000) dayKeyCache.clear();
    dayKeyCache.set(dayNum, k);
  }
  return k;
}

// Arithmetic rather than Date objects: this runs for every call and message
// in a report, twice (current + previous period).
export function etParts(utcMs: number): EtParts {
  const wall = utcMs + etOffsetMs(utcMs);
  const dayNum = Math.floor(wall / DAY_MS);
  const minuteOfDay = Math.floor((wall - dayNum * DAY_MS) / 60_000);
  return {
    date: dayKey(dayNum),
    // 1970-01-01 was a Thursday (ISO weekday 4).
    dow: ((dayNum + 3) % 7) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minuteOfDay,
  };
}

export function etDateKey(utcMs: number): string {
  return dayKey(Math.floor((utcMs + etOffsetMs(utcMs)) / DAY_MS));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
}

/** UTC instant of 00:00 Eastern on the given YYYY-MM-DD. */
export function etMidnightUtc(dateKey: string): number {
  const m = DATE_RE.exec(dateKey);
  if (!m) throw new Error(`bad date key: ${dateKey}`);
  const wallMidnight = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Solve wall(t) = wallMidnight where wall(t) = t + off(t). Two passes
  // converge because the offset only changes at 2am, never at midnight.
  let t = wallMidnight - etOffsetMs(wallMidnight);
  t = wallMidnight - etOffsetMs(t);
  return t;
}

export function addDays(dateKey: string, n: number): string {
  const m = DATE_RE.exec(dateKey);
  if (!m) throw new Error(`bad date key: ${dateKey}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive count of calendar days from `from` to `to`. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO weekday (1 = Mon) of a YYYY-MM-DD. */
export function dowOfDateKey(dateKey: string): number {
  const d = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
