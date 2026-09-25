// Small SVG chart kit for the Reports page.
//
// Hand-rolled rather than a chart library: five shapes cover every report,
// and each one needs to match the app's tokens in both themes exactly.
// Charts measure their container and draw in real pixels, so axis text is
// never stretched by a viewBox.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// ── Tooltip ─────────────────────────────────────────────────────────────

let tipEl: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'rp-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

/** Tooltip lines are set as text nodes — names and numbers never become HTML. */
export function tipHandlers(title: string, lines: string[]) {
  return {
    onMouseMove: (e: React.MouseEvent) => {
      const el = ensureTip();
      el.replaceChildren();
      const b = document.createElement('b');
      b.textContent = title;
      el.appendChild(b);
      for (const l of lines) {
        const d = document.createElement('div');
        d.textContent = l;
        el.appendChild(d);
      }
      el.style.opacity = '1';
      const w = el.offsetWidth;
      const x = e.clientX + 14 + w > window.innerWidth ? e.clientX - w - 14 : e.clientX + 14;
      el.style.left = `${x}px`;
      el.style.top = `${e.clientY + 14}px`;
    },
    onMouseLeave: () => {
      if (tipEl) tipEl.style.opacity = '0';
    },
  };
}

export function useHideTipOnUnmount() {
  useEffect(() => () => { if (tipEl) tipEl.style.opacity = '0'; }, []);
}

// ── Sizing ──────────────────────────────────────────────────────────────

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Axis top = 4 × a round step, so every tick label is a whole, readable
// number (0, 10, 20, 30, 40 — never 7.5, 15, 22.5).
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const step = m * mag;
    if (step >= raw && Number.isInteger(step)) return step * 4;
  }
  return Math.ceil(raw) * 4;
}

function ticks(max: number, n = 4): number[] {
  return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
}

const compact = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);

function topRounded(x: number, y: number, w: number, h: number, r = 3): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ── Stacked / grouped columns ───────────────────────────────────────────

export interface Series {
  key: string;
  name: string;
  color: string;
}

