/**
 * Deterministic, event-driven simulation engine for Series of Systems.
 *
 * The engine is pure TypeScript: no DOM, no React, no wall-clock time, and no
 * `Math.random()`. Every decision flows through the seeded RNG in `rng.ts`, and
 * all generated IDs use monotonic counters. Two runs with the same seed,
 * topology, incidents and player actions therefore produce identical results.
 */

import { cacheHitRatio, getSpec, topologyCostPerMonth } from './catalog';
import { cfgBool, cfgNumber, cfgString } from './config';
import { MinHeap, compareTimed } from './heap';
import { BucketTracker, Reservoir, SlidingCounter, clamp } from './metrics';
import { createRng, type Rng } from './rng';
import type {
  ActiveIncident,
  ComponentKind,
  ComponentSpec,
  GameEvent,
  GameEventKind,
  ID,
  Issue,
  LinkMetrics,
  MetricPoint,
  NodeMetrics,
  NodeStatus,
  RequestTrace,
  RunbookKind,
  RunbookResult,
  Scenario,
  ScenarioIncident,
  Severity,
  SimSeries,
  SimSnapshot,
  Simulation,
  SimulationOptions,
  Topology,
  TopologyLink,
  TopologyNode,
  TraceHop,
  World,
} from './types';

const MAX_TICK = 0.5;
const TRAFFIC_INTERVAL = 0.1;
const CLIENT_TIMEOUT_SECONDS = 3;
const FAILOVER_SECONDS = 6;
const AUTO_FAILOVER_SECONDS = 20;
const RESCHEDULE_SECONDS = 8;
const HPA_INTERVAL = 5;
const HPA_COOLDOWN = 10;
const BAD_DEPLOY_SECONDS = 20;
const SERIES_POINTS = 120;
const RESERVOIR_SIZE = 2000;
const FAILED_TRACE_LIMIT = 30;
const SLOW_TRACE_LIMIT = 10;
const MAX_ISSUES = 50;
const MAX_EVENTS = 400;

const POD_CAPACITY: Record<string, number> = { small: 10, medium: 30, large: 80 };

interface SimRequest {
  id: string;
  entryId: ID;
  createdAt: number;
  deadline: number;
  hops: TraceHop[];
  retries: number;
  cacheHit: boolean;
  hitDb: boolean;
  dataLost: boolean;
  done: boolean;
  status: number;
  error?: string;
}

interface RequestQueue {
  size: number;
  push(request: SimRequest): void;
  shift(): SimRequest | undefined;
  peek(): SimRequest | undefined;
  drain(): SimRequest[];
}

function createQueue(): RequestQueue {
  const items: SimRequest[] = [];
  let head = 0;
  const compact = (): void => {
    if (head > 64 && head * 2 > items.length) {
      items.splice(0, head);
      head = 0;
    }
  };
  return {
    get size(): number {
      return items.length - head;
    },
    push(request: SimRequest): void {
      items.push(request);
    },
    shift(): SimRequest | undefined {
      if (head >= items.length) return undefined;
      const value = items[head];
      head += 1;
      if (head === items.length) {
        items.length = 0;
        head = 0;
      } else {
        compact();
      }
      return value;
    },
    peek(): SimRequest | undefined {
      return head < items.length ? items[head] : undefined;
    },
    drain(): SimRequest[] {
      const remaining = items.slice(head);
      items.length = 0;
      head = 0;
      return remaining;
    },
  };
}

interface BackendHealth {
  failures: number;
  successes: number;
  ejected: boolean;
}

interface K8sState {
  podsTotal: number;
  lostPods: number;
  badPods: number;
  cooldownUntil: number;
}

interface DbState {
  failoverUntil: number;
  stale: boolean;
  diskFull: boolean;
  syncWritesFail: boolean;
  manualPromoted: boolean;
}

interface CacheState {
  flushUntil: number;
}

interface RuntimeNode {
  node: TopologyNode;
  spec: ComponentSpec;
  downReasons: Set<string>;
  slow: number;
  noisy: number;
  draining: boolean;
  inFlight: number;
  queue: RequestQueue;
  out: ID[];
  incoming: ID[];
  linkIdByTarget: Map<ID, ID>;
  requests: number;
  failures: number;
  latency: Reservoir;
  recent: SlidingCounter;
  // per-kind state
  dnsTarget?: { id: ID; expiresAt: number };
  backends: Map<ID, BackendHealth>;
  roundRobin: number;
  k8s?: K8sState;
  db?: DbState;
  cache?: CacheState;
  cacheStampede: boolean;
  badDeployUntil: number;
  rateSec: number;
  rateCount: number;
  note?: string;
}

interface BaseEvent {
  time: number;
  seq: number;
}

interface TrafficPayload {
  kind: 'traffic';
}

interface ArrivePayload {
  kind: 'arrive';
  request: SimRequest;
  nodeId: ID;
}

interface DonePayload {
  kind: 'done';
  request: SimRequest;
  nodeId: ID;
  serviceMs: number;
}

interface HealthPayload {
  kind: 'health';
  lbId: ID;
  backendId: ID;
  version: number;
}

interface HpaPayload {
  kind: 'hpa';
  nodeId: ID;
  version: number;
}

interface ActionPayload {
  kind: 'action';
  run: () => void;
}

type EventPayload = TrafficPayload | ArrivePayload | DonePayload | HealthPayload | HpaPayload | ActionPayload;
type SimEvent = EventPayload & BaseEvent;

interface RetryPolicy {
  maxRetries: number;
  budgetPct: number;
}

function round(value: number, precision = 1): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

function cloneTopology(topology: Topology): Topology {
  return {
    nodes: topology.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    links: topology.links.map((link) => ({ ...link })),
  };
}

class SimulationEngine implements Simulation {
  readonly scenario: Scenario;

  private readonly world: World;
  private readonly options: SimulationOptions;
  private readonly rng: Rng;

  private topology: Topology;
  private runtime = new Map<ID, RuntimeNode>();
  private linkCounters = new Map<ID, SlidingCounter>();
  private entries: ID[] = [];
  private entrySet = new Set<ID>();

  private readonly heap = new MinHeap<SimEvent>(compareTimed);
  private seq = 0;
  private idCounter = 0;
  private currentTime = 0;
  private endedFlag = false;
  private running = false;
  private started = false;
  private topologyVersion = 0;
  private accumulator = 0;

  // Metrics
  private readonly traffic: BucketTracker;
  private readonly completions: Reservoir;
  private readonly retryWindow = new SlidingCounter(10);
  private totalRequests = 0;
  private totalFailures = 0;
  private errorSeconds = 0;
  private dataLossEvents = 0;
  private readonly series: SimSeries = { rps: [], errors: [], p95: [], cost: [] };
  private failedTraces: RequestTrace[] = [];
  private slowTraces: RequestTrace[] = [];
  private issues: Issue[] = [];
  private issueKeys = new Map<string, number>();
  private events: GameEvent[] = [];

  // Incidents and global effects
  private active = new Map<ID, ActiveIncident>();
  private incidentCleanups = new Map<ID, Array<() => void>>();
  private incidentZones = new Map<ID, ID>();
  private incidentRegions = new Map<ID, ID>();
  private zoneDown = new Set<ID>();
  private regionDown = new Set<ID>();
  private trafficMultipliers: number[] = [];
  private ddosCount = 0;
  private certExpiredCount = 0;
  private controlPlaneOutageCount = 0;
  /** Unprotected cache stampedes amplify load on the database. */
  private stampedePressure = 0;

  // caches
  private retryPolicies = new Map<ID, RetryPolicy>();
  private dbPathCache = new Map<ID, boolean>();

  constructor(scenario: Scenario, topology: Topology, options: SimulationOptions = {}) {
    this.scenario = scenario;
    this.world = scenario.world;
    this.options = options;
    this.rng = createRng(scenario.seed);
    this.topology = cloneTopology(topology);
    this.traffic = new BucketTracker(10);
    this.completions = new Reservoir(RESERVOIR_SIZE);
    this.rebuildRuntime(this.topology);
    this.scheduleScenarioIncidents();
  }

  get time(): number {
    return this.currentTime;
  }

  get ended(): boolean {
    return this.endedFlag;
  }

  start(): void {
    if (this.started || this.endedFlag) return;
    this.started = true;
    this.running = true;
    this.schedule(this.currentTime, { kind: 'traffic' });
    this.schedule(this.currentTime + 1, { kind: 'action', run: () => this.sweep() });
  }

  tick(dt: number): void {
    if (!this.running || this.endedFlag) return;
    if (!Number.isFinite(dt) || dt <= 0) return;

    let remaining = Math.min(dt, Math.max(0, this.scenario.duration - this.currentTime));
    if (remaining <= 0) {
      this.finishRun();
      return;
    }

    let guard = 0;
    while (remaining > 1e-9 && !this.endedFlag) {
      const step = Math.min(MAX_TICK, remaining);
      this.advanceTo(this.currentTime + step);
      remaining -= step;
      guard += 1;
      if (guard > 100000) break;
    }

    if (this.currentTime >= this.scenario.duration - 1e-9) this.finishRun();
  }

