import { COMPONENT_ORDER, defaultConfig } from '../sim/catalog';
import type {
  ComponentKind,
  IncidentKind,
  NodeConfig,
  Objectives,
  Scenario,
  ScenarioIncident,
  Severity,
  Topology,
  TopologyLink,
  TopologyNode,
  TrafficPoint,
} from '../sim/types';
import { CAMPAIGN_WORLD } from './worlds';

export type SandboxDifficulty = 'relaxed' | 'normal' | 'chaos';

const DURATION = 3600;

/** Local, self-contained seeded RNG so the sandbox never touches sim state. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DifficultyProfile {
  gapMin: number;
  gapMax: number;
  durationScale: number;
  firstIncidentAt: number;
  objectives: Objectives;
  startingBudgetPerMonth: number;
}

const DIFFICULTIES: Record<SandboxDifficulty, DifficultyProfile> = {
  relaxed: {
    gapMin: 90,
    gapMax: 140,
    durationScale: 0.8,
    firstIncidentAt: 150,
    objectives: { maxErrorSeconds: 300, maxP95Ms: 600, maxMonthlyCost: 2000 },
    startingBudgetPerMonth: 1800,
  },
  normal: {
    gapMin: 60,
    gapMax: 120,
    durationScale: 1,
    firstIncidentAt: 120,
    objectives: { maxErrorSeconds: 240, maxP95Ms: 500, maxMonthlyCost: 1600 },
    startingBudgetPerMonth: 1600,
  },
  chaos: {
    gapMin: 45,
    gapMax: 85,
    durationScale: 1.2,
    firstIncidentAt: 90,
    objectives: { maxErrorSeconds: 180, maxP95Ms: 650, maxMonthlyCost: 1400 },
    startingBudgetPerMonth: 1500,
  },
};

function makeNode(
  kind: ComponentKind,
  id: string,
  name: string,
  placement: { regionId?: string; zoneId?: string },
  x: number,
  y: number,
  config: NodeConfig = {},
): TopologyNode {
  const region = placement.regionId
    ? CAMPAIGN_WORLD.regions.find((candidate) => candidate.id === placement.regionId)
    : undefined;
  return {
    id,
    kind,
    name,
    ...(region ? { cloudId: region.cloudId, regionId: region.id } : {}),
    ...(placement.zoneId ? { zoneId: placement.zoneId } : {}),
    config: { ...defaultConfig(kind), ...config },
    x,
    y,
  };
}

function link(from: string, to: string): TopologyLink {
  return { id: `${from}--${to}`, from, to };
}

function starterTopology(): Topology {
  const nodes: TopologyNode[] = [
    makeNode('dns', 'dns', 'Edge DNS', {}, 470, -40, {
      ttlSeconds: 60,
      routing: 'failover',
      healthChecks: true,
    }),
    makeNode('cdn', 'cdn', 'Edge CDN', {}, 760, -40, {
      ttlSeconds: 300,
      cacheablePct: 70,
      originShield: false,
      compression: true,
    }),
    makeNode('lb', 'lb', 'Public load balancer', { regionId: 'us-east' }, 470, 170, {
      algorithm: 'least-conn',
      healthCheckInterval: 2,
      unhealthyThreshold: 2,
      healthyThreshold: 2,
      timeoutMs: 3000,
      drainingSeconds: 30,
    }),
    makeNode('vm', 'app-1', 'App A', { regionId: 'us-east', zoneId: 'us-east-a' }, 300, 340),
    makeNode('vm', 'app-2', 'App B', { regionId: 'us-east', zoneId: 'us-east-b' }, 640, 340),
    makeNode('cache', 'cache', 'Redis', { regionId: 'us-east', zoneId: 'us-east-a' }, 300, 500, {
      sizeGb: 4,
      ttlSeconds: 60,
      eviction: 'lru',
      stampedeProtection: true,
    }),
    makeNode('db', 'db', 'Primary database', { regionId: 'us-east' }, 470, 620, {
      size: 'medium',
      replicas: 0,
      multiAz: true,
      connectionLimit: 140,
    }),
  ];

  return {
    nodes,
    links: [
      link('dns', 'cdn'),
      link('cdn', 'lb'),
      link('lb', 'app-1'),
      link('lb', 'app-2'),
      link('app-1', 'cache'),
      link('app-2', 'cache'),
      link('cache', 'db'),
      link('app-1', 'db'),
      link('app-2', 'db'),
    ],
  };
}

const STARTER_TRAFFIC: TrafficPoint[] = [
  { at: 0, rps: 0 },
  { at: 120, rps: 12 },
  { at: 600, rps: 45 },
  { at: 1200, rps: 80 },
  { at: 1800, rps: 110 },
  { at: 2400, rps: 140 },
  { at: 3000, rps: 180 },
  { at: 3600, rps: 200 },
];

interface IncidentTemplate {
  key: string;
  kind: IncidentKind;
  severity: Severity;
  minDuration: number;
  maxDuration: number;
  build(id: string, at: number, duration: number): ScenarioIncident;
}

const INCIDENT_TEMPLATES: IncidentTemplate[] = [
  {
    key: 'zone-a',
    kind: 'zone-down',
    severity: 'critical',
    minDuration: 30,
    maxDuration: 60,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'zone-down',
      zoneId: 'us-east-a',
      regionId: 'us-east',
      title: 'us-east-a stopped answering',
      message: 'The provider lost a zone. Everything you put in us-east-a is gone for a while.',
      severity: 'critical',
    }),
  },
  {
    key: 'zone-b',
    kind: 'zone-down',
    severity: 'critical',
    minDuration: 30,
    maxDuration: 60,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'zone-down',
      zoneId: 'us-east-b',
      regionId: 'us-east',
      title: 'us-east-b stopped answering',
      message: 'A different zone this time. The provider says it is investigating, which is a complete sentence.',
      severity: 'critical',
    }),
  },
  {
    key: 'crash-app-1',
    kind: 'node-crash',
    severity: 'warning',
    minDuration: 20,
    maxDuration: 45,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'node-crash',
      targetId: 'app-1',
      title: 'App A fell over',
      message: 'The process is gone. No stack trace, no last words, just a closed connection.',
      severity: 'warning',
    }),
  },
  {
    key: 'crash-app-2',
    kind: 'node-crash',
    severity: 'warning',
    minDuration: 20,
    maxDuration: 45,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'node-crash',
      targetId: 'app-2',
      title: 'App B fell over',
      message: 'One of your app servers has stopped being an app server.',
      severity: 'warning',
    }),
  },
  {
    key: 'slow-app-2',
    kind: 'node-slow',
    severity: 'warning',
    minDuration: 45,
    maxDuration: 90,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'node-slow',
      targetId: 'app-2',
      title: 'App B is thinking about it',
      message: 'Capacity is down and latency is up. Queues form politely, then impolitely.',
      severity: 'warning',
    }),
  },
  {
    key: 'db-failover',
    kind: 'db-failover',
    severity: 'critical',
    minDuration: 30,
    maxDuration: 80,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'db-failover',
      targetId: 'db',
      title: 'Database primary is gone',
      message: 'Whatever HA you configured is about to be tested in front of an audience.',
      severity: 'critical',
    }),
  },
  {
    key: 'cache-stampede',
    kind: 'cache-stampede',
    severity: 'critical',
    minDuration: 30,
    maxDuration: 60,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'cache-stampede',
      targetId: 'cache',
      title: 'Cache is cold',
      message: 'Hit ratio is zero and the database is learning what "popular" means.',
      severity: 'critical',
    }),
  },
  {
    key: 'traffic-spike',
    kind: 'traffic-spike',
    severity: 'warning',
    minDuration: 45,
    maxDuration: 90,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'traffic-spike',
      title: 'Traffic spike',
      message: 'Something somewhere went popular. Your capacity plan did not include this.',
      severity: 'warning',
    }),
  },
  {
    key: 'partition',
    kind: 'network-partition',
    severity: 'warning',
    minDuration: 30,
    maxDuration: 60,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'network-partition',
      targetId: 'db',
      title: 'Network partition around the database',
      message: 'The replica and the primary cannot see each other. They are both fairly sure they are right.',
      severity: 'warning',
    }),
  },
  {
    key: 'disk-full',
    kind: 'disk-full',
    severity: 'critical',
    minDuration: 45,
    maxDuration: 90,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'disk-full',
      targetId: 'db',
      title: 'Database disk is full',
      message: 'Someone forgot that logs are also data. Writes are now a coin flip.',
      severity: 'critical',
    }),
  },
  {
    key: 'noisy-neighbor',
    kind: 'noisy-neighbor',
    severity: 'warning',
    minDuration: 45,
    maxDuration: 90,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'noisy-neighbor',
      targetId: 'app-1',
      title: 'A noisy neighbour shares the host',
      message: 'Another tenant discovered cryptocurrency. Your capacity is now 60% of what you paid for.',
      severity: 'warning',
    }),
  },
  {
    key: 'ddos',
    kind: 'ddos',
    severity: 'critical',
    minDuration: 30,
    maxDuration: 75,
    build: (id, at, duration) => ({
      id,
      at,
      duration,
      kind: 'ddos',
      title: 'Distributed denial of service',
      message: 'A lot of new customers who only want one thing, and it is not your product.',
      severity: 'critical',
    }),
  },
];

function buildSandboxIncidents(
  rand: () => number,
  profile: DifficultyProfile,
): ScenarioIncident[] {
  const incidents: ScenarioIncident[] = [];
  let at = profile.firstIncidentAt;
  let lastKey = '';
  let index = 0;

  while (at < DURATION - 30) {
    const gap = profile.gapMin + rand() * (profile.gapMax - profile.gapMin);

    let pick = Math.floor(rand() * INCIDENT_TEMPLATES.length);
    if (INCIDENT_TEMPLATES[pick].key === lastKey) {
      pick = (pick + 1) % INCIDENT_TEMPLATES.length;
    }
    const template = INCIDENT_TEMPLATES[pick];

    const raw = template.minDuration + rand() * (template.maxDuration - template.minDuration);
    const scaled = Math.round(raw * profile.durationScale);
    const duration = Math.max(15, Math.min(scaled, Math.max(15, Math.round(gap) - 5)));

    index += 1;
    incidents.push(template.build(`sb-incident-${index}`, Math.round(at), duration));

    lastKey = template.key;
    at += gap;
  }

  return incidents;
}

export function createSandbox(difficulty: SandboxDifficulty = 'normal', seed = 1337): Scenario {
  const profile = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const rand = mulberry32(seed);

  return {
    id: `sandbox-${difficulty}-${seed}`,
    act: 4,
    order: 99,
    title: 'Sandbox',
    subtitle: `All components, ${difficulty} incidents, one 60-minute shift.`,
    customer: 'The pager. It has no name and no patience.',
    brief:
      'Everything is unlocked and nothing is holding back. Your starter stack is DNS → CDN → load balancer → two app VMs → Redis → Postgres, already Multi-AZ. Incidents arrive on their own schedule for a full hour. Keep the error budget, keep p95 sane, and keep the bill boring. You can change anything; the simulator will not warn you twice.',
    hints: [
      'The starter stack is a starting point, not an answer. Sandbox has no single win condition.',
      'Every incident type in the campaign can show up here. Read the pager message before you deploy.',
      'Cost objectives scale with the difficulty. A cheaper stack is not automatically a better one.',
    ],
    world: CAMPAIGN_WORLD,
    initialTopology: starterTopology(),
    unlockedKinds: [...COMPONENT_ORDER],
    traffic: STARTER_TRAFFIC.map((point) => ({ ...point })),
    duration: DURATION,
    incidents: buildSandboxIncidents(rand, profile),
    objectives: { ...profile.objectives },
    seed,
    startingBudgetPerMonth: profile.startingBudgetPerMonth,
    successText:
      'The shift ended and the pager went quiet. Availability, cost, and sanity all roughly intact.',
    failureText:
      'The shift ended with an open incident and a dashboard full of regret. The sandbox does not grade on effort.',
    requiresDatabase: true,
    entryNodeIds: ['dns'],
    sandbox: true,
    difficulty,
  };
}
