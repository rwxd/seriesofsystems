import { cfgBool, cfgNumber, cfgString } from './config';
import type {
  ComponentKind,
  ComponentSpec,
  ConfigField,
  NodeConfig,
  TopologyNode,
  World,
} from './types';

const sizeCost = { small: 30, medium: 70, large: 150 } as const;
const sizeCapacity = { small: 12, medium: 35, large: 90 } as const;
const podCapacity = { small: 10, medium: 30, large: 80 } as const;
const dbCapacity = { small: 25, medium: 70, large: 180 } as const;
const dbCost = { small: 60, medium: 150, large: 400 } as const;
const dbLatency = { small: 12, medium: 8, large: 5 } as const;

type SizeKey = keyof typeof sizeCost;

function size<T extends Record<string, number>>(table: T, value: string, fallback: keyof T): number {
  return table[value as keyof T] ?? table[fallback];
}

const placementHelp = 'Where this component lives. Failure domains are enforced by the simulation.';

const commonFields: ConfigField[] = [
  {
    key: 'size',
    label: 'Instance size',
    type: 'select',
    section: 'Sizing',
    options: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ],
    help: 'Bigger instances handle more concurrent requests before queueing.',
  },
];

function placementError(node: TopologyNode, scope: ComponentSpec['scope'], world: World): string[] {
  const errors: string[] = [];
  if (scope === 'global') {
    if (node.regionId || node.zoneId) errors.push('This component is global and cannot be pinned to a region or zone.');
    return errors;
  }
  if (!node.regionId) errors.push('Choose a region.');
  else if (!world.regions.some((region) => region.id === node.regionId)) errors.push('Unknown region.');
  if (scope === 'zonal') {
    const region = world.regions.find((candidate) => candidate.id === node.regionId);
    if (!node.zoneId) errors.push('Choose a zone.');
    else if (!region?.zones.some((zone) => zone.id === node.zoneId)) errors.push('Unknown zone for this region.');
  }
  return errors;
}

