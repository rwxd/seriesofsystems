import { describe, expect, it } from 'vitest';
import { getScenario } from '@/content/scenarios';
import { createLink, createNode } from '@/game/topology';
import { createSimulation } from '@/sim/engine';
import type { NodeConfig, Scenario, SimSnapshot, Topology } from '@/sim/types';

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

function hardened(level: Scenario): Topology {
  const topology = structuredClone(level.initialTopology);
  tune(topology, 'db', { publicAccess: false, encryption: true, backups: true });
  tune(topology, 'app-1', { secrets: 'vault', patching: 'auto' });
  tune(topology, 'app-2', { secrets: 'vault', patching: 'auto' });
  tune(topology, 'lb', { tlsAutoRenew: true });
  tune(topology, 'nginx', { rateLimitRps: 200 });

  const waf = createNode('waf', {}, 180, -40, topology);
  waf.config = { ...waf.config, mode: 'block', rateLimitRps: 1000, botProtection: true };
  topology.nodes.push(waf);
  topology.links = topology.links.filter((link) => !(link.from === 'dns' && link.to === 'lb'));
  const dnsToWaf = createLink('dns', waf.id, topology);
  const wafToLb = createLink(waf.id, 'lb', topology);
  if (dnsToWaf) topology.links.push(dnsToWaf);
  if (wafToLb) topology.links.push(wafToLb);
  return topology;
}

describe('scenario: the leak', () => {
  const level = getScenario('scenario-the-leak')!;

  it('leaks data with public storage, plain secrets and no patching', () => {
    const snapshot = simulate(level, structuredClone(level.initialTopology));
    expect(snapshot.dataLossEvents).toBeGreaterThan(0);
    expect(snapshot.errorSeconds).toBeGreaterThan(70);
  });

  it('survives when the data tier, secrets and patching are hardened, with a WAF', () => {
    const snapshot = simulate(level, hardened(level));
    expect(snapshot.dataLossEvents).toBe(0);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(70);
    expect(snapshot.p95).toBeLessThanOrEqual(400);
    expect(snapshot.monthlyCost).toBeLessThanOrEqual(1500);
  });
});
