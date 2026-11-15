/**
 * Theoretical path availability estimate for the inspector.
 *
 * The estimate walks the deployed graph from the entry points to the data tier
 * and combines nodes in series (product) and alternative paths in parallel
 * (`1 - Π(1 - path)`). It is deliberately simple: it ignores health-check
 * windows, retries, and incident timing. The live `Simulation` metrics remain
 * the source of truth during a run.
 */

import { getSpec } from './catalog';
import type { ID, Scenario, Topology, World } from './types';

const MAX_PATHS = 4096;

function nodeAvailability(topology: Topology, id: ID): number {
  const node = topology.nodes.find((candidate) => candidate.id === id);
  if (!node) return 0;
  try {
    return Math.max(0, Math.min(1, getSpec(node.kind).availability(node)));
  } catch {
    return 0.99;
  }
}

/**
 * Estimate availability of the deployed topology.
 *
 * Returns a number in [0, 1]. If the graph has no usable path we fall back to a
 * conservative but non-zero estimate so the UI never displays `NaN`.
 */
export function estimateAvailability(topology: Topology, world: World, scenario: Scenario): number {
  const entryIds = scenario.entryNodeIds?.length
    ? scenario.entryNodeIds
    : topology.nodes
        .filter((node) => !topology.links.some((link) => link.to === node.id))
        .map((node) => node.id);
  return estimateTopologyAvailability(topology, world, entryIds);
}

export function estimateTopologyAvailability(topology: Topology, _world: World, entryIds?: ID[]): number {
  if (topology.nodes.length === 0) return 0;

  const byId = new Map(topology.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<ID, ID[]>();
  for (const node of topology.nodes) outgoing.set(node.id, []);
  for (const link of topology.links) {
    if (!byId.has(link.from) || !byId.has(link.to)) continue;
    outgoing.get(link.from)!.push(link.to);
  }

  const entries = (entryIds && entryIds.length
    ? entryIds.filter((id) => byId.has(id))
    : topology.nodes
        .filter((node) => !topology.links.some((link) => link.to === node.id))
        .map((node) => node.id)
  );
  const startNodes = entries.length > 0 ? entries : topology.nodes.map((node) => node.id);

  const pathProducts: number[] = [];

  const walk = (id: ID, product: number, visited: Set<ID>): void => {
    if (pathProducts.length >= MAX_PATHS) return;
    const node = byId.get(id);
    if (!node) return;
    const next = outgoing.get(id) ?? [];
    const terminal = next.length === 0 || node.kind === 'db' || node.kind === 'storage';
    if (terminal) {
      pathProducts.push(product);
      return;
    }
    for (const target of next) {
      if (visited.has(target)) continue;
      visited.add(target);
      walk(target, product * nodeAvailability(topology, target), visited);
      visited.delete(target);
    }
  };

  for (const entry of startNodes) {
    walk(entry, nodeAvailability(topology, entry), new Set<ID>([entry]));
  }

  if (pathProducts.length === 0) {
    // No path to a data tier: combine every component in series as a fallback.
    let product = 1;
    for (const node of topology.nodes) product *= nodeAvailability(topology, node.id);
    return Math.max(0, Math.min(1, product));
  }

  let allFailed = 1;
  for (const product of pathProducts) {
    allFailed *= 1 - Math.max(0, Math.min(1, product));
  }
  return Math.max(0, Math.min(1, 1 - allFailed));
}
