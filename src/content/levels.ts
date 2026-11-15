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

/** Fast probes: the configuration level 1 is secretly asking the player for. */
const TUNED_HEALTH_CHECKS: NodeConfig = {
  algorithm: 'least-conn',
  healthCheckInterval: 2,
  unhealthyThreshold: 2,
  healthyThreshold: 2,
  timeoutMs: 3000,
  drainingSeconds: 30,
};

const SLOPPY_HEALTH_CHECKS: NodeConfig = {
  algorithm: 'round-robin',
  healthCheckInterval: 10,
  unhealthyThreshold: 5,
  healthyThreshold: 3,
  timeoutMs: 3000,
  drainingSeconds: 30,
};

export const CAMPAIGN_LEVELS: Scenario[] = [
  {
    id: 'one-is-none',
    act: 1,
    order: 1,
    title: 'One Is None',
    subtitle: 'The app tier has a single point of failure. It is the app tier.',
    customer: 'Nadia Okafor, CTO, Bramblewick & Sons (stationery, e-commerce, 61% of revenue)',
    brief:
      'We run one app server in one availability zone. Last Tuesday that zone had a bad afternoon and so did we: 61 seconds of 502s and a very direct email from the founder. Add a second app server in another zone, point the load balancer at both, and tune the health checks so a dead zone stops receiving traffic before customers notice. The database already has Multi-AZ. The app tier does not. Keep the bill under $600/month and do not lose an order.',
    hints: [
      'A second VM only helps if the load balancer stops routing to the dead one.',
      'Detection window ≈ health check interval × unhealthy threshold. Do the arithmetic.',
      'The database is already Multi-AZ. Adding a second database is not the lesson here.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, SLOPPY_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'App A', 'us-east', 'us-east-a', 300, 340),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
          connectionLimit: 100,
        }),
      ],
      [link('dns', 'lb'), link('lb', 'app-1'), link('app-1', 'db')],
    ),
    unlockedKinds: ['dns', 'lb', 'vm', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 18 },
      { at: 180, rps: 42 },
      { at: 360, rps: 72 },
      { at: 540, rps: 96 },
      { at: 600, rps: 84 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'l1-zone-a',
        at: 180,
        duration: 60,
        kind: 'zone-down',
        zoneId: 'us-east-a',
        regionId: 'us-east',
        title: 'us-east-a is having a bad afternoon',
        message: 'The provider has lost a zone. Instances in us-east-a are unreachable, including anything you put there.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 10,
      maxP95Ms: 250,
      maxMonthlyCost: 600,
      noDataLoss: true,
    },
    seed: 1101,
    startingBudgetPerMonth: 600,
    successText:
      'A zone vanished, customers did not. The load balancer noticed in seconds and the surviving VM carried the traffic. This is the whole job.',
    failureText:
      'One zone went away and took the shop with it. The load balancer kept sending half the traffic to a host that was no longer there.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'two-is-one',
    act: 1,
    order: 2,
    title: 'Two Is One',
    subtitle: 'A single database is a single point of failure with a nicer name.',
    customer: 'Priya Raman, Head of Platform, Cinderpath Freight',
    brief:
      'Our Postgres is a single instance with async replication and no standby, which is a fancy way of saying "one machine and a prayer". Last failover drill it went down for 90 seconds and we lost a pallet of shipment events. Make the database survive losing its primary. You already have two app VMs, so do not break them.',
    hints: [
      'Multi-AZ is the boring answer and it works: a short failover blip instead of a long outage.',
      'Replicas alone are not HA. Replicas plus sync replication plus automatic failover is.',
      'Async replication can lose the last few writes. "No data loss" is an objective, not a vibe.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'App A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_EAST, 'app-2', 'App B', 'us-east', 'us-east-b', 570, 340),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: false,
          replication: 'async',
          automaticFailover: false,
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
      { at: 60, rps: 20 },
      { at: 180, rps: 45 },
      { at: 360, rps: 70 },
      { at: 540, rps: 88 },
      { at: 600, rps: 80 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'l2-db-failover',
        at: 180,
        duration: 90,
        kind: 'db-failover',
        targetId: 'db',
        title: 'Primary database stopped answering',
        message: 'The database host is gone. Without a standby, "failover" is just a word in a runbook nobody wants to run.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 15,
      maxP95Ms: 300,
      noDataLoss: true,
    },
    seed: 2202,
    startingBudgetPerMonth: 700,
    successText:
      'The primary died and the standby took over with a blip instead of an afternoon. Writes survived. So did the freight.',
    failureText:
      'The primary database went down and stayed down. Every app request that needed a row got a 500 with good intentions.',
    unlockOnComplete: ['k8s'],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'the-split-brain',
    act: 1,
    order: 3,
    title: 'The Split Brain',
    subtitle: 'Async replication: fast, cheap, and occasionally a liar.',
    customer: 'Dermot Vance, Founder, Tinned Fish Monthly (a subscription, allegedly)',
    brief:
      'We have a primary, one async replica, and automatic failover turned on because it sounded responsible. During a network wobble the replica went stale and the promotion threw away the last few subscriptions. Nobody noticed until the invoices disagreed with reality. Make a partition and a failover survivable without inventing customers or deleting them.',
    hints: [
      'Async replication is why the last few writes vanished. Sync costs latency and saves data.',
      'A partition with async replication means the replica is stale. A partition with sync means writes fail fast — loudly, but honestly.',
      'Manual failover is slower and safer. Automatic failover is faster and only as good as the replication mode.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'App A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_EAST, 'app-2', 'App B', 'us-east', 'us-east-b', 570, 340),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 430, 500, {
          size: 'small',
          replicas: 1,
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
      { at: 60, rps: 22 },
      { at: 180, rps: 48 },
      { at: 360, rps: 78 },
      { at: 540, rps: 96 },
      { at: 600, rps: 88 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'l3-partition',
        at: 180,
        duration: 45,
        kind: 'network-partition',
        targetId: 'db',
        title: 'Replica cannot reach the primary',
        message: 'A partition split the database pair. The replica is stale; the failover logic is deciding what to do about it.',
        severity: 'warning',
      },
      {
        id: 'l3-failover',
        at: 240,
        duration: 60,
        kind: 'db-failover',
        targetId: 'db',
        title: 'Automatic failover promoted the replica',
        message: 'The standby is now primary. Everything it never received is now a support ticket.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 70,
      noDataLoss: true,
    },
    seed: 3303,
    startingBudgetPerMonth: 700,
    successText:
      'The partition happened, the failover happened, and the data still adds up. Slow and correct beats fast and haunted.',
    failureText:
      'The replica was promoted before it caught up. The split brain is not a metaphor; it is a line in the postmortem.',
    unlockOnComplete: ['cache'],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'pets-and-cattle',
    act: 2,
    order: 4,
    title: 'Pets and Cattle',
    subtitle: 'Kubernetes will replace your servers for you. Sometimes while you watch.',
    customer: 'Aiko Tanaka, VP Engineering, Meridian Ticketing (concerts, queues, regrets)',
    brief:
      'We moved the app to Kubernetes because the deck said "self-healing". The readiness probe is off, so a bad deploy goes straight to users. A worker node died last month and the pods on it did not come back in any hurry. Fix the cluster so a bad rollout, a dead zone, and a ticket rush are boring instead of cinematic.',
    hints: [
      'Readiness probes are how the load balancer learns a pod is not ready. Turning them off does not make deploys safer.',
      'Pods spread across zones. Three nodes in three zones means a zone failure costs you a third, not everything.',
      'Autoscaling is not instant. Give HPA a head start, or the spike wins.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40),
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
          maxUnavailable: 1,
        }),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 430, 500, {
          size: 'medium',
          replicas: 0,
          multiAz: true,
          connectionLimit: 140,
        }),
      ],
      [link('dns', 'lb'), link('lb', 'app-cluster'), link('app-cluster', 'db')],
    ),
    unlockedKinds: ['dns', 'lb', 'vm', 'k8s', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 25 },
      { at: 180, rps: 50 },
      { at: 300, rps: 72 },
      { at: 420, rps: 96 },
      { at: 540, rps: 120 },
      { at: 600, rps: 110 },
      { at: 660, rps: 100 },
    ],
    duration: 660,
    incidents: [
      {
        id: 'l4-bad-deploy',
        at: 120,
        duration: 20,
        kind: 'bad-deploy',
        targetId: 'app-cluster',
        title: 'Deploy 2.4.1 is not ready for production',
        message: 'The new pods start, fail their first request, and stay in the rotation. Readiness would have caught this.',
        severity: 'warning',
      },
      {
        id: 'l4-node-failure',
        at: 240,
        duration: 60,
        kind: 'zone-down',
        zoneId: 'us-east-a',
        regionId: 'us-east',
        title: 'us-east-a is gone',
        message: 'A zone dropped off the network. Pods that lived there are gone until the scheduler finds them a home.',
        severity: 'critical',
      },
      {
        id: 'l4-traffic-spike',
        at: 360,
        duration: 60,
        kind: 'traffic-spike',
        title: 'Ticket presale opened',
        message: 'Traffic is climbing fast. Everyone wants to see the same band and nobody wants to queue fairly.',
        severity: 'warning',
      },
    ],
    objectives: {
      maxErrorSeconds: 20,
      maxP95Ms: 300,
    },
    seed: 4404,
    startingBudgetPerMonth: 900,
    successText:
      'A bad deploy, a dead zone, and a presale rush, and the only thing that paged was the on-call phone doing its job. That is cattle.',
    failureText:
      'The cluster did what clusters do: it scheduled, restarted, and served 500s at scale. Readiness was off the whole time.',
    unlockOnComplete: ['cdn'],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'cache-rules-everything',
    act: 2,
    order: 5,
    title: 'Cache Rules Everything',
    subtitle: 'There are two hard problems: naming things, cache invalidation, and off-by-one.',
    customer: 'Sol Kim, Director of Engineering, Plover & Pine (home goods, unusually viral)',
    brief:
      'We bolted a CDN in front of the site and Redis in front of the database. Most days it is wonderful. On the day a product went viral, the cache expired all at once and every request in the country hit Postgres simultaneously. Postgres has opinions about that. Survive a traffic spike and a cold cache without the database becoming a very expensive space heater.',
    hints: [
      'A CDN with a short TTL and a low cacheable percentage is a rumour, not a cache.',
      'Stampede protection coalesces misses so one cold key does not become ten thousand queries.',
      'Origin shield exists precisely for the moment the edge cache turns into a funnel.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 300, -40),
        makeNode(US_EAST, 'cdn', 'cdn', 'Edge CDN', {}, 620, -40, {
          ttlSeconds: 60,
          cacheablePct: 70,
          originShield: false,
          compression: true,
        }),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_EAST, 'app-1', 'App A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_EAST, 'app-2', 'App B', 'us-east', 'us-east-b', 570, 340),
        makeNode(US_EAST, 'cache', 'cache', 'Redis', { regionId: 'us-east', zoneId: 'us-east-a' }, 300, 500, {
          sizeGb: 4,
          ttlSeconds: 60,
          eviction: 'lru',
          stampedeProtection: false,
        }),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 570, 500, {
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
      { at: 60, rps: 30 },
      { at: 180, rps: 60 },
      { at: 300, rps: 85 },
      { at: 420, rps: 110 },
      { at: 540, rps: 135 },
      { at: 600, rps: 125 },
      { at: 660, rps: 115 },
    ],
    duration: 660,
    incidents: [
      {
        id: 'l5-traffic-spike',
        at: 120,
        duration: 60,
        kind: 'traffic-spike',
        title: 'A candle went viral',
        message: 'Traffic is up sharply. The CDN is your friend until it runs out of friends.',
        severity: 'warning',
      },
      {
        id: 'l5-stampede',
        at: 240,
        duration: 45,
        kind: 'cache-stampede',
        targetId: 'cache',
        title: 'Every cache key expired at once',
        message: 'Hit ratio is zero. The database is receiving the entire internet one query at a time.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxP95Ms: 250,
      maxErrorSeconds: 15,
      maxMonthlyCost: 1500,
    },
    seed: 5505,
    startingBudgetPerMonth: 1500,
    successText:
      'The candle sold out, the cache was cold for a minute, and the database never noticed. That is what the cache was for.',
    failureText:
      'The cache went cold and the database got the whole country at once. p95 is now measured in geological time.',
    unlockOnComplete: ['proxy'],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'retry-harder',
    act: 3,
    order: 6,
    title: 'Retry Harder',
    subtitle: 'A retry is a request that has not learned anything.',
    customer: 'Ines Duarte, SRE Lead, Kettle & Co. (grocery delivery, dinner-dependent)',
    brief:
      'One slow backend turned into a site-wide outage because nginx round-robins half the traffic into it, retries every failure three times with no budget, our app gives up after three seconds, and nginx then waits thirty seconds for an answer that is never coming. When the backend gets slow, we multiply the load by four and call it resilience. Fix the timeouts, cap the retries, put a rate limit in front of the origin, and stop treating a sick backend like a healthy one.',
    hints: [
      'Round-robin sends half your traffic to the slow backend. Least connections notices the queue.',
      'Three retries with no budget is four times the traffic at the exact worst moment.',
      'nginx will wait 30 seconds for a backend that already gave up after three. Shorten the read timeout.',
      'Rate limiting protects the origin. It does not make you popular, but it keeps the lights on.',
    ],
    world: US_EAST,
    initialTopology: topology(
      [
        dnsNode(US_EAST, 430, -40),
        lbNode(US_EAST, 'lb', 'Public load balancer', 'us-east', 430, 170, {
          ...TUNED_HEALTH_CHECKS,
          algorithm: 'round-robin',
        }),
        makeNode(US_EAST, 'proxy', 'nginx', 'Edge proxy', { regionId: 'us-east', zoneId: 'us-east-a' }, 430, 255, {
          connectTimeoutMs: 500,
          readTimeoutMs: 30000,
          retries: 3,
          retryBudgetPct: 0,
          rateLimitRps: 0,
          workerConnections: 1024,
          buffering: true,
        }),
        vmNode(US_EAST, 'app-1', 'App A', 'us-east', 'us-east-a', 290, 340, { timeoutMs: 3000 }),
        vmNode(US_EAST, 'app-2', 'App B', 'us-east', 'us-east-b', 570, 340, { timeoutMs: 3000 }),
        dbNode(US_EAST, 'db', 'Primary database', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
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
    unlockedKinds: ['dns', 'lb', 'proxy', 'vm', 'cache', 'db'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 28 },
      { at: 180, rps: 58 },
      { at: 300, rps: 90 },
      { at: 420, rps: 118 },
      { at: 540, rps: 140 },
      { at: 600, rps: 128 },
    ],
    duration: 600,
    incidents: [
      {
        id: 'l6-node-slow',
        at: 120,
        duration: 60,
        kind: 'node-slow',
        targetId: 'app-1',
        title: 'App A is thinking about it',
        message: 'One backend is about twenty times slower and dropping capacity. Round-robin is still sending it half the traffic, and the retries are already on their way.',
        severity: 'warning',
      },
      {
        id: 'l6-traffic-spike',
        at: 240,
        duration: 60,
        kind: 'traffic-spike',
        title: 'Dinner rush',
        message: 'Grocery orders are up sharply. The proxy is the only thing between this and the database.',
        severity: 'warning',
      },
    ],
    objectives: {
      maxP95Ms: 400,
      maxErrorSeconds: 25,
    },
    seed: 6606,
    startingBudgetPerMonth: 900,
    successText:
      'A slow backend stayed slow, traffic spiked, and the p95 did not. Timeouts and a retry budget did more than any amount of heroics.',
    failureText:
      'The retries found the slow backend and multiplied it. The queue grew until the queue was the product.',
    unlockOnComplete: ['storage'],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },

  {
    id: 'cloudy-with-a-chance-of-outage',
    act: 3,
    order: 7,
    title: 'Cloudy with a Chance of Outage',
    subtitle: 'One region is not a strategy. It is a location.',
    customer: 'Marisol Vega, COO, Northwind Atlas (maps, routing, people who are already late)',
    brief:
      'Everything we run is in us-east. We have an eu-west account, a budget line for it, and a slide that says "multi-region" — but no actual servers. When us-east had a regional afternoon, the entire product was down for two hours. Build a real second region, make DNS fail over, and keep the bill under $2500/month. The map can go down. The directions cannot.',
    hints: [
      'DNS TTL is your failover time. Sixty seconds of cached answers is sixty seconds of outage.',
      'A second region needs its own LB, its own compute, and a database that is not in the failed region.',
      'Cross-region latency is 45 ms. Budget for it in the p95 objective.',
    ],
    world: US_AND_EU,
    initialTopology: topology(
      [
        dnsNode(US_AND_EU, 470, -40, { ttlSeconds: 60, routing: 'failover', healthChecks: true }),
        lbNode(US_AND_EU, 'lb', 'US load balancer', 'us-east', 430, 170, TUNED_HEALTH_CHECKS),
        vmNode(US_AND_EU, 'app-1', 'US App A', 'us-east', 'us-east-a', 290, 340),
        vmNode(US_AND_EU, 'app-2', 'US App B', 'us-east', 'us-east-b', 570, 340),
        dbNode(US_AND_EU, 'db', 'US database', 'us-east', 430, 500, {
          size: 'small',
          replicas: 0,
          multiAz: true,
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
    unlockedKinds: ['dns', 'lb', 'vm', 'db', 'cache', 'storage'],
    traffic: [
      { at: 0, rps: 0 },
      { at: 60, rps: 24 },
      { at: 180, rps: 52 },
      { at: 300, rps: 80 },
      { at: 420, rps: 105 },
      { at: 540, rps: 130 },
      { at: 660, rps: 150 },
      { at: 720, rps: 135 },
    ],
    duration: 720,
    incidents: [
      {
        id: 'l7-region-down',
        at: 180,
        duration: 120,
        kind: 'region-down',
        regionId: 'us-east',
        title: 'us-east has left the chat',
        message: 'The entire region is unreachable. Every node you placed there is gone, including the load balancer.',
        severity: 'critical',
      },
    ],
    objectives: {
      maxErrorSeconds: 30,
      maxP95Ms: 600,
      maxMonthlyCost: 2500,
    },
    seed: 7707,
    startingBudgetPerMonth: 2500,
    successText:
      'A whole region disappeared and the map kept giving directions. The failover was boring, which is the highest compliment a failover can receive.',
    failureText:
      'us-east went down and took the product with it. The second region was a slide, not a server.',
    unlockOnComplete: [],
    requiresDatabase: true,
    entryNodeIds: ['dns'],
  },
];

export function getLevel(id: string): Scenario | undefined {
  return CAMPAIGN_LEVELS.find((level) => level.id === id);
}

export function nextLevel(id: string): Scenario | undefined {
  const ordered = [...CAMPAIGN_LEVELS].sort((a, b) => a.act - b.act || a.order - b.order);
  const index = ordered.findIndex((level) => level.id === id);
  if (index < 0) return undefined;
  return ordered[index + 1];
}

/** Backwards-compatible alias used by the UI campaign metadata layer. */
export const LEVELS = CAMPAIGN_LEVELS;

export { TUNED_HEALTH_CHECKS };
