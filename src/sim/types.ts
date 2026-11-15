/**
 * Shared contracts for Series of Systems.
 *
 * The simulation is a pure TypeScript module: it must not import React, DOM
 * APIs, or anything from `src/ui`. The UI reads `SimSnapshot` values and sends
 * plain `Topology` objects back in.
 *
 * Time is measured in simulated seconds. Positions (`x`, `y`) are canvas
 * coordinates and are ignored by the simulation.
 */

export type ID = string;

export type ConfigValue = string | number | boolean;
export type NodeConfig = Record<string, ConfigValue>;

export type ComponentKind =
  | 'dns'
  | 'cdn'
  | 'lb'
  | 'proxy'
  | 'vm'
  | 'k8s'
  | 'db'
  | 'cache'
  | 'storage';

export type ComponentCategory = 'edge' | 'ingress' | 'compute' | 'data';
export type PlacementScope = 'global' | 'regional' | 'zonal';

export interface CloudDef {
  id: ID;
  name: string;
  color: string;
  blurb: string;
}

export interface ZoneDef {
  id: ID;
  name: string;
  shortName: string;
}

export interface RegionDef {
  id: ID;
  name: string;
  shortName: string;
  cloudId: ID;
  zones: ZoneDef[];
  /** Optional rough position for the world map / background. */
  x?: number;
  y?: number;
}

export interface World {
  clouds: CloudDef[];
  regions: RegionDef[];
  latency: {
    sameZone: number;
    crossZone: number;
    crossRegion: number;
    crossCloud: number;
  };
}

export interface TopologyNode {
  id: ID;
  kind: ComponentKind;
  name: string;
  /** Present for regional and zonal components. */
  cloudId?: ID;
  /** Present for regional and zonal components. */
  regionId?: ID;
  /** Present for zonal components. */
  zoneId?: ID;
  config: NodeConfig;
  x: number;
  y: number;
}

export interface TopologyLink {
  id: ID;
  from: ID;
  to: ID;
}

