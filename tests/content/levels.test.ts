import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVELS,
  TUNED_HEALTH_CHECKS,
  getLevel,
  nextLevel,
} from '../../src/content/levels';
import { createSandbox } from '../../src/content/sandbox';
import {
  CAMPAIGN_WORLD,
  CLOUD_COLORS,
  placementLabel,
  regionById,
  worldSubset,
  zoneById,
} from '../../src/content/worlds';
import { defaultConfig, getSpec, topologyCostPerMonth } from '../../src/sim/catalog';
import type { Scenario, TopologyNode } from '../../src/sim/types';

function peakRps(scenario: Scenario): number {
  return scenario.traffic.reduce((peak, point) => Math.max(peak, point.rps), 0);
}

function initialCost(scenario: Scenario): number {
  return topologyCostPerMonth(scenario.initialTopology, scenario.world, peakRps(scenario));
}

describe('campaign world', () => {
  it('has the three clouds and four regions from the spec', () => {
    expect(CAMPAIGN_WORLD.clouds.map((cloud) => cloud.id)).toEqual(['cumulus', 'stratus', 'nimbus']);
    expect(CAMPAIGN_WORLD.regions.map((region) => region.id)).toEqual([
      'us-east',
      'eu-west',
      'us-west',
      'ap-south',
    ]);
  });

  it('has the spec zone layout', () => {
    expect(CAMPAIGN_WORLD.regions.map((region) => [region.id, region.zones.map((z) => z.id)])).toEqual([
      ['us-east', ['us-east-a', 'us-east-b', 'us-east-c']],
      ['eu-west', ['eu-west-a', 'eu-west-b']],
      ['us-west', ['us-west-a', 'us-west-b']],
      ['ap-south', ['ap-south-a', 'ap-south-b']],
    ]);
  });

  it('has the spec latency table', () => {
    expect(CAMPAIGN_WORLD.latency).toEqual({
      sameZone: 1,
      crossZone: 2,
      crossRegion: 45,
      crossCloud: 70,
    });
  });

  it('assigns every region a cloud that exists and a colour', () => {
    for (const region of CAMPAIGN_WORLD.regions) {
      expect(CAMPAIGN_WORLD.clouds.some((cloud) => cloud.id === region.cloudId)).toBe(true);
      expect(CLOUD_COLORS[region.cloudId]).toBeTruthy();
    }
  });

  it('resolves regions and zones', () => {
    expect(regionById(CAMPAIGN_WORLD, 'eu-west')?.shortName).toBe('eu-west');
    expect(regionById(CAMPAIGN_WORLD, 'nowhere')).toBeUndefined();
    expect(zoneById(CAMPAIGN_WORLD, 'us-east', 'us-east-c')?.name).toBe('us-east-c');
    expect(zoneById(CAMPAIGN_WORLD, 'eu-west', 'us-east-a')).toBeUndefined();
  });

  it('labels placements', () => {
    const globalNode: TopologyNode = {
      id: 'dns',
      kind: 'dns',
      name: 'DNS',
      config: {},
      x: 0,
      y: 0,
    };
    expect(placementLabel(globalNode)).toBe('Global');
    expect(
      placementLabel({
        ...globalNode,
        id: 'lb',
        kind: 'lb',
        cloudId: 'cumulus',
        regionId: 'us-east',
      }),
    ).toBe('cumulus · us-east');
    expect(
      placementLabel({
        ...globalNode,
        id: 'app-1',
        kind: 'vm',
        cloudId: 'cumulus',
        regionId: 'us-east',
        zoneId: 'us-east-a',
      }),
    ).toBe('cumulus · us-east · us-east-a');
  });

  it('builds subsets with the same clouds and latency but only the chosen regions', () => {
    const subset = worldSubset(['us-east', 'eu-west']);
    expect(subset.regions.map((region) => region.id)).toEqual(['us-east', 'eu-west']);
    expect(subset.clouds).toHaveLength(CAMPAIGN_WORLD.clouds.length);
    expect(subset.latency).toEqual(CAMPAIGN_WORLD.latency);
    // Copy, not the same references.
    expect(subset.regions[0]).not.toBe(CAMPAIGN_WORLD.regions[0]);
    expect(subset.regions[0].zones[0]).not.toBe(CAMPAIGN_WORLD.regions[0].zones[0]);
  });
});

