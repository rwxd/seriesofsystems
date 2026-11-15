import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/sim/catalog';
import { estimateAvailability } from '../../src/sim/availability';
import { createSimulation } from '../../src/sim/engine';
import type {
  ComponentKind,
  NodeConfig,
  Scenario,
  ScenarioIncident,
  Simulation,
  Topology,
  TopologyLink,
  TopologyNode,
  World,
} from '../../src/sim/types';

// ---------------------------------------------------------------------------
// Minimal fixture world
// ---------------------------------------------------------------------------

const world: World = {
  clouds: [
    { id: 'cumulus', name: 'Cumulus', color: '#4c8', blurb: '' },
    { id: 'stratus', name: 'Stratus', color: '#48c', blurb: '' },
    { id: 'nimbus', name: 'Nimbus', color: '#84c', blurb: '' },
  ],
  regions: [
    {
      id: 'us-east',
      name: 'US East',
      shortName: 'use1',
      cloudId: 'cumulus',
      zones: [
        { id: 'us-east-a', name: 'US East A', shortName: 'a' },
        { id: 'us-east-b', name: 'US East B', shortName: 'b' },
        { id: 'us-east-c', name: 'US East C', shortName: 'c' },
      ],
    },
    {
      id: 'eu-west',
      name: 'EU West',
      shortName: 'euw1',
      cloudId: 'cumulus',
      zones: [
        { id: 'eu-west-a', name: 'EU West A', shortName: 'a' },
        { id: 'eu-west-b', name: 'EU West B', shortName: 'b' },
      ],
    },
  ],
  latency: { sameZone: 1, crossZone: 2, crossRegion: 45, crossCloud: 70 },
};

function makeNode(
  id: string,
  kind: ComponentKind,
  placement: { regionId?: string; zoneId?: string } = {},
  config: NodeConfig = {},
): TopologyNode {
  const region = placement.regionId
    ? world.regions.find((candidate) => candidate.id === placement.regionId)
    : undefined;
  return {
    id,
    kind,
    name: id,
    regionId: placement.regionId,
    zoneId: placement.zoneId,
    cloudId: region?.cloudId,
    config: { ...defaultConfig(kind), ...config },
    x: 0,
    y: 0,
  };
}

function makeLink(from: string, to: string): TopologyLink {
  return { id: `${from}->${to}`, from, to };
}

function makeTopology(nodes: TopologyNode[], links: TopologyLink[]): Topology {
  return { nodes, links };
}

/** dns -> lb -> vm -> db */
function basicTopology(vmConfig: NodeConfig = {}, dbConfig: NodeConfig = {}): Topology {
  return makeTopology(
    [
      makeNode('dns', 'dns'),
      makeNode('lb', 'lb', { regionId: 'us-east' }),
      makeNode('vm', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }, vmConfig),
      makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true, ...dbConfig }),
    ],
    [makeLink('dns', 'lb'), makeLink('lb', 'vm'), makeLink('vm', 'db')],
  );
}

function makeScenario(topology: Topology, overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'test-scenario',
    act: 1,
    order: 1,
    title: 'Test Scenario',
    subtitle: '',
    customer: '',
    brief: '',
    hints: [],
    world,
    initialTopology: topology,
    unlockedKinds: ['dns', 'cdn', 'lb', 'proxy', 'vm', 'k8s', 'db', 'cache', 'storage'],
    traffic: [
      { at: 0, rps: 20 },
      { at: 120, rps: 20 },
    ],
    duration: 40,
    incidents: [],
    objectives: {},
    seed: 1234,
    startingBudgetPerMonth: 1000,
    successText: '',
    failureText: '',
    requiresDatabase: true,
    ...overrides,
  };
}

function makeIncident(incident: Partial<ScenarioIncident> & Pick<ScenarioIncident, 'id' | 'kind'>): ScenarioIncident {
  return {
    at: 5,
    duration: 10,
    title: incident.kind,
    message: `${incident.kind} test incident`,
    severity: 'critical',
    ...incident,
  };
}

function start(topology: Topology, overrides: Partial<Scenario> = {}): Simulation {
  const scenario = makeScenario(topology, overrides);
  const sim = createSimulation(scenario, topology);
  sim.start();
  return sim;
}

