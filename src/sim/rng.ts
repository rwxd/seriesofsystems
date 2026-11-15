/**
 * Deterministic pseudo-random number generation.
 *
 * The simulation must never touch `Math.random()` or wall-clock time. Every
 * random decision goes through an `Rng` created from the scenario seed, so two
 * runs with the same inputs produce exactly the same output.
 */

export interface Rng {
  /** Normalised seed used to create this stream. */
  readonly seed: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** True with the given probability (default 0.5). */
  bool(probability?: number): boolean;
  /** Pick one element, or undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
}

/** Mulberry32 — small, fast, and plenty good for a game simulation. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const normalized = Number.isFinite(seed) ? seed >>> 0 : 0;
  const next = mulberry32(normalized);

  return {
    seed: normalized,
    next,
    int(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
    bool(probability = 0.5): boolean {
      return next() < probability;
    },
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[Math.floor(next() * items.length)];
    },
  };
}

/** Stable hash for deriving seeds from strings/numbers without Math.random. */
export function hashSeed(...values: Array<number | string>): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const text = typeof value === 'number' ? value.toFixed(6) : String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x9e3779b9;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  }
  return hash >>> 0;
}
