// Layout pieces shared by every report tab.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import { Sparkline } from './charts';
import { change, fmtDay } from './format';
import type { DailyPoint, PersonMetrics, PersonRow, PrevMetrics } from './types';

export type RowLike = PersonMetrics & { prev?: PrevMetrics | null; name?: string };

// ── KPI tile ────────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  unit,
  sub,
  cur,
  prev,
  better = 'up',
  spark,
  points,
  onOpen,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  /** Raw current + previous values drive the change chip. */
  cur?: number | null;
  prev?: number | null;
  better?: 'up' | 'down' | 'none';
  spark?: number[];
  /** cur/prev are ratios (0–1): show the change in percentage points. A
   *  rate going 36% → 43% is "+7 pts", not "+20%". */
  points?: boolean;
  /** Makes the tile a button that opens the drill-down for this number. */
  onOpen?: () => void;
}) {
  const d = cur == null ? null : points ? (prev == null ? null : cur - prev) : change(cur, prev);
  let chip: ReactNode = null;
  if (d != null && Number.isFinite(d) && points) {
    const pts = Math.round(d * 100);
    const good = better === 'none' || pts === 0 ? null : (better === 'up') === pts > 0;
    chip = (
      <span className={`rp-delta ${good == null ? 'flat' : good ? 'good' : 'bad'}`} title="Compared with the previous period">
        {pts > 0 ? <ArrowUp size={11} strokeWidth={2.5} /> : pts < 0 ? <ArrowDown size={11} strokeWidth={2.5} /> : null}
        {pts === 0 ? 'No change' : `${Math.abs(pts)} pts`}
      </span>
    );
  } else if (d != null && Number.isFinite(d)) {
    const up = d > 0;
    const flat = Math.abs(d) < 0.005;
    const good = better === 'none' || flat ? null : (better === 'up') === up;
    chip = (
      <span className={`rp-delta ${good == null ? 'flat' : good ? 'good' : 'bad'}`} title="Compared with the previous period">
        {!flat && (up ? <ArrowUp size={11} strokeWidth={2.5} /> : <ArrowDown size={11} strokeWidth={2.5} />)}
        {flat ? 'No change' : `${Math.abs(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%`}
      </span>
    );
  }
  const body = (
    <>
      <div className="rp-kpi-label">
        {label}
        {onOpen && <ChevronRight size={14} className="rp-kpi-go" aria-hidden="true" />}
      </div>
      <div className="rp-kpi-value rp-num">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="rp-kpi-sub">
        {chip}
        {sub && <span>{sub}</span>}
      </div>
      {spark && <Sparkline values={spark} />}
    </>
  );
  if (!onOpen) return <div className="rp-kpi">{body}</div>;
  return (
    <button type="button" className="rp-kpi rp-kpi-btn" onClick={onOpen} aria-label={`${label}: ${value}. Show the breakdown`}>
      {body}
    </button>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return <div className={`rp-kpis rp-kpis-${cols}`}>{children}</div>;
}

// ── Panel ───────────────────────────────────────────────────────────────

export function Panel({
  title,
  sub,
  right,
  span = 12,
  children,
  flush,
}: {
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
  span?: 4 | 5 | 6 | 7 | 8 | 12;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={`rp-panel rp-span-${span}${flush ? ' rp-flush' : ''}`}>
      <header className="rp-panel-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  return (
    <div className="rp-legend">
      {items.map((i) => (
        <span key={i.name}><i style={{ background: i.color }} />{i.name}</span>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rp-empty">{children}</div>;
}

// ── Columns ─────────────────────────────────────────────────────────────

export interface Col {
  key: string;
  label: string;
  value: (r: RowLike) => number | null;
  fmt: (v: number | null, r: RowLike) => ReactNode;
  /** Plain text for CSV; defaults to the raw number. */
  csv?: (v: number | null, r: RowLike) => string | number | null;
  better?: 'up' | 'down';
  /** Show a pill when this returns a tone. */
  flag?: (v: number | null, r: RowLike) => 'crit' | 'warn' | null;
  bar?: boolean;
}

function avatar(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Person({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="rp-person">
      <span className="rp-avatar" aria-hidden="true">{avatar(name)}</span>
      <span className="rp-person-text">
        <span className="rp-person-name">{name}</span>
        {sub && <span className="rp-person-sub">{sub}</span>}
      </span>
    </span>
  );
}

// ── Team table ──────────────────────────────────────────────────────────

export function PeopleTable({
  rows,
  cols,
  defaultSort,
  onOpen,
  showDelta,
}: {
  rows: PersonRow[];
  cols: Col[];
  defaultSort: string;
  onOpen: (userId: number) => void;
  /** Column key whose previous-period change is shown at the end. */
  showDelta?: { key: keyof PrevMetrics; label: string; better?: 'up' | 'down' };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: defaultSort, dir: -1 });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key);
    const val = (r: PersonRow) => (sort.key === 'name' ? null : col?.value(r) ?? null);
    return [...rows].sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
      const va = val(a);
      const vb = val(b);
      // Blank values (no calls, so no rate) always sink, whichever way we sort.
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, cols, sort]);
  const maxOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cols) if (c.bar) m.set(c.key, Math.max(1, ...rows.map((r) => c.value(r) ?? 0)));
    return m;
  }, [rows, cols]);

  const header = (key: string, label: string, align: 'l' | 'r') => {
    const active = sort.key === key;
    return (
      <th key={key} className={align === 'r' ? 'rp-r' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className={`rp-sort${active ? ' active' : ''}`}
          onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }))}
        >
          {label}
          {active && (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
      </th>
    );
  };

  if (rows.length === 0) return <Empty>No one had activity in this period.</Empty>;

  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead>
          <tr>
            {header('name', 'Person', 'l')}
            {cols.map((c) => header(c.key, c.label, 'r'))}
            {showDelta && <th className="rp-r">{showDelta.label}</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const d = showDelta ? change(r[showDelta.key] as number, r.prev?.[showDelta.key]) : null;
            return (
              <tr key={r.userId} onClick={() => onOpen(r.userId)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.userId); }}>
                <td><Person name={r.name} sub={r.isActive ? undefined : 'Deactivated'} /></td>
                {cols.map((c) => {
                  const v = c.value(r);
                  const tone = c.flag?.(v, r);
                  const content = c.fmt(v, r);
                  return (
                    <td key={c.key} className="rp-r rp-num">
                      {c.bar && v != null && (
                        <span className="rp-minibar" style={{ width: `${Math.round((v / (maxOf.get(c.key) ?? 1)) * 48)}px` }} />
                      )}
                      {tone ? <span className={`rp-pill rp-pill-${tone}`}>{content}</span> : content}
                    </td>
                  );
                })}
                {showDelta && (
                  <td className="rp-r">
                    {d == null ? <span className="rp-muted">—</span> : (
                      <span className={`rp-delta ${Math.abs(d) < 0.005 ? 'flat' : (d > 0) === ((showDelta.better ?? 'up') === 'up') ? 'good' : 'bad'}`}>
                        {d > 0 ? <ArrowUp size={11} strokeWidth={2.5} /> : d < 0 ? <ArrowDown size={11} strokeWidth={2.5} /> : null}
                        {`${Math.abs(d * 100).toFixed(0)}%`}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Person-level comparison ─────────────────────────────────────────────

function finite(v: number | null): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Mean per active person, as a synthetic row the same Col defs can read. */
export function teamAverage(people: PersonRow[]): RowLike | null {
  const active = people.filter((p) => p.callsOut + p.callsIn + p.smsSent + p.smsReceived > 0);
  if (active.length === 0) return null;
  const avg: Record<string, number | null> = {};
  const keys = Object.keys(active[0]) as Array<keyof PersonMetrics>;
  for (const k of keys) {
    const vals = active.map((p) => p[k]).filter((v): v is number => typeof v === 'number');
    avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return avg as unknown as RowLike;
}

export function CompareTable({
  person,
  team,
  cols,
}: {
  person: RowLike;
  team: RowLike | null;
  cols: Col[];
}) {
  return (
    <div className="rp-table-wrap">
      <table className="rp-table rp-compare">
        <thead>
          <tr>
            <th>Measure</th>
            <th className="rp-r">This person</th>
            <th className="rp-r">Team average</th>
            <th className="rp-r">Previous period</th>
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => {
            const v = finite(c.value(person));
            const t = team ? finite(c.value(team)) : null;
            // The server only sends a subset of fields for the previous
            // period. Reading a missing one yields NaN, which shows as "—"
            // rather than silently borrowing this period's value.
            const prevRow = person.prev ? (person.prev as unknown as RowLike) : null;
            const p = prevRow ? finite(c.value(prevRow)) : null;
            let tone: 'good' | 'bad' | null = null;
            if (c.better && v != null && t != null && t !== 0) {
              const diff = (v - t) / Math.abs(t);
              if (Math.abs(diff) >= 0.15) tone = (diff > 0) === (c.better === 'up') ? 'good' : 'bad';
            }
            return (
              <tr key={c.key} className="rp-static">
                <td>{c.label}</td>
                <td className="rp-r rp-num">
                  <span className={tone ? `rp-vs rp-vs-${tone}` : undefined}>{c.fmt(v, person)}</span>
                </td>
                <td className="rp-r rp-num rp-muted">{team ? c.fmt(t, team) : '—'}</td>
                <td className="rp-r rp-num rp-muted">{prevRow && p != null ? c.fmt(p, prevRow) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Drill-down sheet ────────────────────────────────────────────────────
//
// Clicking a number opens it here: ranked by person on the team view, by
// day on a person's view. The sheet reuses the same Col the tables use, so
// the breakdown always adds up to the number that was clicked.

export interface DrillSpec {
  title: string;
  /** The headline value that was clicked, shown at the top. */
  value: string;
  col: Col;
  /** Counts add up across people, so each row can show its share. Rates don't. */
  additive?: boolean;
  daily?: { value: (d: DailyPoint) => number; fmt: (v: number) => string };
  note?: string;
}

export function DrillSheet({
  spec,
  people,
  daily,
  personName,
  rangeLabel,
  onClose,
  onOpenPerson,
  onOpenDay,
}: {
  spec: DrillSpec;
  people: PersonRow[];
  daily: DailyPoint[];
  /** Set when drilling from one person's report: rows are days, not people. */
  personName: string | null;
  rangeLabel: string;
  onClose: () => void;
  onOpenPerson: (userId: number) => void;
  onOpenDay: (date: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [asc, setAsc] = useState(false);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byDay = personName != null && spec.daily;
  const rows = useMemo(() => {
    if (byDay) return [];
    const withVal = people
      .map((p) => ({ p, v: spec.col.value(p) }))
      .filter((x): x is { p: PersonRow; v: number } => x.v != null && Number.isFinite(x.v) && (!spec.additive || x.v > 0));
    withVal.sort((a, b) => (asc ? a.v - b.v : b.v - a.v) || a.p.name.localeCompare(b.p.name));
    return withVal;
  }, [people, spec, asc, byDay]);
  const hidden = byDay ? 0 : people.length - rows.length;
  const total = rows.reduce((a, r) => a + r.v, 0);
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.v)));
  const dayRows = byDay ? daily.map((d) => ({ d, v: spec.daily!.value(d) })) : [];
  const dayMax = Math.max(1e-9, ...dayRows.map((r) => r.v));

  return (
    <div className="rp-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="rp-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-sheet-title">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-eyebrow">{personName ? `${personName} · by day` : 'By person'} · {rangeLabel}</div>
            <h2 id="rp-sheet-title">{spec.title}</h2>
            <div className="rp-sheet-value rp-num">{spec.value}</div>
            {spec.note && <p className="rp-sheet-note">{spec.note}</p>}
          </div>
          <button ref={closeRef} type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {!byDay && rows.length > 1 && (
          <div className="rp-sheet-tools">
            <span>{rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
            <button type="button" className="rp-link" onClick={() => setAsc((a) => !a)}>
              {asc ? 'Lowest first' : 'Highest first'}
            </button>
          </div>
        )}
        <ol className="rp-sheet-list">
          {byDay
            ? dayRows.map(({ d, v }) => (
              <li key={d.date} className="rp-sheet-day">
                <button type="button" onClick={() => onOpenDay(d.date)}>
                  <span className="rp-sheet-name">{fmtDay(d.date)}</span>
                  <span className="rp-sheet-bar"><i style={{ width: `${(v / dayMax) * 100}%` }} /></span>
                  <b className="rp-num">{spec.daily!.fmt(v)}</b>
                  <ChevronRight size={15} className="rp-sheet-go" />
                </button>
              </li>
            ))
            : rows.map(({ p, v }, i) => {
              const prevRow = p.prev ? (p.prev as unknown as RowLike) : null;
              const pv = prevRow ? spec.col.value(prevRow) : null;
              const d = pv != null && Number.isFinite(pv) ? change(v, pv) : null;
              return (
                <li key={p.userId}>
                  <button type="button" onClick={() => onOpenPerson(p.userId)}>
                    <span className="rp-sheet-rank rp-num">{i + 1}</span>
                    <span className="rp-sheet-name"><Person name={p.name} /></span>
                    <span className="rp-sheet-bar"><i style={{ width: `${(Math.abs(v) / max) * 100}%` }} /></span>
                    <b className="rp-num">{spec.col.fmt(v, p)}</b>
                    <span className="rp-sheet-share rp-num">
                      {spec.additive && total > 0 ? `${((v / total) * 100).toFixed(v / total < 0.1 ? 1 : 0)}%` : d != null ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : ''}
                    </span>
                    <ChevronRight size={15} className="rp-sheet-go" />
                  </button>
                </li>
              );
            })}
        </ol>
        {!byDay && rows.length === 0 && <Empty>Nobody has any for this period.</Empty>}
        <footer className="rp-sheet-foot">
          {byDay
            ? 'Select a day to open the report for just that day.'
            : `${spec.additive ? 'Right column: share of the total.' : 'Right column: change vs the previous period.'}${hidden ? ` ${hidden} ${hidden === 1 ? 'person has' : 'people have'} none${spec.additive ? '' : ' or too few calls to rate'}.` : ''} Select a person to open their report.`}
        </footer>
      </aside>
    </div>
  );
}