describe.each(CAMPAIGN_LEVELS.map((level) => [level.id, level] as const))('level %s', (_id, scenario) => {
  it('is a campaign level with the required shape', () => {
    expect(scenario.sandbox).toBeFalsy();
    expect(scenario.title.length).toBeGreaterThan(0);
    expect(scenario.act).toBeGreaterThanOrEqual(1);
    expect(scenario.order).toBeGreaterThanOrEqual(1);
    expect(scenario.duration).toBeGreaterThanOrEqual(480);
    expect(scenario.duration).toBeLessThanOrEqual(720);
    expect(scenario.customer.length).toBeGreaterThan(0);
    expect(scenario.brief.length).toBeGreaterThan(80);
    expect(scenario.hints.length).toBeGreaterThan(0);
  });

  it('has unique node ids', () => {
    const ids = scenario.initialTopology.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has links that reference existing nodes and unique link ids', () => {
    const ids = new Set(scenario.initialTopology.nodes.map((node) => node.id));
    const linkIds = scenario.initialTopology.links.map((link) => link.id);
    expect(new Set(linkIds).size).toBe(linkIds.length);
    for (const link of scenario.initialTopology.links) {
      expect(ids.has(link.from), `${link.id} from`).toBe(true);
      expect(ids.has(link.to), `${link.id} to`).toBe(true);
      expect(link.from).not.toBe(link.to);
    }
  });

  it('places every node in a region and zone that exist in the scenario world', () => {
    for (const node of scenario.initialTopology.nodes) {
      const spec = getSpec(node.kind);
      const errors = spec.validate?.(node, scenario.initialTopology, scenario.world) ?? [];
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

  it('unlocks every kind it ships in the initial topology', () => {
    for (const node of scenario.initialTopology.nodes) {
      expect(scenario.unlockedKinds).toContain(node.kind);
    }
  });

  it('has entry nodes that exist and are the DNS node', () => {
    expect(scenario.entryNodeIds?.length).toBeGreaterThan(0);
    for (const entryId of scenario.entryNodeIds ?? []) {
      const node = scenario.initialTopology.nodes.find((candidate) => candidate.id === entryId);
      expect(node, entryId).toBeDefined();
      expect(node?.kind).toBe('dns');
      expect(node?.regionId).toBeUndefined();
    }
  });

  it('starts traffic at zero and keeps the curve flat at the end', () => {
    expect(scenario.traffic[0].at).toBe(0);
    expect(scenario.traffic[0].rps).toBe(0);
    expect(scenario.traffic[scenario.traffic.length - 1].at).toBe(scenario.duration);
    for (let i = 1; i < scenario.traffic.length; i += 1) {
      expect(scenario.traffic[i].at).toBeGreaterThan(scenario.traffic[i - 1].at);
    }
    expect(peakRps(scenario)).toBeLessThanOrEqual(200);
  });

  it('schedules incidents inside the run against things that exist', () => {
    expect(scenario.incidents.length).toBeGreaterThan(0);
    const ids = new Set(scenario.initialTopology.nodes.map((node) => node.id));
    for (const incident of scenario.incidents) {
      expect(incident.at).toBeGreaterThan(0);
      expect(incident.at).toBeLessThan(scenario.duration);
      if (incident.duration !== undefined) {
        expect(incident.at + incident.duration).toBeLessThanOrEqual(scenario.duration);
      }
      if (incident.targetId) {
        expect(ids.has(incident.targetId), `${incident.id} target ${incident.targetId}`).toBe(true);
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

  it('defines objectives and keeps the starting topology under budget', () => {
    const objectiveKeys = Object.keys(scenario.objectives);
    expect(objectiveKeys.length).toBeGreaterThan(0);
    expect(scenario.startingBudgetPerMonth).toBeGreaterThan(0);
    const cost = initialCost(scenario);
    expect(cost).toBeGreaterThan(0);
    expect(cost, `starting cost ${cost} vs budget ${scenario.startingBudgetPerMonth}`).toBeLessThan(
      scenario.startingBudgetPerMonth,
    );
  });

  it('requires a database when the app tier talks to Postgres', () => {
    expect(scenario.requiresDatabase).toBe(true);
    expect(scenario.initialTopology.nodes.some((node) => node.kind === 'db')).toBe(true);
  });
});

describe('campaign level order', () => {
  it('has seven unique ordered levels', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(7);
    expect(new Set(CAMPAIGN_LEVELS.map((level) => level.id)).size).toBe(7);
    expect(CAMPAIGN_LEVELS.map((level) => level.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('looks levels up and chains them', () => {
    expect(getLevel('one-is-none')?.title).toBe('One Is None');
    expect(getLevel('nope')).toBeUndefined();
    expect(nextLevel('one-is-none')?.id).toBe('two-is-one');
    expect(nextLevel('the-split-brain')?.id).toBe('pets-and-cattle');
    expect(nextLevel('cache-rules-everything')?.id).toBe('retry-harder');
    expect(nextLevel('cloudy-with-a-chance-of-outage')).toBeUndefined();
    expect(nextLevel('nope')).toBeUndefined();
  });
});

describe('level 1: One Is None', () => {
  const level = getLevel('one-is-none') as Scenario;

  it('ships exactly one zonal app VM and a Multi-AZ database', () => {
    const vms = level.initialTopology.nodes.filter((node) => node.kind === 'vm');
    expect(vms).toHaveLength(1);
    expect(vms[0].zoneId).toBe('us-east-a');

    const db = level.initialTopology.nodes.find((node) => node.kind === 'db');
    expect(db).toBeDefined();
    expect(db?.config.multiAz).toBe(true);
  });

  it('starts with the spec topology', () => {
    const nodes = new Map(level.initialTopology.nodes.map((node) => [node.id, node]));
    expect(nodes.get('dns')?.kind).toBe('dns');
    expect(nodes.get('lb')?.regionId).toBe('us-east');
    expect(nodes.get('app-1')?.regionId).toBe('us-east');
    expect(nodes.get('app-1')?.zoneId).toBe('us-east-a');
    expect(nodes.get('db')?.regionId).toBe('us-east');
    const links = level.initialTopology.links.map((link) => `${link.from}--${link.to}`);
    expect(links).toEqual(['dns--lb', 'lb--app-1', 'app-1--db']);
  });

  it('makes the default health checks too slow to survive a zone loss', () => {
    const lb = level.initialTopology.nodes.find((node) => node.id === 'lb');
    const interval = Number(lb?.config.healthCheckInterval);
    const threshold = Number(lb?.config.unhealthyThreshold);
    // The detection window alone would blow the 10 error-second objective.
    expect(interval * threshold).toBeGreaterThanOrEqual(20);
    expect(interval * threshold).toBeGreaterThan(level.objectives.maxErrorSeconds ?? 0);
  });

  it('has the documented objectives and incident', () => {
    expect(level.objectives).toEqual({
      maxErrorSeconds: 10,
      maxP95Ms: 250,
      maxMonthlyCost: 600,
      noDataLoss: true,
    });
    expect(level.incidents).toHaveLength(1);
    expect(level.incidents[0]).toMatchObject({
      kind: 'zone-down',
      zoneId: 'us-east-a',
      at: 180,
      duration: 60,
    });
  });

  it('provides us-east-b so a second VM is structurally valid', () => {
    expect(zoneById(level.world, 'us-east', 'us-east-b')).toBeDefined();

    const app2: TopologyNode = {
      id: 'app-2',
      kind: 'vm',
      name: 'App B',
      cloudId: 'cumulus',
      regionId: 'us-east',
      zoneId: 'us-east-b',
      config: { ...defaultConfig('vm') },
      x: 560,
      y: 340,
    };

    const spec = getSpec('vm');
    expect(spec.validate?.(app2, level.initialTopology, level.world) ?? []).toEqual([]);

    const nodeIds = new Set(level.initialTopology.nodes.map((node) => node.id));
    const newLinks = [
      { id: 'lb--app-2', from: 'lb', to: 'app-2' },
      { id: 'app-2--db', from: 'app-2', to: 'db' },
    ];
    expect(new Set(newLinks.map((link) => link.id)).size).toBe(newLinks.length);
    for (const link of newLinks) {
      for (const endpoint of [link.from, link.to]) {
        expect(endpoint === 'app-2' || nodeIds.has(endpoint), endpoint).toBe(true);
      }
    }
  });

  it('is winnable inside budget with a second VM and tuned health checks', () => {
    expect(TUNED_HEALTH_CHECKS.healthCheckInterval).toBe(2);
    expect(TUNED_HEALTH_CHECKS.unhealthyThreshold).toBe(2);
    const detectionWindow =
      Number(TUNED_HEALTH_CHECKS.healthCheckInterval) * Number(TUNED_HEALTH_CHECKS.unhealthyThreshold);
    expect(detectionWindow).toBeLessThanOrEqual(level.objectives.maxErrorSeconds ?? 0);

    const withSecondVm: Scenario = {
      ...level,
      initialTopology: {
        nodes: [
          ...level.initialTopology.nodes.map((node) =>
            node.id === 'lb' ? { ...node, config: { ...node.config, ...TUNED_HEALTH_CHECKS } } : node,
          ),
          {
            id: 'app-2',
            kind: 'vm',
            name: 'App B',
            cloudId: 'cumulus',
            regionId: 'us-east',
            zoneId: 'us-east-b',
            config: { ...defaultConfig('vm') },
            x: 560,
            y: 340,
          },
        ],
        links: [
          ...level.initialTopology.links,
          { id: 'lb--app-2', from: 'lb', to: 'app-2' },
          { id: 'app-2--db', from: 'app-2', to: 'db' },
        ],
      },
    };

    const cost = initialCost(withSecondVm);
    expect(cost).toBeLessThanOrEqual(level.objectives.maxMonthlyCost ?? Infinity);
    expect(cost).toBeLessThan(level.startingBudgetPerMonth);
  });
});

describe('level 7: multi-region', () => {
  const level = getLevel('cloudy-with-a-chance-of-outage') as Scenario;

  it('exposes us-east and eu-west but only ships a us-east stack', () => {
    expect(level.world.regions.map((region) => region.id)).toEqual(['us-east', 'eu-west']);
    const regions = new Set(level.initialTopology.nodes.map((node) => node.regionId).filter(Boolean));
    expect([...regions]).toEqual(['us-east']);
  });

  it('has a regional outage inside the run and the documented objectives', () => {
    expect(level.incidents[0]).toMatchObject({
      kind: 'region-down',
      regionId: 'us-east',
      at: 180,
      duration: 120,
    });
    expect(level.objectives).toEqual({
      maxErrorSeconds: 30,
      maxP95Ms: 600,
      maxMonthlyCost: 2500,
    });
  });

  it('leaves room in the budget for an eu-west stack', () => {
    const spare = (level.objectives.maxMonthlyCost ?? 0) - initialCost(level);
    // A regional LB, two VMs, and a Multi-AZ DB in eu-west.
    expect(spare).toBeGreaterThan(20 + 30 + 30 + 120);
  });
});

describe('sandbox', () => {
  it('unlocks every component kind and ships a sensible starter stack', () => {
    const sandbox = createSandbox('normal', 7);
    expect(new Set(sandbox.unlockedKinds)).toEqual(
      new Set(['dns', 'waf', 'cdn', 'lb', 'proxy', 'vm', 'k8s', 'db', 'cache', 'storage']),
    );
    expect(sandbox.sandbox).toBe(true);
    expect(sandbox.duration).toBe(3600);
    expect(sandbox.traffic[0]).toEqual({ at: 0, rps: 0 });
    expect(sandbox.traffic[sandbox.traffic.length - 1].at).toBe(3600);

    const kinds = sandbox.initialTopology.nodes.map((node) => node.kind);
    expect(kinds).toContain('dns');
    expect(kinds).toContain('lb');
    expect(kinds.filter((kind) => kind === 'vm')).toHaveLength(2);
    const db = sandbox.initialTopology.nodes.find((node) => node.kind === 'db');
    expect(db?.config.multiAz).toBe(true);
  });

  it('schedules varied incidents across the full run', () => {
    const sandbox = createSandbox('normal', 7);
    expect(sandbox.incidents.length).toBeGreaterThan(6);
    expect(new Set(sandbox.incidents.map((incident) => incident.kind)).size).toBeGreaterThanOrEqual(6);

    const nodeIds = new Set(sandbox.initialTopology.nodes.map((node) => node.id));
    for (const incident of sandbox.incidents) {
      expect(incident.at).toBeGreaterThan(0);
      expect(incident.at).toBeLessThan(sandbox.duration);
      if (incident.targetId) expect(nodeIds.has(incident.targetId)).toBe(true);
      if (incident.zoneId) {
        expect(zoneById(sandbox.world, incident.regionId ?? 'us-east', incident.zoneId)).toBeDefined();
      }
    }

    for (let i = 1; i < sandbox.incidents.length; i += 1) {
      const gap = sandbox.incidents[i].at - sandbox.incidents[i - 1].at;
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(150);
    }
  });

  it('is deterministic for the same seed and difficulty', () => {
    const a = createSandbox('normal', 4242);
    const b = createSandbox('normal', 4242);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.incidents.map((incident) => incident.id)).toEqual(b.incidents.map((incident) => incident.id));
    expect(a.objectives).toEqual(b.objectives);
  });

  it('produces different schedules for different seeds and difficulties', () => {
    const base = createSandbox('normal', 1);
    const otherSeed = createSandbox('normal', 2);
    const otherDifficulty = createSandbox('chaos', 1);
    expect(JSON.stringify(base.incidents)).not.toBe(JSON.stringify(otherSeed.incidents));
    expect(base.objectives).not.toEqual(otherDifficulty.objectives);
    expect(otherDifficulty.incidents.length).toBeGreaterThan(base.incidents.length - 1);
  });

  it('keeps the starting stack under the sandbox budget in every difficulty', () => {
    for (const difficulty of ['relaxed', 'normal', 'chaos'] as const) {
      const sandbox = createSandbox(difficulty, 11);
      const cost = topologyCostPerMonth(sandbox.initialTopology, sandbox.world, peakRps(sandbox));
      expect(cost).toBeLessThan(sandbox.startingBudgetPerMonth);
      expect(Object.keys(sandbox.objectives).length).toBeGreaterThan(0);
    }
  });
});
