/**
 * Postmortem generator for Series of Systems.
 *
 * Given the scenario, the final snapshot, the event log, and the topology that
 * was actually running, produce a dry incident review: objectives, stars,
 * timeline, root cause, contributing factors, and action items.
 *
 * Deterministic and pure. No React, no DOM, no clock reads.
 *
 * Stars (documented here because the UI shows them):
 *   0 — the run failed: an availability or error-seconds objective was missed.
 *   1 — survived, but drifted on two or more secondary objectives.
 *   2 — survived within the error budget with at most one secondary miss
 *       (typically the monthly cost cap).
 *   3 — every objective in the scenario was met.
 * "Primary" objectives are availability and error seconds. Secondary ones are
 * p95, cost, and data loss.
 */

import { cfgBool, cfgNumber, cfgString } from '../sim/config';
import type {
  GameEvent,
  GameEventKind,
  IncidentKind,
  ObjectiveResult,
  Objectives,
  Postmortem,
  PostmortemMetrics,
  Scenario,
  Severity,
  SimSnapshot,
  Topology,
  TopologyNode,
} from '../sim/types';

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** "12s" — whole seconds, because nobody argues about decimals during a page. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'n/a';
  return `${Math.round(seconds)}s`;
}

/** "240 ms" */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return `${Math.round(ms)} ms`;
}

/** "$420/mo" */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost)) return 'n/a';
  return `$${Math.round(cost)}/mo`;
}

/** "99.92%" (and "100%" rather than "100.00%"). */
export function formatAvailability(availability: number): string {
  if (!Number.isFinite(availability)) return 'n/a';
  const pct = Math.max(0, Math.min(1, availability)) * 100;
  let text = pct.toFixed(2);
  if (text.endsWith('0')) text = pct.toFixed(1);
  if (text.endsWith('.0')) text = pct.toFixed(0);
  return `${text}%`;
}

