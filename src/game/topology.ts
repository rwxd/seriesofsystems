import { COMPONENT_SPECS, defaultConfig, getSpec, topologyCostPerMonth } from '@/sim/catalog';
import type {
  CloudDef,
  ComponentKind,
  ID,
  NodeConfig,
  RegionDef,
  Topology,
  TopologyLink,
  TopologyNode,
  World,
  ZoneDef,
} from '@/sim/types';

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: ID;
  linkId?: ID;
}

export interface Placement {
  cloudId?: ID;
  regionId?: ID;
  zoneId?: ID;
}

export function cloneTopology(topology: Topology): Topology {
  return {
    nodes: topology.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    links: topology.links.map((link) => ({ ...link })),
  };
}

export function getNode(topology: Topology, id: ID | null | undefined): TopologyNode | undefined {
  if (!id) return undefined;
  return topology.nodes.find((node) => node.id === id);
}

export function getLink(topology: Topology, id: ID | null | undefined): TopologyLink | undefined {
  if (!id) return undefined;
  return topology.links.find((link) => link.id === id);
}

export function incomingLinks(topology: Topology, nodeId: ID): TopologyLink[] {
  return topology.links.filter((link) => link.to === nodeId);
}

export function outgoingLinks(topology: Topology, nodeId: ID): TopologyLink[] {
  return topology.links.filter((link) => link.from === nodeId);
}

export function entryNodes(topology: Topology): TopologyNode[] {
  const incoming = new Set(topology.links.map((link) => link.to));
  const entries = topology.nodes.filter((node) => !incoming.has(node.id));
  return entries.length > 0 ? entries : topology.nodes.filter((node) => node.kind === 'dns');
}

export function regionOf(world: World, regionId?: ID): RegionDef | undefined {
  return world.regions.find((region) => region.id === regionId);
}

export function zoneOf(world: World, regionId?: ID, zoneId?: ID): ZoneDef | undefined {
  return regionOf(world, regionId)?.zones.find((zone) => zone.id === zoneId);
}

export function cloudOf(world: World, cloudId?: ID): CloudDef | undefined {
  return world.clouds.find((cloud) => cloud.id === cloudId);
}

export function placementLabel(node: TopologyNode, world: World): string {
  const spec = getSpec(node.kind);
  if (spec.scope === 'global') return 'Global';
  const region = regionOf(world, node.regionId);
  const zone = zoneOf(world, node.regionId, node.zoneId);
  if (spec.scope === 'regional') return region?.name ?? 'Region';
  return zone ? `${region?.shortName ?? region?.name} · ${zone.shortName}` : 'Zone';
}

export function placementOf(node: TopologyNode): Placement {
  return {
    ...(node.cloudId ? { cloudId: node.cloudId } : {}),
    ...(node.regionId ? { regionId: node.regionId } : {}),
    ...(node.zoneId ? { zoneId: node.zoneId } : {}),
  };
}

export function defaultPlacement(
  kind: ComponentKind,
  world: World,
  preferred?: Placement,
): Placement {
  const spec = getSpec(kind);
  if (spec.scope === 'global') return {};
  const region =
    world.regions.find((candidate) => candidate.id === preferred?.regionId) ?? world.regions[0];
  if (!region) return {};
  if (spec.scope === 'regional') {
    return { cloudId: region.cloudId, regionId: region.id };
  }
  const zone = region.zones.find((candidate) => candidate.id === preferred?.zoneId) ?? region.zones[0];
  return { cloudId: region.cloudId, regionId: region.id, ...(zone ? { zoneId: zone.id } : {}) };
}

export function linkLatencyMs(from: TopologyNode | undefined, to: TopologyNode | undefined, world: World): number {
  if (!from || !to) return 0;
  const fromSpec = getSpec(from.kind);
  const toSpec = getSpec(to.kind);
  if (fromSpec.scope === 'global' || toSpec.scope === 'global') return 3;
  if (from.cloudId && to.cloudId && from.cloudId !== to.cloudId) return world.latency.crossCloud;
  if (from.regionId && to.regionId && from.regionId !== to.regionId) return world.latency.crossRegion;
  // A regional component is reachable from any zone in the region. Treat a
  // zonal↔regional hop as a cross-zone hop, not as a free local call.
  if (
    fromSpec.scope === 'zonal' &&
    toSpec.scope === 'zonal' &&
    from.zoneId &&
    to.zoneId &&
    from.zoneId === to.zoneId
  ) {
    return world.latency.sameZone;
  }
  return world.latency.crossZone;
}

export function linkLatency(link: TopologyLink, topology: Topology, world: World): number {
  return linkLatencyMs(getNode(topology, link.from), getNode(topology, link.to), world);
}

function nextId(kind: string, topology: Topology): string {
  let index = 1;
  const used = new Set(topology.nodes.map((node) => node.id));
  while (used.has(`${kind}-${index}`)) index += 1;
  return `${kind}-${index}`;
}

function nextName(kind: ComponentKind, topology: Topology): string {
  const spec = COMPONENT_SPECS[kind];
  const count = topology.nodes.filter((node) => node.kind === kind).length + 1;
  return count === 1 ? spec.label : `${spec.shortLabel} ${count}`;
}