export function StackedColumns({
  data,
  series,
  height = 220,
  labelEvery,
  tooltip,
  onSelect,
}: {
  data: Array<{ label: string; values: number[] }>;
  series: Series[];
  height?: number;
  labelEvery?: number;
  tooltip: (i: number) => { title: string; lines: string[] };
  /** Makes each column clickable (e.g. open that day). */
  onSelect?: (i: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  useHideTipOnUnmount();
  const L = 44, R = 6, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...data.map((d) => d.values.reduce((a, b) => a + b, 0))));
  const iw = Math.max(0, width - L - R);
  const ih = height - T - B;
  const bw = data.length ? iw / data.length : 0;
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 64))));
  return (
    <div ref={ref} className="rp-chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(' and ')}>
          {ticks(max).map((v) => {
            const y = T + ih - (v / max) * ih;
            return (
              <g key={v}>
                <line className="rp-gridline" x1={L} x2={width - R} y1={y} y2={y} />
                <text className="rp-axis" x={L - 8} y={y + 4} textAnchor="end">{compact(v)}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const x = L + i * bw + bw * 0.16;
            const w = Math.max(1, bw * 0.68);
            let base = T + ih;
            const segs = d.values.map((v, si) => {
              const h = (v / max) * ih;
              if (h <= 0) return null;
              const top = si === d.values.length - 1 || d.values.slice(si + 1).every((x2) => x2 <= 0);
              const y = base - h;
              const el = top
                ? <path key={si} d={topRounded(x, y, w, h)} fill={series[si].color} />
                : <rect key={si} x={x} y={y} width={w} height={h} fill={series[si].color} />;
              base = y - (h > 3 ? 2 : 0);
              return el;
            });
            const tip = tooltip(i);
            return (
              <g
                key={d.label}
                className={onSelect ? 'rp-hit rp-hit-click' : 'rp-hit'}
                {...tipHandlers(tip.title, onSelect ? [...tip.lines, 'Click to open this day'] : tip.lines)}
                onClick={onSelect ? () => { if (tipEl) tipEl.style.opacity = '0'; onSelect(i); } : undefined}
              >
                <rect x={L + i * bw} y={T} width={bw} height={ih} fill="transparent" />
                {segs}
                {i % every === 0 && (
                  <text className="rp-axis" x={L + i * bw + bw / 2} y={height - 8} textAnchor="middle">{d.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ── Single-series columns with value labels (distributions) ─────────────

export function Columns({
  data,
  height = 220,
  color = 'var(--rp-s1)',
  highlight,
  valueLabel,
  tooltip,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
  highlight?: (i: number) => string | null;
  valueLabel?: (v: number, i: number) => string;
  tooltip: (i: number) => { title: string; lines: string[] };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  useHideTipOnUnmount();
  const L = 44, R = 6, T = 22, B = 26;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const iw = Math.max(0, width - L - R);
  const ih = height - T - B;
  const bw = data.length ? iw / data.length : 0;
  return (
    <div ref={ref} className="rp-chart">
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {ticks(max).map((v) => {
            const y = T + ih - (v / max) * ih;
            return (
              <g key={v}>
                <line className="rp-gridline" x1={L} x2={width - R} y1={y} y2={y} />
                <text className="rp-axis" x={L - 8} y={y + 4} textAnchor="end">{compact(v)}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const h = (d.value / max) * ih;
            const x = L + i * bw + bw * 0.16;
            const w = Math.max(1, bw * 0.68);
            const y = T + ih - h;
            const tip = tooltip(i);
            return (
              <g key={d.label} className="rp-hit" {...tipHandlers(tip.title, tip.lines)}>
                <rect x={L + i * bw} y={T} width={bw} height={ih} fill="transparent" />
                {h > 0 && <path d={topRounded(x, y, w, h, 4)} fill={highlight?.(i) ?? color} />}
                {valueLabel && (
                  <text className="rp-value" x={x + w / 2} y={y - 6} textAnchor="middle">{valueLabel(d.value, i)}</text>
                )}
                <text className="rp-axis" x={x + w / 2} y={height - 8} textAnchor="middle">{d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ── Heatmap ─────────────────────────────────────────────────────────────

const RAMP = ['var(--rp-h0)', 'var(--rp-h1)', 'var(--rp-h2)', 'var(--rp-h3)', 'var(--rp-h4)', 'var(--rp-h5)', 'var(--rp-h6)', 'var(--rp-h7)'];

export function Heatmap({
  grid,
  rowLabels,
  colLabels,
  cellTip,
}: {
  grid: number[][];
  rowLabels: string[];
  colLabels: string[];
  cellTip: (r: number, c: number, v: number) => { title: string; lines: string[] };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  useHideTipOnUnmount();
  const L = 40, T = 4, B = 22;
  const rows = grid.length;
  const cols = colLabels.length;
  const cw = cols ? Math.max(8, (width - L) / cols) : 0;
  const ch = 30;
  const height = T + rows * ch + B;
  const max = Math.max(1, ...grid.flat());
  // Quantile-free stepping: 0 is its own colour so "nobody called" reads as
  // empty, then seven even steps up to the busiest cell.
  const step = (v: number) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999)));
  return (
    <div ref={ref} className="rp-chart">
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {grid.map((row, r) => (
            <g key={r}>
              <text className="rp-axis" x={L - 10} y={T + r * ch + ch / 2 + 4} textAnchor="end">{rowLabels[r]}</text>
              {row.map((v, c) => {
                const tip = cellTip(r, c, v);
                return (
                  <rect
                    key={c}
                    className="rp-cell"
                    x={L + c * cw + 1}
                    y={T + r * ch + 1}
                    width={cw - 2}
                    height={ch - 2}
                    rx={4}
                    fill={RAMP[step(v)]}
                    {...tipHandlers(tip.title, tip.lines)}
                  />
                );
              })}
            </g>
          ))}
          {colLabels.map((l, c) => (cols <= 14 || c % 2 === 0) && (
            <text key={c} className="rp-axis" x={L + c * cw + cw / 2} y={height - 6} textAnchor="middle">{l}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

export function HeatLegend({ maxLabel }: { maxLabel: string }) {
  return (
    <div className="rp-legend rp-heat-legend">
      <span>Fewer</span>
      {RAMP.map((c) => <i key={c} style={{ background: c }} />)}
      <span>{maxLabel}</span>
    </div>
  );
}

// ── Meter ───────────────────────────────────────────────────────────────

export type Tone = 'good' | 'warn' | 'crit' | 'neutral';

export function toneFor(ratio: number | null, goodAt: number, warnAt: number): Tone {
  if (ratio == null) return 'neutral';
  if (ratio >= goodAt) return 'good';
  if (ratio >= warnAt) return 'warn';
  return 'crit';
}

export function Meter({ label, ratio, display, foot, tone }: {
  label: string;
  ratio: number | null;
  display: string;
  foot?: ReactNode;
  tone: Tone;
}) {
  return (
    <div className="rp-meter">
      <div className="rp-meter-top">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <div className="rp-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio == null ? undefined : Math.round(ratio * 100)} aria-label={label}>
        <i className={`rp-tone-${tone}`} style={{ width: `${Math.max(0, Math.min(1, ratio ?? 0)) * 100}%` }} />
      </div>
      {foot && <div className="rp-meter-foot">{foot}</div>}
    </div>
  );
}

// ── Horizontal bar list (breakdowns) ────────────────────────────────────

export function BarList({ items, color = 'var(--rp-s1)', format = (v: number) => String(v) }: {
  items: Array<{ label: string; value: number; hint?: string; color?: string; onClick?: () => void }>;
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="rp-barlist">
      {items.map((it) => {
        const inner = (
          <>
            <div className="rp-barlist-top">
              <span>{it.label}</span>
              <b className="rp-num">{format(it.value)}{it.onClick && <ChevronRight size={14} className="rp-barlist-go" aria-hidden="true" />}</b>
            </div>
            <div className="rp-barlist-track">
              <i style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? color }} />
            </div>
            {it.hint && <div className="rp-barlist-hint">{it.hint}</div>}
          </>
        );
        return (
          <li key={it.label}>
            {it.onClick
              ? <button type="button" className="rp-barlist-btn" onClick={it.onClick} aria-label={`${it.label}: ${format(it.value)}. Show by person`}>{inner}</button>
              : inner}
          </li>
        );
      })}
    </ul>
  );
}

// ── Sparkline (KPI tiles) ───────────────────────────────────────────────

export function Sparkline({ values }: { values: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = 28;
  if (values.length < 2) return <div ref={ref} className="rp-spark" />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, h - 3 - (v / max) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} className="rp-spark" aria-hidden="true">
      {width > 0 && (
        <svg width={width} height={h}>
          <path d={`${line}L${last[0]},${h}L2,${h}Z`} className="rp-spark-area" />
          <path d={line} className="rp-spark-line" />
          <circle cx={last[0]} cy={last[1]} r={2.5} className="rp-spark-dot" />
        </svg>
      )}
    </div>
  );
}
