import { describe, expect, it } from 'vitest';
import { worldSubset } from '@/content/worlds';
import type { Topology } from '@/sim/types';
import {
  createLink,
  createNode,
  entryNodes,
  hasCycle,
  hasPathToKind,
  linkLatencyMs,
  validateTopology,
} from '@/game/topology';

const world = worldSubset(['us-east', 'eu-west']);

function node(kind: Parameters<typeof createNode>[0], regionId: string, zoneId: string, topology: Topology, x = 0, y = 0) {
  return createNode(kind, { regionId, zoneId }, x, y, topology);
}

function fixture(): Topology {
  const empty: Topology = { nodes: [], links: [] };
  const dns = createNode('dns', {}, 100, 50, empty);
  const lb = createNode('lb', { regionId: 'us-east', cloudId: 'cumulus' }, 200, 150, {
    nodes: [dns],
    links: [],
  });
  const vm = createNode('vm', { regionId: 'us-east', zoneId: 'us-east-a' }, 300, 300, {
    nodes: [dns, lb],
    links: [],
  });
  const db = createNode('db', { regionId: 'us-east' }, 400, 450, {
    nodes: [dns, lb, vm],
    links: [],
  });
  return {
    nodes: [dns, lb, vm, db],
    links: [
      { id: 'a', from: dns.id, to: lb.id },
      { id: 'b', from: lb.id, to: vm.id },
      { id: 'c', from: vm.id, to: db.id },
    ],
  };
}

describe('topology helpers', () => {
  it('builds a valid basic topology', () => {
    const topology = fixture();
    expect(validateTopology(topology, world, { requiresDatabase: true })).toEqual([]);
    expect(entryNodes(topology).map((n) => n.kind)).toEqual(['dns']);
    expect(hasPathToKind(topology, topology.nodes.find((n) => n.kind === 'vm')!.id, 'db')).toBe(true);
  });

  it('rejects duplicate and self links', () => {
    const topology = fixture();
    const vm = topology.nodes.find((n) => n.kind === 'vm')!;
    expect(createLink(vm.id, vm.id, topology)).toBeNull();
    expect(createLink(topology.links[0]!.from, topology.links[0]!.to, topology)).toBeNull();
  });

  it('detects loops', () => {
    const topology = fixture();
    const db = topology.nodes.find((n) => n.kind === 'db')!;
    topology.links.push({ id: 'loop', from: db.id, to: topology.nodes[0]!.id });
    expect(hasCycle(topology)).toBe(true);
    expect(validateTopology(topology, world).some((issue) => issue.id === 'cycle')).toBe(true);
  });

  it('requires a database path for compute when the workload needs one', () => {
    const topology = fixture();
    topology.links = topology.links.filter((link) => link.to !== topology.nodes.find((n) => n.kind === 'db')!.id);
    const issues = validateTopology(topology, world, { requiresDatabase: true });
    expect(issues.some((issue) => issue.message.includes('cannot reach a database'))).toBe(true);
  });

  it('computes latency by failure domain', () => {
    const local = fixture().nodes;
    const vm = local.find((n) => n.kind === 'vm')!;
    const db = local.find((n) => n.kind === 'db')!;
    expect(linkLatencyMs(vm, db, world)).toBe(2);

    const eu = createNode('vm', { regionId: 'eu-west', zoneId: 'eu-west-a' }, 0, 0, { nodes: local, links: [] });
    expect(linkLatencyMs(vm, eu, world)).toBe(45);
  });

  it('auto-names new components and keeps ids unique', () => {
    const topology = fixture();
    const first = createNode('vm', { regionId: 'us-east', zoneId: 'us-east-b' }, 0, 0, topology);
    expect(topology.nodes.some((n) => n.id === first.id)).toBe(false);
    const second = createNode('vm', { regionId: 'us-east', zoneId: 'us-east-c' }, 0, 0, {
      nodes: [...topology.nodes, first],
      links: [],
    });
    expect(second.id).not.toBe(first.id);
    expect(second.name).toContain('VM');
  });
});
