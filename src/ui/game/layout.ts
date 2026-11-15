import type { ComponentKind, PlacementScope, Topology, TopologyNode, World } from '@/sim/types';

export const NODE_W = 178;
export const NODE_H = 86;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Container extends Box {
  id: string;
  kind: 'cloud' | 'region' | 'zone';
  label: string;
  sub?: string;
  color: string;
  count: number;
}

export interface Placement {
  cloudId?: string;
  regionId?: string;
  zoneId?: string;
}

export function nodeBox(node: TopologyNode): Box {
  return { x: node.x, y: node.y, w: NODE_W, h: NODE_H };
}

function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const box of boxes) {
    x1 = Math.min(x1, box.x);
    y1 = Math.min(y1, box.y);
    x2 = Math.max(x2, box.x + box.w);
    y2 = Math.max(y2, box.y + box.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function pad(box: Box, side: number, top: number, bottom = side): Box {
  return {
    x: box.x - side,
    y: box.y - top,
    w: box.w + side * 2,
    h: box.h + top + bottom,
  };
}

/**
 * Containers are derived from the world definition plus where nodes actually
 * sit, so moving a node visibly moves its zone. Empty zones are not drawn.
 */
export function computeContainers(topology: Topology, world: World): Container[] {
  const containers: Container[] = [];
  const nodesByZone = new Map<string, TopologyNode[]>();
  const nodesByRegion = new Map<string, TopologyNode[]>();

  for (const node of topology.nodes) {
    if (node.regionId) {
      const bucket = nodesByRegion.get(node.regionId) ?? [];
      bucket.push(node);
      nodesByRegion.set(node.regionId, bucket);
      if (node.zoneId) {
        const zoneBucket = nodesByZone.get(`${node.regionId}/${node.zoneId}`) ?? [];
        zoneBucket.push(node);
        nodesByZone.set(`${node.regionId}/${node.zoneId}`, zoneBucket);
      }
    }
  }

  const zoneBoxes = new Map<string, Box>();
  for (const region of world.regions) {
    const cloud = world.clouds.find((candidate) => candidate.id === region.cloudId);
    const color = cloud?.color ?? '#5cb8ea';
    for (const zone of region.zones) {
      const key = `${region.id}/${zone.id}`;
      const members = nodesByZone.get(key) ?? [];
      if (members.length === 0) continue;
      const box = pad(union(members.map(nodeBox))!, 16, 38, 18);
      zoneBoxes.set(key, box);
      containers.push({
        id: zone.id,
        kind: 'zone',
        label: zone.name || zone.shortName,
        sub: `${members.length} node${members.length === 1 ? '' : 's'}`,
        color,
        count: members.length,
        ...box,
      });
    }
  }

  const regionBoxes = new Map<string, Box>();
  for (const region of world.regions) {
    const members = nodesByRegion.get(region.id) ?? [];
    if (members.length === 0) continue;
    const boxes: Box[] = [];
    for (const zone of region.zones) {
      const zoneBox = zoneBoxes.get(`${region.id}/${zone.id}`);
      if (zoneBox) boxes.push(zoneBox);
    }
    for (const node of members) {
      if (!node.zoneId) boxes.push(nodeBox(node));
    }
    if (boxes.length === 0) continue;
    const box = pad(union(boxes)!, 24, 50, 26);
    regionBoxes.set(region.id, box);
    const cloud = world.clouds.find((candidate) => candidate.id === region.cloudId);
    containers.push({
      id: region.id,
      kind: 'region',
      label: region.name || region.shortName,
      sub: cloud?.name,
      color: cloud?.color ?? '#5cb8ea',
      count: members.length,
      ...box,
    });
  }

  for (const cloud of world.clouds) {
    const regions = world.regions.filter((region) => region.cloudId === cloud.id);
    const boxes: Box[] = [];
    for (const region of regions) {
      const box = regionBoxes.get(region.id);
      if (box) boxes.push(box);
    }
    if (boxes.length === 0) continue;
    const box = pad(union(boxes)!, 34, 62, 34);
    containers.push({
      id: cloud.id,
      kind: 'cloud',
      label: cloud.name,
      color: cloud.color,
      count: topology.nodes.filter((node) => regions.some((region) => region.id === node.regionId)).length,
      ...box,
    });
  }

  const depth: Record<Container['kind'], number> = { cloud: 0, region: 1, zone: 2 };
  return containers.sort((a, b) => depth[a.kind] - depth[b.kind]);
}

export function sceneBounds(topology: Topology, containers: Container[]): Box | null {
  const boxes: Box[] = topology.nodes.map(nodeBox);
  if (containers.length > 0) {
    // Cloud containers already include regions and zones.
    const clouds = containers.filter((container) => container.kind === 'cloud');
    boxes.push(...(clouds.length > 0 ? clouds : containers.filter((container) => container.kind === 'region')));
  }
  return union(boxes);
}

export function latencyBetween(a: TopologyNode | null, b: TopologyNode | null, world: World): number | null {
  if (!a || !b) return null;
  if (!a.regionId || !b.regionId) return null;
  if (a.regionId === b.regionId) {
    if (a.zoneId && b.zoneId && a.zoneId === b.zoneId) return world.latency.sameZone;
    return world.latency.crossZone;
  }
  if (a.cloudId && b.cloudId && a.cloudId !== b.cloudId) return world.latency.crossCloud;
  const regionA = world.regions.find((region) => region.id === a.regionId);
  const regionB = world.regions.find((region) => region.id === b.regionId);
  if (regionA && regionB && regionA.cloudId !== regionB.cloudId) return world.latency.crossCloud;
  return world.latency.crossRegion;
}

function overlaps(box: Box, other: Box, gap: number): boolean {
  return (
    box.x - gap < other.x + other.w &&
    box.x + box.w + gap > other.x &&
    box.y - gap < other.y + other.h &&
    box.y + box.h + gap > other.y
  );
}

function findSpot(topology: Topology, anchor: { x: number; y: number }): { x: number; y: number } {
  const gap = 20;
  for (let row = 0; row < 14; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const candidate = {
        x: anchor.x + col * (NODE_W + gap),
        y: anchor.y + row * (NODE_H + gap),
        w: NODE_W,
        h: NODE_H,
      };
      const collides = topology.nodes.some((node) => overlaps(candidate, nodeBox(node), 14));
      if (!collides) return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: anchor.x, y: anchor.y + 220 };
}

export interface AutoPlacement {
  placement: Placement;
  x: number;
  y: number;
}

/**
 * Work out a sensible home for a new component: same region/zone as the
 * current selection when possible, otherwise the first region in the world.
 */
export function autoPlacement(
  kind: ComponentKind,
  scope: PlacementScope,
  world: World,
  topology: Topology,
  selected: TopologyNode | null,
): AutoPlacement {
  if (scope === 'global') {
    const bounds = sceneBounds(topology, computeContainers(topology, world));
    const anchor = bounds
      ? { x: bounds.x, y: Math.max(40, bounds.y - NODE_H - 56) }
      : { x: 80, y: 60 };
    const spot = findSpot(topology, anchor);
    return { placement: {}, ...spot };
  }

  const selectedRegion =
    selected?.regionId && world.regions.some((region) => region.id === selected.regionId)
      ? world.regions.find((region) => region.id === selected.regionId)!
      : world.regions[0];

  if (!selectedRegion) {
    const spot = findSpot(topology, { x: 80, y: 80 });
    return { placement: {}, ...spot };
  }

  const containers = computeContainers(topology, world);
  const regionContainer = containers.find(
    (container) => container.kind === 'region' && container.id === selectedRegion.id,
  );

  if (scope === 'regional') {
    const anchor = regionContainer
      ? { x: regionContainer.x, y: regionContainer.y + regionContainer.h + 26 }
      : { x: (selectedRegion.x ?? 80) + 40, y: (selectedRegion.y ?? 120) + 60 };
    const spot = findSpot(topology, anchor);
    return {
      placement: { cloudId: selectedRegion.cloudId, regionId: selectedRegion.id },
      ...spot,
    };
  }

  // Zonal: prefer the selected node's zone, then a zone without compute for
  // HA-shaped components, then the region's first zone.
  let zone =
    (selected?.zoneId && selectedRegion.zones.find((candidate) => candidate.id === selected.zoneId)) ||
    selectedRegion.zones[0];

  if (kind === 'vm' || kind === 'k8s') {
    const used = new Set(
      topology.nodes
        .filter((node) => node.zoneId && (node.kind === 'vm' || node.kind === 'k8s'))
        .map((node) => node.zoneId),
    );
    const free = selectedRegion.zones.find((candidate) => !used.has(candidate.id));
    if (free) zone = free;
  }

  if (!zone) {
    const anchor = regionContainer
      ? { x: regionContainer.x, y: regionContainer.y + regionContainer.h + 26 }
      : { x: (selectedRegion.x ?? 80) + 40, y: (selectedRegion.y ?? 120) + 60 };
    const spot = findSpot(topology, anchor);
    return {
      placement: { cloudId: selectedRegion.cloudId, regionId: selectedRegion.id },
      ...spot,
    };
  }

  const zoneContainer = containers.find(
    (container) => container.kind === 'zone' && container.id === zone.id,
  );
  const zoneIndex = Math.max(0, selectedRegion.zones.findIndex((candidate) => candidate.id === zone.id));
  const computeRow = topology.nodes.find((node) => node.kind === 'vm' || node.kind === 'k8s');
  const rowY = computeRow?.y ?? (regionContainer ? regionContainer.y + 190 : (selectedRegion.y ?? 120) + 220);
  const anchor = zoneContainer
    ? { x: zoneContainer.x + 20, y: zoneContainer.y + zoneContainer.h + 18 }
    : regionContainer
      ? { x: regionContainer.x + 40 + zoneIndex * 220, y: rowY }
      : { x: (selectedRegion.x ?? 80) + 40 + zoneIndex * 220, y: rowY };

  const spot = findSpot(topology, anchor);
  return {
    placement: { cloudId: selectedRegion.cloudId, regionId: selectedRegion.id, zoneId: zone.id },
    ...spot,
  };
}

export function placementLabel(node: TopologyNode, world: World): string {
  if (!node.regionId) return 'Global';
  const region = world.regions.find((candidate) => candidate.id === node.regionId);
  if (!node.zoneId) return region?.name ?? node.regionId;
  const zone = region?.zones.find((candidate) => candidate.id === node.zoneId);
  return `${region?.shortName ?? node.regionId} · ${zone?.shortName ?? node.zoneId}`;
}

/** Smallest region/zone options for the inspector selects. */
export function placementOptions(world: World) {
  return world.regions.map((region) => ({
    region,
    zones: region.zones,
  }));
}
