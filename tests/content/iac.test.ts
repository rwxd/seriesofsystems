import { describe, expect, it } from 'vitest';
import { parseTopologyYaml, topologyToYaml, yamlDiffSummary } from '../../src/content/iac';
import type { Topology, World } from '../../src/sim/types';

const world: World = {
  clouds: [
    { id: 'cumulus', name: 'Cumulus Cloud', color: '#000', blurb: 'Default cloud.' },
    { id: 'stratus', name: 'Stratus', color: '#111', blurb: 'The other cloud.' },
    { id: 'nimbus', name: 'Nimbus', color: '#222', blurb: 'The third cloud.' },
  ],
  regions: [
    {
      id: 'us-east',
      name: 'US East',
      shortName: 'USE',
      cloudId: 'cumulus',
      zones: [
        { id: 'us-east-a', name: 'US East A', shortName: 'A' },
        { id: 'us-east-b', name: 'US East B', shortName: 'B' },
        { id: 'us-east-c', name: 'US East C', shortName: 'C' },
      ],
    },
    {
      id: 'us-west',
      name: 'US West',
      shortName: 'USW',
      cloudId: 'stratus',
      zones: [
        { id: 'us-west-a', name: 'US West A', shortName: 'A' },
        { id: 'us-west-b', name: 'US West B', shortName: 'B' },
      ],
    },
  ],
  latency: { sameZone: 1, crossZone: 2, crossRegion: 45, crossCloud: 70 },
};

function baseTopology(): Topology {
  return {
    nodes: [
      {
        id: 'dns',
        kind: 'dns',
        name: 'DNS',
        config: { ttlSeconds: 60, routing: 'failover', healthChecks: true },
        x: 100,
        y: 100,
      },
      {
        id: 'lb',
        kind: 'lb',
        name: 'Edge LB',
        cloudId: 'cumulus',
        regionId: 'us-east',
        config: {
          algorithm: 'least-conn',
          healthCheckInterval: 5,
          unhealthyThreshold: 3,
          healthyThreshold: 2,
          timeoutMs: 3000,
          drainingSeconds: 30,
        },
        x: 300,
        y: 140,
      },
      {
        id: 'app-1',
        kind: 'vm',
        name: 'App A',
        cloudId: 'cumulus',
        regionId: 'us-east',
        zoneId: 'us-east-a',
        config: { size: 'small', replicas: 1 },
        x: 500,
        y: 220,
      },
      {
        id: 'db',
        kind: 'db',
        name: 'Primary DB',
        cloudId: 'cumulus',
        regionId: 'us-east',
        config: {
          size: 'medium',
          replicas: 1,
          multiAz: true,
          replication: 'sync',
          automaticFailover: true,
          connectionLimit: 100,
          storageGb: 200,
        },
        x: 720,
        y: 300,
      },
    ],
    links: [
      { id: 'l1', from: 'dns', to: 'lb' },
      { id: 'l2', from: 'lb', to: 'app-1' },
      { id: 'l3', from: 'app-1', to: 'db' },
    ],
  };
}

function parse(text: string, previous: Topology = baseTopology()) {
  return parseTopologyYaml(text, world, previous);
}

describe('topologyToYaml', () => {
  it('emits the documented manifest shape with stable key order', () => {
    const yaml = topologyToYaml(baseTopology(), world);
    const lines = yaml.split('\n');

    expect(yaml).toContain('apiVersion: seriesofsystems/v1');
    expect(yaml).toContain('kind: Topology');
    expect(yaml).toContain('metadata:\n  name: production');
    expect(yaml).toContain('  components:');
    expect(yaml).toContain('  links:');

    const dnsIndex = lines.findIndex((line) => line.includes('id: dns'));
    const idIndex = lines.findIndex((line, index) => index === dnsIndex + 1 && line.includes('type: dns'));
    expect(dnsIndex).toBeGreaterThan(-1);
    expect(idIndex).toBe(dnsIndex + 1);

    // Global components carry no placement at all.
    const dnsBlock = yaml.slice(yaml.indexOf('id: dns'), yaml.indexOf('id: lb'));
    expect(dnsBlock).not.toContain('placement');
    expect(dnsBlock.indexOf('ttlSeconds')).toBeLessThan(dnsBlock.indexOf('routing'));

    // Zonal components keep cloud/region/zone.
    expect(yaml).toContain('placement:\n        cloud: cumulus\n        region: us-east\n        zone: us-east-a');
  });

  it('round-trips a topology through YAML', () => {
    const topology = baseTopology();
    const result = parse(topologyToYaml(topology, world), topology);

    expect(result.errors).toEqual([]);
    expect(result.topology).toBeDefined();
    expect(result.topology?.nodes).toEqual(topology.nodes);
    // Link IDs are preserved for links that already existed.
    expect(result.topology?.links).toEqual(topology.links);
  });

  it('honours an explicit metadata name', () => {
    const yaml = topologyToYaml(baseTopology(), world, 'staging');
    expect(yaml).toContain('name: staging');
  });
});

