/**
 * Rolling metric helpers used by the simulation.
 *
 * All of these are pure data structures: they never read wall-clock time. The
 * engine passes simulated seconds in explicitly.
 */

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const clamped = clamp(q, 0, 1);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(clamped * sorted.length) - 1));
  return sorted[index];
}

/**
 * Fixed-size reservoir of the most recent samples. Sorting a copy on demand is
 * cheap for 2000 values and keeps the write path allocation-free.
 */
export class Reservoir {
  private values: number[] = [];
  private cursor = 0;

  constructor(readonly capacity = 2000) {}

  get count(): number {
    return this.values.length;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return;
    }
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  reset(): void {
    this.values.length = 0;
    this.cursor = 0;
  }

  quantile(q: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return quantileSorted(sorted, q);
  }

  mean(): number {
    if (this.values.length === 0) return 0;
    let sum = 0;
    for (const value of this.values) sum += value;
    return sum / this.values.length;
  }

  snapshot(): number[] {
    return [...this.values];
  }
}

export interface SecondBucket {
  sec: number;
  arrivals: number;
  completions: number;
  failures: number;
}

/**
 * Counts arrivals, completions, and failures per simulated second and keeps a
 * short rolling window. `rollTo` returns the buckets that just closed, which
 * the engine uses to update error seconds and chart series.
 */
export class BucketTracker {
  private finalized: SecondBucket[] = [];
  private current: SecondBucket = { sec: 0, arrivals: 0, completions: 0, failures: 0 };

  constructor(private readonly window = 10) {}

  get currentSec(): number {
    return this.current.sec;
  }

  get currentArrivals(): number {
    return this.current.arrivals;
  }

  arrive(count = 1): void {
    this.current.arrivals += count;
  }

  complete(ok: boolean): void {
    this.current.completions += 1;
    if (!ok) this.current.failures += 1;
  }

  rollTo(sec: number): SecondBucket[] {
    const closed: SecondBucket[] = [];
    while (this.current.sec < sec) {
      const finished = this.current;
      closed.push(finished);
      this.finalized.push(finished);
      while (this.finalized.length > this.window) this.finalized.shift();
      this.current = { sec: finished.sec + 1, arrivals: 0, completions: 0, failures: 0 };
    }
    return closed;
  }

  recent(sec: number, span = this.window): SecondBucket[] {
    return this.finalized.filter((bucket) => bucket.sec > sec - span);
  }

  /** Average arrivals/sec over the last `span` closed seconds. */
  rate(sec: number, span = 5): number {
    const buckets = this.recent(sec, span);
    if (buckets.length === 0) return this.current.arrivals;
    let total = 0;
    for (const bucket of buckets) total += bucket.arrivals;
    return total / buckets.length;
  }
}

interface CounterRow {
  sec: number;
  values: Record<string, number>;
}

/** A small per-second sliding counter (used for retry budgets and node rates). */
export class SlidingCounter {
  private rows: CounterRow[] = [];

  constructor(private readonly window = 5) {}

  add(sec: number, key: string, count = 1): void {
    let row = this.rows[this.rows.length - 1];
    if (!row || row.sec !== sec) {
      row = { sec, values: {} };
      this.rows.push(row);
    }
    row.values[key] = (row.values[key] ?? 0) + count;
    this.prune(sec);
  }

  total(sec: number, key: string): number {
    this.prune(sec);
    let sum = 0;
    for (const row of this.rows) {
      if (row.sec > sec - this.window) sum += row.values[key] ?? 0;
    }
    return sum;
  }

  reset(): void {
    this.rows.length = 0;
  }

  private prune(sec: number): void {
    while (this.rows.length > 0 && this.rows[0].sec <= sec - this.window) {
      this.rows.shift();
    }
  }
}
