import { describe, expect, it } from 'vitest';
import { TUNED_HEALTH_CHECKS, getLevel } from '@/content/levels';
import { buildPostmortem } from '@/content/postmortem';
import { cloneTopology, createLink, createNode } from '@/game/topology';
import { createSimulation } from '@/sim/engine';
import type { Postmortem, Scenario, SimSnapshot, Topology } from '@/sim/types';

function simulate(level: Scenario, topology: Topology): SimSnapshot {
  return run(level, topology).snapshot;
}

function run(level: Scenario, topology: Topology): { snapshot: SimSnapshot; postmortem: Postmortem } {
  const sim = createSimulation(level, topology);
  sim.start();
  let guard = 0;
  while (!sim.ended && guard < 5000) {
    sim.tick(0.5);
    guard += 1;
  }
  const snapshot = sim.snapshot();
  return { snapshot, postmortem: buildPostmortem(level, snapshot, sim.eventLog(), topology) };
}

function fixedTopology(level: Scenario, linkDatabase = true): Topology {
  const topology = cloneTopology(level.initialTopology);
  const lb = topology.nodes.find((node) => node.id === 'lb')!;
  lb.config = { ...lb.config, ...TUNED_HEALTH_CHECKS };
  const app = createNode('vm', { regionId: 'us-east', zoneId: 'us-east-b' }, 570, 340, topology);
  topology.nodes.push(app);
  const lbLink = createLink('lb', app.id, topology);
  if (lbLink) topology.links.push(lbLink);
  if (linkDatabase) {
    const dbLink = createLink(app.id, 'db', topology);
    if (dbLink) topology.links.push(dbLink);
  }
  return topology;
}

describe('level 1 acceptance', () => {
  const level = getLevel('one-is-none')!;

  it('fails when the only app VM disappears with its zone', () => {
    const { snapshot, postmortem } = run(level, cloneTopology(level.initialTopology));
    expect(snapshot.errorSeconds).toBeGreaterThan(10);
    expect(snapshot.availability).toBeLessThan(0.999);
    expect(postmortem.outcome).toBe('failure');
    expect(postmortem.rootCause).toMatch(/every VM|shared|single point/i);
  });

  it('survives a zone loss with a second VM and tuned health checks', () => {
    const { snapshot, postmortem } = run(level, fixedTopology(level));
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(10);
    expect(snapshot.availability).toBeGreaterThan(0.99);
    expect(snapshot.dataLossEvents).toBe(0);
    expect(snapshot.monthlyCost).toBeLessThanOrEqual(600);
    expect(snapshot.p95).toBeLessThanOrEqual(250);
    expect(postmortem.outcome).toBe('success');
    expect(postmortem.rootCause).toMatch(/kept serving|redundancy|blast radius/i);
    expect(postmortem.actionItems.join(' ')).toMatch(/two compute replicas/i);
  });

  it('does not let a second app VM silently skip the database', () => {
    const snapshot = simulate(level, fixedTopology(level, false));
    expect(snapshot.errorSeconds).toBeGreaterThan(10);
  });

  it('is deterministic for the same seed and topology', () => {
    const a = simulate(level, fixedTopology(level));
    const b = simulate(level, fixedTopology(level));
    expect(a.requests).toBe(b.requests);
    expect(a.failures).toBe(b.failures);
    expect(a.errorSeconds).toBe(b.errorSeconds);
    expect(a.p95).toBe(b.p95);
  });
});
