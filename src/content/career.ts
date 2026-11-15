import { defaultConfig } from '../sim/catalog';
import type {
  ComponentKind,
  NodeConfig,
  Profile,
  Scenario,
  Topology,
  TopologyLink,
  TopologyNode,
  World,
} from '../sim/types';
import { regionById, worldSubset } from './worlds';

/**
 * The career ladder: one engineer, one tiny SaaS, five progressively larger
 * systems. Coherent story, deliberately small first step: a DNS record and a
 * single web server.
 *
 * Lock rule: stage 1 is always open. Stage N opens when stage N-1 is in
 * `profile.completed`.
 */

const US_EAST: World = worldSubset(['us-east']);
const US_AND_EU: World = worldSubset(['us-east', 'eu-west']);

function makeNode(
  world: World,
  kind: ComponentKind,
  id: string,
  name: string,
  placement: { regionId?: string; zoneId?: string },
  x: number,
  y: number,
  config: NodeConfig = {},
): TopologyNode {
  const region = placement.regionId ? regionById(world, placement.regionId) : undefined;
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

function topology(nodes: TopologyNode[], links: TopologyLink[]): Topology {
  return { nodes, links };
}

const dnsNode = (world: World, x = 430, y = -40, config: NodeConfig = {}): TopologyNode =>
  makeNode(world, 'dns', 'dns', 'Edge DNS', {}, x, y, config);

const lbNode = (
  world: World,
  id: string,
  name: string,
  regionId: string,
  x: number,
  y: number,
  config: NodeConfig = {},
): TopologyNode => makeNode(world, 'lb', id, name, { regionId }, x, y, config);

const vmNode = (
  world: World,
  id: string,
  name: string,
  regionId: string,
  zoneId: string,
  x: number,
  y: number,
  config: NodeConfig = {},
): TopologyNode => makeNode(world, 'vm', id, name, { regionId, zoneId }, x, y, config);

const dbNode = (
  world: World,
  id: string,
  name: string,
  regionId: string,
  x: number,
  y: number,
  config: NodeConfig = {},
): TopologyNode => makeNode(world, 'db', id, name, { regionId }, x, y, config);

const TUNED_HEALTH_CHECKS: NodeConfig = {
  algorithm: 'least-conn',
  healthCheckInterval: 2,
  unhealthyThreshold: 2,
  healthyThreshold: 2,
  timeoutMs: 3000,
  drainingSeconds: 30,
};

export const CAREER_STAGES: Scenario[] = [
  {
    id: 'career-one-box',
    act: 1,
    order: 1,
    title: 'One Box',
    subtitle: 'A DNS record, one web server, and a business model made of optimism.',
    customer: 'You, one week after launch. Also Dana, who owns the domain.',
    brief:
      'You are the entire engineering department of a very small SaaS. Production is one DNS record pointing at one virtual machine running the app, and that is the whole architecture. It works. It is also one machine. Tonight it stops responding for thirty seconds, and every customer gets a connection error at the same moment. Get through the shift with the error budget intact: either add a load balancer and a second VM, or use the restart runbook when the box falls over. There is no database yet. There is barely a product yet. Welcome to on-call.',
    hints: [
      'The restart runbook brings a dead node back in about three seconds. Three seconds is inside the ten-second error budget.',
      'A load balancer plus a second VM in another zone survives a crash without you waking up. It also costs money.',
      'A single box is a single point of failure. This is the only lesson you get to learn cheaply.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        vmNode(US_EAST, 'app-1', 'Web server', 'us-east', 'us-east-a', 430, 340, {
          size: 'small',
          replicas: 1,
          appLatencyMs: 8,
        }),
      ],
      [link('dns', 'app-1')],
    ),
    unlockedKinds: ['dns', 'lb', 'vm'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 4 },
      { at: 180, rps: 7 },
      { at: 300, rps: 9 },
      { at: 420, rps: 10 },
      { at: 540, rps: 9 },
    ],
    duration: 540,
    incidents: [
      {
        id: 'career1-crash',
        at: 120,
        duration: 30,
        kind: 'node-crash',
        targetId: 'app-1',
        title: 'The only server has stopped servering',
        message:
          'The process is gone. There is no second machine, no load balancer, and no standby. Restart it before the error budget notices.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 10,
      maxP95Ms: 300,
    },
    seed: 9101,
    startingBudgetPerMonth: 400,
    successText:
      'One machine fell over and the site came back before anyone refreshed twice. You now own a runbook and a story.',
    failureText:
      'The single box went down and stayed down while you read the runbook. Thirty seconds of downtime for a company with one server.',
    unlockOnComplete: [],
    requiresDatabase: false,
    entryNodeIds: ['dns'],
  },

  {
    id: 'career-database',
    act: 1,
    order: 2,
    title: 'The Database',
    subtitle: 'One machine was a bottleneck. Two is a data problem.',
    customer: 'Ravi, your first paying customer, who has started saying "enterprise".',
    brief:
      'Somebody said the word "persistence" and now there is a Postgres box behind the app. We also added a load balancer and a second web server, so the app tier no longer dies with a single machine. The database still does: one instance, no standby, automatic failover enabled because it was a checkbox and checkboxes feel like safety. At the three-minute mark the primary disappears. Make it fail over without losing a single row. Multi-AZ is the boring answer and the boring answer is usually right.',
    hints: [
      'Multi-AZ gives you a six-second blip instead of a long outage.',
      'Replicas plus sync replication plus automatic failover is the other safe path. Replicas alone are just copies.',
      'Async replication can silently drop the last writes. The objective says no data loss, so check the replication mode.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'Web server A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_EAST, 'app-2', 'Web server B', 'us-east', 'us-east-b', 570, 340, {
          timeoutMs: 5000,
        }),
        dbNode(US_EAST, 'db', 'Postgres', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: false,
          replication: 'async',
          automaticFailover: true,
          connectionLimit: 100,
        }),
      ],
      [
        link('dns', 'lb'),
        link('lb', 'app-1'),
        link('lb', 'app-2'),
        link('app-1', 'db'),
        link('app-2', 'db'),
      ],
    ),
    unlockedKinds: ['dns', 'lb', 'vm', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 12 },
      { at: 180, rps: 26 },
      { at: 360, rps: 38 },
      { at: 480, rps: 44 },
      { at: 600, rps: 40 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'career2-db-failover',
        at: 180,
        duration: 90,
        kind: 'db-failover',
        targetId: 'db',
        title: 'Postgres has left the building',
        message:
          'The primary host is gone. Automatic failover is enabled, which is only useful if there is something to fail over to.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 15,
      maxP95Ms: 300,
      noDataLoss: true,
    },
    seed: 9202,
    startingBudgetPerMonth: 700,
    successText:
      'The primary died, the standby took over in six seconds, and every row survived. Enterprise customers love that.',
    failureText:
      'The database went away and took the app with it. The checkbox that promised failover had nothing to promote.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'career-traffic',
    act: 2,
    order: 3,
    title: 'Traffic',
    subtitle: 'Congratulations: the internet found you. It would like a page.',
    customer: 'Priya, growth, who sent one newsletter and doubled your traffic.',
    brief:
      'The product got a write-up and the traffic curve bent upward in a way the capacity plan did not predict. We put a CDN in front and Redis in front of Postgres, because that is what the architecture diagram at the conference said to do. Then a popular page went cold in the cache and every request in the country hit the database at the same instant. Survive the spike and the stampede. Tune the edge TTL, the cacheable percentage, and stampede protection before Postgres becomes a space heater.',
    hints: [
      'A CDN with a short TTL and a low cacheable percentage is mostly a rumour.',
      'Stampede protection coalesces misses. Without it, one cold key becomes ten thousand queries.',
      'Origin shield is exactly for the moment the edge cache turns into a funnel.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 300, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        makeNode(US_EAST, 'cdn', 'cdn', 'Edge CDN', {}, 620, -40, {
          ttlSeconds: 60,
          cacheablePct: 70,
          originShield: false,
          compression: true,
        }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'Web server A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_EAST, 'app-2', 'Web server B', 'us-east', 'us-east-b', 570, 340),
        makeNode(US_EAST, 'cache', 'cache', 'Redis', { regionId: 'us-east', zoneId: 'us-east-a' }, 300, 500, {
          sizeGb: 4,
          ttlSeconds: 60,
          eviction: 'lru',
          stampedeProtection: false,
        }),
        dbNode(US_EAST, 'db', 'Postgres', 'us-east', 570, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          connectionLimit: 100,
        }),
      ],
      [
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
    ),
    unlockedKinds: ['dns', 'cdn', 'lb', 'vm', 'cache', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 20 },
      { at: 180, rps: 44 },
      { at: 300, rps: 62 },
      { at: 420, rps: 82 },
      { at: 540, rps: 96 },
      { at: 600, rps: 90 },
      { at: 660, rps: 84 },
    ],
    duration: 660,
    incidents: [
      {
        id: 'career3-spike',
        at: 120,
        duration: 60,
        kind: 'traffic-spike',
        title: 'The newsletter went out',
        message:
          'Traffic is up sharply and the CDN is carrying it for now. Every cache has a bad day eventually.',
        severity: 'warning',
      },
      {
        id: 'career3-stampede',
        at: 240,
        duration: 45,
        kind: 'cache-stampede',
        targetId: 'cache',
        title: 'The cache went cold all at once',
        message:
          'Hit ratio is zero. Every miss is now a database query, and there are a lot of misses.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxP95Ms: 250,
      maxErrorSeconds: 15,
      maxMonthlyCost: 1500,
    },
    seed: 9303,
    startingBudgetPerMonth: 1500,
    successText:
      'The spike hit, the cache went cold, and Postgres barely noticed. The CDN paid for itself in one afternoon.',
    failureText:
      'The cache expired under load and turned the database into the queue. p95 is now measured in coffee breaks.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'career-orchestration',
    act: 2,
    order: 4,
    title: 'Orchestration',
    subtitle: 'You now have a control plane. It has opinions about your deploy.',
    customer: 'Marco, platform, who has already said "cattle, not pets" twice today.',
    brief:
      'We outgrew two VMs and a shell script, so the app moved to Kubernetes. The cluster has three worker nodes across three zones, three pods, and a readiness probe that somebody switched off during an incident and never switched back on. Tonight a bad deploy ships to every pod at once, and a zone leaves the party an hour later. Turn readiness back on, let the scheduler spread the pain, and keep p95 under three hundred milliseconds.',
    hints: [
      'Readiness probes are how the load balancer learns a pod is not ready. Off means every bad deploy is a user-facing deploy.',
      'Pods spread across zones. Three nodes in three zones means a zone failure costs you a third.',
      'Autoscaling is not instant. Check the HPA floor before the spike checks it for you.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        makeNode(US_EAST, 'k8s', 'app-cluster', 'App cluster', { regionId: 'us-east' }, 430, 340, {
          nodeCount: 3,
          size: 'medium',
          pods: 3,
          hpaMin: 2,
          hpaMax: 12,
          cpuTargetPct: 70,
          readinessProbe: false,
          livenessProbe: true,
          maxUnavailable: 3,
        }),
        dbNode(US_EAST, 'db', 'Postgres', 'us-east', 430, 500, {
          size: 'medium',
          replicas: 0,
          multiAz: true,
          connectionLimit: 140,
        }),
      ],
      [link('dns', 'lb'), link('lb', 'app-cluster'), link('app-cluster', 'db')],
    ),
    unlockedKinds: ['dns', 'cdn', 'lb', 'vm', 'cache', 'k8s', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 24 },
      { at: 180, rps: 48 },
      { at: 300, rps: 70 },
      { at: 420, rps: 94 },
      { at: 540, rps: 118 },
      { at: 600, rps: 108 },
      { at: 660, rps: 100 },
    ],
    duration: 660,
    incidents: [
      {
        id: 'career4-bad-deploy',
        at: 120,
        duration: 20,
        kind: 'bad-deploy',
        targetId: 'app-cluster',
        title: 'Deploy 3.0.0 is not ready for production',
        message:
          'The new pods start, fail their first request, and stay in rotation. Readiness would have caught this.',
        severity: 'warning',
      },
      {
        id: 'career4-zone-down',
        at: 300,
        duration: 60,
        kind: 'zone-down',
        zoneId: 'us-east-a',
        regionId: 'us-east',
        title: 'us-east-a is gone',
        message:
          'A zone dropped off the network. Pods that lived there are gone until the scheduler finds them another home.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 25,
      maxP95Ms: 300,
    },
    seed: 9404,
    startingBudgetPerMonth: 1400,
    successText:
      'A bad deploy, a dead zone, and a cluster that fixed both without a human. That is the part of Kubernetes that works.',
    failureText:
      'The rollout went straight to users and the zone failure finished the job. Readiness was off the entire time.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'career-planet',
    act: 3,
    order: 5,
    title: 'Planet Scale',
    subtitle: 'One region is not a strategy. It is a postal address.',
    customer: 'The board, who saw a rival map with more dots on it.',
    brief:
      'The company has customers on three continents now, and everything still runs in us-east: DNS, CDN, a load balancer, a Kubernetes cluster, Redis, Postgres, and object storage. We have an eu-west account, a budget line, and a slide that says "multi-region". The slide does not have servers. When us-east has a regional afternoon, the whole product goes with it. Build the second stack, make DNS fail over, and keep the bill under three thousand dollars a month. The map can go down. The product cannot.',
    hints: [
      'DNS TTL is your failover time. A five-minute TTL is a five-minute regional outage.',
      'A second region needs its own LB, its own compute, and a database that is not in the failed region.',
      'Cross-region latency is 45 ms. Budget for it in the p95 objective instead of being surprised by it.',
      'You can also run the failover-dns runbook to force a target refresh while you are mid-incident.',
    ],
    world: US_AND_EU,
    initialTopology: topology(
      [
        dnsNode(US_AND_EU, 470, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        makeNode(US_AND_EU, 'cdn', 'cdn', 'Edge CDN', {}, 760, -40, {
          ttlSeconds: 300,
          cacheablePct: 85,
          originShield: true,
          compression: true,
        }),
        lbNode(US_AND_EU, 'lb', 'US load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        makeNode(US_AND_EU, 'k8s', 'app-cluster', 'US cluster', { regionId: 'us-east' }, 430, 340, {
          nodeCount: 3,
          size: 'medium',
          pods: 4,
          hpaMin: 2,
          hpaMax: 14,
          cpuTargetPct: 70,
          readinessProbe: true,
          livenessProbe: true,
          maxUnavailable: 1,
        }),
        makeNode(US_AND_EU, 'cache', 'cache', 'US Redis', { regionId: 'us-east', zoneId: 'us-east-a' }, 250, 500, {
          sizeGb: 8,
          ttlSeconds: 60,
          eviction: 'lru',
          stampedeProtection: true,
        }),
        dbNode(US_AND_EU, 'db', 'US Postgres', 'us-east', 430, 500, {
          size: 'medium',
          replicas: 0,
          multiAz: true,
          connectionLimit: 140,
        }),
        makeNode(US_AND_EU, 'storage', 'assets', 'US assets', { regionId: 'us-east' }, 610, 500, {
          storageGb: 250,
          storageClass: 'standard',
          versioning: true,
        }),
      ],
      [
        link('dns', 'cdn'),
        link('cdn', 'lb'),
        link('lb', 'app-cluster'),
        link('app-cluster', 'cache'),
        link('cache', 'db'),
        link('app-cluster', 'db'),
        link('app-cluster', 'assets'),
      ],
    ),
    unlockedKinds: ['dns', 'cdn', 'lb', 'proxy', 'vm', 'k8s', 'db', 'cache', 'storage'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 30 },
      { at: 180, rps: 58 },
      { at: 300, rps: 88 },
      { at: 420, rps: 115 },
      { at: 540, rps: 140 },
      { at: 660, rps: 152 },
      { at: 720, rps: 138 },
    ],
    duration: 720,
    incidents: [
      {
        id: 'career5-region-down',
        at: 180,
        duration: 120,
        kind: 'region-down',
        regionId: 'us-east',
        title: 'us-east has left the chat',
        message:
          'The entire region is unreachable. Every node you placed there is gone, including the load balancer and the database. eu-west still exists.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 45,
      maxP95Ms: 600,
      maxMonthlyCost: 3000,
    },
    seed: 9505,
    startingBudgetPerMonth: 3000,
    successText:
      'A whole region disappeared and the product kept serving from Dublin. The failover was boring, which is the highest compliment.',
    failureText:
      'us-east went down and took everything with it. The second region was a slide, not a server.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },
];

export function getCareerStage(id: string): Scenario | undefined {
  return CAREER_STAGES.find((stage) => stage.id === id);
}

export function nextCareerStage(id: string): Scenario | undefined {
  const ordered = [...CAREER_STAGES].sort((a, b) => a.act - b.act || a.order - b.order);
  const index = ordered.findIndex((stage) => stage.id === id);
  if (index < 0) return undefined;
  return ordered[index + 1];
}

/**
 * Stage 1 is always open. Every later stage requires the previous stage to be
 * in `profile.completed`. Unknown ids are never unlocked.
 */
export function isCareerUnlocked(profile: Profile, id: string): boolean {
  const ordered = [...CAREER_STAGES].sort((a, b) => a.act - b.act || a.order - b.order);
  const index = ordered.findIndex((stage) => stage.id === id);
  if (index < 0) return false;
  if (index === 0) return true;
  return profile.completed.includes(ordered[index - 1].id);
}
