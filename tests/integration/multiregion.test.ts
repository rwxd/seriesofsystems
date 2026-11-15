import { describe, expect, it } from 'vitest';
import { getLevel } from '@/content/levels';
import { createLink, createNode } from '@/game/topology';
import { createSimulation } from '@/sim/engine';
import type { NodeConfig, Scenario, SimSnapshot, Topology } from '@/sim/types';

function tune(topology: Topology, id: string, patch: NodeConfig): void {
  const node = topology.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`missing ${id}`);
  node.config = { ...node.config, ...patch };
}

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

function withEuWest(level: Scenario): Topology {
  const topology = structuredClone(level.initialTopology);
  const dns = topology.nodes.find((node) => node.id === 'dns')!;
  dns.config = { ...dns.config, ttlSeconds: 30 };

  const euLb = createNode('lb', { cloudId: 'cumulus', regionId: 'eu-west' }, 820, 170, topology);
  const euA = createNode('vm', { cloudId: 'cumulus', regionId: 'eu-west', zoneId: 'eu-west-a' }, 740, 340, topology);
  const euB = createNode('vm', { cloudId: 'cumulus', regionId: 'eu-west', zoneId: 'eu-west-b' }, 920, 340, topology);
  const euDb = createNode('db', { cloudId: 'cumulus', regionId: 'eu-west' }, 830, 500, topology);
  euDb.config = { ...euDb.config, multiAz: true };
  topology.nodes.push(euLb, euA, euB, euDb);

  for (const [from, to] of [
    [dns.id, euLb.id],
    [euLb.id, euA.id],
    [euLb.id, euB.id],
    [euA.id, euDb.id],
    [euB.id, euDb.id],
  ] as const) {
    const link = createLink(from, to, topology);
    if (link) topology.links.push(link);
  }
  return topology;
}

describe('level 6: retries and slow backends', () => {
  const level = getLevel('retry-harder')!;

  it('fails when round-robin keeps feeding the slow backend', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.errorSeconds).toBeGreaterThan(25);
  });

  it('survives after sending traffic away from the slow backend', () => {
    const topology = structuredClone(level.initialTopology);
    tune(topology, 'nginx', { algorithm: 'least-conn' });
    const snapshot = simulate(level, topology);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(25);
    expect(snapshot.p95).toBeLessThanOrEqual(400);
  });
});

describe('level 7: multi-region', () => {
  const level = getLevel('cloudy-with-a-chance-of-outage')!;

  it('fails when the only region disappears', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.errorSeconds).toBeGreaterThan(30);
  });

  it('survives a regional outage with a second region and a short DNS TTL', () => {
    const snapshot = simulate(level, withEuWest(level));
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(30);
    expect(snapshot.p95).toBeLessThanOrEqual(600);
    expect(snapshot.monthlyCost).toBeLessThanOrEqual(2500);
  });
});
