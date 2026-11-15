import { useId } from 'react';

export interface SeriesPoint {
  t: number;
  v: number;
}

function clampSeries(points: SeriesPoint[], max?: number): { pts: SeriesPoint[]; top: number } {
  const clean = points.filter((point) => Number.isFinite(point.v));
  let top = max ?? 0;
  if (max === undefined) {
    for (const point of clean) top = Math.max(top, point.v);
  }
  if (!Number.isFinite(top) || top <= 0) top = 1;
  top *= 1.12;
  return { pts: clean, top };
}

/**
 * Sparkline: stretched to its container. No axes, no labels — used in the
 * timeline strip where space is tight.
 */
export function Sparkline({
  points,
  height = 30,
  color = 'var(--orange)',
  fill = true,
  max,
  ariaLabel,
}: {
  points: SeriesPoint[];
  height?: number;
  color?: string;
  fill?: boolean;
  max?: number;
  ariaLabel?: string;
}) {
  const gradientId = useId();
  const width = 100;
  const { pts, top } = clampSeries(points, max);
  if (pts.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line
          x1="0"
          x2={width}
          y1={height - 1}
          y2={height - 1}
          stroke="var(--ink-faint)"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  const step = width / Math.max(1, pts.length - 1);
  const y = (value: number) => height - 2 - (Math.max(0, value) / top) * (height - 4);
  const line = pts.map((point, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(2)} ${y(point.v).toFixed(2)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradientId})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * LineChart: plot area only. Labels live in HTML so type stays crisp at any
 * container width.
 */
export function LineChart({
  points,
  color = 'var(--orange)',
  max,
  height = 88,
  width = 320,
  ariaLabel,
  dashed = false,
}: {
  points: SeriesPoint[];
  color?: string;
  max?: number;
  height?: number;
  width?: number;
  ariaLabel?: string;
  dashed?: boolean;
}) {
  const gradientId = useId();
  const { pts, top } = clampSeries(points, max);
  const padY = 6;
  const plotH = height - padY * 2;

  if (pts.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel ?? 'No data yet'}>
        <line
          x1="4"
          x2={width - 4}
          y1={height - padY}
          y2={height - padY}
          stroke="var(--ink-faint)"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const step = width / Math.max(1, pts.length - 1);
  const y = (value: number) => padY + plotH - (Math.max(0, value) / top) * plotH;
  const line = pts
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(2)} ${y(point.v).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1="0"
          x2={width}
          y1={padY + plotH * fraction}
          y2={padY + plotH * fraction}
          stroke="rgba(23,33,43,0.12)"
          strokeWidth="1"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={width}
        cy={y(last.v)}
        r="3"
        fill={color}
        stroke="var(--paper-2)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Tiny horizontal bar used in node tables. */
export function UtilBar({ value, width = 56 }: { value: number; width?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const color = pct >= 0.9 ? 'var(--red)' : pct >= 0.75 ? 'var(--orange)' : pct >= 0.55 ? 'var(--amber)' : 'var(--mint)';
  return (
    <svg width={width} height="8" viewBox={`0 0 ${width} 8`} aria-hidden="true">
      <rect x="0.5" y="0.5" width={width - 1} height="7" rx="3.5" fill="var(--paper-sunk)" stroke="var(--ink)" strokeWidth="1" />
      <rect x="1.5" y="1.5" width={Math.max(0, (width - 3) * pct)} height="5" rx="2.5" fill={color} />
    </svg>
  );
}