export function createNode(
  kind: ComponentKind,
  placement: Placement,
  x: number,
  y: number,
  topology: Topology,
): TopologyNode {
  return {
    id: nextId(kind, topology),
    kind,
    name: nextName(kind, topology),
    ...placement,
    config: defaultConfig(kind),
    x: Math.round(x),
    y: Math.round(y),
  };
}

export function createLink(from: ID, to: ID, topology: Topology): TopologyLink | null {
  if (!from || !to || from === to) return null;
  if (!getNode(topology, from) || !getNode(topology, to)) return null;
  if (topology.links.some((link) => link.from === from && link.to === to)) return null;
  return { id: `${from}->${to}`, from, to };
}

export function hasPathToKind(topology: Topology, fromId: ID, kind: ComponentKind): boolean {
  const seen = new Set<ID>([fromId]);
  const queue: ID[] = [fromId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of outgoingLinks(topology, current)) {
      const target = getNode(topology, link.to);
      if (!target) continue;
      if (target.kind === kind) return true;
      if (!seen.has(target.id)) {
        seen.add(target.id);
        queue.push(target.id);
      }
    }
  }
  return false;
}

export function hasCycle(topology: Topology): boolean {
  const byId = new Map(topology.nodes.map((node) => [node.id, node]));
  const visiting = new Set<ID>();
  const visited = new Set<ID>();
  const visit = (id: ID): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const link of outgoingLinks(topology, id)) {
      if (byId.has(link.to) && visit(link.to)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return topology.nodes.some((node) => visit(node.id));
}

export function validateTopology(
  topology: Topology,
  world: World,
  options: { requiresDatabase?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<ID>();
  const names = new Set<string>();

  for (const node of topology.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ id: `dup-${node.id}`, severity: 'error', message: `Duplicate node id ${node.id}.`, nodeId: node.id });
    }
    nodeIds.add(node.id);
    if (!node.name.trim()) {
      issues.push({ id: `name-${node.id}`, severity: 'error', message: 'Give this component a name.', nodeId: node.id });
    }
    if (names.has(node.name)) {
      issues.push({ id: `name-dup-${node.id}`, severity: 'warning', message: `Another component is also named "${node.name}".`, nodeId: node.id });
    }
    names.add(node.name);
    const spec = getSpec(node.kind);
    for (const message of spec.validate?.(node, topology, world) ?? []) {
      issues.push({ id: `spec-${node.id}-${message}`, severity: 'error', message, nodeId: node.id });
    }
  }

  for (const link of topology.links) {
    if (!nodeIds.has(link.from) || !nodeIds.has(link.to)) {
      issues.push({ id: `link-${link.id}`, severity: 'error', message: 'This link points at a component that no longer exists.', linkId: link.id });
    }
    if (link.from === link.to) {
      issues.push({ id: `self-${link.id}`, severity: 'error', message: 'A component cannot link to itself.', linkId: link.id });
    }
  }

  if (topology.nodes.length > 0 && entryNodes(topology).length === 0) {
    issues.push({ id: 'no-entry', severity: 'error', message: 'There is no entry point. Add a DNS component or remove the loop.' });
  }

  if (hasCycle(topology)) {
    issues.push({ id: 'cycle', severity: 'error', message: 'The topology contains a loop. Requests need a direction.' });
  }

  for (const node of topology.nodes) {
    const outgoing = outgoingLinks(topology, node.id);
    if ((node.kind === 'lb' || node.kind === 'proxy' || node.kind === 'dns' || node.kind === 'cdn') && outgoing.length === 0) {
      issues.push({ id: `dead-${node.id}`, severity: 'error', message: `${node.name} has no upstream target.`, nodeId: node.id });
    }
    if ((node.kind === 'vm' || node.kind === 'k8s') && options.requiresDatabase && !hasPathToKind(topology, node.id, 'db')) {
      issues.push({ id: `db-${node.id}`, severity: 'error', message: `${node.name} cannot reach a database. This workload needs one.`, nodeId: node.id });
    }
    if (node.kind === 'cache' && !hasPathToKind(topology, node.id, 'db')) {
      issues.push({ id: `cache-db-${node.id}`, severity: 'warning', message: `${node.name} has no database to fall back to on a cache miss.`, nodeId: node.id });
    }
    if (node.kind === 'db' && incomingLinks(topology, node.id).length === 0) {
      issues.push({ id: `db-in-${node.id}`, severity: 'warning', message: `${node.name} is not connected to anything.`, nodeId: node.id });
    }
  }

  return issues;
}

export function issuesByNode(issues: ValidationIssue[]): Record<ID, ValidationIssue[]> {
  const map: Record<ID, ValidationIssue[]> = {};
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    (map[issue.nodeId] ??= []).push(issue);
  }
  return map;
}

export function monthlyCost(topology: Topology, world: World, rps: number): number {
  return topologyCostPerMonth(topology, world, rps);
}

export function nodeConfigValue(node: TopologyNode, key: string): NodeConfig[string] | undefined {
  return node.config[key];
}

export function renameIfDefault(node: TopologyNode, nextName: string): TopologyNode {
  return { ...node, name: nextName.trim() || node.name };
}

export function fitNodePosition(x: number, y: number, width = 1200, height = 700): { x: number; y: number } {
  return {
    x: Math.max(40, Math.min(width - 180, Math.round(x))),
    y: Math.max(40, Math.min(height - 90, Math.round(y))),
  };
}