function runUntil(sim: Simulation, target: number): void {
  let guard = 0;
  while (sim.time < target - 1e-9 && !sim.ended) {
    const remaining = target - sim.time;
    sim.tick(Math.min(0.5, remaining));
    guard += 1;
    if (guard > 100000) throw new Error('runUntil guard exceeded');
  }
}

describe('simulation engine', () => {
  it('serves a healthy request path with sane metrics', () => {
    const topology = basicTopology();
    const sim = start(topology, { duration: 20, traffic: [{ at: 0, rps: 20 }, { at: 60, rps: 20 }] });
    runUntil(sim, 10);

    const snapshot = sim.snapshot();
    expect(snapshot.requests).toBeGreaterThan(80);
    expect(snapshot.failures).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.availability).toBe(1);
    expect(snapshot.p95).toBeGreaterThan(0);
    expect(snapshot.p95).toBeLessThan(500);
    expect(snapshot.monthlyCost).toBeGreaterThan(0);
    expect(snapshot.ended).toBe(false);
    expect(snapshot.series.rps.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.series.errors.every((point) => point.v === 0)).toBe(true);

    for (const id of ['dns', 'lb', 'vm', 'db']) {
      expect(snapshot.nodes[id].status).toBe('healthy');
      expect(snapshot.nodes[id].requests).toBeGreaterThan(0);
    }
    expect(snapshot.nodes.db.requests).toBeGreaterThan(0);
    expect(snapshot.nodes.db.requests).toBeLessThanOrEqual(snapshot.nodes.vm.requests);
  });

  it('queues requests at a saturated node and raises p95 latency', () => {
    const topology = basicTopology({ size: 'small', appLatencyMs: 200 });

    const low = start(topology, { duration: 20, traffic: [{ at: 0, rps: 20 }, { at: 60, rps: 20 }] });
    runUntil(low, 20);
    const lowSnapshot = low.snapshot();

    const high = start(topology, { duration: 20, traffic: [{ at: 0, rps: 60 }, { at: 60, rps: 60 }] });
    runUntil(high, 20);
    const highSnapshot = high.snapshot();

    expect(highSnapshot.p95).toBeGreaterThan(lowSnapshot.p95 * 1.5);
    expect(highSnapshot.nodes.vm.utilization).toBeGreaterThanOrEqual(0.9);
    expect(highSnapshot.nodes.vm.queue).toBeGreaterThan(0);
    expect(highSnapshot.requests).toBeGreaterThan(lowSnapshot.requests * 2);
  });

  it('fails requests that exceed the client deadline', () => {
    const topology = basicTopology({ size: 'large', appLatencyMs: 5000 });
    const sim = start(topology, { duration: 20, traffic: [{ at: 0, rps: 10 }, { at: 60, rps: 10 }] });
    runUntil(sim, 12);

    const snapshot = sim.snapshot();
    expect(snapshot.failures).toBeGreaterThan(0);
    expect(snapshot.availability).toBeLessThan(1);
    expect(snapshot.errorRate).toBeGreaterThan(0);
    expect(snapshot.nodes.vm.failures).toBeGreaterThan(0);

    const traces = sim.traces();
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.some((trace) => !trace.ok && trace.status === 504)).toBe(true);
  });

  it('has an LB health-check detection window before ejecting a dead backend', () => {
    const topology = makeTopology(
      [
        makeNode('dns', 'dns'),
        makeNode('lb', 'lb', { regionId: 'us-east' }, {
          algorithm: 'round-robin',
          healthCheckInterval: 2,
          unhealthyThreshold: 3,
          healthyThreshold: 2,
        }),
        makeNode('app-a', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }),
        makeNode('app-b', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
        makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
      ],
      [
        makeLink('dns', 'lb'),
        makeLink('lb', 'app-a'),
        makeLink('lb', 'app-b'),
        makeLink('app-a', 'db'),
        makeLink('app-b', 'db'),
      ],
    );
    const sim = start(topology, {
      duration: 30,
      traffic: [{ at: 0, rps: 40 }, { at: 60, rps: 40 }],
      incidents: [
        makeIncident({ id: 'crash-a', kind: 'node-crash', at: 5, duration: 60, targetId: 'app-a' }),
      ],
    });

    runUntil(sim, 9);
    const duringWindow = sim.snapshot();
    expect(duringWindow.failures).toBeGreaterThan(0);
    expect(duringWindow.nodes['app-a'].status).toBe('down');

    runUntil(sim, 12);
    const afterEjection = sim.snapshot();
    runUntil(sim, 16);
    const later = sim.snapshot();

    // Once ejected, traffic stops failing (the detection window is closed).
    expect(later.failures - afterEjection.failures).toBe(0);
    expect(sim.eventLog().some((event) => event.title.startsWith('Backend ejected'))).toBe(true);
  });

  it('survives a zone failure better with two app VMs in separate zones', () => {
    const incident = makeIncident({
      id: 'zone-a-out',
      kind: 'zone-down',
      at: 5,
      duration: 10,
      zoneId: 'us-east-a',
      title: 'us-east-a down',
    });

    const single = basicTopology();
    const singleSim = start(single, {
      duration: 60,
      traffic: [{ at: 0, rps: 20 }, { at: 120, rps: 20 }],
      incidents: [incident],
    });
    runUntil(singleSim, 60);
    const singleSnapshot = singleSim.snapshot();

    const dual = makeTopology(
      [
        makeNode('dns', 'dns'),
        makeNode('lb', 'lb', { regionId: 'us-east' }, {
          algorithm: 'round-robin',
          healthCheckInterval: 2,
          unhealthyThreshold: 2,
          healthyThreshold: 2,
        }),
        makeNode('app-a', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }),
        makeNode('app-b', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
        makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
      ],
      [
        makeLink('dns', 'lb'),
        makeLink('lb', 'app-a'),
        makeLink('lb', 'app-b'),
        makeLink('app-a', 'db'),
        makeLink('app-b', 'db'),
      ],
    );
    const dualSim = start(dual, {
      duration: 60,
      traffic: [{ at: 0, rps: 20 }, { at: 120, rps: 20 }],
      incidents: [incident],
    });
    runUntil(dualSim, 60);
    const dualSnapshot = dualSim.snapshot();

    expect(dualSnapshot.failures).toBeLessThan(singleSnapshot.failures * 0.75);
    expect(dualSnapshot.availability).toBeGreaterThan(singleSnapshot.availability);
    expect(dualSnapshot.availability).toBeGreaterThan(0.85);
  });

  it('handles DB multi-AZ, no-HA, and async failover differently', () => {
    const zoneIncident = makeIncident({
      id: 'db-zone',
      kind: 'zone-down',
      at: 5,
      duration: 10,
      zoneId: 'us-east-a',
    });

    const build = (dbConfig: NodeConfig): Topology =>
      makeTopology(
        [
          makeNode('dns', 'dns'),
          makeNode('lb', 'lb', { regionId: 'us-east' }),
          makeNode('vm', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
          makeNode('db', 'db', { regionId: 'us-east' }, dbConfig),
        ],
        [makeLink('dns', 'lb'), makeLink('lb', 'vm'), makeLink('vm', 'db')],
      );

    const run = (topology: Topology) => {
      const sim = start(topology, {
        duration: 40,
        traffic: [{ at: 0, rps: 20 }, { at: 120, rps: 20 }],
        incidents: [zoneIncident],
      });
      runUntil(sim, 40);
      return sim.snapshot();
    };

    const multiAz = run(build({ multiAz: true }));
    const noHa = run(build({ multiAz: false, replicas: 0, automaticFailover: false }));
    const asyncFailover = run(build({ multiAz: false, replicas: 2, automaticFailover: true, replication: 'async' }));

    expect(multiAz.failures).toBeGreaterThan(0);
    expect(multiAz.failures).toBeLessThan(noHa.failures);
    expect(noHa.failures).toBeLessThan(asyncFailover.failures);
    expect(multiAz.dataLossEvents).toBe(0);
    expect(noHa.dataLossEvents).toBe(0);
    expect(asyncFailover.dataLossEvents).toBeGreaterThan(0);
  });

  it('reduces database load with a cache in front of it', () => {
    const noCache = basicTopology();
    const withCache = makeTopology(
      [
        makeNode('dns', 'dns'),
        makeNode('lb', 'lb', { regionId: 'us-east' }),
        makeNode('vm', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }),
        makeNode('cache', 'cache', { regionId: 'us-east', zoneId: 'us-east-a' }, { ttlSeconds: 300 }),
        makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
      ],
      [
        makeLink('dns', 'lb'),
        makeLink('lb', 'vm'),
        makeLink('vm', 'cache'),
        makeLink('cache', 'db'),
      ],
    );

    const options: Partial<Scenario> = {
      duration: 30,
      traffic: [{ at: 0, rps: 30 }, { at: 120, rps: 30 }],
    };

    const noCacheSim = start(noCache, options);
    runUntil(noCacheSim, 30);
    const noCacheSnapshot = noCacheSim.snapshot();

    const withCacheSim = start(withCache, options);
    runUntil(withCacheSim, 30);
    const withCacheSnapshot = withCacheSim.snapshot();

    expect(withCacheSnapshot.nodes.cache.requests).toBeGreaterThan(0);
    expect(withCacheSnapshot.nodes.db.requests).toBeGreaterThan(0);
    expect(withCacheSnapshot.nodes.db.requests).toBeLessThan(noCacheSnapshot.nodes.db.requests * 0.6);
  });

  it('limits bad-deploy impact when k8s readiness probes are enabled', () => {
    const build = (readinessProbe: boolean): Topology =>
      makeTopology(
        [
          makeNode('dns', 'dns'),
          makeNode('lb', 'lb', { regionId: 'us-east' }),
          makeNode('k8s', 'k8s', { regionId: 'us-east' }, {
            pods: 6,
            hpaMin: 6,
            hpaMax: 12,
            readinessProbe,
            livenessProbe: true,
            maxUnavailable: 1,
          }),
          makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
        ],
        [makeLink('dns', 'lb'), makeLink('lb', 'k8s'), makeLink('k8s', 'db')],
      );

    const run = (readinessProbe: boolean) => {
      const sim = start(build(readinessProbe), {
        duration: 40,
        traffic: [{ at: 0, rps: 20 }, { at: 120, rps: 20 }],
        incidents: [
          makeIncident({ id: 'bad-deploy', kind: 'bad-deploy', at: 5, duration: 20, targetId: 'k8s' }),
        ],
      });
      runUntil(sim, 40);
      return sim.snapshot();
    };

    const ready = run(true);
    const unready = run(false);

    expect(ready.failures).toBeLessThan(unready.failures * 0.1);
    expect(unready.failures).toBeGreaterThan(100);
    expect(unready.nodes.k8s.failures).toBeGreaterThan(0);
  });

  it('is deterministic for identical seeds, topology, and incidents', () => {
    const topology = makeTopology(
      [
        makeNode('dns', 'dns'),
        makeNode('lb', 'lb', { regionId: 'us-east' }, { algorithm: 'random', healthCheckInterval: 2 }),
        makeNode('app-a', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }),
        makeNode('app-b', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
        makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
      ],
      [
        makeLink('dns', 'lb'),
        makeLink('lb', 'app-a'),
        makeLink('lb', 'app-b'),
        makeLink('app-a', 'db'),
        makeLink('app-b', 'db'),
      ],
    );
    const overrides: Partial<Scenario> = {
      seed: 987654,
      duration: 50,
      traffic: [
        { at: 0, rps: 10 },
        { at: 20, rps: 60 },
        { at: 60, rps: 30 },
      ],
      incidents: [
        makeIncident({ id: 'z', kind: 'zone-down', at: 7, duration: 8, zoneId: 'us-east-a' }),
        makeIncident({ id: 'slow', kind: 'node-slow', at: 25, duration: 6, targetId: 'lb' }),
      ],
    };

    const first = start(topology, overrides);
    runUntil(first, 50);
    const second = start(topology, overrides);
    runUntil(second, 50);

    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.eventLog().map((event) => [event.id, event.kind, event.title])).toEqual(
      second.eventLog().map((event) => [event.id, event.kind, event.title]),
    );
  });

  it('recovers a crashed node with the restart runbook', () => {
    const topology = basicTopology();
    const sim = start(topology, {
      duration: 60,
      incidents: [
        makeIncident({ id: 'crash', kind: 'node-crash', at: 5, duration: 60, targetId: 'vm' }),
      ],
    });

    runUntil(sim, 10);
    expect(sim.snapshot().nodes.vm.status).toBe('down');

    const result = sim.runRunbook('restart', 'vm');
    expect(result.ok).toBe(true);

    runUntil(sim, 14);
    expect(sim.snapshot().nodes.vm.status).toBe('healthy');
    expect(sim.snapshot().nodes.vm.replicasUp).toBe(1);
  });

  it('caps retries with the retry budget', () => {
    const build = (retryBudgetPct: number): Topology =>
      makeTopology(
        [
          makeNode('dns', 'dns'),
          makeNode('proxy', 'proxy', { regionId: 'us-east', zoneId: 'us-east-a' }, {
            retries: 2,
            retryBudgetPct,
            readTimeoutMs: 10000,
          }),
          makeNode('vm', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }, {
            size: 'large',
            appLatencyMs: 4000,
          }),
          makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
        ],
        [makeLink('dns', 'proxy'), makeLink('proxy', 'vm'), makeLink('vm', 'db')],
      );

    const run = (retryBudgetPct: number) => {
      const sim = start(build(retryBudgetPct), {
        duration: 40,
        traffic: [{ at: 0, rps: 10 }, { at: 120, rps: 10 }],
      });
      runUntil(sim, 40);
      return sim;
    };

    const unlimited = run(0);
    const budgeted = run(10);

    expect(unlimited.snapshot().requests).toBeGreaterThan(budgeted.snapshot().requests * 1.5);
    expect(unlimited.snapshot().failures).toBeGreaterThan(0);
    expect(budgeted.traces().some((trace) => trace.retries > 0)).toBe(true);
  });

  it('estimates higher availability with parallel app replicas in separate zones', () => {
    const single = basicTopology();
    const dual = makeTopology(
      [
        makeNode('dns', 'dns'),
        makeNode('lb', 'lb', { regionId: 'us-east' }),
        makeNode('app-a', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }),
        makeNode('app-b', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
        makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true }),
      ],
      [
        makeLink('dns', 'lb'),
        makeLink('lb', 'app-a'),
        makeLink('lb', 'app-b'),
        makeLink('app-a', 'db'),
        makeLink('app-b', 'db'),
      ],
    );

    const singleEstimate = estimateAvailability(single, world, makeScenario(single));
    const dualEstimate = estimateAvailability(dual, world, makeScenario(dual));

    expect(singleEstimate).toBeGreaterThan(0);
    expect(singleEstimate).toBeLessThan(1);
    expect(dualEstimate).toBeGreaterThan(singleEstimate);
    expect(dualEstimate).toBeLessThanOrEqual(1);
  });

  it('applies a new topology while running and preserves matching node state', () => {
    const topology = basicTopology();
    topology.nodes[1].config = { ...topology.nodes[1].config, algorithm: 'round-robin' };
    const sim = start(topology, {
      duration: 40,
      traffic: [{ at: 0, rps: 20 }, { at: 120, rps: 20 }],
    });
    runUntil(sim, 10);
    const before = sim.snapshot();

    const expanded: Topology = {
      nodes: [
        ...topology.nodes,
        makeNode('vm-b', 'vm', { regionId: 'us-east', zoneId: 'us-east-b' }),
      ],
      links: [
        ...topology.links,
        makeLink('lb', 'vm-b'),
        makeLink('vm-b', 'db'),
      ],
    };

    sim.applyTopology(expanded);
    const afterDeploy = sim.snapshot();

    expect(afterDeploy.nodes['vm-b']).toBeDefined();
    expect(afterDeploy.nodes['vm-b'].requests).toBe(0);
    expect(afterDeploy.nodes.dns.requests).toBe(before.nodes.dns.requests);
    expect(sim.eventLog().some((event) => event.kind === 'deploy')).toBe(true);

    runUntil(sim, 20);
    const later = sim.snapshot();
    expect(later.nodes['vm-b'].requests).toBeGreaterThan(0);
    expect(later.failures).toBe(before.failures);
  });

  it('runs a 600s, 200 RPS scenario quickly', () => {
    const topology = basicTopology();
    const sim = start(topology, {
      duration: 600,
      traffic: [{ at: 0, rps: 200 }, { at: 600, rps: 200 }],
    });

    const startedAt = Date.now();
    let guard = 0;
    while (sim.time < 600 - 1e-9 && !sim.ended) {
      sim.tick(1);
      guard += 1;
      if (guard > 2000) throw new Error('perf loop guard exceeded');
    }
    const elapsedMs = Date.now() - startedAt;
    const snapshot = sim.snapshot();

    expect(snapshot.ended).toBe(true);
    expect(snapshot.requests).toBeGreaterThan(100000);
    expect(snapshot.failures).toBe(0);
    // Generous bound for a shared CI box; locally this is well under a second.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
