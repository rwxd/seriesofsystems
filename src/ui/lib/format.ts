import type { Objectives, SimSnapshot } from '@/sim/types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fmtClock(seconds: number, pad = true): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const mm = pad ? String(mins).padStart(2, '0') : String(mins);
  return `${mm}:${String(secs).padStart(2, '0')}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

export function fmtMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 10000) return `$${(rounded / 1000).toFixed(1)}k`;
  return `$${rounded.toLocaleString('en-US')}`;
}

export function fmtMoneyPrecise(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function fmtRps(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function fmtMs(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function fmtPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtAvail(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const pctValue = value * 100;
  if (pctValue >= 99.999) return `${pctValue.toFixed(3)}%`;
  return `${pctValue.toFixed(2)}%`;
}

export function fmtNum(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function fmtSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

/** "Nadia Okafor, CTO, ..." → "Nadia Okafor" */
export function shortName(value: string): string {
  const first = value.split(/[,–—(]/)[0]?.trim();
  return first && first.length > 0 ? first : value;
}

export function hexAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return `rgba(92, 184, 234, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type Tone = 'mint' | 'warn' | 'hot' | 'bad' | 'neutral';

export function utilTone(utilization: number): Tone {
  if (!Number.isFinite(utilization)) return 'neutral';
  if (utilization >= 0.9) return 'bad';
  if (utilization >= 0.75) return 'hot';
  if (utilization >= 0.55) return 'warn';
  return 'mint';
}

export function errorBudgetTone(errorSeconds: number, maxErrorSeconds?: number): Tone {
  if (maxErrorSeconds === undefined) return errorSeconds > 0 ? 'warn' : 'mint';
  if (errorSeconds > maxErrorSeconds) return 'bad';
  if (errorSeconds > maxErrorSeconds * 0.6) return 'warn';
  return errorSeconds > 0 ? 'warn' : 'mint';
}

export interface ObjectiveLine {
  key: string;
  label: string;
  target: string;
  actual: string;
  met: boolean;
}

function p95Target(maxP95Ms: number): string {
  return `≤ ${Math.round(maxP95Ms)} ms`;
}

/** Objective targets with no run data — used on briefing and level cards. */
export function objectiveTargets(objectives: Objectives): Array<{ key: string; label: string; target: string }> {
  const lines: Array<{ key: string; label: string; target: string }> = [];
  if (objectives.maxErrorSeconds !== undefined) {
    lines.push({
      key: 'errorSeconds',
      label: 'Error seconds',
      target: `≤ ${Math.round(objectives.maxErrorSeconds)}s`,
    });
  }
  if (objectives.maxP95Ms !== undefined) {
    lines.push({ key: 'p95', label: 'p95 latency', target: p95Target(objectives.maxP95Ms) });
  }
  if (objectives.maxMonthlyCost !== undefined) {
    lines.push({
      key: 'cost',
      label: 'Monthly cost',
      target: `≤ ${fmtMoney(objectives.maxMonthlyCost)}`,
    });
  }
  if (objectives.noDataLoss) {
    lines.push({ key: 'dataLoss', label: 'Data loss', target: 'none' });
  }
  if (objectives.minAvailability !== undefined) {
    lines.push({
      key: 'availability',
      label: 'Availability',
      target: `≥ ${fmtPct(objectives.minAvailability, 2)}`,
    });
  }
  return lines;
}

/** Objective targets plus live values from the current snapshot. */
export function liveObjectives(objectives: Objectives, snapshot: SimSnapshot | null): ObjectiveLine[] {
  const lines: ObjectiveLine[] = [];
  if (objectives.maxErrorSeconds !== undefined) {
    const actual = snapshot?.errorSeconds ?? 0;
    lines.push({
      key: 'errorSeconds',
      label: 'Error seconds',
      target: `≤ ${Math.round(objectives.maxErrorSeconds)}s`,
      actual: `${Math.round(actual)}s`,
      met: actual <= objectives.maxErrorSeconds,
    });
  }
  if (objectives.maxP95Ms !== undefined) {
    const actual = snapshot?.p95 ?? 0;
    lines.push({
      key: 'p95',
      label: 'p95 latency',
      target: p95Target(objectives.maxP95Ms),
      actual: fmtMs(actual),
      met: actual <= objectives.maxP95Ms,
    });
  }
  if (objectives.maxMonthlyCost !== undefined) {
    const actual = snapshot?.monthlyCost ?? 0;
    lines.push({
      key: 'cost',
      label: 'Monthly cost',
      target: `≤ ${fmtMoney(objectives.maxMonthlyCost)}`,
      actual: fmtMoney(actual),
      met: actual <= objectives.maxMonthlyCost,
    });
  }
  if (objectives.noDataLoss) {
    const actual = snapshot?.dataLossEvents ?? 0;
    lines.push({
      key: 'dataLoss',
      label: 'Data loss',
      target: 'none',
      actual: actual === 0 ? 'none' : `${actual} event${actual === 1 ? '' : 's'}`,
      met: actual === 0,
    });
  }
  if (objectives.minAvailability !== undefined) {
    const actual = snapshot?.availability ?? 1;
    lines.push({
      key: 'availability',
      label: 'Availability',
      target: `≥ ${fmtPct(objectives.minAvailability, 2)}`,
      actual: fmtAvail(actual),
      met: actual >= objectives.minAvailability,
    });
  }
  return lines;
}
