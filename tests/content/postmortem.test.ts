import { describe, expect, it } from 'vitest';
import { buildPostmortem, formatAvailability, formatCost, formatLatency, formatSeconds } from '../../src/content/postmortem';
import type {
  GameEvent,
  Scenario,
  SimSnapshot,
  Topology,
  World,
} from '../../src/sim/types';

const world: World = {
  clouds: [
    { id: 'cumulus', name: 'Cumulus Cloud', color: '#000', blurb: 'Default cloud.' },
    { id: 'stratus', name: 'Stratus', color: '#111', blurb: 'The other cloud.' },
    { id: 'nimbus', name: 'Nimbus', color: '#222', blurb: 'The third cloud.' },
  ],
  regions: [
    {
      id: 'us-east',
      name: 'US East',
      shortName: 'USE',
      cloudId: 'cumulus',
      zones: [
        { id: 'us-east-a', name: 'US East A', shortName: 'A' },
        { id: 'us-east-b', name: 'US East B', shortName: 'B' },
        { id: 'us-east-c', name: 'US East C', shortName: 'C' },
      ],
    },
    {
      id: 'eu-west',
      name: 'EU West',
      shortName: 'EUW',
      cloudId: 'cumulus',
      zones: [
        { id: 'eu-west-a', name: 'EU West A', shortName: 'A' },
        { id: 'eu-west-b', name: 'EU West B', shortName: 'B' },
      ],
    },
  ],
  latency: { sameZone: 1, crossZone: 2, crossRegion: 45, crossCloud: 70 },
};

/** Level 1-ish: one app VM in us-east-a, single-AZ async DB. */
function fragileTopology(): Topology {
  return {
    nodes: [
      { id: 'dns', kind: 'dns', name: 'DNS', config: { ttlSeconds: 300, routing: 'failover', healthChecks: true }, x: 100, y: 100 },
      {
        id: 'lb',
        kind: 'lb',
        name: 'Edge LB',
        cloudId: 'cumulus',
        regionId: 'us-east',
        config: {
          algorithm: 'least-conn',
          healthCheckInterval: 10,
          unhealthyThreshold: 5,
          healthyThreshold: 2,
          timeoutMs: 3000,
          drainingSeconds: 0,
        },
        x: 300,
        y: 140,
      },
      {
        id: 'app-1',
        kind: 'vm',
        name: 'App A',
        cloudId: 'cumulus',
        regionId: 'us-east',
        zoneId: 'us-east-a',
        config: { size: 'small', replicas: 1 },
        x: 500,
        y: 220,
      },
      {
        id: 'db',
        kind: 'db',
        name: 'Primary DB',
        cloudId: 'cumulus',
        regionId: 'us-east',
        config: {
          size: 'small',
          replicas: 1,
          multiAz: false,
          replication: 'async',
          automaticFailover: true,
          connectionLimit: 100,
          storageGb: 100,
        },
        x: 720,
        y: 300,
      },
    ],
    links: [
      { id: 'l1', from: 'dns', to: 'lb' },
      { id: 'l2', from: 'lb', to: 'app-1' },
      { id: 'l3', from: 'app-1', to: 'db' },
    ],
  };
}

function healthyScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'level-1',
    act: 1,
    order: 1,
    title: 'One Is None',
    subtitle: 'App HA',
    customer: 'Acme Freight',
    brief: 'Keep the depot online.',
    hints: [],
    world,
    initialTopology: fragileTopology(),
    unlockedKinds: ['lb', 'vm', 'db'],
    traffic: [
      { at: 0, rps: 20 },
      { at: 300, rps: 60 },
    ],
    duration: 300,
    incidents: [
      {
        id: 'i1',
        at: 180,
        duration: 60,
        kind: 'zone-down',
        zoneId: 'us-east-a',
        title: 'Zone us-east-a is unreachable',
        message: 'A whole zone vanished.',
        severity: 'critical',
      },
    ],
    objectives: { maxErrorSeconds: 10, maxP95Ms: 250, maxMonthlyCost: 600, noDataLoss: true, minAvailability: 0.999 },
    seed: 7,
    startingBudgetPerMonth: 600,
    successText: 'The depot kept moving.',
    failureText: 'The depot did not keep moving.',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SimSnapshot> = {}): SimSnapshot {
  const base: SimSnapshot = {
    time: 300,
    duration: 300,
    running: false,
    ended: true,
    rps: 60,
    requests: 12000,
    failures: 0,
    errorRate: 0,
    p50: 40,
    p95: 120,
    p99: 200,
    errorSeconds: 0,
    availability: 1,
    monthlyCost: 420,
    dataLossEvents: 0,
    dbLagMs: 20,
    nodes: {
      'app-1': {
        nodeId: 'app-1',
        status: 'healthy',
        rps: 60,
        inFlight: 4,
        queue: 0,
        capacity: 12,
        utilization: 0.5,
        errorRate: 0,
        p95: 120,
        requests: 12000,
        failures: 0,
        replicasUp: 1,
        replicasTotal: 1,
      },
      db: {
        nodeId: 'db',
        status: 'healthy',
        rps: 60,
        inFlight: 2,
        queue: 0,
        capacity: 25,
        utilization: 0.4,
        errorRate: 0,
        p95: 40,
        requests: 12000,
        failures: 0,
        replicasUp: 1,
        replicasTotal: 1,
      },
    },
    links: {
      l1: { linkId: 'l1', rps: 60, utilization: 0.1, status: 'up' },
      l2: { linkId: 'l2', rps: 60, utilization: 0.1, status: 'up' },
      l3: { linkId: 'l3', rps: 60, utilization: 0.1, status: 'up' },
    },
    incidents: [],
    issues: [],
    series: {
      rps: [
        { t: 0, v: 20 },
        { t: 150, v: 60 },
        { t: 300, v: 60 },
      ],
      errors: [],
      p95: [],
      cost: [],
    },
  };
  return { ...base, ...overrides };
}

let eventCounter = 0;
function event(
  at: number,
  kind: GameEvent['kind'],
  severity: GameEvent['severity'],
  title: string,
  extra: Partial<GameEvent> = {},
): GameEvent {
  eventCounter += 1;
  return {
    id: `e${eventCounter}`,
    at,
    kind,
    severity,
    title,
    message: title,
    ...extra,
  };
}

describe('buildPostmortem scoring', () => {
  it('awards 3 stars when every objective is met', () => {
    const scenario = healthyScenario();
    const snapshot = makeSnapshot({ availability: 1, errorSeconds: 0, p95: 120, monthlyCost: 420, dataLossEvents: 0 });
    const postmortem = buildPostmortem(
      scenario,
      snapshot,
      [event(0, 'deploy', 'info', 'Deployed v1'), event(300, 'objective', 'info', 'Objectives met')],
      fragileTopology(),
    );

    expect(postmortem.stars).toBe(3);
    expect(postmortem.outcome).toBe('success');
    expect(postmortem.objectives.every((result) => result.met)).toBe(true);
    expect(postmortem.levelId).toBe('level-1');
    expect(postmortem.levelTitle).toBe('One Is None');
  });

  it('awards 0 stars when the run fails the availability and error-budget objectives', () => {
    const scenario = healthyScenario();
    const snapshot = makeSnapshot({
      availability: 0.97,
      errorSeconds: 42,
      failures: 360,
      errorRate: 0.03,
      p95: 900,
      monthlyCost: 420,
    });
    const postmortem = buildPostmortem(
      scenario,
      snapshot,
      [event(180, 'incident', 'critical', 'Zone us-east-a is unreachable')],
      fragileTopology(),
    );

    expect(postmortem.stars).toBe(0);
    expect(postmortem.outcome).toBe('failure');
    expect(postmortem.objectives.find((result) => result.key === 'minAvailability')?.met).toBe(false);
    expect(postmortem.objectives.find((result) => result.key === 'maxErrorSeconds')?.met).toBe(false);
    expect(postmortem.headline.length).toBeGreaterThan(0);
    expect(postmortem.summary).toContain('Acme Freight');
  });

  it('awards 2 stars for a budget-only miss: survived, but over the monthly cap', () => {
    const scenario = healthyScenario();
    const snapshot = makeSnapshot({ availability: 0.9995, errorSeconds: 4, p95: 180, monthlyCost: 900 });
    const postmortem = buildPostmortem(scenario, snapshot, [event(180, 'incident', 'warning', 'Zone blip')], fragileTopology());

    expect(postmortem.outcome).toBe('success');
    expect(postmortem.stars).toBe(2);
    const cost = postmortem.objectives.find((result) => result.key === 'maxMonthlyCost');
    expect(cost?.met).toBe(false);
    expect(cost?.actual).toBe('$900/mo');
    expect(cost?.target).toBe('≤ $600/mo');
  });

  it('treats a p95 miss alone as a 2-star run', () => {
    const scenario = healthyScenario();
    const snapshot = makeSnapshot({ p95: 400, errorSeconds: 2, availability: 0.9998, monthlyCost: 500 });
    const postmortem = buildPostmortem(scenario, snapshot, [], fragileTopology());
    expect(postmortem.stars).toBe(2);
    expect(postmortem.outcome).toBe('success');
  });
});