describe('parseTopologyYaml', () => {
  it('rejects invalid YAML syntax and returns no topology', () => {
    const result = parse('apiVersion: seriesofsystems/v1\nkind: Topology\nspec: [unclosed');
    expect(result.topology).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => /YAML syntax error/.test(error))).toBe(true);
  });

  it('rejects an empty document and the wrong apiVersion/kind', () => {
    expect(parse('').errors[0]).toMatch(/empty/i);

    const wrongApi = parse('apiVersion: v1\nkind: Topology\nspec:\n  components: []\n');
    expect(wrongApi.topology).toBeUndefined();
    expect(wrongApi.errors.join(' ')).toMatch(/Unsupported apiVersion/);

    const wrongKind = parse('apiVersion: seriesofsystems/v1\nkind: Deployment\nspec:\n  components: []\n');
    expect(wrongKind.errors.join(' ')).toMatch(/Unsupported kind/);
  });

  it('rejects duplicate component IDs', () => {
    const result = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      name: App One
      placement:
        cloud: cumulus
        region: us-east
        zone: us-east-a
    - id: app-1
      type: vm
      name: App One Again
      placement:
        cloud: cumulus
        region: us-east
        zone: us-east-b
`);
    expect(result.topology).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/duplicate component id "app-1"/);
  });

  it('rejects a zonal component without a zone', () => {
    const result = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      name: App One
      placement:
        region: us-east
`);
    expect(result.topology).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/placement\.zone is required/);
  });

  it('rejects placement that does not belong to the component scope', () => {
    const regionalWithZone = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: lb
      placement:
        region: us-east
        zone: us-east-a
`);
    expect(regionalWithZone.errors.join(' ')).toMatch(/regional lb; placement\.zone does not apply/);

    const globalWithRegion = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: dns
      type: dns
      placement:
        region: us-east
`);
    expect(globalWithRegion.errors.join(' ')).toMatch(/cannot be pinned to a region or zone/);
  });

  it('rejects unknown regions, zones, and clouds', () => {
    const unknownRegion = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: lb
      placement:
        region: mars-east
`);
    expect(unknownRegion.errors.join(' ')).toMatch(/unknown region "mars-east"/);

    const unknownZone = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      placement:
        region: us-east
        zone: us-west-a
`);
    expect(unknownZone.errors.join(' ')).toMatch(/unknown zone "us-west-a"/);

    const mismatchedCloud = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: lb
      placement:
        cloud: stratus
        region: us-east
`);
    expect(mismatchedCloud.errors.join(' ')).toMatch(/belongs to cloud "cumulus"/);
  });

  it('treats unknown config keys as errors', () => {
    const result = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      name: App One
      placement:
        region: us-east
        zone: us-east-a
      config:
        replica: 2
`);
    expect(result.topology).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/unknown config key "replica" for type vm/);
  });

  it('validates config types, select options, and numeric bounds', () => {
    const badSelect = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      placement:
        region: us-east
        zone: us-east-a
      config:
        size: enormous
`);
    expect(badSelect.errors.join(' ')).toMatch(/must be one of small, medium, large/);

    const badType = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      placement:
        region: us-east
        zone: us-east-a
      config:
        replicas: many
`);
    expect(badType.errors.join(' ')).toMatch(/must be a number/);

    const outOfBounds = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      placement:
        region: us-east
        zone: us-east-a
      config:
        replicas: 99
`);
    expect(outOfBounds.errors.join(' ')).toMatch(/at most 8/);
  });

  it('accepts numeric strings for number fields and canonicalizes select values', () => {
    const result = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: app-1
      type: vm
      placement:
        region: us-east
        zone: us-east-a
      config:
        size: small
        replicas: "2"
    - id: dns
      type: dns
      config:
        ttlSeconds: "60"
`);
    expect(result.errors).toEqual([]);
    const app = result.topology?.nodes.find((node) => node.id === 'app-1');
    expect(app?.config.replicas).toBe(2);
    const dns = result.topology?.nodes.find((node) => node.id === 'dns');
    expect(dns?.config.ttlSeconds).toBe(60);
  });

  it('rejects links to missing nodes, self-links, and duplicate links', () => {
    const missing = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: lb
      placement:
        region: us-east
  links:
    - from: lb
      to: ghost
`);
    expect(missing.errors.join(' ')).toMatch(/"to" references unknown component "ghost"/);

    const selfLink = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: lb
      placement:
        region: us-east
  links:
    - from: lb
      to: lb
`);
    expect(selfLink.errors.join(' ')).toMatch(/cannot link to itself/);

    const duplicate = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: dns
      type: dns
    - id: lb
      type: lb
      placement:
        region: us-east
  links:
    - from: dns
      to: lb
    - from: dns
      to: lb
`);
    expect(duplicate.errors.join(' ')).toMatch(/duplicate link/);
  });

  it('preserves x/y from the previous topology by node id', () => {
    const previous = baseTopology();
    const topology = baseTopology();
    const yaml = topologyToYaml(topology, world);
    const result = parse(yaml, previous);
    expect(result.errors).toEqual([]);

    for (const node of previous.nodes) {
      const parsed = result.topology?.nodes.find((candidate) => candidate.id === node.id);
      expect(parsed?.x).toBe(node.x);
      expect(parsed?.y).toBe(node.y);
    }
  });

  it('auto-places new nodes in a grid inside the viewport', () => {
    const previous = baseTopology();
    const yaml = `
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: dns
      type: dns
      name: DNS
    - id: lb
      type: lb
      name: Edge LB
      placement:
        region: us-east
    - id: app-1
      type: vm
      name: App A
      placement:
        region: us-east
        zone: us-east-a
    - id: app-2
      type: vm
      name: App B
      placement:
        region: us-east
        zone: us-east-b
    - id: app-3
      type: vm
      name: App C
      placement:
        region: us-east
        zone: us-east-c
`;
    const result = parse(yaml, previous);
    expect(result.errors).toEqual([]);

    const preserved = result.topology?.nodes.find((node) => node.id === 'app-1');
    expect(preserved?.x).toBe(500);
    expect(preserved?.y).toBe(220);

    const newNodes = result.topology?.nodes.filter((node) => node.id === 'app-2' || node.id === 'app-3') ?? [];
    expect(newNodes).toHaveLength(2);
    for (const node of newNodes) {
      expect(node.x).toBeGreaterThanOrEqual(120);
      expect(node.x).toBeLessThanOrEqual(1100);
      expect(node.y).toBeGreaterThanOrEqual(80);
      expect(node.y).toBeLessThanOrEqual(620);
    }
    expect(newNodes[0].x).not.toBe(newNodes[1].x);
  });

  it('does not auto-place when the parse has errors', () => {
    const result = parse(`
apiVersion: seriesofsystems/v1
kind: Topology
spec:
  components:
    - id: lb
      type: nope
`);
    expect(result.topology).toBeUndefined();
    expect(result.errors.join(' ')).toMatch(/unknown type "nope"/);
  });
});

describe('yamlDiffSummary', () => {
  it('reports added, removed, and changed pieces', () => {
    const previous = baseTopology();
    const next = baseTopology();
    next.nodes = next.nodes.map((node) =>
      node.id === 'app-1'
        ? { ...node, name: 'App A (renamed)', config: { ...node.config, replicas: 2 } }
        : node,
    );
    next.nodes.push({
      id: 'cache',
      kind: 'cache',
      name: 'Session cache',
      cloudId: 'cumulus',
      regionId: 'us-east',
      zoneId: 'us-east-b',
      config: { sizeGb: 8, ttlSeconds: 60, eviction: 'lru', stampedeProtection: true },
      x: 900,
      y: 400,
    });
    next.links = [...next.links.filter((link) => link.id !== 'l3'), { id: 'l4', from: 'lb', to: 'cache' }];

    const diff = yamlDiffSummary(previous, next).join('\n');
    expect(diff).toMatch(/\+ cache "Session cache" \(cache\)/);
    expect(diff).toMatch(/~ app-1: name "App A" -> "App A \(renamed\)"/);
    expect(diff).toMatch(/~ app-1: replicas 1 -> 2/);
    expect(diff).toMatch(/\+ link lb -> cache/);
    expect(diff).toMatch(/- link app-1 -> db/);
  });

  it('is empty for identical topologies', () => {
    expect(yamlDiffSummary(baseTopology(), baseTopology())).toEqual([]);
  });
});
