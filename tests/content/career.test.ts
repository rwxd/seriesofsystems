import { describe, expect, it } from 'vitest';
import {
  CAREER_STAGES,
  getCareerStage,
  isCareerUnlocked,
  nextCareerStage,
} from '../../src/content/career';
import { TUNED_HEALTH_CHECKS } from '../../src/content/levels';
import { regionById, zoneById } from '../../src/content/worlds';
import { defaultConfig, getSpec, topologyCostPerMonth } from '../../src/sim/catalog';
import type { Profile, Scenario, TopologyNode } from '../../src/sim/types';

function peakRps(scenario: Scenario): number {
  return scenario.traffic.reduce((peak, point) => Math.max(peak, point.rps), 0);
}

function initialCost(scenario: Scenario): number {
  return topologyCostPerMonth(scenario.initialTopology, scenario.world, peakRps(scenario));
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    version: 1,
    stars: {},
    completed: [],
    unlocked: [],
    settings: { reducedMotion: false, sound: false, showHints: true },
    sandboxBest: 0,
    ...overrides,
  };
}

const ids = CAREER_STAGES.map((stage) => stage.id);

describe.each(CAREER_STAGES.map((stage) => [stage.id, stage] as const))('career stage %s', (_id, scenario) => {
  it('has the required shape and a playable duration', () => {
    expect(scenario.title.length).toBeGreaterThan(0);
    expect(scenario.subtitle.length).toBeGreaterThan(0);
    expect(scenario.customer.length).toBeGreaterThan(0);
    expect(scenario.brief.length).toBeGreaterThan(80);
    expect(scenario.hints.length).toBeGreaterThan(0);
    expect(scenario.successText.length).toBeGreaterThan(0);
    expect(scenario.failureText.length).toBeGreaterThan(0);
    expect(scenario.act).toBeGreaterThanOrEqual(1);
    expect(scenario.order).toBeGreaterThanOrEqual(1);
    expect(scenario.seed).toBeGreaterThan(0);
    expect(scenario.sandbox).toBeFalsy();
    expect(scenario.duration).toBeGreaterThanOrEqual(480);
    expect(scenario.duration).toBeLessThanOrEqual(720);
    expect(scenario.unlockOnComplete).toEqual([]);
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
      expect(incident.title.length).toBeGreaterThan(0);
      expect(incident.message.length).toBeGreaterThan(0);
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

describe('career ladder', () => {
  it('has five unique stages in story order', () => {
    expect(CAREER_STAGES).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([
      'career-one-box',
      'career-database',
      'career-traffic',
      'career-orchestration',
      'career-planet',
    ]);
    expect(CAREER_STAGES.map((stage) => stage.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('looks stages up and chains them', () => {
    expect(getCareerStage('career-one-box')?.title).toBe('One Box');
    expect(getCareerStage('career-planet')?.title).toBe('Planet Scale');
    expect(getCareerStage('nope')).toBeUndefined();
    expect(nextCareerStage('career-one-box')?.id).toBe('career-database');
    expect(nextCareerStage('career-traffic')?.id).toBe('career-orchestration');
    expect(nextCareerStage('career-planet')).toBeUndefined();
    expect(nextCareerStage('nope')).toBeUndefined();
  });

  it('unlocks the first stage for a brand new profile', () => {
    const fresh = makeProfile();
    expect(isCareerUnlocked(fresh, 'career-one-box')).toBe(true);
    expect(isCareerUnlocked(fresh, 'career-database')).toBe(false);
    expect(isCareerUnlocked(fresh, 'career-traffic')).toBe(false);
    expect(isCareerUnlocked(fresh, 'career-planet')).toBe(false);
    expect(isCareerUnlocked(fresh, 'nope')).toBe(false);
  });

  it('unlocks each stage only after the previous stage is completed', () => {
    for (let i = 1; i < CAREER_STAGES.length; i += 1) {
      const previous = CAREER_STAGES[i - 1].id;
      const current = CAREER_STAGES[i].id;

      expect(isCareerUnlocked(makeProfile(), current)).toBe(false);
      expect(isCareerUnlocked(makeProfile({ completed: [previous] }), current)).toBe(true);

      // Completing a later stage out of order must not skip the chain.
      const outOfOrder = makeProfile({ completed: [...ids.slice(0, i - 1), current] });
      expect(isCareerUnlocked(outOfOrder, current)).toBe(false);
    }
  });

  it('treats completion as a set and keeps the whole ladder open for a veteran', () => {
    const veteran = makeProfile({ completed: [...ids] });
    for (const id of ids) {
      expect(isCareerUnlocked(veteran, id)).toBe(true);
    }
  });
});

describe('stage 1: One Box', () => {
  const stage = getCareerStage('career-one-box') as Scenario;

  it('genuinely starts from a DNS record and one web server', () => {
    const nodes = stage.initialTopology.nodes;
    expect(nodes.map((node) => node.kind).sort()).toEqual(['dns', 'vm']);

    const vms = nodes.filter((node) => node.kind === 'vm');
    expect(vms).toHaveLength(1);
    expect(vms[0].id).toBe('app-1');
    expect(vms[0].zoneId).toBe('us-east-a');

    expect(nodes.some((node) => node.kind === 'db')).toBe(false);
    expect(nodes.some((node) => node.kind === 'lb')).toBe(false);
    expect(stage.initialTopology.links.map((link) => link.id)).toEqual(['dns--app-1']);
  });

  it('does not require a database and does not unlock one', () => {
    expect(stage.requiresDatabase).toBe(false);
    expect(stage.unlockedKinds).not.toContain('db');
    expect([...stage.unlockedKinds].sort()).toEqual(['dns', 'lb', 'vm']);
  });

  it('has the documented low-traffic objectives and a crash inside the run', () => {
    expect(stage.objectives).toEqual({ maxErrorSeconds: 10, maxP95Ms: 300 });
    expect(stage.incidents[0]).toMatchObject({
      kind: 'node-crash',
      targetId: 'app-1',
      at: 120,
      duration: 30,
    });
    // A single small VM on a trickle of traffic is not the bottleneck.
    expect(peakRps(stage)).toBeLessThanOrEqual(getSpec('vm').capacity(stage.initialTopology.nodes[1], stage.world));
  });

  it('is winnable with the restart runbook', () => {
    const restartSeconds = 3; // The restart runbook brings a down node back in 3 s.
    expect(restartSeconds).toBeLessThanOrEqual(stage.objectives.maxErrorSeconds ?? 0);
    expect(stage.duration).toBeGreaterThan(stage.incidents[0].at + (stage.incidents[0].duration ?? 0));
  });

  it('has room in the budget to add a load balancer and a second VM', () => {
    const spare = stage.startingBudgetPerMonth - initialCost(stage);
    expect(spare).toBeGreaterThan(getSpec('lb').baseCostPerMonth + getSpec('vm').baseCostPerMonth);

    expect(zoneById(stage.world, 'us-east', 'us-east-b')).toBeDefined();
    const app2: TopologyNode = {
      id: 'app-2',
      kind: 'vm',
      name: 'Second web server',
      cloudId: 'cumulus',
      regionId: 'us-east',
      zoneId: 'us-east-b',
      config: { ...defaultConfig('vm') },
      x: 570,
      y: 340,
    };
    expect(getSpec('vm').validate?.(app2, stage.initialTopology, stage.world) ?? []).toEqual([]);

    const detectionWindow =
      Number(TUNED_HEALTH_CHECKS.healthCheckInterval) * Number(TUNED_HEALTH_CHECKS.unhealthyThreshold);
    expect(detectionWindow).toBeLessThanOrEqual(stage.objectives.maxErrorSeconds ?? 0);
  });
});

describe('the ladder grows visibly', () => {
  it('adds compute redundancy and then a database before caching', () => {
    const oneBox = getCareerStage('career-one-box') as Scenario;
    const database = getCareerStage('career-database') as Scenario;
    const traffic = getCareerStage('career-traffic') as Scenario;

    expect(oneBox.initialTopology.nodes.filter((node) => node.kind === 'vm')).toHaveLength(1);
    expect(database.initialTopology.nodes.filter((node) => node.kind === 'vm')).toHaveLength(2);
    expect(database.initialTopology.nodes.some((node) => node.kind === 'db')).toBe(true);

    expect(database.unlockedKinds).toContain('db');
    expect(traffic.unlockedKinds).toContain('cache');
    expect(traffic.unlockedKinds).toContain('cdn');
  });

  it('reaches Kubernetes then multi-region', () => {
    const orchestration = getCareerStage('career-orchestration') as Scenario;
    const planet = getCareerStage('career-planet') as Scenario;

    expect(orchestration.initialTopology.nodes.some((node) => node.kind === 'k8s')).toBe(true);
    expect(orchestration.unlockedKinds).toContain('k8s');

    expect(planet.world.regions.map((region) => region.id)).toEqual(['us-east', 'eu-west']);
    const regions = new Set(planet.initialTopology.nodes.map((node) => node.regionId).filter(Boolean));
    expect([...regions]).toEqual(['us-east']);
    expect(planet.unlockedKinds).toEqual(['dns', 'cdn', 'lb', 'proxy', 'vm', 'k8s', 'db', 'cache', 'storage']);
    expect(planet.incidents[0]).toMatchObject({ kind: 'region-down', regionId: 'us-east' });
  });

  it('keeps the company story anchored to one engineer at a time', () => {
    for (const stage of CAREER_STAGES) {
      expect(stage.brief.length).toBeGreaterThan(200);
      expect(stage.customer.length).toBeGreaterThan(0);
    }
  });
});