function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return 'n/a';
  return `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/* Objectives                                                                 */
/* -------------------------------------------------------------------------- */

const PRIMARY_KEYS = new Set(['minAvailability', 'maxErrorSeconds']);

function buildObjectives(objectives: Objectives, snapshot: SimSnapshot): ObjectiveResult[] {
  const results: ObjectiveResult[] = [];

  if (objectives.minAvailability !== undefined) {
    results.push({
      key: 'minAvailability',
      label: 'Availability',
      target: `≥ ${formatAvailability(objectives.minAvailability)}`,
      actual: formatAvailability(snapshot.availability),
      met: snapshot.availability + 1e-9 >= objectives.minAvailability,
    });
  }

  if (objectives.maxErrorSeconds !== undefined) {
    results.push({
      key: 'maxErrorSeconds',
      label: 'Error time',
      target: `≤ ${formatSeconds(objectives.maxErrorSeconds)}`,
      actual: formatSeconds(snapshot.errorSeconds),
      met: snapshot.errorSeconds <= objectives.maxErrorSeconds + 1e-9,
    });
  }

  if (objectives.maxP95Ms !== undefined) {
    results.push({
      key: 'maxP95Ms',
      label: 'p95 latency',
      target: `≤ ${formatLatency(objectives.maxP95Ms)}`,
      actual: formatLatency(snapshot.p95),
      met: snapshot.p95 <= objectives.maxP95Ms + 1e-9,
    });
  }

  if (objectives.maxMonthlyCost !== undefined) {
    results.push({
      key: 'maxMonthlyCost',
      label: 'Monthly cost',
      target: `≤ ${formatCost(objectives.maxMonthlyCost)}`,
      actual: formatCost(snapshot.monthlyCost),
      met: snapshot.monthlyCost <= objectives.maxMonthlyCost + 1e-9,
    });
  }

  if (objectives.noDataLoss === true) {
    results.push({
      key: 'noDataLoss',
      label: 'Data loss',
      target: 'No data loss',
      actual: snapshot.dataLossEvents === 0 ? 'None' : `${snapshot.dataLossEvents} event${snapshot.dataLossEvents === 1 ? '' : 's'}`,
      met: snapshot.dataLossEvents === 0,
    });
  }

  return results;
}

interface Score {
  stars: number;
  outcome: 'success' | 'failure';
  primaryMet: boolean;
  allMet: boolean;
  metCount: number;
  total: number;
  secondaryMisses: number;
}

function scoreRun(objectives: Objectives, results: ObjectiveResult[], snapshot: SimSnapshot): Score {
  const availabilityMet =
    objectives.minAvailability === undefined ? true : snapshot.availability + 1e-9 >= objectives.minAvailability;
  const errorMet =
    objectives.maxErrorSeconds === undefined ? true : snapshot.errorSeconds <= objectives.maxErrorSeconds + 1e-9;
  // With no availability/error objective (sandbox), treat a run that failed more
  // than half of its requests as a loss.
  const primaryMet = objectives.minAvailability === undefined && objectives.maxErrorSeconds === undefined
    ? snapshot.errorRate < 0.5
    : availabilityMet && errorMet;

  const allMet = results.every((result) => result.met);
  const secondaryMisses = results.filter((result) => !result.met && !PRIMARY_KEYS.has(result.key)).length;
  const metCount = results.filter((result) => result.met).length;

  let stars: number;
  if (!primaryMet) stars = 0;
  else if (allMet) stars = 3;
  else if (secondaryMisses <= 1) stars = 2;
  else stars = 1;

  return {
    stars,
    outcome: stars >= 1 && primaryMet ? 'success' : 'failure',
    primaryMet,
    allMet,
    metCount,
    total: results.length,
    secondaryMisses,
  };
}

/* -------------------------------------------------------------------------- */
/* Topology helpers                                                           */
/* -------------------------------------------------------------------------- */

const SEVERITY_WEIGHT: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };

function nodeLabel(node: TopologyNode): string {
  return `${node.kind} "${node.name}"`;
}

function zoneLabel(scenario: Scenario, zoneId: string | undefined): string {
  if (!zoneId) return 'an unnamed zone';
  for (const region of scenario.world.regions) {
    if (region.zones.some((candidate) => candidate.id === zoneId)) return zoneId;
  }
  return zoneId;
}

function regionLabel(scenario: Scenario, regionId: string | undefined): string {
  if (!regionId) return 'an unnamed region';
  const region = scenario.world.regions.find((candidate) => candidate.id === regionId);
  return region ? `${region.id} (${region.name})` : regionId;
}

function byKind(topology: Topology, kind: TopologyNode['kind']): TopologyNode[] {
  return topology.nodes.filter((node) => node.kind === kind);
}

function peakRps(snapshot: SimSnapshot): number {
  const series = snapshot.series?.rps ?? [];
  let peak = snapshot.rps;
  for (const point of series) {
    if (Number.isFinite(point.v) && point.v > peak) peak = point.v;
  }
  return Math.max(0, Math.round(peak));
}

function busiestNode(snapshot: SimSnapshot, topology: Topology): TopologyNode | undefined {
  let worst: TopologyNode | undefined;
  let worstScore = -1;
  for (const node of topology.nodes) {
    const metrics = snapshot.nodes[node.id];
    if (!metrics) continue;
    const score = metrics.errorRate * metrics.requests + metrics.utilization * 10 + (metrics.status === 'down' ? 50 : 0);
    if (score > worstScore) {
      worstScore = score;
      worst = node;
    }
  }
  return worst;
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                  */
/* -------------------------------------------------------------------------- */

interface TopIncident {
  title: string;
  kind: IncidentKind;
  at: number;
  duration: number;
  targetId?: string;
  zoneId?: string;
  regionId?: string;
  cloudId?: string;
  impact: number;
}

function pickTopIncident(scenario: Scenario, events: GameEvent[], elapsed: number): TopIncident | undefined {
  const dataLossTimes = events.filter((event) => event.kind === 'data-loss').map((event) => event.at);

  let best: TopIncident | undefined;
  for (const incident of scenario.incidents) {
    if (incident.at > elapsed) continue;
    const duration = incident.duration ?? 60;
    const nearbyLosses = dataLossTimes.filter(
      (at) => at >= incident.at - 5 && at <= incident.at + duration + 30,
    ).length;
    const impact = duration * SEVERITY_WEIGHT[incident.severity] + nearbyLosses * 90;
    const candidate: TopIncident = {
      title: incident.title,
      kind: incident.kind,
      at: incident.at,
      duration,
      targetId: incident.targetId,
      zoneId: incident.zoneId,
      regionId: incident.regionId,
      cloudId: incident.cloudId,
      impact,
    };
    if (!best || impact > best.impact || (impact === best.impact && incident.at < best.at)) best = candidate;
  }

  if (best) return best;

  // No scheduled incidents (sandbox): infer from the event log.
  const incidentEvents = events.filter((event) => event.kind === 'incident');
  if (incidentEvents.length === 0) return undefined;
  const first = incidentEvents[0];
  const last = incidentEvents[incidentEvents.length - 1];
  return {
    title: first.title,
    kind: 'node-crash',
    at: first.at,
    duration: Math.max(0, last.at - first.at),
    targetId: first.nodeId,
    impact: incidentEvents.length * 10,
  };
}

/* -------------------------------------------------------------------------- */
/* Root cause / factors / actions                                             */
/* -------------------------------------------------------------------------- */

interface Cause {
  factor: string;
  action: string;
}

function collectCauses(
  scenario: Scenario,
  snapshot: SimSnapshot,
  events: GameEvent[],
  topology: Topology,
  top: TopIncident | undefined,
): Cause[] {
  const causes: Cause[] = [];
  const incidentKinds = new Set(
    scenario.incidents.filter((incident) => incident.at <= snapshot.time).map((incident) => incident.kind),
  );
  const peak = peakRps(snapshot);
  const have = (kind: IncidentKind) => incidentKinds.has(kind);

  const vms = byKind(topology, 'vm');
  const k8s = byKind(topology, 'k8s');
  const dbs = byKind(topology, 'db');
  const caches = byKind(topology, 'cache');
  const proxies = byKind(topology, 'proxy');
  const lbs = byKind(topology, 'lb');
  const dns = byKind(topology, 'dns');
  const regions = new Set(topology.nodes.map((node) => node.regionId).filter(Boolean) as string[]);

  // 1. Compute concentrated in the zone that failed. ---------------------
  if (have('zone-down')) {
    const failedZones = scenario.incidents
      .filter((incident) => incident.kind === 'zone-down' && incident.at <= snapshot.time)
      .map((incident) => incident.zoneId)
      .filter((zoneId): zoneId is string => Boolean(zoneId));
    for (const zoneId of failedZones) {
      const computeInZone = vms.filter((node) => node.zoneId === zoneId);
      const computeElsewhere = vms.filter((node) => node.zoneId !== zoneId);
      if (computeInZone.length > 0 && computeElsewhere.length === 0) {
        const lb = lbs[0];
        const otherZone = scenario.world.regions
          .flatMap((region) => region.zones)
          .map((zone) => zone.id)
          .find((id) => id !== zoneId);
        causes.push({
          factor: `Every app VM lived in ${zoneLabel(scenario, zoneId)}: ${computeInZone
            .map((node) => nodeLabel(node))
            .join(', ')}. When that zone went down there was nothing to fail over to.`,
          action: otherZone
            ? `Add an app VM in ${zoneLabel(scenario, otherZone)} and link ${lb ? nodeLabel(lb) : 'the load balancer'} to it.`
            : 'Add a second zone and put an app VM in it.',
        });
      }
    }
  }

  // 2. Health check detection window. ------------------------------------
  const worstLb = lbs
    .map((node) => ({
      node,
      window: cfgNumber(node, 'healthCheckInterval', 5) * cfgNumber(node, 'unhealthyThreshold', 3),
    }))
    .sort((a, b) => b.window - a.window)[0];
  if (worstLb && worstLb.window >= 10) {
    const interval = cfgNumber(worstLb.node, 'healthCheckInterval', 5);
    const threshold = cfgNumber(worstLb.node, 'unhealthyThreshold', 3);
    causes.push({
      factor: `${nodeLabel(worstLb.node)} needs ${worstLb.window}s to eject a dead backend (${interval}s interval × ${threshold} failures). That is ${worstLb.window}s of users reaching a corpse.`,
      action: `Set healthCheckInterval to 2s and unhealthyThreshold to 2 on ${nodeLabel(worstLb.node)} (about 4s to eject).`,
    });
  }

  // 3. Database durability. ----------------------------------------------
  const primaryDb = dbs[0];
  if (primaryDb) {
    const multiAz = cfgBool(primaryDb, 'multiAz', false);
    const replicas = cfgNumber(primaryDb, 'replicas', 0);
    const replication = cfgString(primaryDb, 'replication', 'async');
    const autoFailover = cfgBool(primaryDb, 'automaticFailover', true);

    if (!multiAz && replicas === 0) {
      causes.push({
        factor: `${nodeLabel(primaryDb)} has no multi-AZ standby and no replicas, so any zone event is a full outage, not a failover.`,
        action: `Enable multiAz on ${nodeLabel(primaryDb)} so a zone failure is a ~6s blip instead of an outage.`,
      });
    } else if (!multiAz && autoFailover) {
      causes.push({
        factor: `${nodeLabel(primaryDb)} fails over automatically to an async replica, which is a polite way of saying it drops the last writes.`,
        action: `Switch ${nodeLabel(primaryDb)} to sync replication, or accept losing writes and put that in the SLA.`,
      });
    } else if (!multiAz) {
      causes.push({
        factor: `${nodeLabel(primaryDb)} runs single-AZ with manual failover; recovery waits for a human with a laptop.`,
        action: `Enable multiAz on ${nodeLabel(primaryDb)} (or script the promotion).`,
      });
    }

    if (have('network-partition') && replication === 'async') {
      causes.push({
        factor: `The network partition left ${nodeLabel(primaryDb)} with a stale async replica; sync replication is what makes a partition a pause instead of a data-loss event.`,
        action: `Use sync replication on ${nodeLabel(primaryDb)} for the primary write path.`,
      });
    }

    if (snapshot.dbLagMs > 500) {
      causes.push({
        factor: `Replication lag on ${nodeLabel(primaryDb)} reached ${Math.round(snapshot.dbLagMs)}ms, so reads were serving history.`,
        action: `Cap read traffic or size up ${nodeLabel(primaryDb)} so replication lag stays under 500ms.`,
      });
    }
  }

  // 4. Cache stampede. ----------------------------------------------------
  const unprotectedCache = caches.find((node) => !cfgBool(node, 'stampedeProtection', true));
  if (unprotectedCache && (have('cache-stampede') || snapshot.errorSeconds > 0)) {
    causes.push({
      factor: `${nodeLabel(unprotectedCache)} has stampedeProtection off, so one cold key sent the whole miss rate to the database.`,
      action: `Enable stampedeProtection on ${nodeLabel(unprotectedCache)}.`,
    });
  }

  // 5. Retries without a budget. -----------------------------------------
  const retrying = [...proxies, ...vms].find(
    (node) => cfgNumber(node, 'retries', 0) > 0 && cfgNumber(node, 'retryBudgetPct', 10) === 0,
  );
  if (retrying) {
    causes.push({
      factor: `${nodeLabel(retrying)} retries ${cfgNumber(retrying, 'retries', 0)}× with retryBudgetPct 0, so a blip becomes a self-inflicted traffic spike.`,
      action: `Set retryBudgetPct to 10 on ${nodeLabel(retrying)}.`,
    });
  }

  // 6. Rate limit off during a spike. ------------------------------------
  const openProxy = proxies.find((node) => cfgNumber(node, 'rateLimitRps', 0) === 0);
  const bursty = have('traffic-spike') || have('ddos') || (snapshot.errorSeconds > 0 && peak >= 50);
  if (openProxy && bursty) {
    causes.push({
      factor: `${nodeLabel(openProxy)} ran with rateLimitRps 0 while traffic reached ${peak} rps. Nothing rejected anything.`,
      action: `Set rateLimitRps on ${nodeLabel(openProxy)} to about ${Math.max(10, peak)} (peak observed traffic).`,
    });
  }

  // 7. Kubernetes readiness. ---------------------------------------------
  const unready = k8s.find((node) => !cfgBool(node, 'readinessProbe', false));
  if (unready) {
    causes.push({
      factor: `${nodeLabel(unready)} runs with readinessProbe off, so a bad deploy reached every pod at the same time.`,
      action: `Turn on readinessProbe for ${nodeLabel(unready)} and keep maxUnavailable at 1.`,
    });
  }

  // 8. Single region. ----------------------------------------------------
  if (regions.size <= 1 && (have('region-down') || have('zone-down'))) {
    const regionId = [...regions][0];
    causes.push({
      factor: `Everything sits in ${regionLabel(scenario, regionId)}; a regional failure has nowhere else to go.`,
      action: `Stand up a second region and point ${dns[0] ? nodeLabel(dns[0]) : 'DNS failover'} at it.`,
    });
  }

  // 9. DNS TTL. ----------------------------------------------------------
  const slowDns = dns.find((node) => cfgNumber(node, 'ttlSeconds', 60) >= 300);
  if (slowDns && (have('region-down') || have('zone-down') || have('db-failover'))) {
    causes.push({
      factor: `${nodeLabel(slowDns)} hands out ${cfgNumber(slowDns, 'ttlSeconds', 60)}s answers; clients kept talking to the broken target long after you fixed it.`,
      action: `Lower ttlSeconds to 30 on ${nodeLabel(slowDns)}.`,
    });
  }

  // 10. Draining off during deploys. -------------------------------------
  const sloppyLb = lbs.find(
    (node) => cfgNumber(node, 'drainingSeconds', 30) === 0 && events.some((event) => event.kind === 'deploy'),
  );
  if (sloppyLb) {
    causes.push({
      factor: `${nodeLabel(sloppyLb)} has connection draining off, so each deploy dropped whatever was in flight.`,
      action: `Set drainingSeconds to 30 on ${nodeLabel(sloppyLb)}.`,
    });
  }

  // 11. Unmanaged data loss. --------------------------------------------
  if (snapshot.dataLossEvents > 0) {
    causes.push({
      factor: `${snapshot.dataLossEvents} data-loss event${snapshot.dataLossEvents === 1 ? '' : 's'} on the record; the failover path was faster than the durability path.`,
      action: 'Add continuous backups/point-in-time recovery and rehearse a restore before the next promotion.',
    });
  }

  // 12. Security posture. -----------------------------------------------
  if (have('credential-leak')) {
    const publicDb = dbs.find((node) => cfgBool(node, 'publicAccess', false));
    const plainSecrets = vms.find((node) => cfgString(node, 'secrets', 'env') === 'plain');
    causes.push({
      factor: publicDb
        ? `${nodeLabel(publicDb)} is reachable from the public internet; one leaked password becomes a data breach.`
        : plainSecrets
          ? `${nodeLabel(plainSecrets)} stores credentials in plain config, which turns a host compromise into a credential compromise.`
          : 'The credential leak had a narrow blast radius because the data tier and secrets were hardened.',
      action: 'Close public database access, enable encryption and backups, and move secrets into a manager.',
    });
  }
  if (have('vulnerability')) {
    const unpatched = [...vms, ...k8s].find(
      (node) => cfgString(node, 'patching', 'manual') !== 'auto',
    );
    causes.push({
      factor: unpatched
        ? `${nodeLabel(unpatched)} patches ${cfgString(unpatched, 'patching', 'manual')}; a known exploit stays live until someone rolls the patch.`
        : 'Automatic patching kept the vulnerability from becoming an outage.',
      action: 'Enable automatic patching for every compute tier and keep a manual emergency window.',
    });
  }
  if (have('brute-force')) {
    const waf = byKind(topology, 'waf')[0];
    causes.push({
      factor: waf
        ? `${nodeLabel(waf)} is in ${cfgString(waf, 'mode', 'block')} mode; monitor-only rules forward the attack to the origin.`
        : 'No WAF and no proxy rate limit meant credential stuffing reached the login endpoint directly.',
      action: 'Put a WAF in block mode at the edge and set a rate limit near peak traffic.',
    });
  }

  // 13. Fallback based on the busiest node. ------------------------------
  if (causes.length === 0) {
    const worst = busiestNode(snapshot, topology);
    if (worst) {
      const metrics = snapshot.nodes[worst.id];
      causes.push({
        factor: `${nodeLabel(worst)} was the tightest component at the end: ${Math.round(
          (metrics?.utilization ?? 0) * 100,
        )}% utilization, ${formatLatency(metrics?.p95 ?? 0)} p95, ${formatPercent(metrics?.errorRate ?? 0)} error rate.`,
        action: `Size up ${nodeLabel(worst)} or put a second copy of it behind ${
          lbs[0] ? nodeLabel(lbs[0]) : 'a load balancer'
        }.`,
      });
    } else if (top) {
      causes.push({
        factor: `${top.title} had no redundant path to fall back to, so it became a full outage instead of a blip.`,
        action: 'Add a second instance of the tier that the incident hit, in a different zone.',
      });
    }
  }

  return causes;
}

function buildRootCause(
  scenario: Scenario,
  snapshot: SimSnapshot,
  topology: Topology,
  top: TopIncident | undefined,
): string {
  const incidentKinds = new Set(
    scenario.incidents.filter((incident) => incident.at <= snapshot.time).map((incident) => incident.kind),
  );
  const vms = byKind(topology, 'vm');
  const k8s = byKind(topology, 'k8s');
  const dbs = byKind(topology, 'db');
  const caches = byKind(topology, 'cache');
  const proxies = byKind(topology, 'proxy');
  const lbs = byKind(topology, 'lb');
  const wafs = byKind(topology, 'waf');

  // Order matters: the most structural explanation wins.
  if (incidentKinds.has('zone-down') && vms.length > 0) {
    const failedZone = scenario.incidents.find(
      (incident) => incident.kind === 'zone-down' && incident.at <= snapshot.time,
    )?.zoneId;
    const outside = vms.filter((node) => node.zoneId !== failedZone);
    if (outside.length === 0) {
      return `A zone failure took ${vms.map((node) => node.name).join(', ')} offline because every VM in the topology shared ${zoneLabel(
        scenario,
        failedZone,
      )}. A load balancer with one place to send traffic is a very confident single point of failure.`;
    }
    const lb = lbs[0];
    if (lb && cfgNumber(lb, 'healthCheckInterval', 5) * cfgNumber(lb, 'unhealthyThreshold', 3) >= 10) {
      return `The zone failure itself was survivable, but ${nodeLabel(lb)} kept sending traffic to the dead backend for ${cfgNumber(
        lb,
        'healthCheckInterval',
        5,
      ) * cfgNumber(lb, 'unhealthyThreshold', 3)}s before ejecting it. Detection, not capacity, was the outage.`;
    }
    if (outside.length > 0) {
      const survivors = outside.map((node) => node.name).join(', ');
      const detection = lb
        ? cfgNumber(lb, 'healthCheckInterval', 5) * cfgNumber(lb, 'unhealthyThreshold', 3)
        : 0;
      return `A zone failure took ${vms
        .filter((node) => node.zoneId === failedZone)
        .map((node) => node.name)
        .join(', ')} offline, but ${survivors} kept serving from another zone. ${
        lb
          ? `${nodeLabel(lb)} ejected the dead backend in about ${formatSeconds(detection)}, so the blast radius stopped at the zone boundary.`
          : 'The surviving backend carried the traffic.'
      } This is redundancy doing its job.`;
    }
  }

  if (incidentKinds.has('region-down')) {
    const regions = new Set(topology.nodes.map((node) => node.regionId).filter(Boolean));
    if (regions.size <= 1) {
      return `${regionLabel(scenario, [...regions][0])} was the entire footprint, so "regional failover" was a slide in a document.`;
    }
  }

  if ((incidentKinds.has('db-failover') || incidentKinds.has('network-partition')) && dbs.length > 0) {
    const db = dbs[0];
    if (!cfgBool(db, 'multiAz', false) && cfgNumber(db, 'replicas', 0) === 0) {
      return `${nodeLabel(db)} had no standby, so the failover was really a scheduled outage with extra steps.`;
    }
    if (!cfgBool(db, 'multiAz', false) && cfgString(db, 'replication', 'async') === 'async') {
      return `${nodeLabel(db)} promoted an asynchronous replica. Promotion took seconds; the writes it had not received are now the "data loss" section of this document.`;
    }
    if (snapshot.dbLagMs > 500) {
      return `${nodeLabel(db)} could not keep its replicas current (${Math.round(
        snapshot.dbLagMs,
      )}ms lag); the failover promoted whichever copy answered first.`;
    }
  }

  if (incidentKinds.has('cache-stampede')) {
    const cache = caches[0];
    if (cache && !cfgBool(cache, 'stampedeProtection', true)) {
      return `${nodeLabel(cache)} dropped its keys and, with stampedeProtection off, forwarded every miss to ${
        dbs[0] ? nodeLabel(dbs[0]) : 'the database'
      } at once. The database then did what databases do under that load.`;
    }
  }

  if (incidentKinds.has('bad-deploy')) {
    const cluster = k8s[0];
    if (cluster && !cfgBool(cluster, 'readinessProbe', false)) {
      return `A bad deploy reached every pod of ${nodeLabel(cluster)} because readinessProbe was off; there was no point at which the rollout looked unhealthy enough to stop.`;
    }
  }

  if (incidentKinds.has('node-crash')) {
    const crash = scenario.incidents.find(
      (incident) => incident.kind === 'node-crash' && incident.at <= snapshot.time,
    );
    const target = crash?.targetId ? topology.nodes.find((node) => node.id === crash.targetId) : undefined;
    const compute = [...vms, ...k8s];
    if (compute.length <= 1) {
      return `${target ? nodeLabel(target) : 'The only compute node'} crashed, and there was no second instance to absorb the request path. ${
        snapshot.errorSeconds <= 5
          ? 'The restart runbook brought it back inside the error budget, but one machine is still one failure domain.'
          : 'Without a redundant instance, recovery depended on a manual restart while the error budget burned.'
      }`;
    }
    return `A single node crash took ${target ? nodeLabel(target) : 'one backend'} out of rotation, but the remaining compute tier carried the traffic. This is the difference between a node failure and an outage.`;
  }

  if (incidentKinds.has('credential-leak')) {
    const publicDb = dbs.find((node) => cfgBool(node, 'publicAccess', false));
    const plainSecrets = vms.find((node) => cfgString(node, 'secrets', 'env') === 'plain');
    if (publicDb) {
      return `${nodeLabel(publicDb)} accepted connections from the internet, which turned one leaked password into a data breach. Public access is a security posture, not a firewall rule.`;
    }
    if (plainSecrets) {
      return `${nodeLabel(plainSecrets)} kept credentials in plain config, where a crash dump or a log line could hand them to anyone reading the host.`;
    }
    return 'The leaked credential had a narrow blast radius: the data tier was private and the secrets were vaulted, so there was nothing useful to use.';
  }

  if (incidentKinds.has('vulnerability')) {
    const unpatched = [...vms, ...k8s].find(
      (node) => cfgString(node, 'patching', 'manual') !== 'auto',
    );
    if (unpatched) {
      return `A known vulnerability took down ${nodeLabel(unpatched)} because patching was ${cfgString(
        unpatched,
        'patching',
        'manual',
      )}. The advisory was public; the patch window was not.`;
    }
    return 'Automatic patching closed the vulnerability before it became an outage. The boring configuration was the security control.';
  }

  if (incidentKinds.has('brute-force')) {
    const waf = wafs[0];
    const rateLimited = proxies.some((node) => cfgNumber(node, 'rateLimitRps', 0) > 0);
    if (!waf && !rateLimited) {
      return 'Credential stuffing reached the login endpoint because there was no WAF and no proxy rate limit. The only thing between the botnet and the app was hope.';
    }
    if (waf && cfgString(waf, 'mode', 'block') !== 'block') {
      return `${nodeLabel(waf)} was in monitor mode, so the attack was logged and then forwarded to the origin anyway.`;
    }
    return 'The WAF and rate limit absorbed the credential stuffing before it reached the app. The botnet got 429s and a log line.';
  }

  if ((incidentKinds.has('traffic-spike') || incidentKinds.has('ddos')) && proxies.length > 0) {
    const wafBlock = wafs.some((node) => cfgString(node, 'mode', 'block') === 'block');
    if (!wafBlock) {
      const proxy = proxies.find((node) => cfgNumber(node, 'rateLimitRps', 0) === 0) ?? proxies[0];
      return `Traffic climbed to ${peakRps(snapshot)} rps and ${nodeLabel(
        proxy,
      )} had no rate limit (rateLimitRps ${cfgNumber(proxy, 'rateLimitRps', 0)}), so the origin absorbed all of it until it could not.`;
    }
  }

  if (incidentKinds.has('ddos') && wafs.some((node) => cfgString(node, 'mode', 'block') === 'block')) {
    return 'The WAF in block mode absorbed the attack before it reached the origin. The edge did the job it was paid for.';
  }

  if (incidentKinds.has('cert-expiry')) {
    return 'The certificate expired on schedule. Nothing auto-renewed it, so TLS did exactly what the calendar said it would.';
  }

  if (incidentKinds.has('disk-full') && dbs[0]) {
    return `${nodeLabel(dbs[0])} ran out of storage, which is a capacity problem that presents as a correctness problem.`;
  }

  const worst = busiestNode(snapshot, topology);
  if (worst) {
    const metrics = snapshot.nodes[worst.id];
    return `No single incident was contained: ${nodeLabel(worst)} absorbed the load to ${
      metrics ? `${Math.round(metrics.utilization * 100)}% utilization` : 'its limit'
    } and the failures compounded from there.`;
  }

  return top
    ? `"${top.title}" hit a topology with no redundant path, so a local failure became a headline.`
    : 'Nothing in the topology had a second copy of anything, which is a design decision until it is an incident.';
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

const TIMELINE_KINDS: GameEventKind[] = ['incident', 'recovery', 'deploy', 'data-loss', 'runbook'];

function timelineScore(event: GameEvent): number {
  const base: Record<string, number> = {
    'data-loss': 100,
    incident: 60,
    recovery: 45,
    runbook: 35,
    deploy: 30,
    objective: 15,
    alert: 10,
    system: 5,
  };
  return (base[event.kind] ?? 0) + SEVERITY_WEIGHT[event.severity] * 2;
}

/** Keep the most important events, then show them in time order. */
function buildTimeline(events: GameEvent[], limit = 14): GameEvent[] {
  const relevant = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => TIMELINE_KINDS.includes(event.kind));

  if (relevant.length <= limit) {
    return relevant
      .sort((a, b) => a.event.at - b.event.at || a.index - b.index)
      .map(({ event }) => event);
  }

  const kept = relevant
    .slice()
    .sort((a, b) => timelineScore(b.event) - timelineScore(a.event) || a.event.at - b.event.at)
    .slice(0, limit)
    .sort((a, b) => a.event.at - b.event.at || a.index - b.index);

  return kept.map(({ event }) => event);
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

function buildHeadline(
  scenario: Scenario,
  snapshot: SimSnapshot,
  score: Score,
  results: ObjectiveResult[],
  top: TopIncident | undefined,
): string {
  const availability = formatAvailability(snapshot.availability);
  const duration = formatSeconds(snapshot.time || scenario.duration);
  const missed = results.filter((result) => !result.met).map((result) => result.label.toLowerCase());

  if (scenario.sandbox && (snapshot.time < 300 || snapshot.requests < 100)) {
    return 'The shift ended before the first real traffic curve. No stars for a rehearsal.';
  }
  if (score.stars === 0) {
    if (snapshot.dataLossEvents > 0) {
      return `You lost writes and uptime; ${scenario.customer} kept the receipts.`;
    }
    if (top) {
      return `"${top.title}" cost ${formatSeconds(snapshot.errorSeconds)} of errors, and ${scenario.customer} noticed at second four.`;
    }
    return `${formatSeconds(snapshot.errorSeconds)} of errors, and ${scenario.customer} noticed at second four.`;
  }
  if (score.stars === 3) {
    return `${availability} availability over ${duration}. Nobody noticed, which is the entire job.`;
  }
  if (score.stars === 2) {
    if (snapshot.dataLossEvents > 0) {
      return `Survived ${duration} at ${availability}. The writes did not.`;
    }
    return `Survived ${duration} at ${availability}. ${missed[0] ? `The ${missed[0]} did not.` : 'One number went over.'}`;
  }
  return `Survived ${duration} at ${availability}, over more than one budget and by a narrow margin.`;
}

function buildSummary(
  scenario: Scenario,
  snapshot: SimSnapshot,
  score: Score,
  results: ObjectiveResult[],
  top: TopIncident | undefined,
): string {
  const duration = Math.round(snapshot.time || scenario.duration);
  const requests = Math.round(snapshot.requests);
  const failures = Math.round(snapshot.failures);
  const avgRps = duration > 0 ? requests / duration : snapshot.rps;
  const missed = results.filter((result) => !result.met);

  const parts: string[] = [];
  parts.push(
    `${scenario.title} ran ${duration}s for ${scenario.customer}: ${requests.toLocaleString('en-US')} requests at ~${Math.round(
      avgRps,
    )} rps, ${failures.toLocaleString('en-US')} of them failed (${formatPercent(
      requests > 0 ? failures / requests : 0,
    )}).`,
  );
  if (scenario.sandbox && (snapshot.time < 300 || requests < 100)) {
    parts.push('The shift was ended before the traffic curve arrived; sandbox stars require a real run, not a rehearsal.');
  }
  parts.push(
    `Final availability ${formatAvailability(snapshot.availability)}, p95 ${formatLatency(snapshot.p95)}, cost ${formatCost(
      snapshot.monthlyCost,
    )}${snapshot.dataLossEvents > 0 ? `, ${snapshot.dataLossEvents} data-loss event${snapshot.dataLossEvents === 1 ? '' : 's'}` : ''}.`,
  );
  if (top) {
    parts.push(
      `Largest incident: "${top.title}" at ${formatSeconds(top.at)} for ${formatSeconds(top.duration)}${
        snapshot.dataLossEvents > 0 ? ', which is where the writes went' : ''
      }.`,
    );
  }
  if (score.total === 0) {
    parts.push('No objectives were set, so survival is the metric.');
  } else if (score.stars === 0) {
    if (scenario.sandbox && (snapshot.time < 300 || requests < 100)) {
      parts.push('The shift was ended early; run the full hour to earn a score.');
    } else {
      parts.push(`${score.metCount}/${score.total} objectives met. ${scenario.failureText}`);
    }
  } else if (score.stars === 3) {
    parts.push(`All ${score.total} objectives met. ${scenario.successText}`);
  } else if (missed.length > 0) {
    parts.push(
      `${score.metCount}/${score.total} objectives met; missed ${missed
        .map((result) => `${result.label.toLowerCase()} (${result.actual} vs ${result.target})`)
        .join(', ')}.`,
    );
  } else {
    parts.push(`${score.metCount}/${score.total} objectives met.`);
  }
  return parts.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function buildPostmortem(
  scenario: Scenario,
  snapshot: SimSnapshot,
  events: GameEvent[],
  topology: Topology,
): Postmortem {
  const results = buildObjectives(scenario.objectives, snapshot);
  let score = scoreRun(scenario.objectives, results, snapshot);
  const abandoned = scenario.sandbox && (snapshot.time < 300 || snapshot.requests < 100);
  if (abandoned) {
    results.push({
      key: 'minShift',
      label: 'Minimum shift',
      target: '300s',
      actual: formatSeconds(snapshot.time),
      met: false,
    });
    score = {
      ...score,
      stars: 0,
      outcome: 'failure',
      primaryMet: false,
      allMet: false,
      total: results.length,
      metCount: results.filter((result) => result.met).length,
    };
  }
  const top = pickTopIncident(scenario, events, snapshot.time);
  const causes = abandoned ? [] : collectCauses(scenario, snapshot, events, topology, top);

  const factors = causes.map((cause) => cause.factor);
  const rootCause = abandoned
    ? 'The shift ended before traffic arrived. There is no root cause because nothing had time to break.'
    : buildRootCause(scenario, snapshot, topology, top);
  const contributingFactors = abandoned
    ? ['No traffic reached the system; this run was a rehearsal, not a shift.']
    : factors.slice(0, 5);
  if (contributingFactors.length === 0) {
    contributingFactors.push(
      `${Math.round(snapshot.failures)} failed requests with no obvious single cause; the system degraded for a while and then stopped.`,
    );
  }

  const actionItems: string[] = [];
  if (abandoned) {
    actionItems.push('Run a full sandbox shift and let the traffic curve arrive before reading the score.');
    actionItems.push('Use the difficulty setting to choose how much chaos the shift should contain.');
  } else if (score.outcome === 'success' && score.stars >= 2 && snapshot.dataLossEvents === 0) {
    const compute = topology.nodes.filter((node) => node.kind === 'vm' || node.kind === 'k8s');
    const db = topology.nodes.find((node) => node.kind === 'db');
    const cache = topology.nodes.find((node) => node.kind === 'cache');
    if (compute.length >= 2) {
      actionItems.push(
        `Keep at least two compute replicas in separate zones, and keep the load balancer's detection window under 10 seconds.`,
      );
    } else {
      actionItems.push(
        'Put a second compute replica in another zone behind a load balancer; one box is still one failure domain.',
      );
    }
    if (db && (cfgBool(db, 'multiAz', false) || cfgNumber(db, 'replicas', 0) > 0)) {
      actionItems.push(`Keep ${nodeLabel(db)} redundant and rehearse promotion before the next real failure.`);
    }
    if (cache && cfgBool(cache, 'stampedeProtection', true)) {
      actionItems.push(`Keep stampede protection on ${nodeLabel(cache)}; the cold-cache drill is what proved it.`);
    }
    if (
      scenario.incidents.some((incident) =>
        ['credential-leak', 'vulnerability', 'brute-force', 'ddos', 'cert-expiry'].includes(incident.kind),
      )
    ) {
      actionItems.push(
        'Keep the WAF in block mode, rate limits configured, secrets vaulted, databases private and encrypted, and automatic patching on.',
      );
    }
    actionItems.push(
      `Alert on p95 above ${Math.max(200, Math.round(snapshot.p95 * 3))} ms and on error-budget burn before ${scenario.customer} emails.`,
    );
    actionItems.push('Schedule a game day for the same failure domain, so the next surprise is a rehearsal.');
  } else {
    for (const cause of causes) {
      if (!actionItems.includes(cause.action)) actionItems.push(cause.action);
      if (actionItems.length >= 4) break;
    }
  }
  if (actionItems.length < 2) {
    actionItems.push(`Add an error-rate and p95 alert that fires before ${scenario.customer} emails.`);
  }
  if (actionItems.length < 2) {
    actionItems.push(`Write the runbook you wished you had at ${formatSeconds(top?.at ?? 0)}.`);
  }

  const metrics: PostmortemMetrics = {
    availability: snapshot.availability,
    errorSeconds: snapshot.errorSeconds,
    p95: snapshot.p95,
    monthlyCost: snapshot.monthlyCost,
    dataLossEvents: snapshot.dataLossEvents,
    totalRequests: snapshot.requests,
    failedRequests: snapshot.failures,
    duration: snapshot.time || scenario.duration,
  };

  return {
    levelId: scenario.id,
    levelTitle: scenario.title,
    outcome: score.outcome,
    stars: score.stars,
    headline: buildHeadline(scenario, snapshot, score, results, top),
    summary: buildSummary(scenario, snapshot, score, results, top),
    timeline: buildTimeline(events),
    rootCause,
    contributingFactors,
    actionItems: actionItems.slice(0, 4),
    objectives: results,
    metrics,
  };
}