export const COMPONENT_SPECS: Record<ComponentKind, ComponentSpec> = {
  dns: {
    kind: 'dns',
    label: 'DNS',
    shortLabel: 'DNS',
    category: 'edge',
    scope: 'global',
    icon: 'dns',
    description: 'The phone book. Global, managed, and usually the last thing you should worry about — except for TTLs.',
    baseCostPerMonth: 5,
    perRpsCost: 0.00005,
    defaults: {
      ttlSeconds: 60,
      routing: 'failover',
      healthChecks: true,
    },
    fields: [
      {
        key: 'ttlSeconds',
        label: 'Record TTL',
        type: 'select',
        section: 'Routing',
        options: [
          { value: 30, label: '30 seconds' },
          { value: 60, label: '60 seconds' },
          { value: 300, label: '5 minutes' },
          { value: 900, label: '15 minutes' },
        ],
        help: 'How long clients cache the answer. Long TTLs make failover slow; short TTLs increase query load.',
      },
      {
        key: 'routing',
        label: 'Routing policy',
        type: 'select',
        section: 'Routing',
        options: [
          { value: 'failover', label: 'Failover' },
          { value: 'weighted', label: 'Weighted' },
          { value: 'geo', label: 'Geographic' },
        ],
        help: 'Failover sends traffic to the healthy target. Geographic routing keeps users near a region.',
      },
      {
        key: 'healthChecks',
        label: 'Health checks',
        type: 'boolean',
        section: 'Reliability',
        help: 'Remove unhealthy targets from DNS answers.',
      },
    ],
    costPerMonth: (node, _world, rps) => 5 + rps * 0.00005,
    capacity: () => 100000,
    latencyMs: () => 2,
    availability: () => 0.99999,
    validate: (node, _topology, world) => placementError(node, 'global', world),
  },

  waf: {
    kind: 'waf',
    label: 'Web app firewall',
    shortLabel: 'WAF',
    category: 'edge',
    scope: 'global',
    icon: 'waf',
    description:
      'A bouncer for the internet. Blocks the obvious attacks, absorbs floods, and writes a very long log about it.',
    baseCostPerMonth: 25,
    perRpsCost: 0.0002,
    defaults: {
      mode: 'block',
      ruleset: 'baseline',
      rateLimitRps: 0,
      botProtection: true,
    },
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        section: 'Protection',
        options: [
          { value: 'monitor', label: 'Monitor only' },
          { value: 'block', label: 'Block' },
        ],
        help: 'Monitor logs attacks and lets them through. Block actually stops them.',
      },
      {
        key: 'ruleset',
        label: 'Ruleset',
        type: 'select',
        section: 'Protection',
        options: [
          { value: 'baseline', label: 'Baseline' },
          { value: 'owasp', label: 'OWASP Top 10' },
        ],
        help: 'OWASP catches more application attacks at the cost of the occasional false positive.',
      },
      {
        key: 'rateLimitRps',
        label: 'Edge rate limit',
        type: 'number',
        section: 'Protection',
        min: 0,
        max: 5000,
        step: 10,
        unit: 'req/s',
        help: 'Reject excess traffic with 429 before it reaches the origin. 0 means off.',
      },
      {
        key: 'botProtection',
        label: 'Bot protection',
        type: 'boolean',
        section: 'Protection',
        help: 'Challenge automated traffic. Slows credential stuffing and scrapers.',
      },
    ],
    costPerMonth: (_node, _world, rps) => 25 + rps * 0.0002,
    capacity: () => 50000,
    latencyMs: () => 3,
    availability: () => 0.9999,
    validate: (node, _topology, world) => placementError(node, 'global', world),
  },

  cdn: {
    kind: 'cdn',
    label: 'CDN',
    shortLabel: 'CDN',
    category: 'edge',
    scope: 'global',
    icon: 'cdn',
    description: 'A worldwide cache with a surprisingly good marketing team. Offloads your origin until the cache misses.',
    baseCostPerMonth: 15,
    perRpsCost: 0.0006,
    defaults: {
      ttlSeconds: 300,
      originShield: false,
      cacheablePct: 80,
      compression: true,
      tls: true,
      tlsAutoRenew: false,
    },
    fields: [
      {
        key: 'ttlSeconds',
        label: 'Edge TTL',
        type: 'select',
        section: 'Caching',
        options: [
          { value: 60, label: '1 minute' },
          { value: 300, label: '5 minutes' },
          { value: 3600, label: '1 hour' },
          { value: 86400, label: '1 day' },
        ],
        help: 'Longer TTLs mean higher hit ratio and staler content. There is no free lunch.',
      },
      {
        key: 'cacheablePct',
        label: 'Cacheable traffic',
        type: 'select',
        section: 'Caching',
        options: [
          { value: 50, label: '50%' },
          { value: 70, label: '70%' },
          { value: 85, label: '85%' },
          { value: 95, label: '95%' },
        ],
        help: 'How much of the workload can be cached at all. Dynamic API responses rarely can.',
      },
      {
        key: 'originShield',
        label: 'Origin shield',
        type: 'boolean',
        section: 'Reliability',
        help: 'A second cache layer that protects the origin from a stampede.',
      },
      {
        key: 'compression',
        label: 'Compression',
        type: 'boolean',
        section: 'Efficiency',
        help: 'Reduces egress bytes. Nice for the bill.',
      },
      {
        key: 'tls',
        label: 'TLS termination',
        type: 'boolean',
        section: 'Security',
        help: 'Serve HTTPS at the edge. Turn it off and every visitor gets a certificate warning.',
      },
      {
        key: 'tlsAutoRenew',
        label: 'Auto-renew certificate',
        type: 'boolean',
        section: 'Security',
        help: 'Renew certificates automatically. Off means a cert-expiry incident takes you down.',
      },
    ],
    costPerMonth: (node, _world, rps) => 15 + rps * 0.0006,
    capacity: () => 50000,
    latencyMs: () => 12,
    availability: () => 0.9999,
    validate: (node, _topology, world) => placementError(node, 'global', world),
  },

  lb: {
    kind: 'lb',
    label: 'Load balancer',
    shortLabel: 'LB',
    category: 'ingress',
    scope: 'regional',
    icon: 'lb',
    description: 'Spreads requests across backends and ejects the unhealthy ones. The health check is the whole game.',
    baseCostPerMonth: 20,
    perRpsCost: 0.0001,
    defaults: {
      algorithm: 'least-conn',
      healthCheckInterval: 5,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      timeoutMs: 3000,
      drainingSeconds: 30,
      tls: true,
      tlsAutoRenew: false,
    },
    fields: [
      {
        key: 'algorithm',
        label: 'Algorithm',
        type: 'select',
        section: 'Balancing',
        options: [
          { value: 'least-conn', label: 'Least connections' },
          { value: 'round-robin', label: 'Round robin' },
          { value: 'random', label: 'Random' },
          { value: 'consistent-hash', label: 'Consistent hash' },
        ],
        help: 'Least connections handles slow backends. Consistent hash keeps related requests sticky.',
      },
      {
        key: 'healthCheckInterval',
        label: 'Health check interval',
        type: 'select',
        section: 'Health checks',
        options: [
          { value: 2, label: '2 seconds' },
          { value: 5, label: '5 seconds' },
          { value: 10, label: '10 seconds' },
        ],
        help: 'How often backends are probed. Faster detection costs more probe traffic.',
      },
      {
        key: 'unhealthyThreshold',
        label: 'Unhealthy threshold',
        type: 'select',
        section: 'Health checks',
        options: [
          { value: 2, label: '2 failures' },
          { value: 3, label: '3 failures' },
          { value: 5, label: '5 failures' },
        ],
        help: 'Consecutive failures before a backend is ejected. This is your outage window.',
      },
      {
        key: 'healthyThreshold',
        label: 'Healthy threshold',
        type: 'select',
        section: 'Health checks',
        options: [
          { value: 2, label: '2 successes' },
          { value: 3, label: '3 successes' },
        ],
        help: 'Consecutive successes before a backend is trusted again.',
      },
      {
        key: 'timeoutMs',
        label: 'Request timeout',
        type: 'select',
        section: 'Timeouts',
        options: [
          { value: 1000, label: '1 second' },
          { value: 3000, label: '3 seconds' },
          { value: 5000, label: '5 seconds' },
          { value: 10000, label: '10 seconds' },
        ],
        help: 'How long the balancer waits before giving up. Long timeouts hold connections hostage.',
      },
      {
        key: 'drainingSeconds',
        label: 'Connection draining',
        type: 'select',
        section: 'Lifecycle',
        options: [
          { value: 0, label: 'Off' },
          { value: 30, label: '30 seconds' },
          { value: 60, label: '60 seconds' },
        ],
        help: 'Let in-flight requests finish before removing a backend. Off means dropped requests during deploys.',
      },
      {
        key: 'tls',
        label: 'TLS termination',
        type: 'boolean',
        section: 'Security',
        help: 'Terminate HTTPS here. Turn it off and external traffic is served in the clear.',
      },
      {
        key: 'tlsAutoRenew',
        label: 'Auto-renew certificate',
        type: 'boolean',
        section: 'Security',
        help: 'Renew certificates before they expire. Off means a cert-expiry incident takes you down.',
      },
    ],
    costPerMonth: (node, _world, rps) => 20 + rps * 0.0001,
    capacity: () => 20000,
    latencyMs: () => 1,
    availability: () => 0.9999,
    validate: (node, _topology, world) => placementError(node, 'regional', world),
  },

  proxy: {
    kind: 'proxy',
    label: 'Nginx proxy',
    shortLabel: 'Nginx',
    category: 'ingress',
    scope: 'zonal',
    icon: 'nginx',
    description: 'A battle-tested reverse proxy. Great at timeouts, rate limits, and absorbing traffic you did not plan for.',
    baseCostPerMonth: 15,
    perRpsCost: 0,
    defaults: {
      algorithm: 'round-robin',
      connectTimeoutMs: 500,
      readTimeoutMs: 10000,
      retries: 0,
      retryBudgetPct: 10,
      rateLimitRps: 0,
      workerConnections: 1024,
      buffering: true,
    },
    fields: [
      {
        key: 'algorithm',
        label: 'Upstream balancing',
        type: 'select',
        section: 'Balancing',
        options: [
          { value: 'round-robin', label: 'Round robin' },
          { value: 'least-conn', label: 'Least connections' },
        ],
        help: 'Round robin treats every backend equally, even the slow one. Least connections notices the queue.',
      },
      {
        key: 'connectTimeoutMs',
        label: 'Connect timeout',
        type: 'select',
        section: 'Timeouts',
        options: [
          { value: 250, label: '250 ms' },
          { value: 500, label: '500 ms' },
          { value: 1000, label: '1 second' },
        ],
        help: 'How long nginx waits to open a connection to the backend.',
      },
      {
        key: 'readTimeoutMs',
        label: 'Read timeout',
        type: 'select',
        section: 'Timeouts',
        options: [
          { value: 2000, label: '2 seconds' },
          { value: 10000, label: '10 seconds' },
          { value: 30000, label: '30 seconds' },
        ],
        help: 'How long nginx waits for the backend to respond.',
      },
      {
        key: 'retries',
        label: 'Upstream retries',
        type: 'select',
        section: 'Retries',
        options: [
          { value: 0, label: 'None' },
          { value: 1, label: '1 retry' },
          { value: 2, label: '2 retries' },
          { value: 3, label: '3 retries' },
        ],
        help: 'Retries can paper over a blip or turn a small failure into a retry storm.',
      },
      {
        key: 'retryBudgetPct',
        label: 'Retry budget',
        type: 'number',
        section: 'Retries',
        min: 0,
        max: 50,
        step: 5,
        unit: '%',
        help: 'Cap retries as a share of traffic. Zero disables the budget.',
      },
      {
        key: 'rateLimitRps',
        label: 'Rate limit',
        type: 'number',
        section: 'Protection',
        min: 0,
        max: 5000,
        step: 10,
        unit: 'req/s',
        help: 'Reject excess traffic with 429 before it reaches the app. 0 means off.',
      },
      {
        key: 'workerConnections',
        label: 'Worker connections',
        type: 'number',
        section: 'Sizing',
        min: 128,
        max: 8192,
        step: 128,
        help: 'Concurrent connections nginx can hold. Exhaustion looks like a mysterious outage.',
      },
      {
        key: 'buffering',
        label: 'Response buffering',
        type: 'boolean',
        section: 'Protection',
        help: 'Absorbs slow clients so they do not occupy app workers.',
      },
    ],
    costPerMonth: () => 15,
    capacity: (node) => cfgNumber(node, 'workerConnections', 1024),
    latencyMs: () => 2,
    availability: () => 0.995,
    validate: (node, _topology, world) => placementError(node, 'zonal', world),
  },

  vm: {
    kind: 'vm',
    label: 'App VM',
    shortLabel: 'VM',
    category: 'compute',
    scope: 'zonal',
    icon: 'vm',
    description: 'A virtual machine running your app. Reliable until the host, the zone, or your latest deploy says otherwise.',
    baseCostPerMonth: 30,
    perRpsCost: 0,
    maxReplicas: 8,
    defaults: {
      size: 'small',
      replicas: 1,
      appLatencyMs: 8,
      timeoutMs: 3000,
      retries: 0,
      retryBudgetPct: 10,
      patching: 'manual',
      secrets: 'env',
    },
    fields: [
      ...commonFields,
      {
        key: 'replicas',
        label: 'Replicas in zone',
        type: 'number',
        section: 'Sizing',
        min: 1,
        max: 8,
        step: 1,
        help: 'More replicas share load inside this zone. They do not protect you from a zone failure.',
      },
      {
        key: 'appLatencyMs',
        label: 'App processing',
        type: 'number',
        section: 'Performance',
        min: 1,
        max: 200,
        step: 1,
        unit: 'ms',
        help: 'Base time your code spends on each request.',
      },
      {
        key: 'timeoutMs',
        label: 'Request timeout',
        type: 'select',
        section: 'Timeouts',
        options: [
          { value: 1000, label: '1 second' },
          { value: 3000, label: '3 seconds' },
          { value: 5000, label: '5 seconds' },
          { value: 10000, label: '10 seconds' },
        ],
        help: 'The app gives up after this long. Clients may retry, which may make things worse.',
      },
      {
        key: 'retries',
        label: 'Upstream retries',
        type: 'select',
        section: 'Retries',
        options: [
          { value: 0, label: 'None' },
          { value: 1, label: '1 retry' },
          { value: 2, label: '2 retries' },
          { value: 3, label: '3 retries' },
        ],
        help: 'Retries can paper over a blip or turn a small failure into a retry storm.',
      },
      {
        key: 'retryBudgetPct',
        label: 'Retry budget',
        type: 'number',
        section: 'Retries',
        min: 0,
        max: 50,
        step: 5,
        unit: '%',
        help: 'Cap retries as a share of traffic. Zero disables the budget.',
      },
      {
        key: 'patching',
        label: 'Patch policy',
        type: 'select',
        section: 'Security',
        options: [
          { value: 'auto', label: 'Automatic' },
          { value: 'manual', label: 'Manual' },
          { value: 'never', label: 'Never' },
        ],
        help: 'Automatic patching keeps a vulnerability incident from taking the VM down.',
      },
      {
        key: 'secrets',
        label: 'Secret storage',
        type: 'select',
        section: 'Security',
        options: [
          { value: 'vault', label: 'Secrets manager' },
          { value: 'env', label: 'Environment variables' },
          { value: 'plain', label: 'Plain config files' },
        ],
        help: 'Plain secrets turn a credential leak into a data breach.',
      },
    ],
    costPerMonth: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      return (sizeCost[key] ?? sizeCost.small) * cfgNumber(node, 'replicas', 1);
    },
    capacity: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      return (sizeCapacity[key] ?? sizeCapacity.small) * cfgNumber(node, 'replicas', 1);
    },
    latencyMs: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      const base = key === 'large' ? 6 : key === 'medium' ? 10 : 14;
      return base + cfgNumber(node, 'appLatencyMs', 8);
    },
    availability: (node) => {
      const replicas = cfgNumber(node, 'replicas', 1);
      return 1 - Math.pow(0.005, replicas);
    },
    validate: (node, _topology, world) => [
      ...placementError(node, 'zonal', world),
      ...(cfgNumber(node, 'replicas', 1) > 8 ? ['Replicas are capped at 8 per VM.'] : []),
    ],
  },

  k8s: {
    kind: 'k8s',
    label: 'Kubernetes',
    shortLabel: 'K8s',
    category: 'compute',
    scope: 'regional',
    icon: 'k8s',
    description: 'A cluster that schedules your pods, restarts them, and occasionally invents a new failure mode.',
    baseCostPerMonth: 70,
    perRpsCost: 0,
    defaults: {
      nodeCount: 3,
      size: 'medium',
      pods: 3,
      hpaMin: 2,
      hpaMax: 12,
      cpuTargetPct: 70,
      readinessProbe: true,
      livenessProbe: true,
      maxUnavailable: 1,
      patching: 'manual',
      secrets: 'env',
    },
    fields: [
      {
        key: 'nodeCount',
        label: 'Worker nodes',
        type: 'number',
        section: 'Sizing',
        min: 3,
        max: 12,
        step: 1,
        help: 'Nodes are spread across zones. Fewer than three is a gamble.',
      },
      {
        key: 'size',
        label: 'Node size',
        type: 'select',
        section: 'Sizing',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ],
      },
      {
        key: 'pods',
        label: 'Deployment replicas',
        type: 'number',
        section: 'Sizing',
        min: 1,
        max: 30,
        step: 1,
        help: 'Pods run your app. Spread them across zones for real availability.',
      },
      {
        key: 'readinessProbe',
        label: 'Readiness probe',
        type: 'boolean',
        section: 'Health',
        help: 'Keep traffic away from pods that are not ready. Without it, bad deploys go straight to users.',
      },
      {
        key: 'livenessProbe',
        label: 'Liveness probe',
        type: 'boolean',
        section: 'Health',
        help: 'Restart wedged pods automatically.',
      },
      {
        key: 'hpaMin',
        label: 'HPA minimum',
        type: 'number',
        section: 'Autoscaling',
        min: 1,
        max: 30,
        step: 1,
      },
      {
        key: 'hpaMax',
        label: 'HPA maximum',
        type: 'number',
        section: 'Autoscaling',
        min: 1,
        max: 60,
        step: 1,
      },
      {
        key: 'cpuTargetPct',
        label: 'CPU target',
        type: 'number',
        section: 'Autoscaling',
        min: 30,
        max: 95,
        step: 5,
        unit: '%',
        help: 'Scale out above this utilization. Scale back down slowly.',
      },
      {
        key: 'maxUnavailable',
        label: 'Max unavailable',
        type: 'number',
        section: 'Rollouts',
        min: 0,
        max: 10,
        step: 1,
        help: 'Pods that may be down during a rolling deploy. Zero is slow but safe.',
      },
      {
        key: 'patching',
        label: 'Patch policy',
        type: 'select',
        section: 'Security',
        options: [
          { value: 'auto', label: 'Automatic' },
          { value: 'manual', label: 'Manual' },
          { value: 'never', label: 'Never' },
        ],
        help: 'Automatic patching rolls pods safely. Manual patching means an outage window.',
      },
      {
        key: 'secrets',
        label: 'Secret storage',
        type: 'select',
        section: 'Security',
        options: [
          { value: 'vault', label: 'Secrets manager' },
          { value: 'env', label: 'Environment variables' },
          { value: 'plain', label: 'Plain config files' },
        ],
        help: 'Plain secrets turn a credential leak into a data breach.',
      },
    ],
    costPerMonth: (node) => {
      const key = cfgString(node, 'size', 'medium') as SizeKey;
      return 70 + (sizeCost[key] ?? sizeCost.medium) * cfgNumber(node, 'nodeCount', 3);
    },
    capacity: (node) => {
      const key = cfgString(node, 'size', 'medium') as SizeKey;
      return (podCapacity[key] ?? podCapacity.medium) * cfgNumber(node, 'pods', 3);
    },
    latencyMs: () => 10,
    availability: () => 0.999,
    validate: (node, _topology, world) => {
      const errors = placementError(node, 'regional', world);
      if (cfgNumber(node, 'hpaMin', 2) > cfgNumber(node, 'hpaMax', 12)) {
        errors.push('HPA minimum cannot exceed HPA maximum.');
      }
      if (cfgNumber(node, 'pods', 3) > cfgNumber(node, 'hpaMax', 12)) {
        errors.push('Deployment replicas exceed the HPA maximum.');
      }
      return errors;
    },
  },

  db: {
    kind: 'db',
    label: 'Database',
    shortLabel: 'Postgres',
    category: 'data',
    scope: 'regional',
    icon: 'db',
    description: 'The source of truth. Slow, expensive, and the only component whose failure can lose data.',
    baseCostPerMonth: 60,
    perRpsCost: 0,
    defaults: {
      size: 'small',
      replicas: 0,
      multiAz: false,
      replication: 'async',
      automaticFailover: true,
      connectionLimit: 100,
      storageGb: 100,
      encryption: false,
      backups: false,
      publicAccess: false,
    },
    fields: [
      ...commonFields,
      {
        key: 'multiAz',
        label: 'Multi-AZ',
        type: 'boolean',
        section: 'Reliability',
        help: 'Managed standby in another zone. Survives a zone failure with a short blip.',
      },
      {
        key: 'replicas',
        label: 'Read replicas',
        type: 'number',
        section: 'Reliability',
        min: 0,
        max: 3,
        step: 1,
        help: 'Extra copies for reads. They can be promoted, but only if you planned for it.',
      },
      {
        key: 'replication',
        label: 'Replication mode',
        type: 'select',
        section: 'Reliability',
        options: [
          { value: 'async', label: 'Asynchronous' },
          { value: 'sync', label: 'Synchronous' },
        ],
        help: 'Sync protects data but adds write latency. Async is faster and can lose the last few writes.',
      },
      {
        key: 'automaticFailover',
        label: 'Automatic failover',
        type: 'boolean',
        section: 'Reliability',
        help: 'Promote a standby without a human. Fast, unless it promotes the wrong one.',
      },
      {
        key: 'connectionLimit',
        label: 'Connection limit',
        type: 'number',
        section: 'Sizing',
        min: 20,
        max: 500,
        step: 10,
        help: 'Maximum concurrent connections. Exhaustion queues requests and ruins p95.',
      },
      {
        key: 'storageGb',
        label: 'Storage',
        type: 'number',
        section: 'Sizing',
        min: 20,
        max: 2000,
        step: 20,
        unit: 'GB',
      },
      {
        key: 'encryption',
        label: 'Encryption at rest',
        type: 'boolean',
        section: 'Security',
        help: 'Encrypt the volume and its backups. Boring, cheap, and the first thing an auditor asks for.',
      },
      {
        key: 'backups',
        label: 'Automated backups',
        type: 'boolean',
        section: 'Security',
        help: 'Point-in-time backups. Without them, a bad day becomes an unrecoverable day.',
      },
      {
        key: 'publicAccess',
        label: 'Public network access',
        type: 'boolean',
        section: 'Security',
        help: 'Reachable from the internet. Convenient for attackers and credential leaks.',
      },
    ],
    costPerMonth: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      const base = dbCost[key] ?? dbCost.small;
      return base * (cfgBool(node, 'multiAz') ? 2 : 1) + cfgNumber(node, 'replicas', 0) * 40;
    },
    capacity: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      return Math.min(dbCapacity[key] ?? dbCapacity.small, cfgNumber(node, 'connectionLimit', 100));
    },
    latencyMs: (node) => {
      const key = cfgString(node, 'size', 'small') as SizeKey;
      const base = dbLatency[key] ?? dbLatency.small;
      return base + (cfgString(node, 'replication', 'async') === 'sync' ? 3 : 0);
    },
    availability: (node) => {
      if (cfgBool(node, 'multiAz')) return 0.9995;
      if (cfgNumber(node, 'replicas', 0) > 0) return 0.999;
      return 0.995;
    },
    validate: (node, _topology, world) => placementError(node, 'regional', world),
  },

  cache: {
    kind: 'cache',
    label: 'Cache',
    shortLabel: 'Redis',
    category: 'data',
    scope: 'zonal',
    icon: 'cache',
    description: 'Makes reads fast and failures interesting. The moment it dies, your database finds out how popular it is.',
    baseCostPerMonth: 20,
    perRpsCost: 0,
    defaults: {
      sizeGb: 4,
      ttlSeconds: 60,
      eviction: 'lru',
      stampedeProtection: true,
    },
    fields: [
      {
        key: 'sizeGb',
        label: 'Memory',
        type: 'number',
        section: 'Sizing',
        min: 1,
        max: 64,
        step: 1,
        unit: 'GB',
      },
      {
        key: 'ttlSeconds',
        label: 'TTL',
        type: 'select',
        section: 'Caching',
        options: [
          { value: 10, label: '10 seconds' },
          { value: 60, label: '1 minute' },
          { value: 300, label: '5 minutes' },
          { value: 3600, label: '1 hour' },
        ],
        help: 'Longer TTLs hit more often, until every key expires at once.',
      },
      {
        key: 'eviction',
        label: 'Eviction policy',
        type: 'select',
        section: 'Caching',
        options: [
          { value: 'lru', label: 'Least recently used' },
          { value: 'lfu', label: 'Least frequently used' },
          { value: 'random', label: 'Random' },
        ],
      },
      {
        key: 'stampedeProtection',
        label: 'Stampede protection',
        type: 'boolean',
        section: 'Reliability',
        help: 'Coalesce misses so a cold cache does not send every request to the database.',
      },
    ],
    costPerMonth: (node) => 20 + cfgNumber(node, 'sizeGb', 4) * 4,
    capacity: () => 10000,
    latencyMs: () => 1,
    availability: () => 0.999,
    validate: (node, _topology, world) => placementError(node, 'zonal', world),
  },

  storage: {
    kind: 'storage',
    label: 'Object storage',
    shortLabel: 'Storage',
    category: 'data',
    scope: 'regional',
    icon: 'storage',
    description: 'Boring, durable, and exactly what you want for static assets and backups.',
    baseCostPerMonth: 5,
    perRpsCost: 0.00002,
    defaults: {
      storageGb: 100,
      storageClass: 'standard',
      versioning: true,
      encryption: false,
      publicAccess: false,
    },
    fields: [
      {
        key: 'storageGb',
        label: 'Stored data',
        type: 'number',
        section: 'Sizing',
        min: 10,
        max: 5000,
        step: 10,
        unit: 'GB',
      },
      {
        key: 'storageClass',
        label: 'Storage class',
        type: 'select',
        section: 'Sizing',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'infrequent', label: 'Infrequent access' },
          { value: 'archive', label: 'Archive' },
        ],
      },
      {
        key: 'versioning',
        label: 'Versioning',
        type: 'boolean',
        section: 'Reliability',
        help: 'Keep old versions. Great for accidental deletes, less great for the bill.',
      },
      {
        key: 'encryption',
        label: 'Encryption at rest',
        type: 'boolean',
        section: 'Security',
        help: 'Encrypt objects and snapshots at rest.',
      },
      {
        key: 'publicAccess',
        label: 'Public bucket',
        type: 'boolean',
        section: 'Security',
        help: 'Anyone on the internet can read the bucket. Great for marketing assets, terrible for backups.',
      },
    ],
    costPerMonth: (node, _world, rps) => 5 + cfgNumber(node, 'storageGb', 100) * 0.1 + rps * 0.00002,
    capacity: () => 5000,
    latencyMs: () => 8,
    availability: () => 0.999999999,
    validate: (node, _topology, world) => placementError(node, 'regional', world),
  },
};

