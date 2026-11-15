import { describe, expect, it } from 'vitest';
import { getLevel } from '@/content/levels';
import type { NodeConfig, Scenario, SimSnapshot, Topology } from '@/sim/types';
import { createSimulation } from '@/sim/engine';

function simulate(level: Scenario, topology: Topology): SimSnapshot {
  const sim = createSimulation(level, topology);
  sim.start();
  let guard = 0;
  while (!sim.ended && guard < 6000) {
    sim.tick(0.5);
    guard += 1;
  }
  return sim.snapshot();
}

function tune(topology: Topology, id: string, patch: NodeConfig): void {
  const node = topology.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`missing ${id}`);
  node.config = { ...node.config, ...patch };
}

describe('level 2: database HA', () => {
  const level = getLevel('two-is-one')!;

  it('fails without a standby', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.errorSeconds).toBeGreaterThan(15);
  });

  it('survives with Multi-AZ and no data loss', () => {
    const topology = structuredClone(level.initialTopology);
    tune(topology, 'db', { multiAz: true });
    const snapshot = simulate(level, topology);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(15);
    expect(snapshot.dataLossEvents).toBe(0);
  });
});

describe('level 3: the split brain', () => {
  const level = getLevel('the-split-brain')!;

  it('loses data with async replication and automatic failover', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.dataLossEvents).toBeGreaterThan(0);
  });

  it('keeps data with synchronous replication', () => {
    const topology = structuredClone(level.initialTopology);
    tune(topology, 'db', { replication: 'sync' });
    const snapshot = simulate(level, topology);
    expect(snapshot.dataLossEvents).toBe(0);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(70);
  });
});

describe('level 4: kubernetes', () => {
  const level = getLevel('pets-and-cattle')!;

  it('lets a bad deploy reach users without readiness probes', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.errorSeconds).toBeGreaterThan(20);
  });

  it('contains a bad deploy with readiness and a safe rollout', () => {
    const topology = structuredClone(level.initialTopology);
    tune(topology, 'app-cluster', {
      readinessProbe: true,
      livenessProbe: true,
      maxUnavailable: 0,
      pods: 4,
      hpaMin: 3,
    });
    const snapshot = simulate(level, topology);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(20);
    expect(snapshot.p95).toBeLessThanOrEqual(300);
  });
});

describe('level 5: cache and CDN', () => {
  const level = getLevel('cache-rules-everything')!;

  it('melts down when the cache expires without protection', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.errorSeconds > 15 || snapshot.p95 > 250).toBe(true);
  });

  it('survives with stampede protection and an origin shield', () => {
    const topology = structuredClone(level.initialTopology);
    tune(topology, 'cache', { stampedeProtection: true, ttlSeconds: 300 });
    tune(topology, 'cdn', { originShield: true, ttlSeconds: 300 });
    const snapshot = simulate(level, topology);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(15);
    expect(snapshot.p95).toBeLessThanOrEqual(250);
    expect(snapshot.monthlyCost).toBeLessThanOrEqual(1500);
  });
});