describe('buildPostmortem copy', () => {
  it('blames async failover for data loss and recommends sync replication', () => {
    const scenario = healthyScenario({
      title: 'Two Is One',
      incidents: [
        {
          id: 'i1',
          at: 180,
          duration: 90,
          kind: 'db-failover',
          targetId: 'db',
          title: 'Primary DB failed over',
          message: 'The standby is now primary.',
          severity: 'critical',
        },
      ],
      objectives: { maxErrorSeconds: 30, noDataLoss: true, minAvailability: 0.99 },
    });
    const snapshot = makeSnapshot({
      availability: 0.995,
      errorSeconds: 20,
      failures: 60,
      errorRate: 0.005,
      dataLossEvents: 2,
      p95: 300,
    });
    const postmortem = buildPostmortem(
      scenario,
      snapshot,
      [
        event(180, 'incident', 'critical', 'Primary DB failed over', { nodeId: 'db', incidentId: 'i1' }),
        event(186, 'data-loss', 'critical', 'One write batch lost', { nodeId: 'db', incidentId: 'i1' }),
        event(206, 'recovery', 'info', 'DB promoted', { nodeId: 'db', incidentId: 'i1' }),
      ],
      fragileTopology(),
    );

    // Availability and error budget survived; the data-loss objective did not.
    expect(postmortem.stars).toBe(2);
    expect(postmortem.outcome).toBe('success');
    expect(postmortem.rootCause).toMatch(/asynchronous/i);
    expect(postmortem.contributingFactors.join(' ')).toMatch(/Primary DB/);
    expect(postmortem.contributingFactors.join(' ')).toMatch(/async/i);
    expect(postmortem.actionItems.join(' ')).toMatch(/sync replication/i);
    expect(postmortem.metrics.dataLossEvents).toBe(2);
  });

  it('names the zone concentration and the slow health check window', () => {
    const scenario = healthyScenario();
    const snapshot = makeSnapshot({ availability: 0.95, errorSeconds: 55, failures: 500, errorRate: 0.04 });
    const postmortem = buildPostmortem(
      scenario,
      snapshot,
      [event(180, 'incident', 'critical', 'Zone us-east-a is unreachable', { incidentId: 'i1' })],
      fragileTopology(),
    );

    expect(postmortem.rootCause).toMatch(/us-east-a/);
    const factors = postmortem.contributingFactors.join('\n');
    expect(factors).toMatch(/App A/);
    expect(factors).toMatch(/needs 50s to eject/);
    expect(postmortem.actionItems.join('\n')).toMatch(/Add an app VM in us-east-b/);
  });

  it('keeps the timeline compact and ordered, capped at 14 events', () => {
    const scenario = healthyScenario();
    const events: GameEvent[] = [];
    for (let index = 0; index < 40; index += 1) {
      events.push(event(index * 5, 'incident', 'warning', `Blip ${index}`));
    }
    events.push(event(1, 'deploy', 'info', 'Deploy v2'));
    events.push(event(2, 'data-loss', 'critical', 'Lost a batch'));
    events.push(event(3, 'runbook', 'info', 'Restarted the app'));

    const postmortem = buildPostmortem(scenario, makeSnapshot(), events, fragileTopology());
    expect(postmortem.timeline.length).toBe(14);
    for (let index = 1; index < postmortem.timeline.length; index += 1) {
      expect(postmortem.timeline[index].at).toBeGreaterThanOrEqual(postmortem.timeline[index - 1].at);
    }
    expect(postmortem.timeline.some((item) => item.kind === 'data-loss')).toBe(true);
  });

  it('mentions cache stampede protection and readiness probes when they are off', () => {
    const topology = fragileTopology();
    topology.nodes.push({
      id: 'cache',
      kind: 'cache',
      name: 'Session cache',
      cloudId: 'cumulus',
      regionId: 'us-east',
      zoneId: 'us-east-a',
      config: { sizeGb: 4, ttlSeconds: 60, eviction: 'lru', stampedeProtection: false },
      x: 600,
      y: 400,
    });
    topology.nodes.push({
      id: 'cluster',
      kind: 'k8s',
      name: 'App cluster',
      cloudId: 'cumulus',
      regionId: 'us-east',
      config: { nodeCount: 3, size: 'medium', pods: 3, readinessProbe: false },
      x: 500,
      y: 500,
    });

    const scenario = healthyScenario({
      incidents: [
        {
          id: 'i1',
          at: 120,
          duration: 60,
          kind: 'cache-stampede',
          title: 'Cache stampede',
          message: 'Every key expired at once.',
          severity: 'critical',
        },
      ],
    });
    const snapshot = makeSnapshot({ availability: 0.99, errorSeconds: 20, failures: 120 });
    const postmortem = buildPostmortem(scenario, snapshot, [event(120, 'incident', 'critical', 'Cache stampede')], topology);

    expect(postmortem.rootCause).toMatch(/stampedeProtection off/i);
    expect(postmortem.contributingFactors.join(' ')).toMatch(/Session cache/);
    expect(postmortem.contributingFactors.join(' ')).toMatch(/readinessProbe off/);
    expect(postmortem.actionItems.join(' ')).toMatch(/stampedeProtection/);
    expect(postmortem.actionItems.join(' ')).toMatch(/readinessProbe/);
    expect(postmortem.actionItems.length).toBeGreaterThanOrEqual(2);
    expect(postmortem.actionItems.length).toBeLessThanOrEqual(4);
  });

  it('always returns between 2 and 4 action items', () => {
    const scenario = healthyScenario();
    const postmortem = buildPostmortem(scenario, makeSnapshot(), [], fragileTopology());
    expect(postmortem.actionItems.length).toBeGreaterThanOrEqual(2);
    expect(postmortem.actionItems.length).toBeLessThanOrEqual(4);
  });

  it('copies snapshot metrics into the postmortem', () => {
    const snapshot = makeSnapshot({
      availability: 0.9992,
      errorSeconds: 12.4,
      p95: 240.2,
      monthlyCost: 420.4,
      dataLossEvents: 1,
      requests: 12345,
      failures: 67,
      duration: 300,
    });
    const postmortem = buildPostmortem(healthyScenario(), snapshot, [], fragileTopology());
    expect(postmortem.metrics).toEqual({
      availability: 0.9992,
      errorSeconds: 12.4,
      p95: 240.2,
      monthlyCost: 420.4,
      dataLossEvents: 1,
      totalRequests: 12345,
      failedRequests: 67,
      duration: 300,
    });
  });
});

