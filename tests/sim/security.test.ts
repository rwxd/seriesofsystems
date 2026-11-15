import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/sim/catalog';
import { createSimulation } from '../../src/sim/engine';
import { computeSecurityScore, securityFindings } from '../../src/sim/security';
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
// Fixtures
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

function makeScenario(topology: Topology, overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'security-test',
    act: 1,
    order: 1,
    title: 'Security Test',
    subtitle: '',
    customer: '',
    brief: '',
    hints: [],
    world,
    initialTopology: topology,
    unlockedKinds: ['dns', 'waf', 'cdn', 'lb', 'proxy', 'vm', 'k8s', 'db', 'cache', 'storage'],
    traffic: [
      { at: 0, rps: 40 },
      { at: 120, rps: 40 },
    ],
    duration: 40,
    incidents: [],
    objectives: {},
    seed: 4242,
    startingBudgetPerMonth: 1000,
    successText: '',
    failureText: '',
    requiresDatabase: true,
    ...overrides,
  };
}

function makeIncident(
  incident: Partial<ScenarioIncident> & Pick<ScenarioIncident, 'id' | 'kind'>,
): ScenarioIncident {
  return {
    at: 5,
    duration: 20,
    title: incident.kind,
    message: `${incident.kind} test incident`,
    severity: 'critical',
    ...incident,
  };
}

function run(topology: Topology, overrides: Partial<Scenario> = {}): Simulation {
  const scenario = makeScenario(topology, overrides);
  const sim = createSimulation(scenario, topology);
  sim.start();
  let guard = 0;
  while (!sim.ended && guard < 4000) {
    sim.tick(0.5);
    guard += 1;
  }
  if (guard >= 4000) throw new Error('simulation did not finish');
  return sim;
}

/**
 * dns -> [waf] -> lb -> vm -> db.
 * `mode: null` builds the same path without a WAF.
 */