export interface Topology {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface ConfigOption {
  value: string | number;
  label: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'text';
  section?: string;
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ConfigOption[];
}

export interface ComponentSpec {
  kind: ComponentKind;
  label: string;
  shortLabel: string;
  category: ComponentCategory;
  scope: PlacementScope;
  /** Key into the UI icon registry. */
  icon: string;
  description: string;
  defaults: NodeConfig;
  fields: ConfigField[];
  baseCostPerMonth: number;
  /** Additional monthly cost per sustained request per second. */
  perRpsCost: number;
  costPerMonth(node: TopologyNode, world: World, rps: number): number;
  /** Concurrent requests this component can process without queueing. */
  capacity(node: TopologyNode, world: World): number;
  latencyMs(node: TopologyNode, world: World): number;
  /** Nominal uptime used for the theoretical availability estimate. */
  availability(node: TopologyNode): number;
  maxReplicas?: number;
  validate?(node: TopologyNode, topology: Topology, world: World): string[];
}

export type NodeStatus = 'healthy' | 'degraded' | 'down';

export interface MetricPoint {
  t: number;
  v: number;
}

export interface SimSeries {
  rps: MetricPoint[];
  errors: MetricPoint[];
  p95: MetricPoint[];
  cost: MetricPoint[];
}

export interface NodeMetrics {
  nodeId: ID;
  status: NodeStatus;
  rps: number;
  inFlight: number;
  queue: number;
  capacity: number;
  utilization: number;
  errorRate: number;
  p95: number;
  requests: number;
  failures: number;
  replicasUp: number;
  replicasTotal: number;
  note?: string;
}

export interface LinkMetrics {
  linkId: ID;
  rps: number;
  utilization: number;
  status: 'up' | 'down' | 'degraded';
}

export type IncidentKind =
  | 'zone-down'
  | 'region-down'
  | 'node-crash'
  | 'node-slow'
  | 'bad-deploy'
  | 'traffic-spike'
  | 'cache-stampede'
  | 'network-partition'
  | 'cert-expiry'
  | 'disk-full'
  | 'db-failover'
  | 'control-plane-outage'
  | 'noisy-neighbor'
  | 'ddos';

export type Severity = 'info' | 'warning' | 'critical';

export interface ScenarioIncident {
  id: ID;
  at: number;
  duration?: number;
  kind: IncidentKind;
  targetId?: ID;
  zoneId?: ID;
  regionId?: ID;
  cloudId?: ID;
  title: string;
  message: string;
  severity: Severity;
}

export interface ActiveIncident {
  id: ID;
  kind: IncidentKind;
  title: string;
  message: string;
  severity: Severity;
  startedAt: number;
  endsAt?: number;
  targetId?: ID;
}

export interface Issue {
  id: ID;
  at: number;
  severity: Severity;
  title: string;
  message: string;
  nodeId?: ID;
  incidentId?: ID;
}

export type GameEventKind =
  | 'incident'
  | 'recovery'
  | 'deploy'
  | 'alert'
  | 'runbook'
  | 'data-loss'
  | 'system'
  | 'objective';

export interface GameEvent {
  id: ID;
  at: number;
  kind: GameEventKind;
  severity: Severity;
  title: string;
  message: string;
  nodeId?: ID;
  incidentId?: ID;
}

export type RunbookKind =
  | 'restart'
  | 'failover-db'
  | 'failover-dns'
  | 'scale-out'
  | 'rollback'
  | 'flush-cache'
  | 'rate-limit'
  | 'drain'
  | 'renew-cert';

export interface RunbookResult {
  ok: boolean;
  message: string;
}

export interface TraceHop {
  nodeId: ID;
  nodeName: string;
  kind: ComponentKind;
  at: number;
  durationMs: number;
  ok: boolean;
  note?: string;
}

export interface RequestTrace {
  id: ID;
  at: number;
  ok: boolean;
  latencyMs: number;
  status: number;
  entryId: ID;
  path: TraceHop[];
  error?: string;
  retries: number;
}

export interface SimSnapshot {
  time: number;
  duration: number;
  running: boolean;
  ended: boolean;
  rps: number;
  requests: number;
  failures: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  errorSeconds: number;
  availability: number;
  monthlyCost: number;
  dataLossEvents: number;
  dbLagMs: number;
  nodes: Record<ID, NodeMetrics>;
  links: Record<ID, LinkMetrics>;
  incidents: ActiveIncident[];
  issues: Issue[];
  series: SimSeries;
}

export interface TrafficPoint {
  at: number;
  rps: number;
}

export interface Objectives {
  maxErrorSeconds?: number;
  maxP95Ms?: number;
  maxMonthlyCost?: number;
  noDataLoss?: boolean;
  minAvailability?: number;
}

export interface Scenario {
  id: ID;
  act: number;
  order: number;
  title: string;
  subtitle: string;
  customer: string;
  brief: string;
  hints: string[];
  world: World;
  initialTopology: Topology;
  unlockedKinds: ComponentKind[];
  traffic: TrafficPoint[];
  duration: number;
  incidents: ScenarioIncident[];
  objectives: Objectives;
  seed: number;
  startingBudgetPerMonth: number;
  successText: string;
  failureText: string;
  unlockOnComplete?: ComponentKind[];
  /** If true, every compute node must reach a database or the workload fails. */
  requiresDatabase?: boolean;
  /** Optional explicit entry points. If omitted, nodes with no incoming links are used. */
  entryNodeIds?: ID[];
  sandbox?: boolean;
  difficulty?: 'relaxed' | 'normal' | 'chaos';
}

export interface ObjectiveResult {
  key: string;
  label: string;
  target: string;
  actual: string;
  met: boolean;
}

export interface PostmortemMetrics {
  availability: number;
  errorSeconds: number;
  p95: number;
  monthlyCost: number;
  dataLossEvents: number;
  totalRequests: number;
  failedRequests: number;
  duration: number;
}

export interface Postmortem {
  levelId: ID;
  levelTitle: string;
  outcome: 'success' | 'failure';
  stars: number;
  headline: string;
  summary: string;
  timeline: GameEvent[];
  rootCause: string;
  contributingFactors: string[];
  actionItems: string[];
  objectives: ObjectiveResult[];
  metrics: PostmortemMetrics;
}

export interface Settings {
  reducedMotion: boolean;
  sound: boolean;
  showHints: boolean;
}

export interface Profile {
  version: number;
  stars: Record<string, number>;
  completed: string[];
  unlocked: ComponentKind[];
  settings: Settings;
  sandboxBest: number;
}

export interface SimulationOptions {
  onEvent?: (event: GameEvent) => void;
}

/**
 * Deterministic simulation instance. The UI calls `tick()` from its animation
 * loop with elapsed simulated seconds; all internal scheduling is independent
 * of wall-clock time.
 */
export interface Simulation {
  readonly scenario: Scenario;
  readonly time: number;
  readonly ended: boolean;
  start(): void;
  tick(dt: number): void;
  snapshot(): SimSnapshot;
  applyTopology(topology: Topology): void;
  triggerIncident(incident: ScenarioIncident): void;
  runRunbook(kind: RunbookKind, targetId?: ID): RunbookResult;
  traces(): RequestTrace[];
  eventLog(): GameEvent[];
}
