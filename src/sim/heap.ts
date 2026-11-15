/**
 * A tiny binary min-heap.
 *
 * The simulation schedules hundreds of thousands of events, so this avoids any
 * O(n) scans: push and pop are O(log n). Ties are broken by insertion order via
 * the `seq` field, which keeps event processing deterministic.
 */

export interface Timed {
  time: number;
  seq: number;
}

export function compareTimed(a: Timed, b: Timed): number {
  if (a.time !== b.time) return a.time - b.time;
  return a.seq - b.seq;
}

export class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    const items = this.items;
    const value = items[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[parent], value) <= 0) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }

  private siftDown(index: number): void {
    const items = this.items;
    const length = items.length;
    const value = items[index];
    while (true) {
      const left = index * 2 + 1;
      if (left >= length) break;
      const right = left + 1;
      let child = left;
      if (right < length && this.compare(items[right], items[left]) < 0) child = right;
      if (this.compare(items[child], value) >= 0) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = value;
  }
}