function edgeTopology(options: {
  waf?: NodeConfig | null;
  lb?: NodeConfig;
  vm?: NodeConfig;
  db?: NodeConfig;
} = {}): Topology {
  const hasWaf = options.waf !== null && options.waf !== undefined;
  const nodes: TopologyNode[] = [makeNode('dns', 'dns')];
  const links: TopologyLink[] = [];

  if (hasWaf) {
    nodes.push(makeNode('waf', 'waf', {}, options.waf ?? {}));
    links.push(makeLink('dns', 'waf'), makeLink('waf', 'lb'));
  } else {
    links.push(makeLink('dns', 'lb'));
  }

  nodes.push(
    makeNode('lb', 'lb', { regionId: 'us-east' }, options.lb ?? {}),
    makeNode('vm', 'vm', { regionId: 'us-east', zoneId: 'us-east-a' }, options.vm ?? {}),
    makeNode('db', 'db', { regionId: 'us-east' }, { multiAz: true, ...(options.db ?? {}) }),
  );
  links.push(makeLink('lb', 'vm'), makeLink('vm', 'db'));

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// WAF and DDoS
// ---------------------------------------------------------------------------

describe('WAF and DDoS mitigation', () => {
  const ddos = makeIncident({ id: 'ddos', kind: 'ddos', at: 10, duration: 20 });
  // Small VM with 100 ms app work: ~105 req/s ceiling, so a 2.5x flood hurts.
  const slowVm: NodeConfig = { size: 'small', appLatencyMs: 100 };

  const runDdos = (waf: NodeConfig | null) =>
    run(edgeTopology({ waf, vm: slowVm }), {
      duration: 45,
      traffic: [{ at: 0, rps: 50 }, { at: 120, rps: 50 }],
      incidents: [ddos],
    }).snapshot();

  it('reduces DDoS impact with a WAF in block mode and only partially in monitor mode', () => {
    const unmitigated = runDdos(null);
    const monitored = runDdos({ mode: 'monitor' });
    const blocked = runDdos({ mode: 'block' });

    expect(unmitigated.failures).toBeGreaterThan(0);
    expect(blocked.failures).toBe(0);

    // Blocked attack traffic never reaches the origin.
    expect(blocked.requests).toBeLessThan(monitored.requests);
    expect(monitored.requests).toBeLessThan(unmitigated.requests);
    expect(blocked.requests).toBeLessThan(unmitigated.requests * 0.75);
  });

  it('forwards WAF traffic to a single upstream and enforces the edge rate limit', () => {
    const sim = run(edgeTopology({ waf: { rateLimitRps: 20 } }), {
      duration: 20,
      traffic: [{ at: 0, rps: 60 }, { at: 60, rps: 60 }],
    });
    const snapshot = sim.snapshot();

    expect(snapshot.nodes.waf.requests).toBeGreaterThan(0);
    expect(snapshot.nodes.lb.requests).toBeGreaterThan(0);
    expect(snapshot.failures).toBeGreaterThan(0);
    expect(sim.traces().some((trace) => !trace.ok && trace.status === 429)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

describe('certificate expiry', () => {
  const certExpiry = makeIncident({ id: 'cert', kind: 'cert-expiry', at: 5, duration: 20 });

  it('auto-renewing certificates mitigate the outage completely', () => {
    const auto = run(edgeTopology({ lb: { tlsAutoRenew: true } }), {
      duration: 40,
      incidents: [certExpiry],
    }).snapshot();
    const manual = run(edgeTopology({ lb: { tlsAutoRenew: false } }), {
      duration: 40,
      incidents: [certExpiry],
    }).snapshot();

    expect(auto.failures).toBe(0);
    expect(auto.requests).toBeGreaterThan(0);

    expect(manual.failures).toBeGreaterThan(0);
    expect(manual.errorSeconds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Credential leaks
// ---------------------------------------------------------------------------

describe('credential leak', () => {
  const leak = makeIncident({ id: 'leak', kind: 'credential-leak', at: 5, duration: 20 });

  it('records data loss and errors when a data store is public', () => {
    const weak = run(
      edgeTopology({
        db: { publicAccess: true, encryption: false, backups: false },
        vm: { secrets: 'plain' },
      }),
      { duration: 40, incidents: [leak] },
    ).snapshot();

    expect(weak.dataLossEvents).toBeGreaterThan(0);
    expect(weak.failures).toBeGreaterThan(0);
  });

  it('is mitigated when secrets are vaulted and stores are private', () => {
    const hardened = run(
      edgeTopology({
        db: { publicAccess: false, encryption: true, backups: true },
        vm: { secrets: 'vault', patching: 'auto' },
      }),
      { duration: 40, incidents: [leak] },
    ).snapshot();

    expect(hardened.dataLossEvents).toBe(0);
    expect(hardened.failures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Vulnerabilities
// ---------------------------------------------------------------------------

describe('vulnerability patching', () => {
  const vulnerability = makeIncident({
    id: 'cve',
    kind: 'vulnerability',
    at: 5,
    duration: 20,
    targetId: 'vm',
  });

  it('takes a manually patched host out of rotation', () => {
    const sim = run(edgeTopology({ vm: { patching: 'manual' } }), {
      duration: 40,
      incidents: [vulnerability],
    });
    const snapshot = sim.snapshot();

    expect(snapshot.nodes.vm.status).toBe('healthy'); // recovered after the window
    expect(snapshot.nodes.vm.failures).toBeGreaterThan(0);
    expect(snapshot.failures).toBeGreaterThan(0);
    expect(sim.eventLog().some((event) => event.title.includes('down for emergency patching'))).toBe(true);
  });

  it('rides through the advisory with automatic patching', () => {
    const sim = run(edgeTopology({ vm: { patching: 'auto' } }), {
      duration: 40,
      incidents: [vulnerability],
    });
    const snapshot = sim.snapshot();

    expect(snapshot.failures).toBe(0);
    expect(sim.eventLog().some((event) => event.title.includes('patched automatically'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Brute force
// ---------------------------------------------------------------------------

describe('brute force', () => {
  const bruteForce = makeIncident({ id: 'stuffing', kind: 'brute-force', at: 5, duration: 20 });

  const runBrute = (waf: NodeConfig | null) =>
    run(edgeTopology({ waf }), { duration: 40, incidents: [bruteForce] }).snapshot();

  it('fully mitigates with a blocking WAF and partially with monitor mode', () => {
    const unmitigated = runBrute(null);
    const monitored = runBrute({ mode: 'monitor' });
    const blocked = runBrute({ mode: 'block' });

    expect(unmitigated.failures).toBeGreaterThan(0);
    expect(monitored.failures).toBeGreaterThan(0);
    expect(blocked.failures).toBe(0);
    expect(monitored.failures).toBeLessThan(unmitigated.failures);
  });
});

// ---------------------------------------------------------------------------
// Score and findings
// ---------------------------------------------------------------------------

describe('security score and findings', () => {
  const weak: Topology = edgeTopology({
    waf: { mode: 'monitor', rateLimitRps: 0, botProtection: false },
    lb: { tls: false, tlsAutoRenew: false },
    vm: { patching: 'never', secrets: 'plain' },
    db: { encryption: false, backups: false, publicAccess: true },
  });
  weak.nodes.push(makeNode('bucket', 'storage', { regionId: 'us-east' }, { encryption: false, publicAccess: true }));

  const hardened: Topology = edgeTopology({
    waf: { mode: 'block', rateLimitRps: 1000, botProtection: true },
    lb: { tls: true, tlsAutoRenew: true },
    vm: { patching: 'auto', secrets: 'vault' },
    db: { encryption: true, backups: true, publicAccess: false },
  });
  hardened.nodes.push(
    makeNode('bucket', 'storage', { regionId: 'us-east' }, { encryption: true, publicAccess: false }),
  );

  it('scores a hardened topology far above a weak one, inside 0-100', () => {
    const weakScore = computeSecurityScore(weak);
    const hardenedScore = computeSecurityScore(hardened);

    expect(hardenedScore).toBeGreaterThan(weakScore);
    expect(hardenedScore).toBeGreaterThanOrEqual(95);
    expect(weakScore).toBeGreaterThanOrEqual(0);
    expect(weakScore).toBeLessThan(30);
    for (const score of [weakScore, hardenedScore]) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('reports actionable findings with stable ids and severities', () => {
    const findings = securityFindings(weak);
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);

    const critical = findings.filter((finding) => finding.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.id === 'db-public:db')).toBe(true);
    expect(findings.some((finding) => finding.id === 'secrets-plain:vm')).toBe(true);
    expect(findings.some((finding) => finding.id === 'patching-never:vm')).toBe(true);
    expect(findings.some((finding) => finding.id === 'waf-monitor')).toBe(true);

    for (const finding of findings) {
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.detail.length).toBeGreaterThan(0);
      expect(finding.action.length).toBeGreaterThan(0);
    }

    const publicDb = findings.find((finding) => finding.id === 'db-public:db');
    expect(publicDb?.nodeId).toBe('db');
    expect(publicDb?.severity).toBe('critical');
  });

  it('does not credit a WAF that is not in the request path', () => {
    const noWaf = edgeTopology({ waf: null });
    const isolated = structuredClone(noWaf);
    isolated.nodes.push(makeNode('waf', 'waf'));
    expect(computeSecurityScore(isolated)).toBe(computeSecurityScore(noWaf));
    expect(securityFindings(isolated).some((finding) => finding.id.startsWith('waf-isolated'))).toBe(true);
  });

  it('has nothing to report for a hardened topology', () => {
    expect(securityFindings(hardened)).toEqual([]);
  });
});