export const COMPONENT_ORDER: ComponentKind[] = [
  'dns',
  'waf',
  'cdn',
  'lb',
  'proxy',
  'vm',
  'k8s',
  'db',
  'cache',
  'storage',
];

export function getSpec(kind: ComponentKind): ComponentSpec {
  return COMPONENT_SPECS[kind];
}

export function defaultConfig(kind: ComponentKind): NodeConfig {
  return { ...COMPONENT_SPECS[kind].defaults };
}

export function nodeCostPerMonth(node: TopologyNode, world: World, rps: number): number {
  return getSpec(node.kind).costPerMonth(node, world, rps);
}

export function topologyCostPerMonth(topology: { nodes: TopologyNode[] }, world: World, rps: number): number {
  return topology.nodes.reduce((sum, node) => sum + nodeCostPerMonth(node, world, rps), 0);
}

/** Estimated hit ratio for a cache or CDN. `cacheablePct` may be 0-1 or 0-100. */
export function cacheHitRatio(ttlSeconds: number, cacheablePct: number, sizeGb: number): number {
  const fraction = cacheablePct > 1 ? cacheablePct / 100 : cacheablePct;
  const ttlFactor = Math.min(1, Math.log10(Math.max(10, ttlSeconds)) / 4);
  const sizeFactor = Math.min(1, Math.log10(Math.max(1, sizeGb)) / 1.8);
  return Math.min(0.98, fraction * (0.45 + 0.35 * ttlFactor + 0.12 * sizeFactor));
}