  snapshot(): SimSnapshot {
    const sec = Math.floor(this.currentTime);
    const recent = this.traffic.recent(sec, 10);
    let recentRequests = 0;
    let recentFailures = 0;
    for (const bucket of recent) {
      recentRequests += bucket.arrivals;
      recentFailures += bucket.failures;
    }
    const errorRate = recentRequests > 0
      ? recentFailures / recentRequests
      : this.totalRequests > 0
        ? this.totalFailures / this.totalRequests
        : 0;
    const availability = this.totalRequests > 0
      ? clamp((this.totalRequests - this.totalFailures) / this.totalRequests, 0, 1)
      : 1;
    const rps = this.currentRps();

    const nodes: Record<ID, NodeMetrics> = {};
    for (const rt of this.runtime.values()) nodes[rt.node.id] = this.nodeMetrics(rt, sec);

    const links: Record<ID, LinkMetrics> = {};
    for (const link of this.topology.links) links[link.id] = this.linkMetrics(link, sec);

    const incidents = [...this.active.values()]
      .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1))
      .map((incident) => ({ ...incident }));

    return {
      time: this.currentTime,
      duration: this.scenario.duration,
      running: this.running,
      ended: this.endedFlag,
      rps,
      requests: this.totalRequests,
      failures: this.totalFailures,
      errorRate,
      p50: this.completions.quantile(0.5),
      p95: this.completions.quantile(0.95),
      p99: this.completions.quantile(0.99),
      errorSeconds: this.errorSeconds,
      availability,
      monthlyCost: round(topologyCostPerMonth(this.topology, this.world, rps), 2),
      dataLossEvents: this.dataLossEvents,
      dbLagMs: this.dbLagMs(),
      nodes,
      links,
      incidents,
      issues: this.issues.map((issue) => ({ ...issue })),
      series: {
        rps: this.series.rps.map((point) => ({ ...point })),
        errors: this.series.errors.map((point) => ({ ...point })),
        p95: this.series.p95.map((point) => ({ ...point })),
        cost: this.series.cost.map((point) => ({ ...point })),
      },
    };
  }

  applyTopology(topology: Topology): void {
    this.topology = cloneTopology(topology);
    this.rebuildRuntime(this.topology);
    this.log(
      'deploy',
      'info',
      'Deployment applied',
      `${this.topology.nodes.length} components and ${this.topology.links.length} links are live.`,
    );
  }

  triggerIncident(incident: ScenarioIncident): void {
    this.applyIncident({ ...incident, at: this.currentTime });
  }

  runRunbook(kind: RunbookKind, targetId?: ID): RunbookResult {
    const explicit = targetId ? this.runtime.get(targetId) : undefined;
    let result: RunbookResult;

    switch (kind) {
      case 'restart': {
        result = this.runbookRestart(explicit);
        break;
      }
      case 'failover-db': {
        result = this.runbookFailoverDb(explicit);
        break;
      }
      case 'failover-dns': {
        for (const rt of this.runtime.values()) {
          if (rt.node.kind === 'dns') rt.dnsTarget = undefined;
        }
        result = { ok: true, message: 'Flushed DNS answers. Clients will refresh on their next lookup.' };
        break;
      }
      case 'scale-out': {
        result = this.runbookScaleOut(explicit);
        break;
      }
      case 'rollback': {
        let changed = false;
        for (const rt of this.runtime.values()) {
          if (rt.badDeployUntil > this.currentTime || (rt.k8s && rt.k8s.badPods > 0)) {
            rt.badDeployUntil = 0;
            if (rt.k8s) rt.k8s.badPods = 0;
            changed = true;
          }
        }
        const ids = [...this.active.entries()]
          .filter(([, incident]) => incident.kind === 'bad-deploy')
          .map(([id]) => id);
        for (const id of ids) this.recoverIncident(id);
        result = changed
          ? { ok: true, message: 'Rolled back the deploy. Traffic is returning to the previous version.' }
          : { ok: false, message: 'No deploy is currently broken.' };
        break;
      }
      case 'flush-cache': {
        const caches = explicit
          ? [explicit]
          : [...this.runtime.values()].filter((rt) => rt.node.kind === 'cache');
        let changed = false;
        for (const rt of caches) {
          if (rt.cache) {
            rt.cache.flushUntil = this.currentTime + 5;
            changed = true;
          }
        }
        result = changed
          ? { ok: true, message: 'Cache flushed. Expect a short, painful cold start.' }
          : { ok: false, message: 'No cache to flush.' };
        break;
      }
      case 'rate-limit': {
        const proxies = explicit
          ? [explicit]
          : [...this.runtime.values()].filter((rt) => rt.node.kind === 'proxy');
        let changed = false;
        const limit = Math.max(1, Math.ceil(this.currentRps()));
        for (const rt of proxies) {
          if (rt.node.kind !== 'proxy') continue;
          rt.node.config = { ...rt.node.config, rateLimitRps: limit };
          changed = true;
        }
        result = changed
          ? { ok: true, message: `Rate limit set to ${limit} req/s at the edge.` }
          : { ok: false, message: 'No proxy to rate limit.' };
        break;
      }
      case 'drain': {
        let target = explicit;
        if (!target) {
          for (const rt of this.runtime.values()) {
            if (rt.node.kind !== 'lb' || rt.out.length === 0) continue;
            target = this.runtime.get(rt.out[0]);
            if (target) break;
          }
        }
        if (!target) {
          result = { ok: false, message: 'Pick a node to drain.' };
          break;
        }
        target.draining = true;
        result = { ok: true, message: `${target.node.name} is draining and removed from rotation.` };
        break;
      }
      case 'renew-cert': {
        this.certExpiredCount = 0;
        const ids = [...this.active.entries()]
          .filter(([, incident]) => incident.kind === 'cert-expiry')
          .map(([id]) => id);
        for (const id of ids) this.recoverIncident(id);
        result = { ok: true, message: 'Certificate renewed. External traffic can reach you again.' };
        break;
      }
      default: {
        result = { ok: false, message: 'Unknown runbook.' };
      }
    }

    this.log(
      'runbook',
      result.ok ? 'info' : 'warning',
      `Runbook: ${kind.replace(/-/g, ' ')}`,
      result.message,
      targetId ? { nodeId: targetId } : undefined,
    );
    return result;
  }

  traces(): RequestTrace[] {
    const seen = new Set<string>();
    const out: RequestTrace[] = [];
    for (const trace of [...this.slowTraces, ...this.failedTraces]) {
      if (seen.has(trace.id)) continue;
      seen.add(trace.id);
      out.push({ ...trace, path: trace.path.map((hop) => ({ ...hop })) });
    }
    return out;
  }

  eventLog(): GameEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  // -------------------------------------------------------------------------
  // Event loop
  // -------------------------------------------------------------------------

  private schedule(time: number, event: EventPayload): void {
    this.seq += 1;
    // Every payload literal is created for a single scheduling call, so it is
    // safe (and much cheaper) to stamp the heap fields directly on it.
    const queued = event as SimEvent;
    queued.time = time;
    queued.seq = this.seq;
    this.heap.push(queued);
  }

  private after(delay: number, run: () => void): void {
    this.schedule(this.currentTime + Math.max(0, delay), { kind: 'action', run });
  }

  private advanceTo(target: number): void {
    const epsilon = 1e-9;
    while (!this.endedFlag) {
      const next = this.heap.peek();
      if (!next || next.time > target + epsilon) break;
      const event = this.heap.pop() as SimEvent;
      if (event.time > this.currentTime) this.currentTime = event.time;
      this.rollBuckets(Math.floor(this.currentTime));
      this.process(event);
    }
    if (target > this.currentTime) this.currentTime = target;
    this.rollBuckets(Math.floor(this.currentTime));
  }

  private process(event: SimEvent): void {
    switch (event.kind) {
      case 'traffic':
        this.handleTraffic();
        break;
      case 'arrive':
        this.handleArrive(event.request, event.nodeId);
        break;
      case 'done':
        this.handleDone(event.request, event.nodeId, event.serviceMs);
        break;
      case 'health':
        this.handleHealthCheck(event.lbId, event.backendId, event.version);
        break;
      case 'hpa':
        this.handleHpa(event.nodeId, event.version);
        break;
      case 'action':
        event.run();
        break;
    }
  }

  private rollBuckets(sec: number): void {
    if (sec <= this.traffic.currentSec) return;
    const closed = this.traffic.rollTo(sec);
    for (const bucket of closed) {
      if (bucket.failures > 0) this.errorSeconds += 1;
      const p95 = this.completions.quantile(0.95);
      const cost = topologyCostPerMonth(this.topology, this.world, bucket.arrivals);
      this.pushPoint(this.series.rps, bucket.sec, bucket.arrivals);
      this.pushPoint(this.series.errors, bucket.sec, bucket.failures);
      this.pushPoint(this.series.p95, bucket.sec, p95);
      this.pushPoint(this.series.cost, bucket.sec, round(cost, 2));
    }
  }

  private pushPoint(points: MetricPoint[], t: number, v: number): void {
    points.push({ t, v });
    if (points.length > SERIES_POINTS) points.shift();
  }

  private sweep(): void {
    if (this.endedFlag) return;
    for (const rt of this.runtime.values()) {
      if (rt.queue.size > 0) this.pumpQueue(rt);
    }
    this.schedule(this.currentTime + 1, { kind: 'action', run: () => this.sweep() });
  }

  private finishRun(): void {
    if (this.endedFlag) return;
    this.currentTime = this.scenario.duration;
    this.rollBuckets(Math.floor(this.currentTime));
    this.endedFlag = true;
    this.running = false;
    this.log('system', 'info', 'Shift complete', 'The simulation has reached the end of the scenario.');
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------

  private handleTraffic(): void {
    const base = this.rpsAt(this.currentTime);
    const expected = base * this.trafficMultiplier() * TRAFFIC_INTERVAL * this.rng.range(0.95, 1.05);
    this.accumulator += Math.max(0, expected);
    let count = Math.floor(this.accumulator);
    if (count > 0) this.accumulator -= count;
    if (count > 5000) count = 5000;

    for (let i = 0; i < count; i++) {
      const entry = this.rng.pick(this.entries);
      if (!entry) break;
      const request = this.newRequest(entry);
      this.schedule(this.currentTime, { kind: 'arrive', request, nodeId: entry });
    }

    if (this.currentTime + TRAFFIC_INTERVAL <= this.scenario.duration + 1e-9) {
      this.schedule(this.currentTime + TRAFFIC_INTERVAL, { kind: 'traffic' });
    }
  }

  private rpsAt(t: number): number {
    const points = this.scenario.traffic;
    if (!points.length) return 0;
    if (t <= points[0].at) return Math.max(0, points[0].rps);
    const last = points[points.length - 1];
    if (t >= last.at) return Math.max(0, last.rps);
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      if (t <= current.at) {
        const span = current.at - previous.at;
        if (span <= 0) return Math.max(0, current.rps);
        const ratio = (t - previous.at) / span;
        return Math.max(0, previous.rps + (current.rps - previous.rps) * ratio);
      }
    }
    return Math.max(0, last.rps);
  }

  private trafficMultiplier(): number {
    let multiplier = 1;
    for (const value of this.trafficMultipliers) multiplier *= value;
    return clamp(multiplier, 0, 20);
  }

  private currentRps(): number {
    return this.traffic.rate(Math.floor(this.currentTime), 5);
  }

  private newRequest(entryId: ID, retries = 0): SimRequest {
    const id = `req-${++this.idCounter}`;
    const request: SimRequest = {
      id,
      entryId,
      createdAt: this.currentTime,
      deadline: this.currentTime + CLIENT_TIMEOUT_SECONDS,
      hops: [],
      retries,
      cacheHit: false,
      hitDb: false,
      dataLost: false,
      done: false,
      status: 200,
    };
    this.totalRequests += 1;
    this.traffic.arrive(1);
    this.retryWindow.add(Math.floor(this.currentTime), 'req');
    return request;
  }

  // -------------------------------------------------------------------------
  // Request lifecycle
  // -------------------------------------------------------------------------

  private handleArrive(request: SimRequest, nodeId: ID): void {
    if (request.done) return;
    const rt = this.runtime.get(nodeId);
    if (!rt) {
      this.finishRequest(request, false, 503, 'route target was removed');
      return;
    }

    if (this.certExpiredCount > 0 && this.entrySet.has(nodeId)) {
      this.failAt(rt, request, 495, 'TLS certificate expired');
      return;
    }

    if (!this.isNodeUp(rt)) {
      this.failAt(rt, request, 503, `${rt.node.name} is unavailable`);
      return;
    }

    if (this.currentTime > request.deadline) {
      this.failAt(rt, request, 504, 'client timeout');
      return;
    }

    if (rt.node.kind === 'proxy') {
      const limit = cfgNumber(rt.node, 'rateLimitRps', 0);
      if (limit > 0) {
        const sec = Math.floor(this.currentTime);
        if (rt.rateSec !== sec) {
          rt.rateSec = sec;
          rt.rateCount = 0;
        }
        rt.rateCount += 1;
        if (rt.rateCount > limit) {
          this.failAt(rt, request, 429, 'rate limit exceeded');
          return;
        }
      }
    }

    rt.requests += 1;
    rt.recent.add(Math.floor(this.currentTime), 'req');

    const capacity = this.effectiveCapacity(rt);
    if (capacity <= 0) {
      this.failAt(rt, request, 503, `${rt.node.name} has no capacity`);
      return;
    }

    if (rt.inFlight < capacity) {
      this.startService(rt, request);
      return;
    }

    const maxQueue = Math.max(64, capacity * 20);
    if (rt.queue.size >= maxQueue) {
      this.failAt(rt, request, 503, `${rt.node.name} queue overflow`);
      return;
    }
    rt.queue.push(request);
  }

  private startService(rt: RuntimeNode, request: SimRequest): void {
    if (request.done) return;
    if (this.currentTime > request.deadline) {
      this.failAt(rt, request, 504, 'client timeout in queue');
      return;
    }

    const serviceMs = Math.max(0.1, this.effectiveLatencyMs(rt) * this.rng.range(0.8, 1.2));
    rt.inFlight += 1;
    request.hops.push({
      nodeId: rt.node.id,
      nodeName: rt.node.name,
      kind: rt.node.kind,
      at: this.currentTime,
      durationMs: round(serviceMs),
      ok: true,
    });
    this.schedule(this.currentTime + serviceMs / 1000, {
      kind: 'done',
      request,
      nodeId: rt.node.id,
      serviceMs,
    });
  }

  private handleDone(request: SimRequest, nodeId: ID, serviceMs: number): void {
    const rt = this.runtime.get(nodeId);
    if (rt) {
      rt.inFlight = Math.max(0, rt.inFlight - 1);
      rt.latency.add(serviceMs);
      this.pumpQueue(rt);
    }

    if (request.done) return;
    if (!rt) {
      this.finishRequest(request, false, 503, 'route target was removed');
      return;
    }

    if (this.currentTime > request.deadline) {
      this.failAt(rt, request, 504, 'request exceeded its deadline');
      return;
    }

    switch (rt.node.kind) {
      case 'db':
        this.completeDatabase(rt, request);
        return;
      case 'storage':
        this.completeSuccess(request);
        return;
      case 'dns':
        this.routeDns(rt, request);
        return;
      case 'cdn':
        this.routeCdn(rt, request);
        return;
      case 'lb':
        this.routeLoadBalancer(rt, request);
        return;
      case 'proxy':
        this.routeProxy(rt, request);
        return;
      case 'cache':
        this.routeCache(rt, request);
        return;
      case 'vm':
      case 'k8s':
        this.routeCompute(rt, request);
        return;
      default:
        this.completeSuccess(request);
        return;
    }
  }

  private pumpQueue(rt: RuntimeNode): void {
    while (rt.queue.size > 0) {
      const capacity = this.effectiveCapacity(rt);
      if (capacity <= 0 || rt.inFlight >= capacity || !this.isNodeUp(rt)) return;
      const next = rt.queue.shift();
      if (!next || next.done) continue;
      if (this.currentTime > next.deadline) {
        this.failAt(rt, next, 504, 'client timeout in queue');
        continue;
      }
      this.startService(rt, next);
    }
  }

  private routeDns(rt: RuntimeNode, request: SimRequest): void {
    const targets = rt.out
      .map((id) => this.runtime.get(id))
      .filter((target): target is RuntimeNode => Boolean(target));
    if (targets.length === 0) {
      this.completeSuccess(request);
      return;
    }

    const ttl = Math.max(0, cfgNumber(rt.node, 'ttlSeconds', 60));
    const healthChecks = cfgBool(rt.node, 'healthChecks', true);
    const cached = rt.dnsTarget;

    if (cached && cached.expiresAt > this.currentTime) {
      const target = this.runtime.get(cached.id);
      if (target) {
        this.forward(rt, request, target.node.id);
        return;
      }
    }

    const healthy = healthChecks ? targets.filter((target) => this.isNodeUp(target)) : targets;
    if (healthy.length === 0) {
      this.failAt(rt, request, 503, 'no healthy DNS target');
      return;
    }

    const policy = cfgString(rt.node, 'routing', 'failover');
    const choice = policy === 'weighted' ? this.rng.pick(healthy) ?? healthy[0] : healthy[0];
    rt.dnsTarget = { id: choice.node.id, expiresAt: this.currentTime + ttl };
    this.forward(rt, request, choice.node.id);
  }

  private routeCdn(rt: RuntimeNode, request: SimRequest): void {
    const ttl = Math.max(10, cfgNumber(rt.node, 'ttlSeconds', 300));
    const cacheable = cfgNumber(rt.node, 'cacheablePct', 80);
    const ratio = rt.cacheStampede ? 0 : cacheHitRatio(ttl, cacheable, 100);

    if (this.rng.next() < ratio) {
      request.cacheHit = true;
      this.completeSuccess(request);
      return;
    }

    // Origin shield acts as a second cache layer, halving origin traffic.
    if (cfgBool(rt.node, 'originShield', false) && this.rng.next() < 0.5) {
      request.cacheHit = true;
      this.completeSuccess(request);
      return;
    }

    const next = rt.out[0];
    if (!next) {
      this.completeSuccess(request);
      return;
    }
    request.cacheHit = false;
    this.forward(rt, request, next);
  }

  private routeLoadBalancer(rt: RuntimeNode, request: SimRequest): void {
    const candidates = rt.out
      .map((id) => this.runtime.get(id))
      .filter((target): target is RuntimeNode => Boolean(target))
      .filter((target) => this.isBackendUsable(rt, target));

    if (candidates.length === 0) {
      this.failAt(rt, request, 503, 'no healthy backend');
      return;
    }

    const algorithm = cfgString(rt.node, 'algorithm', 'least-conn');
    let choice: RuntimeNode;
    if (algorithm === 'round-robin') {
      rt.roundRobin = (rt.roundRobin + 1) % candidates.length;
      choice = candidates[rt.roundRobin];
    } else if (algorithm === 'random') {
      choice = this.rng.pick(candidates) ?? candidates[0];
    } else if (algorithm === 'consistent-hash') {
      const hash = this.hashRequest(request);
      choice = candidates[hash % candidates.length];
    } else {
      // Least connections with rotating tie-breaking: otherwise a brand-new
      // idle backend can sit at zero forever when every backend is also idle.
      const start = (rt.roundRobin + 1 + candidates.length) % candidates.length;
      let best = candidates[start];
      let bestLoad = best.inFlight + best.queue.size;
      for (let offset = 1; offset < candidates.length; offset++) {
        const candidate = candidates[(start + offset) % candidates.length];
        const load = candidate.inFlight + candidate.queue.size;
        if (load < bestLoad) {
          bestLoad = load;
          best = candidate;
        }
      }
      rt.roundRobin = candidates.indexOf(best);
      choice = best;
    }

    const timeoutMs = cfgNumber(rt.node, 'timeoutMs', 3000);
    if (timeoutMs > 0) {
      request.deadline = Math.min(request.deadline, this.currentTime + timeoutMs / 1000);
    }
    this.forward(rt, request, choice.node.id);
  }

  private routeProxy(rt: RuntimeNode, request: SimRequest): void {
    const next = rt.out[0];
    if (!next) {
      this.completeSuccess(request);
      return;
    }
    const readTimeout = cfgNumber(rt.node, 'readTimeoutMs', 10000);
    if (readTimeout > 0) {
      request.deadline = Math.min(request.deadline, this.currentTime + readTimeout / 1000);
    }
    this.forward(rt, request, next);
  }

  private routeCompute(rt: RuntimeNode, request: SimRequest): void {
    if (this.scenario.requiresDatabase && !this.hasDatabasePath(rt)) {
      this.addIssue(
        `nodatabase:${rt.node.id}`,
        'critical',
        'No database path',
        `${rt.node.name} cannot reach a database, so the workload is returning 500s.`,
        rt.node.id,
      );
      this.failAt(rt, request, 500, 'no database configured');
      return;
    }

    const targets = rt.out
      .map((id) => this.runtime.get(id))
      .filter((target): target is RuntimeNode => Boolean(target));
    if (targets.length === 0) {
      this.completeSuccess(request);
      return;
    }

    const cache = targets.find((target) => target.node.kind === 'cache' && this.isNodeUp(target));
    if (cache) {
      this.forward(rt, request, cache.node.id);
      return;
    }

    const database = targets.find((target) => target.node.kind === 'db');
    if (database) {
      this.forward(rt, request, database.node.id);
      return;
    }

    const storage = targets.find((target) => target.node.kind === 'storage');
    if (storage) {
      this.forward(rt, request, storage.node.id);
      return;
    }

    this.forward(rt, request, targets[0].node.id);
  }

  private routeCache(rt: RuntimeNode, request: SimRequest): void {
    const database = rt.out
      .map((id) => this.runtime.get(id))
      .find((target): target is RuntimeNode => target !== undefined && target.node.kind === 'db');

    const ttl = Math.max(10, cfgNumber(rt.node, 'ttlSeconds', 60));
    const sizeGb = Math.max(1, cfgNumber(rt.node, 'sizeGb', 4));
    const cold = Boolean(rt.cache && rt.cache.flushUntil > this.currentTime);
    const stampede = rt.cacheStampede || cold;
    const ratio = stampede ? 0 : cacheHitRatio(ttl, 100, sizeGb);

    if (this.rng.next() < ratio) {
      request.cacheHit = true;
      this.completeSuccess(request);
      return;
    }

    request.cacheHit = false;
    if (!database) {
      this.completeSuccess(request);
      return;
    }

    if (stampede && cfgBool(rt.node, 'stampedeProtection', true)) {
      // Coalesce 90% of misses during a cold-cache event so the DB survives.
      if (this.rng.next() < 0.9) {
        this.completeSuccess(request);
        return;
      }
    }

    this.forward(rt, request, database.node.id);
  }

  private completeDatabase(rt: RuntimeNode, request: SimRequest): void {
    if (rt.db) {
      if (rt.db.syncWritesFail && this.rng.next() < 0.01) {
        this.failAt(rt, request, 500, 'network partition: write rejected');
        return;
      }
      if (rt.db.diskFull && this.rng.next() < 0.1) {
        this.failAt(rt, request, 500, 'disk full: write failed');
        return;
      }
    }
    request.hitDb = true;
    this.completeSuccess(request);
  }

  private completeSuccess(request: SimRequest): void {
    this.finishRequest(request, true, 200);
  }

  private failAt(rt: RuntimeNode | undefined, request: SimRequest, status: number, message: string): void {
    if (rt) {
      rt.failures += 1;
      rt.recent.add(Math.floor(this.currentTime), 'fail');
      const last = request.hops[request.hops.length - 1];
      if (last && last.nodeId === rt.node.id) {
        last.ok = false;
        last.note = message;
      } else {
        request.hops.push({
          nodeId: rt.node.id,
          nodeName: rt.node.name,
          kind: rt.node.kind,
          at: this.currentTime,
          durationMs: 0,
          ok: false,
          note: message,
        });
      }
    }
    this.finishRequest(request, false, status, message);
  }

  private finishRequest(request: SimRequest, ok: boolean, status: number, error?: string): void {
    if (request.done) return;
    request.done = true;
    request.status = status;
    if (error) request.error = error;

    const latencyMs = Math.max(0, (this.currentTime - request.createdAt) * 1000);
    this.traffic.complete(ok);
    this.completions.add(latencyMs);

    if (!ok) {
      this.totalFailures += 1;
      const trace = this.buildTrace(request, false, latencyMs);
      this.failedTraces.push(trace);
      if (this.failedTraces.length > FAILED_TRACE_LIMIT) this.failedTraces.shift();
    } else if (latencyMs >= 500) {
      const trace = this.buildTrace(request, true, latencyMs);
      this.slowTraces.push(trace);
      if (this.slowTraces.length > SLOW_TRACE_LIMIT) this.slowTraces.shift();
    }

    if (!ok && this.maybeRetry(request)) this.scheduleRetry(request);
  }

  private buildTrace(request: SimRequest, ok: boolean, latencyMs: number): RequestTrace {
    return {
      id: request.id,
      at: request.createdAt,
      ok,
      latencyMs: round(latencyMs),
      status: request.status,
      entryId: request.entryId,
      path: request.hops.map((hop) => ({ ...hop })),
      error: request.error,
      retries: request.retries,
    };
  }

  private forward(rt: RuntimeNode, request: SimRequest, targetId: ID): void {
    if (targetId === rt.node.id) {
      this.failAt(rt, request, 500, 'routing loop');
      return;
    }
    const target = this.runtime.get(targetId);
    if (!target) {
      this.failAt(rt, request, 500, 'route target missing');
      return;
    }
    const linkId = rt.linkIdByTarget.get(targetId);
    if (linkId) {
      const counter = this.linkCounters.get(linkId);
      counter?.add(Math.floor(this.currentTime), 'req');
    }
    const latency = this.linkLatency(rt.node, target.node);
    this.schedule(this.currentTime + latency / 1000, { kind: 'arrive', request, nodeId: targetId });
  }

  private linkLatency(from: TopologyNode, to: TopologyNode): number {
    const latency = this.world.latency;
    if (from.zoneId && to.zoneId) {
      if (from.regionId === to.regionId) {
        return from.zoneId === to.zoneId ? latency.sameZone : latency.crossZone;
      }
    }
    if (from.regionId && to.regionId) {
      if (from.regionId === to.regionId) return latency.crossZone;
      if (from.cloudId && to.cloudId && from.cloudId === to.cloudId) return latency.crossRegion;
      return latency.crossCloud;
    }
    return 0;
  }

  private hashRequest(request: SimRequest): number {
    let hash = 0;
    for (let i = 0; i < request.id.length; i++) {
      hash = (hash * 31 + request.id.charCodeAt(i)) >>> 0;
    }
    return hash + request.retries;
  }

  // -------------------------------------------------------------------------
  // Retries
  // -------------------------------------------------------------------------

  private retryPolicy(entryId: ID): RetryPolicy {
    const cached = this.retryPolicies.get(entryId);
    if (cached) return cached;

    let found: RuntimeNode | undefined;
    const queue: ID[] = [entryId];
    const seen = new Set<ID>();
    while (queue.length > 0 && seen.size < 64) {
      const id = queue.shift() as ID;
      if (seen.has(id)) continue;
      seen.add(id);
      const rt = this.runtime.get(id);
      if (!rt) continue;
      if (rt.node.kind === 'proxy' || rt.node.kind === 'vm') {
        found = rt;
        break;
      }
      for (const next of rt.out) queue.push(next);
    }

    const policy: RetryPolicy = found
      ? {
          maxRetries: Math.max(0, Math.floor(cfgNumber(found.node, 'retries', 0))),
          budgetPct: Math.max(0, cfgNumber(found.node, 'retryBudgetPct', 10)),
        }
      : { maxRetries: 0, budgetPct: 10 };
    this.retryPolicies.set(entryId, policy);
    return policy;
  }

  private maybeRetry(request: SimRequest): boolean {
    const policy = this.retryPolicy(request.entryId);
    if (request.retries >= policy.maxRetries) return false;

    const sec = Math.floor(this.currentTime);
    const requests = this.retryWindow.total(sec, 'req');
    const retries = this.retryWindow.total(sec, 'retry');
    if (policy.budgetPct > 0) {
      const allowed = requests * (policy.budgetPct / 100);
      if (retries + 1 > allowed) return false;
    }
    return true;
  }

  private scheduleRetry(request: SimRequest): void {
    const attempt = request.retries;
    const delay = 0.05 * Math.pow(2, attempt);
    const entryId = request.entryId;
    this.schedule(this.currentTime + delay, {
      kind: 'action',
      run: () => {
        if (this.endedFlag) return;
        const next = this.newRequest(entryId, attempt + 1);
        this.retryWindow.add(Math.floor(this.currentTime), 'retry');
        this.schedule(this.currentTime, { kind: 'arrive', request: next, nodeId: entryId });
      },
    });
  }

  // -------------------------------------------------------------------------
  // Health checks and autoscaling
  // -------------------------------------------------------------------------

  private isBackendUsable(lb: RuntimeNode, target: RuntimeNode): boolean {
    // Down backends stay in rotation until health checks eject them. That
    // detection window is the core failure mode the player has to manage.
    if (target.draining) return false;
    const health = lb.backends.get(target.node.id);
    if (health?.ejected) return false;
    return true;
  }

  private handleHealthCheck(lbId: ID, backendId: ID, version: number): void {
    if (version !== this.topologyVersion) return;
    const lb = this.runtime.get(lbId);
    if (!lb || lb.node.kind !== 'lb') return;
    if (!lb.out.includes(backendId)) return;

    const target = this.runtime.get(backendId);
    const health = lb.backends.get(backendId) ?? { failures: 0, successes: 0, ejected: false };
    const healthyNow = Boolean(target) && this.isNodeUp(target as RuntimeNode) && !(target as RuntimeNode).draining;

    const unhealthyThreshold = Math.max(1, cfgNumber(lb.node, 'unhealthyThreshold', 3));
    const healthyThreshold = Math.max(1, cfgNumber(lb.node, 'healthyThreshold', 2));

    if (healthyNow) {
      health.failures = 0;
      health.successes += 1;
      if (health.ejected && health.successes >= healthyThreshold) {
        health.ejected = false;
        this.log(
          'alert',
          'info',
          `Backend restored: ${target?.node.name ?? backendId}`,
          `${lb.node.name} is sending traffic to it again.`,
          { nodeId: backendId },
        );
      }
    } else {
      health.successes = 0;
      health.failures += 1;
      if (!health.ejected && health.failures >= unhealthyThreshold) {
        health.ejected = true;
        this.log(
          'alert',
          'warning',
          `Backend ejected: ${target?.node.name ?? backendId}`,
          `${lb.node.name} removed it after ${health.failures} failed probes.`,
          { nodeId: backendId },
        );
      }
    }

    lb.backends.set(backendId, health);
    const interval = Math.max(1, cfgNumber(lb.node, 'healthCheckInterval', 5));
    this.schedule(this.currentTime + interval, { kind: 'health', lbId, backendId, version });
  }

  private handleHpa(nodeId: ID, version: number): void {
    if (version !== this.topologyVersion) return;
    const rt = this.runtime.get(nodeId);
    if (!rt || rt.node.kind !== 'k8s' || !rt.k8s) return;

    const k8s = rt.k8s;
    const hpaMin = Math.max(1, Math.floor(cfgNumber(rt.node, 'hpaMin', 2)));
    const hpaMax = Math.max(hpaMin, Math.floor(cfgNumber(rt.node, 'hpaMax', 12)));
    const target = clamp(cfgNumber(rt.node, 'cpuTargetPct', 70) / 100, 0.05, 1);

    if (this.controlPlaneOutageCount === 0 && this.currentTime >= k8s.cooldownUntil) {
      const capacity = Math.max(1, this.effectiveCapacity(rt));
      const utilization = rt.inFlight / capacity;
      if (utilization > target && k8s.podsTotal < hpaMax) {
        const desired = Math.max(k8s.podsTotal + 1, Math.ceil(k8s.podsTotal * (utilization / target)));
        k8s.podsTotal = Math.min(hpaMax, desired);
        k8s.cooldownUntil = this.currentTime + HPA_COOLDOWN;
      } else if (utilization < target * 0.5 && k8s.podsTotal > hpaMin) {
        k8s.podsTotal = Math.max(hpaMin, k8s.podsTotal - 1);
        k8s.cooldownUntil = this.currentTime + HPA_COOLDOWN;
      }
    }

    this.schedule(this.currentTime + HPA_INTERVAL, { kind: 'hpa', nodeId, version });
  }

  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------

  private scheduleScenarioIncidents(): void {
    const incidents = [...this.scenario.incidents].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    for (const incident of incidents) {
      const at = Math.max(0, incident.at);
      if (at <= this.currentTime) {
        this.applyIncident(incident);
      } else {
        this.schedule(at, { kind: 'action', run: () => this.applyIncident(incident) });
      }
    }
  }

  private applyIncident(incident: ScenarioIncident): void {
    if (this.active.has(incident.id)) return;

    const duration = typeof incident.duration === 'number' && incident.duration > 0 ? incident.duration : undefined;
    const active: ActiveIncident = {
      id: incident.id,
      kind: incident.kind,
      title: incident.title,
      message: incident.message,
      severity: incident.severity,
      startedAt: this.currentTime,
      endsAt: duration !== undefined ? this.currentTime + duration : undefined,
      targetId: incident.targetId,
    };
    this.active.set(incident.id, active);
    this.log('incident', incident.severity, incident.title, incident.message, {
      incidentId: incident.id,
      nodeId: incident.targetId,
    });
    if (incident.severity === 'critical') {
      this.log('alert', 'critical', `Pager: ${incident.title}`, incident.message, {
        incidentId: incident.id,
      });
    }

    const cleanups: Array<() => void> = [];
    this.applyIncidentEffects(incident, cleanups);
    this.incidentCleanups.set(incident.id, cleanups);

    if (duration !== undefined) {
      this.schedule(this.currentTime + duration, {
        kind: 'action',
        run: () => this.recoverIncident(incident.id),
      });
    }
  }

  private applyIncidentEffects(incident: ScenarioIncident, cleanups: Array<() => void>): void {
    switch (incident.kind) {
      case 'zone-down': {
        const zoneId = incident.zoneId ?? incident.targetId ?? this.nodeZone(incident.targetId);
        if (!zoneId) return;
        const regionId = incident.regionId ?? this.zoneRegion(zoneId) ?? this.nodeRegion(incident.targetId);
        this.zoneDown.add(zoneId);
        this.incidentZones.set(incident.id, zoneId);
        cleanups.push(() => {
          this.zoneDown.delete(zoneId);
          this.incidentZones.delete(incident.id);
        });

        for (const rt of this.runtime.values()) {
          if (rt.node.zoneId !== zoneId) continue;
          const key = `zone:${incident.id}`;
          rt.downReasons.add(key);
          cleanups.push(() => rt.downReasons.delete(key));
        }

        if (regionId) {
          for (const rt of this.runtime.values()) {
            if (rt.node.regionId !== regionId) continue;
            if (rt.node.kind === 'db') this.applyDatabaseFailure(rt, incident, cleanups);
            if (rt.node.kind === 'k8s') this.loseK8sPods(rt, zoneId, cleanups);
          }
        }
        return;
      }

      case 'region-down': {
        const regionId = incident.regionId ?? incident.targetId ?? this.nodeRegion(incident.targetId);
        if (!regionId) return;
        this.regionDown.add(regionId);
        this.incidentRegions.set(incident.id, regionId);
        cleanups.push(() => {
          this.regionDown.delete(regionId);
          this.incidentRegions.delete(incident.id);
        });
        for (const rt of this.runtime.values()) {
          if (rt.node.regionId !== regionId) continue;
          const key = `region:${incident.id}`;
          rt.downReasons.add(key);
          cleanups.push(() => rt.downReasons.delete(key));
        }
        return;
      }

      case 'node-crash': {
        const target = incident.targetId ? this.runtime.get(incident.targetId) : undefined;
        if (!target) return;
        const key = `crash:${incident.id}`;
        target.downReasons.add(key);
        cleanups.push(() => target.downReasons.delete(key));
        return;
      }

      case 'node-slow': {
        for (const rt of this.incidentTargets(incident)) {
          rt.slow += 1;
          cleanups.push(() => {
            rt.slow = Math.max(0, rt.slow - 1);
          });
        }
        return;
      }

      case 'noisy-neighbor': {
        for (const rt of this.incidentTargets(incident)) {
          rt.noisy += 1;
          cleanups.push(() => {
            rt.noisy = Math.max(0, rt.noisy - 1);
          });
        }
        return;
      }

      case 'db-failover': {
        const db = this.findDatabase(incident.targetId);
        if (!db) return;
        this.applyDatabaseFailure(db, incident, cleanups);
        return;
      }

      case 'network-partition': {
        const db = this.findDatabase(incident.targetId);
        if (!db?.db) return;
        const asyncReplication = cfgString(db.node, 'replication', 'async') === 'async';
        if (asyncReplication) {
          db.db.stale = true;
          cleanups.push(() => {
            if (db.db) db.db.stale = false;
          });
          this.recordDataLoss(db.node.id, 'Partitioned replica served stale reads.');
        } else {
          db.db.syncWritesFail = true;
          cleanups.push(() => {
            if (db.db) db.db.syncWritesFail = false;
          });
        }
        return;
      }

      case 'bad-deploy': {
        const targets = this.incidentTargets(incident);
        const candidates = targets.length > 0
          ? targets
          : [...this.runtime.values()].filter((rt) => rt.node.kind === 'k8s' || rt.node.kind === 'proxy');
        for (const rt of candidates) {
          if (rt.node.kind === 'k8s' && rt.k8s) {
            const pods = Math.max(1, Math.floor(cfgNumber(rt.node, 'pods', 3)));
            const readiness = cfgBool(rt.node, 'readinessProbe', true);
            const liveness = cfgBool(rt.node, 'livenessProbe', true);
            const maxUnavailable = Math.max(0, Math.floor(cfgNumber(rt.node, 'maxUnavailable', 1)));
            const badPods = readiness ? Math.min(maxUnavailable, pods) : pods;
            const duration = readiness ? BAD_DEPLOY_SECONDS : liveness ? 10 : BAD_DEPLOY_SECONDS;
            rt.k8s.badPods = Math.max(rt.k8s.badPods, badPods);
            rt.badDeployUntil = Math.max(rt.badDeployUntil, this.currentTime + duration);
            cleanups.push(() => {
              if (!rt.k8s) return;
              rt.k8s.badPods = 0;
              rt.badDeployUntil = 0;
            });
          } else {
            rt.badDeployUntil = Math.max(rt.badDeployUntil, this.currentTime + BAD_DEPLOY_SECONDS);
            cleanups.push(() => {
              rt.badDeployUntil = 0;
            });
          }
        }
        return;
      }

      case 'cache-stampede': {
        const targets = this.incidentTargets(incident).filter(
          (rt) => rt.node.kind === 'cache' || rt.node.kind === 'cdn',
        );
        const candidates = targets.length > 0
          ? targets
          : [...this.runtime.values()].filter((rt) => rt.node.kind === 'cache' || rt.node.kind === 'cdn');
        for (const rt of candidates) {
          rt.cacheStampede = true;
          const unprotected = rt.node.kind === 'cache' && !cfgBool(rt.node, 'stampedeProtection', true);
          if (unprotected) this.stampedePressure += 1;
          cleanups.push(() => {
            rt.cacheStampede = false;
            if (unprotected) this.stampedePressure = Math.max(0, this.stampedePressure - 1);
          });
        }
        return;
      }

      case 'traffic-spike': {
        const multiplier = this.rng.range(1.8, 3);
        this.trafficMultipliers.push(multiplier);
        cleanups.push(() => {
          const index = this.trafficMultipliers.indexOf(multiplier);
          if (index >= 0) this.trafficMultipliers.splice(index, 1);
        });
        return;
      }

      case 'ddos': {
        this.ddosCount += 1;
        this.trafficMultipliers.push(2.5);
        cleanups.push(() => {
          this.ddosCount = Math.max(0, this.ddosCount - 1);
          const index = this.trafficMultipliers.lastIndexOf(2.5);
          if (index >= 0) this.trafficMultipliers.splice(index, 1);
        });
        return;
      }

      case 'cert-expiry': {
        this.certExpiredCount += 1;
        cleanups.push(() => {
          this.certExpiredCount = Math.max(0, this.certExpiredCount - 1);
        });
        return;
      }

      case 'disk-full': {
        const db = this.findDatabase(incident.targetId);
        if (!db?.db) return;
        db.db.diskFull = true;
        cleanups.push(() => {
          if (db.db) db.db.diskFull = false;
        });
        this.recordDataLoss(db.node.id, 'Disk full corrupted the last write batch.');
        return;
      }

      case 'control-plane-outage': {
        this.controlPlaneOutageCount += 1;
        cleanups.push(() => {
          this.controlPlaneOutageCount = Math.max(0, this.controlPlaneOutageCount - 1);
        });
        return;
      }

      default:
        return;
    }
  }

  private recoverIncident(incidentId: ID): void {
    const active = this.active.get(incidentId);
    if (!active) return;
    const cleanups = this.incidentCleanups.get(incidentId) ?? [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // A cleanup should never take down the simulation loop.
      }
    }
    this.incidentCleanups.delete(incidentId);
    this.active.delete(incidentId);
    this.incidentZones.delete(incidentId);
    this.incidentRegions.delete(incidentId);
    this.log('recovery', 'info', `Recovered: ${active.title}`, active.message, {
      incidentId,
    });
  }

  private incidentTargets(incident: ScenarioIncident): RuntimeNode[] {
    if (incident.targetId) {
      const direct = this.runtime.get(incident.targetId);
      if (direct) return [direct];
    }
    if (incident.zoneId) {
      return [...this.runtime.values()].filter((rt) => rt.node.zoneId === incident.zoneId);
    }
    if (incident.regionId) {
      return [...this.runtime.values()].filter((rt) => rt.node.regionId === incident.regionId);
    }
    return [];
  }

  private nodeZone(nodeId?: ID): ID | undefined {
    return nodeId ? this.runtime.get(nodeId)?.node.zoneId : undefined;
  }

  private nodeRegion(nodeId?: ID): ID | undefined {
    return nodeId ? this.runtime.get(nodeId)?.node.regionId : undefined;
  }

  private zoneRegion(zoneId: ID): ID | undefined {
    return this.world.regions.find((region) => region.zones.some((zone) => zone.id === zoneId))?.id;
  }

  private findDatabase(targetId?: ID): RuntimeNode | undefined {
    if (targetId) {
      const direct = this.runtime.get(targetId);
      if (direct?.node.kind === 'db') return direct;
    }
    return [...this.runtime.values()].find((rt) => rt.node.kind === 'db');
  }

  private applyDatabaseFailure(rt: RuntimeNode, incident: ScenarioIncident, cleanups: Array<() => void>): void {
    if (!rt.db) return;
    const multiAz = cfgBool(rt.node, 'multiAz', false);
    const replicas = Math.max(0, Math.floor(cfgNumber(rt.node, 'replicas', 0)));
    const automatic = cfgBool(rt.node, 'automaticFailover', true);
    const asyncReplication = cfgString(rt.node, 'replication', 'async') === 'async';

    if (multiAz) {
      rt.db.failoverUntil = Math.max(rt.db.failoverUntil, this.currentTime + FAILOVER_SECONDS);
      this.addIssue(
        `dbfailover:${rt.node.id}`,
        'warning',
        `${rt.node.name} failing over`,
        'Multi-AZ standby promoted. Expect a short blip.',
        rt.node.id,
        incident.id,
      );
      return;
    }

    if (replicas > 0 && automatic) {
      rt.db.failoverUntil = Math.max(rt.db.failoverUntil, this.currentTime + AUTO_FAILOVER_SECONDS);
      this.addIssue(
        `dbfailover:${rt.node.id}`,
        'critical',
        `${rt.node.name} automatic failover`,
        'Promoting a replica. Writes are unavailable until it catches up.',
        rt.node.id,
        incident.id,
      );
      if (asyncReplication) {
        this.recordDataLoss(rt.node.id, 'Asynchronous failover lost the last write batch.');
      }
      return;
    }

    const key = `db:${incident.id}`;
    rt.downReasons.add(key);
    cleanups.push(() => rt.downReasons.delete(key));
    this.addIssue(
      `dbdown:${rt.node.id}:${incident.id}`,
      'critical',
      `${rt.node.name} is down`,
      'This database has no standby, so it stays down until the incident clears.',
      rt.node.id,
      incident.id,
    );
  }

  private loseK8sPods(rt: RuntimeNode, zoneId: ID, cleanups: Array<() => void>): void {
    if (!rt.k8s) return;
    const regionId = rt.node.regionId;
    if (!regionId) return;
    const region = this.world.regions.find((candidate) => candidate.id === regionId);
    if (!region || !region.zones.some((zone) => zone.id === zoneId)) return;

    const podsTotal = rt.k8s.podsTotal;
    const zoneCount = Math.max(1, region.zones.length);
    const lost = Math.min(podsTotal, Math.max(1, Math.round(podsTotal / zoneCount)));
    rt.k8s.lostPods = Math.min(rt.k8s.podsTotal, rt.k8s.lostPods + lost);

    let restored = false;
    const restore = (): void => {
      if (restored || !rt.k8s) return;
      restored = true;
      rt.k8s.lostPods = Math.max(0, rt.k8s.lostPods - lost);
    };

    this.after(RESCHEDULE_SECONDS, () => {
      if (this.controlPlaneOutageCount === 0) restore();
    });
    cleanups.push(restore);
  }

  private recordDataLoss(nodeId: ID, message: string): void {
    this.dataLossEvents += 1;
    this.log('data-loss', 'critical', 'Data loss', message, { nodeId });
  }

  // -------------------------------------------------------------------------
  // Runbooks
  // -------------------------------------------------------------------------

  private runbookRestart(explicit?: RuntimeNode): RunbookResult {
    const target = explicit
      ?? [...this.runtime.values()].find(
        (rt) => [...rt.downReasons].some((reason) => reason.startsWith('crash')),
      );
    if (!target) return { ok: false, message: 'No crashed node to restart.' };

    this.after(3, () => {
      for (const reason of [...target.downReasons]) {
        if (reason.startsWith('crash')) target.downReasons.delete(reason);
      }
      if (target.db) target.db.failoverUntil = 0;
      this.pumpQueue(target);
    });

    const blocked = [...target.downReasons].some((reason) => reason.startsWith('zone') || reason.startsWith('region'));
    return {
      ok: true,
      message: blocked
        ? `Restarting ${target.node.name}, but its failure domain is still down.`
        : `Restarting ${target.node.name}. It will be back in 3 seconds.`,
    };
  }

  private runbookFailoverDb(explicit?: RuntimeNode): RunbookResult {
    const db = explicit?.node.kind === 'db' ? explicit : this.findDatabase();
    if (!db?.db) return { ok: false, message: 'No database to fail over.' };

    const multiAz = cfgBool(db.node, 'multiAz', false);
    const replicas = Math.max(0, Math.floor(cfgNumber(db.node, 'replicas', 0)));
    if (!multiAz && replicas === 0) {
      return { ok: false, message: 'No standby replica exists. Promote something first.' };
    }

    const asyncReplication = cfgString(db.node, 'replication', 'async') === 'async';
    this.after(5, () => {
      if (!db.db) return;
      db.db.manualPromoted = true;
      db.db.failoverUntil = 0;
      for (const reason of [...db.downReasons]) db.downReasons.delete(reason);
      this.pumpQueue(db);
      if (asyncReplication) this.recordDataLoss(db.node.id, 'Manual promotion of an async replica lost recent writes.');
    });
    return { ok: true, message: 'Promoting the standby. Expect about 5 seconds of writes failing.' };
  }

  private runbookScaleOut(explicit?: RuntimeNode): RunbookResult {
    const target = explicit
      ?? [...this.runtime.values()].find((rt) => rt.node.kind === 'vm' || rt.node.kind === 'k8s')
      ?? this.findDatabase();
    if (!target) return { ok: false, message: 'Pick a node to scale out.' };

    if (target.node.kind === 'vm') {
      const replicas = Math.max(1, Math.floor(cfgNumber(target.node, 'replicas', 1)));
      if (replicas >= 8) return { ok: false, message: 'This VM is already at the replica cap.' };
      target.node.config = { ...target.node.config, replicas: replicas + 1 };
      return { ok: true, message: `${target.node.name} now has ${replicas + 1} replicas.` };
    }

    if (target.node.kind === 'k8s' && target.k8s) {
      target.k8s.podsTotal = Math.min(60, target.k8s.podsTotal + 1);
      target.node.config = {
        ...target.node.config,
        pods: Math.max(1, Math.floor(cfgNumber(target.node, 'pods', 3))) + 1,
      };
      return { ok: true, message: `${target.node.name} scaled to ${target.k8s.podsTotal} pods.` };
    }

    if (target.node.kind === 'db') {
      const replicas = Math.max(0, Math.floor(cfgNumber(target.node, 'replicas', 0)));
      if (replicas >= 3) return { ok: false, message: 'This database already has the maximum replicas.' };
      target.node.config = { ...target.node.config, replicas: replicas + 1 };
      return { ok: true, message: `${target.node.name} added read replica ${replicas + 1}.` };
    }

    return { ok: false, message: 'This component cannot be scaled out.' };
  }

  // -------------------------------------------------------------------------
  // Topology and runtime
  // -------------------------------------------------------------------------

  private rebuildRuntime(topology: Topology): void {
    const previous = this.runtime;
    const next = new Map<ID, RuntimeNode>();

    for (const node of topology.nodes) {
      const prev = previous.get(node.id);
      if (prev && prev.node.kind === node.kind) {
        const movedZone = prev.node.zoneId !== node.zoneId;
        const movedRegion = prev.node.regionId !== node.regionId;
        prev.node = node;
        prev.spec = getSpec(node.kind);
        if (movedZone || movedRegion) {
          for (const reason of [...prev.downReasons]) {
            if (reason.startsWith('zone:') || reason.startsWith('region:')) prev.downReasons.delete(reason);
          }
          for (const reason of this.placementReasons(node)) {
            if (reason.startsWith('zone:') || reason.startsWith('region:')) prev.downReasons.add(reason);
          }
        }
        if (prev.k8s) {
          const hpaMin = Math.max(1, Math.floor(cfgNumber(node, 'hpaMin', 2)));
          const hpaMax = Math.max(hpaMin, Math.floor(cfgNumber(node, 'hpaMax', 12)));
          prev.k8s.podsTotal = clamp(Math.floor(cfgNumber(node, 'pods', 3)), hpaMin, hpaMax);
          prev.k8s.cooldownUntil = 0;
        }
        next.set(node.id, prev);
      } else {
        next.set(node.id, this.createRuntime(node));
      }
    }

    for (const [id, rt] of previous) {
      if (next.has(id)) continue;
      const dropped = rt.queue.drain();
      for (const request of dropped) this.finishRequest(request, false, 503, 'node removed during deploy');
    }

    this.runtime = next;
    this.topologyVersion += 1;

    for (const rt of next.values()) {
      rt.out = [];
      rt.incoming = [];
      rt.linkIdByTarget = new Map();
    }
    this.linkCounters.clear();

    for (const link of topology.links) {
      const from = next.get(link.from);
      const to = next.get(link.to);
      if (!from || !to) continue;
      from.out.push(link.to);
      to.incoming.push(link.from);
      from.linkIdByTarget.set(link.to, link.id);
      if (!this.linkCounters.has(link.id)) this.linkCounters.set(link.id, new SlidingCounter(5));
    }

    for (const rt of next.values()) {
      if (rt.node.kind !== 'lb') {
        rt.backends = new Map();
        continue;
      }
      const preserved = rt.backends;
      rt.backends = new Map();
      for (const backendId of rt.out) {
        rt.backends.set(backendId, preserved.get(backendId) ?? { failures: 0, successes: 0, ejected: false });
      }
    }

    this.entries = this.computeEntries();
    this.entrySet = new Set(this.entries);
    this.retryPolicies.clear();
    this.dbPathCache.clear();

    const version = this.topologyVersion;
    for (const rt of next.values()) {
      if (rt.node.kind === 'lb') {
        const interval = Math.max(1, cfgNumber(rt.node, 'healthCheckInterval', 5));
        for (const backendId of rt.out) {
          this.schedule(this.currentTime + interval, {
            kind: 'health',
            lbId: rt.node.id,
            backendId,
            version,
          });
        }
      }
      if (rt.node.kind === 'k8s') {
        this.schedule(this.currentTime + HPA_INTERVAL, { kind: 'hpa', nodeId: rt.node.id, version });
      }
    }
  }

  private createRuntime(node: TopologyNode): RuntimeNode {
    const rt: RuntimeNode = {
      node,
      spec: getSpec(node.kind),
      downReasons: new Set<string>(this.placementReasons(node)),
      slow: 0,
      noisy: 0,
      draining: false,
      inFlight: 0,
      queue: createQueue(),
      out: [],
      incoming: [],
      linkIdByTarget: new Map(),
      requests: 0,
      failures: 0,
      latency: new Reservoir(200),
      recent: new SlidingCounter(5),
      backends: new Map(),
      roundRobin: -1,
      cacheStampede: false,
      badDeployUntil: 0,
      rateSec: -1,
      rateCount: 0,
    };

    if (node.kind === 'k8s') {
      const hpaMin = Math.max(1, Math.floor(cfgNumber(node, 'hpaMin', 2)));
      const hpaMax = Math.max(hpaMin, Math.floor(cfgNumber(node, 'hpaMax', 12)));
      rt.k8s = {
        podsTotal: clamp(Math.floor(cfgNumber(node, 'pods', 3)), hpaMin, hpaMax),
        lostPods: 0,
        badPods: 0,
        cooldownUntil: 0,
      };
    }
    if (node.kind === 'db') {
      rt.db = {
        failoverUntil: 0,
        stale: false,
        diskFull: false,
        syncWritesFail: false,
        manualPromoted: false,
      };
    }
    if (node.kind === 'cache') {
      rt.cache = { flushUntil: 0 };
    }
    return rt;
  }

  private placementReasons(node: TopologyNode): string[] {
    const reasons: string[] = [];
    if (node.zoneId) {
      for (const [id, incident] of this.active) {
        if (incident.kind === 'zone-down' && this.incidentZones.get(id) === node.zoneId) {
          reasons.push(`zone:${id}`);
        }
      }
    }
    if (node.regionId) {
      for (const [id, incident] of this.active) {
        if (incident.kind === 'region-down' && this.incidentRegions.get(id) === node.regionId) {
          reasons.push(`region:${id}`);
        }
      }
    }
    for (const [id, incident] of this.active) {
      if (incident.kind === 'node-crash' && incident.targetId === node.id) reasons.push(`crash:${id}`);
    }
    return reasons;
  }

  private computeEntries(): ID[] {
    const explicit = this.scenario.entryNodeIds?.filter((id) => this.runtime.has(id)) ?? [];
    if (explicit.length > 0) return explicit;
    return [...this.runtime.values()].filter((rt) => rt.incoming.length === 0).map((rt) => rt.node.id);
  }

  private isNodeUp(rt: RuntimeNode): boolean {
    if (rt.db?.manualPromoted) {
      const regionBlocked = [...rt.downReasons].some((reason) => reason.startsWith('region'));
      if (!regionBlocked) return this.currentTime >= rt.db.failoverUntil;
    }
    if (rt.downReasons.size > 0) return false;
    if (rt.db && this.currentTime < rt.db.failoverUntil) return false;
    if (rt.node.kind !== 'k8s' && rt.badDeployUntil > this.currentTime) return false;
    return true;
  }

  private effectiveCapacity(rt: RuntimeNode): number {
    let capacity: number;
    if (rt.node.kind === 'k8s' && rt.k8s) {
      const size = cfgString(rt.node, 'size', 'medium');
      capacity = (POD_CAPACITY[size] ?? POD_CAPACITY.medium) * this.readyPods(rt);
    } else {
      capacity = rt.spec.capacity(rt.node, this.world);
      if (rt.db?.diskFull) capacity *= 0.5;
      // A thundering herd without stampede protection crushes the database.
      if (rt.db && this.stampedePressure > 0) capacity *= 0.05;
    }
    if (rt.slow > 0) capacity *= 0.4;
    if (rt.noisy > 0) capacity *= 0.6;
    return Math.max(0, Math.floor(capacity));
  }

  private readyPods(rt: RuntimeNode): number {
    if (!rt.k8s) return 0;
    return Math.max(0, rt.k8s.podsTotal - rt.k8s.lostPods - rt.k8s.badPods);
  }

  private effectiveLatencyMs(rt: RuntimeNode): number {
    let latency = rt.spec.latencyMs(rt.node, this.world);
    if (rt.slow > 0) latency *= 3;
    if (rt.db && this.stampedePressure > 0) latency *= 8;
    return Math.max(0.1, latency);
  }

  private hasDatabasePath(rt: RuntimeNode): boolean {
    const cached = this.dbPathCache.get(rt.node.id);
    if (cached !== undefined) return cached;

    let found = false;
    const queue = [...rt.out];
    const seen = new Set<ID>();
    while (queue.length > 0 && seen.size < 128) {
      const id = queue.shift() as ID;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = this.runtime.get(id);
      if (!node) continue;
      if (node.node.kind === 'db') {
        found = true;
        break;
      }
      for (const next of node.out) queue.push(next);
    }
    this.dbPathCache.set(rt.node.id, found);
    return found;
  }

  private linkDown(link: TopologyLink): boolean {
    const from = this.runtime.get(link.from);
    const to = this.runtime.get(link.to);
    if (!from || !to) return true;
    return !this.isNodeUp(from) || !this.isNodeUp(to);
  }

  private linkDegraded(link: TopologyLink): boolean {
    const from = this.runtime.get(link.from);
    const to = this.runtime.get(link.to);
    if (!from || !to) return false;
    return from.slow > 0 || to.slow > 0 || from.noisy > 0 || to.noisy > 0 || from.draining || to.draining;
  }

  // -------------------------------------------------------------------------
  // Snapshot helpers
  // -------------------------------------------------------------------------

  private nodeMetrics(rt: RuntimeNode, sec: number): NodeMetrics {
    const up = this.isNodeUp(rt);
    const capacity = this.effectiveCapacity(rt);
    const recentRequests = rt.recent.total(sec, 'req');
    const recentFailures = rt.recent.total(sec, 'fail');
    const divisor = Math.max(1, Math.min(5, this.currentTime));
    const requestsPerSecond = recentRequests / divisor;
    const errorRate = recentRequests > 0 ? recentFailures / recentRequests : 0;

    let status: NodeStatus = 'healthy';
    let note = rt.note;
    if (!up) {
      status = 'down';
      if (rt.db && this.currentTime < rt.db.failoverUntil) note = 'failing over';
      else if (!note) note = 'unavailable';
    } else if (
      rt.slow > 0 ||
      rt.noisy > 0 ||
      rt.draining ||
      (rt.k8s && rt.k8s.badPods > 0) ||
      rt.queue.size > Math.max(8, capacity)
    ) {
      status = 'degraded';
      if (!note) {
        if (rt.slow > 0) note = 'slow';
        else if (rt.noisy > 0) note = 'noisy neighbor';
        else if (rt.draining) note = 'draining';
        else if (rt.k8s && rt.k8s.badPods > 0) note = 'bad deploy';
        else note = 'queue building';
      }
    }

    let replicasTotal = 1;
    let replicasUp = up ? 1 : 0;
    if (rt.node.kind === 'vm') {
      replicasTotal = Math.max(1, Math.floor(cfgNumber(rt.node, 'replicas', 1)));
      replicasUp = up ? replicasTotal : 0;
    } else if (rt.node.kind === 'k8s' && rt.k8s) {
      replicasTotal = Math.max(1, rt.k8s.podsTotal);
      replicasUp = up ? this.readyPods(rt) : 0;
    } else if (rt.node.kind === 'db') {
      replicasTotal = 1;
      replicasUp = up ? 1 : 0;
    }

    return {
      nodeId: rt.node.id,
      status,
      rps: round(requestsPerSecond, 2),
      inFlight: rt.inFlight,
      queue: rt.queue.size,
      capacity,
      utilization: capacity > 0 ? round(rt.inFlight / capacity, 3) : 0,
      errorRate: round(errorRate, 4),
      p95: round(rt.latency.quantile(0.95), 1),
      requests: rt.requests,
      failures: rt.failures,
      replicasUp,
      replicasTotal,
      note,
    };
  }

  private linkMetrics(link: TopologyLink, sec: number): LinkMetrics {
    const counter = this.linkCounters.get(link.id);
    const total = counter ? counter.total(sec, 'req') : 0;
    const divisor = Math.max(1, Math.min(5, this.currentTime));
    const rps = total / divisor;
    const from = this.runtime.get(link.from);
    const to = this.runtime.get(link.to);
    const capacity = Math.max(1, Math.min(
      from ? Math.max(1, this.effectiveCapacity(from)) : 1,
      to ? Math.max(1, this.effectiveCapacity(to)) : 1,
    ));
    return {
      linkId: link.id,
      rps: round(rps, 2),
      utilization: round(rps / capacity, 3),
      status: this.linkDown(link) ? 'down' : this.linkDegraded(link) ? 'degraded' : 'up',
    };
  }

  private dbLagMs(): number {
    let lag = 0;
    for (const rt of this.runtime.values()) {
      if (!rt.db) continue;
      const replicas = Math.max(0, Math.floor(cfgNumber(rt.node, 'replicas', 0)));
      const multiAz = cfgBool(rt.node, 'multiAz', false);
      if (rt.db.stale) {
        lag = Math.max(lag, 250);
      } else if (replicas > 0) {
        const sync = cfgString(rt.node, 'replication', 'async') === 'sync';
        lag = Math.max(lag, sync ? 5 : 50 + ((Math.floor(this.currentTime) * 37) % 251));
      } else if (multiAz) {
        lag = Math.max(lag, 5);
      }
    }
    return lag;
  }

  // -------------------------------------------------------------------------
  // Events and issues
  // -------------------------------------------------------------------------

  private log(
    kind: GameEventKind,
    severity: Severity,
    title: string,
    message: string,
    extra?: { nodeId?: ID; incidentId?: ID },
  ): GameEvent {
    const event: GameEvent = {
      id: `ev-${++this.idCounter}`,
      at: this.currentTime,
      kind,
      severity,
      title,
      message,
      ...(extra?.nodeId ? { nodeId: extra.nodeId } : {}),
      ...(extra?.incidentId ? { incidentId: extra.incidentId } : {}),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    try {
      this.options.onEvent?.(event);
    } catch {
      // A UI callback must never break the simulation.
    }
    return event;
  }

  private addIssue(
    key: string,
    severity: Severity,
    title: string,
    message: string,
    nodeId?: ID,
    incidentId?: ID,
  ): void {
    const last = this.issueKeys.get(key);
    if (last !== undefined && this.currentTime - last < 15) return;
    this.issueKeys.set(key, this.currentTime);
    const issue: Issue = {
      id: `issue-${++this.idCounter}`,
      at: this.currentTime,
      severity,
      title,
      message,
      ...(nodeId ? { nodeId } : {}),
      ...(incidentId ? { incidentId } : {}),
    };
    this.issues.push(issue);
    if (this.issues.length > MAX_ISSUES) this.issues.shift();
    this.log('alert', severity, title, message, { nodeId, incidentId });
  }
}

/**
 * Create a deterministic simulation for a scenario and starting topology.
 *
 * The topology is cloned, so the caller's objects are never mutated by runbooks
 * such as `scale-out`.
 */
export function createSimulation(
  scenario: Scenario,
  topology: Topology,
  options?: SimulationOptions,
): Simulation {
  return new SimulationEngine(scenario, topology, options);
}

/** Exposed for tests and tooling that want the raw kinds. */
export const SIM_COMPONENT_KINDS: ComponentKind[] = [
  'dns',
  'cdn',
  'lb',
  'proxy',
  'vm',
  'k8s',
  'db',
  'cache',
  'storage',
];