describe('objective formatting', () => {
  it('formats seconds, latency, cost, and availability', () => {
    expect(formatSeconds(12.4)).toBe('12s');
    expect(formatLatency(240.2)).toBe('240 ms');
    expect(formatCost(420.4)).toBe('$420/mo');
    expect(formatAvailability(0.9992)).toBe('99.92%');
    expect(formatAvailability(1)).toBe('100%');
  });

  it('renders every objective with target and actual strings', () => {
    const snapshot = makeSnapshot({
      availability: 0.9992,
      errorSeconds: 12.4,
      p95: 240.2,
      monthlyCost: 420.4,
      dataLossEvents: 1,
    });
    const postmortem = buildPostmortem(healthyScenario(), snapshot, [], fragileTopology());
    const byKey = Object.fromEntries(postmortem.objectives.map((result) => [result.key, result]));

    expect(byKey.minAvailability).toMatchObject({ target: '≥ 99.9%', actual: '99.92%', met: true });
    expect(byKey.maxErrorSeconds).toMatchObject({ target: '≤ 10s', actual: '12s', met: false });
    expect(byKey.maxP95Ms).toMatchObject({ target: '≤ 250 ms', actual: '240 ms', met: true });
    expect(byKey.maxMonthlyCost).toMatchObject({ target: '≤ $600/mo', actual: '$420/mo', met: true });
    expect(byKey.noDataLoss).toMatchObject({ target: 'No data loss', actual: '1 event', met: false });
  });
});
