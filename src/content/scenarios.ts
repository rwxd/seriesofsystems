import { defaultConfig } from '../sim/catalog';
import type {
  ComponentKind,
  NodeConfig,
  Scenario,
  Topology,
  TopologyLink,
  TopologyNode,
  World,
} from '../sim/types';
import { regionById, worldSubset } from './worlds';

/**
 * Standalone challenges. Not part of the campaign or the career ladder: every
 * one is available, self-contained, and graded on its own objectives.
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

export const SCENARIOS: Scenario[] = [
  {
    id: 'scenario-black-friday',
    act: 4,
    order: 1,
    title: 'Black Friday',
    subtitle: 'The one day a year the capacity plan is a suggestion.',
    customer: 'Oskar Lind, Head of Commerce, Threadbare Outfitters',
    brief:
      'Every year we promise the infrastructure team that this year will be different. This year it is different in that the sale starts in four minutes. Traffic will roughly triple, the CDN will carry what it can, and at some point a set of product keys will expire together and Redis will go cold. The stack is already wired: DNS, CDN, load balancer, two app VMs, Redis, Postgres. Tune it rather than rebuild it. Keep p95 under a quarter second, keep errors low, and keep the bill under fifteen hundred.',
    hints: [
      'A short edge TTL and a low cacheable percentage make the CDN look decorative under load.',
      'Stampede protection is the difference between one database query per key and one per customer.',
      'Origin shield is a second cache layer for exactly the moment the edge misses everything at once.',
      'The database is already Multi-AZ. Do not buy another one, buy a better cache.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 300, -40, { ttlSeconds: 30, routing: 'failover', healthChecks: true }),
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
      { at: 60, rps: 26 },
      { at: 120, rps: 50 },
      { at: 240, rps: 70 },
      { at: 360, rps: 92 },
      { at: 480, rps: 112 },
      { at: 600, rps: 96 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'sc-black-friday-spike',
        at: 120,
        duration: 90,
        kind: 'traffic-spike',
        title: 'The sale started',
        message:
          'Traffic is climbing hard and every cache is being asked to justify itself. Three times the load, one stack.',
        severity: 'warning',
      },
      {
        id: 'sc-black-friday-stampede',
        at: 300,
        duration: 60,
        kind: 'cache-stampede',
        targetId: 'cache',
        title: 'Every product key expired together',
        message:
          'Hit ratio is zero. Postgres is receiving the entire holiday shopping season one query at a time.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxP95Ms: 250,
      maxErrorSeconds: 15,
      maxMonthlyCost: 1500,
    },
    seed: 10101,
    startingBudgetPerMonth: 1500,
    successText:
      'The sale started, the cache went cold, and the store stayed open. The database will never know how close it came.',
    failureText:
      'The cache expired under peak load and Postgres became the queue. The sale is still running; the site is not.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'scenario-bad-deploy',
    act: 4,
    order: 2,
    title: 'Bad Deploy',
    subtitle: 'It passed CI. CI is not production, and production has opinions.',
    customer: 'Hana Sato, Release Engineering, Cascade Billing',
    brief:
      'The cluster is healthy, the database is Multi-AZ, and the release train runs every afternoon whether the code is ready or not. This afternoon the deploy is not ready: the new pods come up, fail their first request, and stay in the load balancer because the readiness probe is off. An hour later a worker node leaves the cluster for reasons the provider will describe as "degraded performance". Turn readiness on, set a sane max-unavailable, and make both events boring.',
    hints: [
      'Without readiness probes, a bad deploy is a user-facing deploy.',
      'maxUnavailable of 3 in a three-replica deployment means the rollout has no safe floor.',
      'Pods are spread across zones. A three-node cluster in three zones loses a third, not everything.',
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
    unlockedKinds: ['dns', 'lb', 'k8s', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 22 },
      { at: 180, rps: 42 },
      { at: 300, rps: 64 },
      { at: 420, rps: 84 },
      { at: 540, rps: 98 },
      { at: 660, rps: 88 },
    ],
    duration: 660,
    incidents: [
      {
        id: 'sc-bad-deploy-rollout',
        at: 120,
        duration: 20,
        kind: 'bad-deploy',
        targetId: 'app-cluster',
        title: 'Release 8.2.0 is not ready',
        message:
          'The new pods start, fail their first request, and keep receiving traffic. Readiness would have held them back.',
        severity: 'warning',
      },
      {
        id: 'sc-bad-deploy-node',
        at: 300,
        duration: 60,
        kind: 'zone-down',
        zoneId: 'us-east-a',
        regionId: 'us-east',
        title: 'A worker node is gone',
        message:
          'us-east-a has dropped off the network. The pods that lived there are gone until the scheduler reschedules them.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 20,
      maxP95Ms: 300,
    },
    seed: 10202,
    startingBudgetPerMonth: 1200,
    successText:
      'The deploy was bad, the node left, and the cluster handled both. Readiness finally earned its keep.',
    failureText:
      'The bad rollout met the dead node and the pager met you. Readiness was off for the whole shift.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'scenario-region-down',
    act: 4,
    order: 3,
    title: 'Region Down',
    subtitle: 'Both regions exist. Only one of them is currently a region.',
    customer: 'Ines Moreau, VP Platform, Meridian Atlas',
    brief:
      'Good news: somebody already built the multi-region stack, and both us-east and eu-west are fully wired. Bad news: the DNS record still has a five-minute TTL, which means "multi-region" is a five-minute outage with extra steps. At the three-minute mark us-east stops existing. This is a diagnosis and failover problem, not a construction problem. Read the pager, shorten the failover window, and make sure traffic lands in Dublin before the error budget is gone.',
    hints: [
      'DNS TTL is your failover time. Five minutes of cached answers is five minutes of downtime.',
      'The failover-dns runbook forces a target refresh right now. It is faster than waiting for a TTL you forgot to lower.',
      'Do not rebuild eu-west. It is already there; make DNS send traffic to it.',
      'eu-west has its own database. You do not need to replicate anything mid-incident.',
    ],
    world: US_AND_EU,
    initialTopology: topology(
      [
        dnsNode(US_AND_EU, 470, -40, { ttlSeconds: 300, routing: 'failover', healthChecks: true }),
        lbNode(US_AND_EU, 'lb-us', 'US load balancer', 'us-east', 300, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_AND_EU, 'app-us-1', 'US web A', 'us-east', 'us-east-a', 200, 340),
        vmNode(US_AND_EU, 'app-us-2', 'US web B', 'us-east', 'us-east-b', 400, 340),
        dbNode(US_AND_EU, 'db-us', 'US Postgres', 'us-east', 300, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          connectionLimit: 100,
        }),
        lbNode(US_AND_EU, 'lb-eu', 'EU load balancer', 'eu-west', 760, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_AND_EU, 'app-eu-1', 'EU web A', 'eu-west', 'eu-west-a', 670, 340),
        vmNode(US_AND_EU, 'app-eu-2', 'EU web B', 'eu-west', 'eu-west-b', 870, 340),
        dbNode(US_AND_EU, 'db-eu', 'EU Postgres', 'eu-west', 760, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          connectionLimit: 100,
        }),
      ],
      [
        link('dns', 'lb-us'),
        link('dns', 'lb-eu'),
        link('lb-us', 'app-us-1'),
        link('lb-us', 'app-us-2'),
        link('app-us-1', 'db-us'),
        link('app-us-2', 'db-us'),
        link('lb-eu', 'app-eu-1'),
        link('lb-eu', 'app-eu-2'),
        link('app-eu-1', 'db-eu'),
        link('app-eu-2', 'db-eu'),
      ],
    ),
    unlockedKinds: ['dns', 'cdn', 'lb', 'vm', 'cache', 'db', 'storage'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 30 },
      { at: 180, rps: 58 },
      { at: 300, rps: 86 },
      { at: 420, rps: 110 },
      { at: 540, rps: 132 },
      { at: 660, rps: 148 },
      { at: 720, rps: 136 },
    ],
    duration: 720,
    incidents: [
      {
        id: 'sc-region-down-us-east',
        at: 180,
        duration: 120,
        kind: 'region-down',
        regionId: 'us-east',
        title: 'us-east is not a region right now',
        message:
          'The entire us-east region is unreachable. The EU stack is healthy and idle, waiting for DNS to notice.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 45,
      maxP95Ms: 600,
      maxMonthlyCost: 2600,
    },
    seed: 10303,
    startingBudgetPerMonth: 2600,
    successText:
      'us-east vanished and Dublin picked up the traffic in under a minute. Diagnosis beat reconstruction.',
    failureText:
      'The region died and DNS kept handing out the same cached answer. The second region was real and completely unused.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'scenario-zero-day',
    act: 4,
    order: 4,
    title: 'Zero Day',
    subtitle: 'There is no WAF in front of the proxy. Yet.',
    customer: 'Bea Kowalski, Security, Latchkey (passwords, presumably)',
    brief:
      'Two things are happening at once. First, a botnet has decided your login page is a worthwhile target, which is flattering and expensive. Second, the TLS certificate expires tonight because the renewal cron job was in the same container that got rescheduled. You have no WAF in front of the proxy, no rate limit configured, and no time for a procurement cycle. You do have a platform catalog with a WAF in it, nginx with rate limiting, a DNS TTL you control, and the renew-cert runbook. Put a wall in front of the origin, renew the certificate, and keep the error budget from becoming a security incident.',
    hints: [
      'A WAF in block mode absorbs most of a botnet before it reaches nginx. Monitor mode only gives you a log line.',
      'A rate limit turns a botnet into a 429 and a log line. Zero means every request reaches the app.',
      'The renew-cert runbook fixes an expired certificate immediately. The alternative is waiting it out.',
      'A short DNS TTL does not stop a DDoS, but it lets you move traffic quickly when you need to.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 300, -40, { ttlSeconds: 300, routing: 'failover', healthChecks: true }),
        makeNode(US_EAST, 'cdn', 'cdn', 'Edge CDN', {}, 640, -40, {
          ttlSeconds: 300,
          cacheablePct: 50,
          originShield: false,
          compression: true,
        }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 470, 170, TUNED_HEALTH_CHECKS),
        makeNode(US_EAST, 'proxy', 'nginx', 'Edge proxy', { regionId: 'us-east', zoneId: 'us-east-a' }, 470, 250, {
          algorithm: 'least-conn',
          connectTimeoutMs: 500,
          readTimeoutMs: 10000,
          retries: 0,
          retryBudgetPct: 10,
          rateLimitRps: 0,
          workerConnections: 1024,
          buffering: true,
        }),
        vmNode(US_EAST, 'app-1', 'Web server A', 'us-east', 'us-east-a', 330, 340),
        vmNode(US_EAST, 'app-2', 'Web server B', 'us-east', 'us-east-b', 620, 340),
        dbNode(US_EAST, 'db', 'Postgres', 'us-east', 470, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          connectionLimit: 100,
        }),
      ],
      [
        link('dns', 'cdn'),
        link('cdn', 'lb'),
        link('lb', 'nginx'),
        link('nginx', 'app-1'),
        link('nginx', 'app-2'),
        link('app-1', 'db'),
        link('app-2', 'db'),
      ],
    ),
    unlockedKinds: ['dns', 'cdn', 'waf', 'lb', 'proxy', 'vm', 'db', 'cache'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 18 },
      { at: 180, rps: 36 },
      { at: 300, rps: 52 },
      { at: 420, rps: 66 },
      { at: 540, rps: 74 },
      { at: 600, rps: 68 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'sc-zero-day-ddos',
        at: 120,
        duration: 45,
        kind: 'ddos',
        title: 'The login page is popular with robots',
        message:
          'A botnet is hammering the login endpoint. nginx can shed this load, if you tell it how much load is acceptable.',
        severity: 'critical',
      },
      {
        id: 'sc-zero-day-cert',
        at: 300,
        duration: 30,
        kind: 'cert-expiry',
        title: 'The TLS certificate expired',
        message:
          'Every external request now fails the handshake. The renewal job died with the container it lived in. There is a runbook for this.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 75,
      maxP95Ms: 350,
      maxMonthlyCost: 1200,
    },
    seed: 10404,
    startingBudgetPerMonth: 1200,
    successText:
      'The bots got 429s, the certificate got renewed, and the only thing that expired on time was the incident.',
    failureText:
      'The proxy forwarded the botnet and the certificate expired on schedule. Security is a systems problem, not a product.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },
  {
    id: 'scenario-the-leak',
    act: 4,
    order: 5,
    title: 'The Leak',
    subtitle: 'The database is public. The secrets are in an env var. The patch queue is a museum.',
    customer: 'Iris Bell, Head of Trust, Latchkey (passwords, presumably)',
    brief:
      'A security review found three things before an attacker did: the production database accepts connections from the internet, one app host keeps its credentials in a plain config file, and patching is a quarterly ceremony. Tonight someone starts credential stuffing the login endpoint, then a known vulnerability lands on the oldest host. Harden the data tier, move the secrets, turn on automatic patching, and put a WAF or a rate limit in front of the login path. The postmortem is either a lesson or a breach notification.',
    hints: [
      'A database that is publicly reachable turns one leaked password into a data breach.',
      'Secrets in environment variables leak through logs, crash dumps, and child processes. Use the vault.',
      'A vulnerability incident only takes down hosts that are not patching automatically.',
      'A WAF in block mode and a proxy rate limit both make credential stuffing expensive.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, {
          ...TUNED_HEALTH_CHECKS,
          tls: true,
          tlsAutoRenew: false,
        }),
        makeNode(US_EAST, 'proxy', 'nginx', 'Edge proxy', { regionId: 'us-east', zoneId: 'us-east-a' }, 430, 255, {
          algorithm: 'least-conn',
          connectTimeoutMs: 500,
          readTimeoutMs: 5000,
          retries: 0,
          retryBudgetPct: 10,
          rateLimitRps: 0,
          workerConnections: 1024,
          buffering: true,
        }),
        vmNode(US_EAST, 'app-1', 'Legacy app A', 'us-east', 'us-east-a', 300, 340, {
          secrets: 'plain',
          patching: 'never',
        }),
        vmNode(US_EAST, 'app-2', 'App B', 'us-east', 'us-east-b', 580, 340, {
          secrets: 'env',
          patching: 'manual',
        }),
        dbNode(US_EAST, 'db', 'Public Postgres', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          encryption: false,
          backups: false,
          publicAccess: true,
          connectionLimit: 100,
        }),
      ],
      [
        link('dns', 'lb'),
        link('lb', 'nginx'),
        link('nginx', 'app-1'),
        link('nginx', 'app-2'),
        link('app-1', 'db'),
        link('app-2', 'db'),
      ],
    ),
    unlockedKinds: ['dns', 'waf', 'cdn', 'lb', 'proxy', 'vm', 'db', 'cache'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 16 },
      { at: 180, rps: 32 },
      { at: 300, rps: 48 },
      { at: 420, rps: 62 },
      { at: 540, rps: 72 },
      { at: 600, rps: 64 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'sc-leak-credential',
        at: 120,
        duration: 45,
        kind: 'credential-leak',
        targetId: 'db',
        title: 'A credential is being used from outside the VPC',
        message:
          'Someone found a database password and is using it from the internet. Public access, plain secrets, and no audit trail are all contributing.',
        severity: 'critical',
      },
      {
        id: 'sc-leak-vulnerability',
        at: 240,
        duration: 45,
        kind: 'vulnerability',
        targetId: 'app-1',
        title: 'The oldest host has a known vulnerability',
        message:
          'A critical advisory has a working exploit. The host has not been patched since the last quarterly window.',
        severity: 'critical',
      },
      {
        id: 'sc-leak-bruteforce',
        at: 360,
        duration: 45,
        kind: 'brute-force',
        title: 'Login attempts are coming from everywhere',
        message:
          'Credential stuffing is hitting the login endpoint. A WAF in block mode or a proxy rate limit would make this much less interesting.',
        severity: 'warning',
      },
    ],
    objectives: {
      maxErrorSeconds: 70,
      maxP95Ms: 400,
      maxMonthlyCost: 1500,
      noDataLoss: true,
    },
    seed: 10505,
    startingBudgetPerMonth: 1500,
    successText:
      'The database went private, the secrets moved into the vault, the host patched itself, and the botnet found a different login page. Security was a configuration problem after all.',
    failureText:
      'The leak became a breach because the weak settings were still live when the attacker arrived. The postmortem is now a disclosure.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
