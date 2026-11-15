import type { CloudDef, RegionDef, TopologyNode, World } from '../sim/types';

/**
 * The one world the campaign plays in. Regions are pinned to clouds; levels
 * expose a subset of these regions with `worldSubset`.
 */

export const CLOUD_COLORS: Record<string, string> = {
  cumulus: '#7fb8d4',
  stratus: '#9fc9a8',
  nimbus: '#e0b05c',
};

const CLOUDS: CloudDef[] = [
  {
    id: 'cumulus',
    name: 'Cumulus Cloud',
    color: CLOUD_COLORS.cumulus,
    blurb: 'The default cloud. Three zones per region, a status page that is mostly green, and a bill you learn to stop reading.',
  },
  {
    id: 'stratus',
    name: 'Stratus',
    color: CLOUD_COLORS.stratus,
    blurb: 'Cheaper egress, older hardware, and an account manager who says "regional" a lot. The us-west region is here.',
  },
  {
    id: 'nimbus',
    name: 'Nimbus',
    color: CLOUD_COLORS.nimbus,
    blurb: 'The plucky third cloud. Great latency to APAC, slightly experimental control plane, excellent conference swag.',
  },
];

const REGIONS: RegionDef[] = [
  {
    id: 'us-east',
    name: 'US East (Ashburn)',
    shortName: 'us-east',
    cloudId: 'cumulus',
    zones: [
      { id: 'us-east-a', name: 'us-east-a', shortName: 'A' },
      { id: 'us-east-b', name: 'us-east-b', shortName: 'B' },
      { id: 'us-east-c', name: 'us-east-c', shortName: 'C' },
    ],
    x: 250,
    y: 190,
  },
  {
    id: 'eu-west',
    name: 'EU West (Dublin)',
    shortName: 'eu-west',
    cloudId: 'cumulus',
    zones: [
      { id: 'eu-west-a', name: 'eu-west-a', shortName: 'A' },
      { id: 'eu-west-b', name: 'eu-west-b', shortName: 'B' },
    ],
    x: 640,
    y: 120,
  },
  {
    id: 'us-west',
    name: 'US West (The Dalles)',
    shortName: 'us-west',
    cloudId: 'stratus',
    zones: [
      { id: 'us-west-a', name: 'us-west-a', shortName: 'A' },
      { id: 'us-west-b', name: 'us-west-b', shortName: 'B' },
    ],
    x: 180,
    y: 540,
  },
  {
    id: 'ap-south',
    name: 'AP South (Mumbai)',
    shortName: 'ap-south',
    cloudId: 'nimbus',
    zones: [
      { id: 'ap-south-a', name: 'ap-south-a', shortName: 'A' },
      { id: 'ap-south-b', name: 'ap-south-b', shortName: 'B' },
    ],
    x: 930,
    y: 480,
  },
];

export const CAMPAIGN_WORLD: World = {
  clouds: CLOUDS,
  regions: REGIONS,
  latency: {
    sameZone: 1,
    crossZone: 2,
    crossRegion: 45,
    crossCloud: 70,
  },
};

export function regionById(world: World, id: string): RegionDef | undefined {
  return world.regions.find((region) => region.id === id);
}

export function zoneById(world: World, regionId: string, zoneId: string) {
  return regionById(world, regionId)?.zones.find((zone) => zone.id === zoneId);
}

/** Short human label for where a node lives. Globals read "Global". */
export function placementLabel(node: TopologyNode): string {
  if (!node.regionId) return 'Global';
  if (!node.zoneId) return node.cloudId ? `${node.cloudId} · ${node.regionId}` : node.regionId;
  return node.cloudId ? `${node.cloudId} · ${node.regionId} · ${node.zoneId}` : `${node.regionId} · ${node.zoneId}`;
}

/** Same clouds and latency table, only the requested regions, in world order. */
export function worldSubset(regionIds: string[]): World {
  const keep = new Set(regionIds);
  const regions = CAMPAIGN_WORLD.regions.filter((region) => keep.has(region.id));
  return {
    clouds: CAMPAIGN_WORLD.clouds.map((cloud) => ({ ...cloud })),
    regions: regions.map((region) => ({ ...region, zones: region.zones.map((zone) => ({ ...zone })) })),
    latency: { ...CAMPAIGN_WORLD.latency },
  };
}
