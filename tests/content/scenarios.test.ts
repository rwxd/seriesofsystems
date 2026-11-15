import { describe, expect, it } from 'vitest';
import { CAREER_STAGES } from '../../src/content/career';
import { SCENARIOS, getScenario } from '../../src/content/scenarios';
import { regionById, zoneById } from '../../src/content/worlds';
import { getSpec, topologyCostPerMonth } from '../../src/sim/catalog';
import type { Scenario } from '../../src/sim/types';

function peakRps(scenario: Scenario): number {
  return scenario.traffic.reduce((peak, point) => Math.max(peak, point.rps), 0);
}

function initialCost(scenario: Scenario): number {
  return topologyCostPerMonth(scenario.initialTopology, scenario.world, peakRps(scenario));
}

function kinds(scenario: Scenario): string[] {
  return scenario.initialTopology.nodes.map((node) => node.kind);
}

describe.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('scenario %s', (_id, scenario) => {
  it('is a standalone challenge with the required shape', () => {
    expect(scenario.title.length).toBeGreaterThan(0);
    expect(scenario.subtitle.length).toBeGreaterThan(0);
    expect(scenario.customer.length).toBeGreaterThan(0);
    expect(scenario.brief.length).toBeGreaterThan(80);
    expect(scenario.hints.length).toBeGreaterThan(0);
    expect(scenario.successText.length).toBeGreaterThan(0);
    expect(scenario.failureText.length).toBeGreaterThan(0);
    expect(scenario.sandbox).toBeFalsy();
    expect(scenario.unlockOnComplete).toEqual([]);
    expect(scenario.duration).toBeGreaterThanOrEqual(480);
    expect(scenario.duration).toBeLessThanOrEqual(720);
    expect(scenario.seed).toBeGreaterThan(0);
  });

  it('has unique node ids', () => {
    const nodeIds = scenario.initialTopology.nodes.map((node) => node.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('has links that resolve to existing nodes with unique ids', () => {
    const nodeIds = new Set(scenario.initialTopology.nodes.map((node) => node.id));
    const linkIds = scenario.initialTopology.links.map((link) => link.id);
    expect(new Set(linkIds).size).toBe(linkIds.length);
    for (const link of scenario.initialTopology.links) {
      expect(nodeIds.has(link.from), `${link.id} from`).toBe(true);
      expect(nodeIds.has(link.to), `${link.id} to`).toBe(true);
      expect(link.from).not.toBe(link.to);
    }
  });

  it('places every node in a valid region and zone', () => {
    for (const node of scenario.initialTopology.nodes) {
      const errors = getSpec(node.kind).validate?.(node, scenario.initialTopology, scenario.world) ?? [];
      expect(errors, `${node.id}: ${errors.join(', ')}`).toEqual([]);

      if (node.regionId) {
        const region = regionById(scenario.world, node.regionId);
        expect(region, `${node.id} region`).toBeDefined();
        expect(node.cloudId).toBe(region?.cloudId);
        if (node.zoneId) {
          expect(zoneById(scenario.world, node.regionId, node.zoneId), `${node.id} zone`).toBeDefined();
        }
      }
    }
  });

  it('unlocks every component kind it ships', () => {
    for (const node of scenario.initialTopology.nodes) {
      expect(scenario.unlockedKinds, node.kind).toContain(node.kind);
    }
  });

  it('enters at a global DNS node', () => {
    expect(scenario.entryNodeIds).toContain('dns');
    const dns = scenario.initialTopology.nodes.find((node) => node.id === 'dns');
    expect(dns?.kind).toBe('dns');
    expect(dns?.regionId).toBeUndefined();
    expect(dns?.zoneId).toBeUndefined();
  });

  it('starts traffic at zero, ends at duration, and stays under 200 rps', () => {
    expect(scenario.traffic[0]).toEqual({ at: 0, rps: 0 });
    expect(scenario.traffic[scenario.traffic.length - 1].at).toBe(scenario.duration);
    for (let i = 1; i < scenario.traffic.length; i += 1) {
      expect(scenario.traffic[i].at).toBeGreaterThan(scenario.traffic[i - 1].at);
      expect(scenario.traffic[i].rps).toBeGreaterThanOrEqual(0);
    }
    expect(peakRps(scenario)).toBeLessThanOrEqual(200);
  });

  it('schedules incidents inside the run against things that exist', () => {
    expect(scenario.incidents.length).toBeGreaterThan(0);
    const nodeIds = new Set(scenario.initialTopology.nodes.map((node) => node.id));
    for (const incident of scenario.incidents) {
      expect(incident.at).toBeGreaterThan(0);
      expect(incident.at).toBeLessThan(scenario.duration);
      if (incident.duration !== undefined) {
        expect(incident.at + incident.duration).toBeLessThanOrEqual(scenario.duration);
      }
      if (incident.targetId) {
        expect(nodeIds.has(incident.targetId), `${incident.id} target`).toBe(true);
      }
      if (incident.regionId) {
        expect(regionById(scenario.world, incident.regionId), `${incident.id} region`).toBeDefined();
      }
      if (incident.zoneId) {
        expect(
          zoneById(scenario.world, incident.regionId ?? 'us-east', incident.zoneId),
          `${incident.id} zone`,
        ).toBeDefined();
      }
    }
  });

  it('defines objectives and a starting stack under budget', () => {
    expect(Object.keys(scenario.objectives).length).toBeGreaterThan(0);
    expect(scenario.startingBudgetPerMonth).toBeGreaterThan(0);
    const cost = initialCost(scenario);
    expect(cost).toBeGreaterThan(0);
    if (scenario.objectives.maxMonthlyCost !== undefined) {
      expect(cost).toBeLessThanOrEqual(scenario.objectives.maxMonthlyCost);
    }
    expect(cost, `starting cost ${cost} vs budget ${scenario.startingBudgetPerMonth}`).toBeLessThan(
      scenario.startingBudgetPerMonth,
    );
  });
});

describe('scenario collection', () => {
  it('has five unique standalone challenges', () => {
    expect(SCENARIOS).toHaveLength(5);
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(5);
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'scenario-black-friday',
      'scenario-bad-deploy',
      'scenario-region-down',
      'scenario-zero-day',
      'scenario-the-leak',
    ]);
  });

  it('looks scenarios up by id', () => {
    expect(getScenario('scenario-black-friday')?.title).toBe('Black Friday');
    expect(getScenario('scenario-zero-day')?.title).toBe('Zero Day');
    expect(getScenario('scenario-the-leak')?.title).toBe('The Leak');
    expect(getScenario('nope')).toBeUndefined();
  });

  it('does not reuse career stage ids', () => {
    const careerIds = new Set(CAREER_STAGES.map((stage) => stage.id));
    for (const scenario of SCENARIOS) {
      expect(careerIds.has(scenario.id)).toBe(false);
    }
  });
});

describe('Black Friday', () => {
  const scenario = getScenario('scenario-black-friday') as Scenario;

  it('is a wired e-commerce stack with a spike and a stampede', () => {
    expect(kinds(scenario)).toEqual(['dns', 'cdn', 'lb', 'vm', 'vm', 'cache', 'db']);
    const incidentKinds = scenario.incidents.map((incident) => incident.kind);
    expect(incidentKinds).toContain('traffic-spike');
    expect(incidentKinds).toContain('cache-stampede');
    expect(scenario.incidents.find((incident) => incident.kind === 'cache-stampede')?.targetId).toBe('cache');
  });

  it('ships a cache without stampede protection so the stampede matters', () => {
    const cache = scenario.initialTopology.nodes.find((node) => node.id === 'cache');
    expect(cache?.config.stampedeProtection).toBe(false);
    expect(scenario.unlockedKinds).toContain('cache');
    expect(scenario.unlockedKinds).toContain('cdn');
  });

  it('grades latency, errors, and cost', () => {
    expect(scenario.objectives).toEqual({
      maxP95Ms: 250,
      maxErrorSeconds: 15,
      maxMonthlyCost: 1500,
    });
  });
});

describe('Bad Deploy', () => {
  const scenario = getScenario('scenario-bad-deploy') as Scenario;

  it('runs a k8s stack and ships a bad rollout plus a node failure', () => {
    expect(kinds(scenario)).toEqual(['dns', 'lb', 'k8s', 'db']);
    const incidentKinds = scenario.incidents.map((incident) => incident.kind);
    expect(incidentKinds).toEqual(['bad-deploy', 'zone-down']);
    expect(scenario.incidents[0].targetId).toBe('app-cluster');
    expect(scenario.incidents[1]).toMatchObject({ zoneId: 'us-east-a', regionId: 'us-east' });
  });

  it('starts with readiness off and max-unavailable too high', () => {
    const cluster = scenario.initialTopology.nodes.find((node) => node.kind === 'k8s');
    expect(cluster?.config.readinessProbe).toBe(false);
    expect(cluster?.config.maxUnavailable).toBe(3);
    expect(scenario.unlockedKinds).toContain('k8s');
  });

  it('grades errors and latency', () => {
    expect(scenario.objectives).toEqual({ maxErrorSeconds: 20, maxP95Ms: 300 });
  });
});

describe('Region Down', () => {
  const scenario = getScenario('scenario-region-down') as Scenario;

  it('prebuilds both regional stacks instead of asking for construction', () => {
    expect(scenario.world.regions.map((region) => region.id)).toEqual(['us-east', 'eu-west']);
    const regions = new Set(scenario.initialTopology.nodes.map((node) => node.regionId).filter(Boolean));
    expect([...regions].sort()).toEqual(['eu-west', 'us-east']);

    for (const regionId of ['us-east', 'eu-west']) {
      const regionalNodes = scenario.initialTopology.nodes.filter((node) => node.regionId === regionId);
      expect(regionalNodes.filter((node) => node.kind === 'lb')).toHaveLength(1);
      expect(regionalNodes.filter((node) => node.kind === 'vm')).toHaveLength(2);
      expect(regionalNodes.filter((node) => node.kind === 'db')).toHaveLength(1);
    }
  });

  it('wires DNS to both regional load balancers', () => {
    const dnsTargets = scenario.initialTopology.links
      .filter((link) => link.from === 'dns')
      .map((link) => link.to)
      .sort();
    expect(dnsTargets).toEqual(['lb-eu', 'lb-us']);
  });

  it('has a region outage inside the run and a cost objective', () => {
    expect(scenario.incidents).toHaveLength(1);
    expect(scenario.incidents[0]).toMatchObject({
      kind: 'region-down',
      regionId: 'us-east',
      at: 180,
      duration: 120,
    });
    expect(scenario.objectives.maxMonthlyCost).toBe(2600);
  });

  it('makes DNS failover the lever by shipping a long TTL', () => {
    const dns = scenario.initialTopology.nodes.find((node) => node.id === 'dns');
    expect(Number(dns?.config.ttlSeconds)).toBeGreaterThan(scenario.objectives.maxErrorSeconds ?? 0);
    expect(dns?.config.healthChecks).toBe(true);
  });
});

describe('Zero Day', () => {
  const scenario = getScenario('scenario-zero-day') as Scenario;

  it('ships a proxy and no WAF, with a ddos and a certificate expiry', () => {
    expect(kinds(scenario)).toContain('proxy');
    const incidentKinds = scenario.incidents.map((incident) => incident.kind);
    expect(incidentKinds).toEqual(['ddos', 'cert-expiry']);
    expect(scenario.unlockedKinds).toContain('proxy');
  });

  it('starts with rate limiting off so the player has to turn it on', () => {
    const proxy = scenario.initialTopology.nodes.find((node) => node.kind === 'proxy');
    expect(proxy?.config.rateLimitRps).toBe(0);
    expect(proxy?.config.workerConnections).toBeGreaterThan(0);
  });

  it('grades errors, latency, and cost', () => {
    expect(scenario.objectives).toEqual({
      maxErrorSeconds: 75,
      maxP95Ms: 350,
      maxMonthlyCost: 1200,
    });
  });

  it('keeps the certificate and botnet incidents short enough to survive', () => {
    const cert = scenario.incidents.find((incident) => incident.kind === 'cert-expiry');
    expect(cert?.duration).toBeLessThanOrEqual(scenario.objectives.maxErrorSeconds ?? 0);
    const ddos = scenario.incidents.find((incident) => incident.kind === 'ddos');
    expect((ddos?.duration ?? 0) + (cert?.duration ?? 0)).toBeLessThanOrEqual(
      scenario.objectives.maxErrorSeconds ?? 0,
    );
  });
});
