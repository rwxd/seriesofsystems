/**
 * Infrastructure-as-code view for Series of Systems.
 *
 * `topologyToYaml` renders a topology as a small, human-readable manifest.
 * `parseTopologyYaml` turns that manifest back into a `Topology`, validating it
 * against the world and the component catalog. Both functions are pure: no
 * React, no DOM, no network.
 *
 * The manifest is intentionally narrow:
 *
 *   apiVersion: seriesofsystems/v1
 *   kind: Topology
 *   metadata:
 *     name: production
 *   spec:
 *     components:
 *       - id: dns
 *         type: dns
 *         name: DNS
 *         config: { ... }
 *     links:
 *       - from: lb
 *         to: app-1
 *
 * Positions are a UI concern and are never serialized. The parser keeps the
 * previous x/y for known node IDs and drops new nodes into a grid.
 */

import { parseDocument, stringify } from 'yaml';
import { COMPONENT_ORDER, COMPONENT_SPECS, getSpec } from '../sim/catalog';
import type {
  ComponentKind,
  ComponentSpec,
  ConfigField,
  ConfigValue,
  NodeConfig,
  PlacementScope,
  Topology,
  TopologyLink,
  TopologyNode,
  World,
} from '../sim/types';

export const YAML_API_VERSION = 'seriesofsystems/v1';
export const YAML_KIND = 'Topology';

export interface ParseTopologyResult {
  topology?: Topology;
  errors: string[];
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

function orderedConfig(node: TopologyNode, spec: ComponentSpec): NodeConfig {
  const out: NodeConfig = {};
  for (const field of spec.fields) {
    if (Object.prototype.hasOwnProperty.call(node.config, field.key)) {
      out[field.key] = node.config[field.key];
    }
  }
  // Anything the catalog does not know about (shouldn't happen) goes last, in
  // a stable order, so the output is deterministic no matter what.
  for (const key of Object.keys(node.config).sort()) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = node.config[key];
  }
  return out;
}

function placementFor(node: TopologyNode, spec: ComponentSpec, world: World): Record<string, string> | undefined {
  if (spec.scope === 'global') return undefined;
  const cloudId =
    node.cloudId ?? world.regions.find((region) => region.id === node.regionId)?.cloudId ?? undefined;
  const placement: Record<string, string> = {};
  if (cloudId) placement.cloud = cloudId;
  if (node.regionId) placement.region = node.regionId;
  if (spec.scope === 'zonal' && node.zoneId) placement.zone = node.zoneId;
  return Object.keys(placement).length > 0 ? placement : undefined;
}

/** Render a topology as a compact YAML manifest. */
export function topologyToYaml(topology: Topology, world: World, name = 'production'): string {
  const components = topology.nodes.map((node) => {
    const spec = getSpec(node.kind);
    const component: Record<string, unknown> = {
      id: node.id,
      type: node.kind,
      name: node.name,
    };
    const placement = placementFor(node, spec, world);
    if (placement) component.placement = placement;
    const config = orderedConfig(node, spec);
    if (Object.keys(config).length > 0) component.config = config;
    return component;
  });

  const links = topology.links.map((link) => ({ from: link.from, to: link.to }));

  const manifest = {
    apiVersion: YAML_API_VERSION,
    kind: YAML_KIND,
    metadata: { name },
    spec: { components, links },
  };

  return stringify(manifest, { lineWidth: 0, indent: 2 });
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

function yamlErrorMessage(error: unknown): string {
  const candidate = error as { message?: string; linePos?: Array<{ line: number; col: number }> };
  const message = (candidate.message ?? 'Invalid YAML').replace(/\s*\n\s*/g, ' ');
  const position = candidate.linePos?.[0];
  if (position) return `YAML syntax error at line ${position.line}, column ${position.col}: ${message}`;
  return `YAML syntax error: ${message}`;
}

function knownKinds(): string {
  return COMPONENT_ORDER.join(', ');
}

function isKnownKind(value: unknown): value is ComponentKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COMPONENT_SPECS, value);
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface ParsedComponent {
  id: string;
  kind: ComponentKind;
  name: string;
  cloudId?: string;
  regionId?: string;
  zoneId?: string;
  config: NodeConfig;
}

function parseConfigValue(
  field: ConfigField,
  raw: unknown,
  componentId: string,
  kind: ComponentKind,
  errors: string[],
): ConfigValue | undefined {
  const prefix = `Component "${componentId}" (${kind}):`;

  const fail = (message: string): undefined => {
    errors.push(`${prefix} ${message}`);
    return undefined;
  };

  switch (field.type) {
    case 'number': {
      let numeric: number | undefined;
      if (typeof raw === 'number' && Number.isFinite(raw)) numeric = raw;
      else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        numeric = Number(raw);
      }
      if (numeric === undefined) return fail(`config "${field.key}" must be a number (got ${describeValue(raw)}).`);
      if (field.min !== undefined && numeric < field.min) {
        return fail(`${field.key} must be at least ${field.min} (got ${numeric}).`);
      }
      if (field.max !== undefined && numeric > field.max) {
        return fail(`${field.key} must be at most ${field.max} (got ${numeric}).`);
      }
      return numeric;
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') return fail(`config "${field.key}" must be true or false (got ${describeValue(raw)}).`);
      return raw;
    }
    case 'select': {
      const options = field.options ?? [];
      const match = options.find((option) => String(option.value) === String(raw));
      if (!match) {
        const allowed = options.map((option) => String(option.value)).join(', ');
        return fail(`config "${field.key}" must be one of ${allowed} (got ${describeValue(raw)}).`);
      }
      return match.value;
    }
    case 'text': {
      if (typeof raw !== 'string') return fail(`config "${field.key}" must be text (got ${describeValue(raw)}).`);
      return raw;
    }
    default:
      return fail(`config "${field.key}" has an unsupported field type.`);
  }
}

function parseComponent(
  raw: unknown,
  index: number,
  world: World,
  errors: string[],
): ParsedComponent | undefined {
  const path = `spec.components[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${path}: each component must be a mapping.`);
    return undefined;
  }

  const id = raw.id;
  if (typeof id !== 'string' || id.trim() === '') {
    errors.push(`${path}: "id" is required and must be a non-empty string.`);
    return undefined;
  }
  if (!ID_PATTERN.test(id)) {
    errors.push(`${path}: id "${id}" may only contain letters, numbers, dashes, underscores, and dots.`);
  }

  if (!isKnownKind(raw.type)) {
    errors.push(
      `${path}: component "${id}" has unknown type ${describeValue(raw.type)}. Known types: ${knownKinds()}.`,
    );
    return undefined;
  }
  const kind = raw.type;
  const spec = getSpec(kind);

  let name = id;
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      errors.push(`${path}: component "${id}" name must be a non-empty string.`);
    } else {
      name = raw.name;
    }
  }

  // Placement -------------------------------------------------------------
  const placementRaw = raw.placement;
  const placement: UnknownRecord = {};
  if (placementRaw !== undefined) {
    if (!isRecord(placementRaw)) {
      errors.push(`${path}: component "${id}" placement must be a mapping.`);
    } else {
      for (const key of Object.keys(placementRaw)) {
        if (key !== 'cloud' && key !== 'region' && key !== 'zone') {
          errors.push(`${path}: component "${id}" has unknown placement key "${key}". Use cloud, region, zone.`);
          continue;
        }
        const value = placementRaw[key];
        if (value === undefined) continue;
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push(`${path}: component "${id}" placement.${key} must be a non-empty string.`);
          continue;
        }
        placement[key] = value;
      }
    }
  }

  let cloudId: string | undefined;
  let regionId: string | undefined;
  let zoneId: string | undefined;

  if (typeof placement.cloud === 'string') {
    cloudId = placement.cloud;
    if (!world.clouds.some((cloud) => cloud.id === cloudId)) {
      errors.push(
        `${path}: component "${id}" uses unknown cloud "${cloudId}". Known clouds: ${world.clouds
          .map((cloud) => cloud.id)
          .join(', ')}.`,
      );
      cloudId = undefined;
    }
  }

  if (typeof placement.region === 'string') {
    regionId = placement.region;
    const region = world.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      errors.push(
        `${path}: component "${id}" uses unknown region "${regionId}". Known regions: ${world.regions
          .map((candidate) => candidate.id)
          .join(', ')}.`,
      );
      regionId = undefined;
    }
  }

  if (typeof placement.zone === 'string') {
    zoneId = placement.zone;
    const region = world.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      // The region error (or missing region) is reported below.
      zoneId = placement.zone;
    } else if (!region.zones.some((zone) => zone.id === zoneId)) {
      errors.push(
        `${path}: component "${id}" uses unknown zone "${zoneId}" for region "${region.id}". Known zones: ${region.zones
          .map((zone) => zone.id)
          .join(', ')}.`,
      );
      zoneId = undefined;
    }
  }

  const scope: PlacementScope = spec.scope;

  if (scope === 'global') {
    if (placement.region !== undefined || placement.zone !== undefined) {
      errors.push(
        `${path}: component "${id}" is a global ${kind} and cannot be pinned to a region or zone. Remove placement.region/placement.zone.`,
      );
    }
    // Global components carry no placement in the model.
    cloudId = undefined;
    regionId = undefined;
    zoneId = undefined;
  } else {
    if (placement.region === undefined) {
      errors.push(`${path}: component "${id}" is a ${kind}; placement.region is required.`);
    }
    if (scope === 'regional' && placement.zone !== undefined) {
      errors.push(
        `${path}: component "${id}" is a regional ${kind}; placement.zone does not apply. Remove it.`,
      );
      zoneId = undefined;
    }
    if (scope === 'zonal' && placement.zone === undefined) {
      errors.push(`${path}: component "${id}" is a zonal ${kind}; placement.zone is required.`);
    }
  }

  const region = regionId ? world.regions.find((candidate) => candidate.id === regionId) : undefined;
  if (region) {
    if (cloudId && cloudId !== region.cloudId) {
      errors.push(
        `${path}: component "${id}" says cloud "${cloudId}", but region "${region.id}" belongs to cloud "${region.cloudId}".`,
      );
    }
    // Always derive the cloud from the region; it is redundant information.
    cloudId = region.cloudId;
  }

  // Config ----------------------------------------------------------------
  const config: NodeConfig = {};
  if (raw.config !== undefined) {
    if (!isRecord(raw.config)) {
      errors.push(`${path}: component "${id}" config must be a mapping of key/value pairs.`);
    } else {
      for (const [key, value] of Object.entries(raw.config)) {
        const field = spec.fields.find((candidate) => candidate.key === key);
        if (!field) {
          const known = spec.fields.map((candidate) => candidate.key).join(', ');
          errors.push(
            `${path}: component "${id}" has unknown config key "${key}" for type ${kind}. Known keys: ${known}.`,
          );
          continue;
        }
        if (value === undefined) continue;
        const parsed = parseConfigValue(field, value, id, kind, errors);
        if (parsed !== undefined) config[key] = parsed;
      }
    }
  }

  return { id, kind, name, cloudId, regionId, zoneId, config };
}

/** Extra cross-field checks from the catalog that are not placement related. */
const PLACEMENT_MESSAGES = new Set([
  'Choose a region.',
  'Unknown region.',
  'Choose a zone.',
  'Unknown zone for this region.',
  'This component is global and cannot be pinned to a region or zone.',
]);

function catalogErrors(node: TopologyNode, topology: Topology, world: World): string[] {
  const spec = getSpec(node.kind);
  if (!spec.validate) return [];
  return spec.validate(node, topology, world).filter((message) => !PLACEMENT_MESSAGES.has(message));
}

const GRID = {
  originX: 120,
  originY: 80,
  stepX: 176,
  stepY: 108,
  columns: 6,
  maxX: 1100,
  maxY: 620,
} as const;

function autoPosition(index: number): { x: number; y: number } {
  const column = index % GRID.columns;
  const row = Math.floor(index / GRID.columns);
  return {
    x: Math.min(GRID.maxX, GRID.originX + column * GRID.stepX),
    y: Math.min(GRID.maxY, GRID.originY + row * GRID.stepY),
  };
}

function uniqueLinkId(from: string, to: string, taken: Set<string>): string {
  const base = `link-${from}-${to}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Parse and validate a YAML manifest.
 *
 * Returns `topology` only when `errors` is empty. Config keys that the catalog
 * does not know about are errors rather than silently dropped values.
 */
export function parseTopologyYaml(text: string, world: World, previous: Topology): ParseTopologyResult {
  const errors: string[] = [];

  let document;
  try {
    document = parseDocument(text, { uniqueKeys: true });
  } catch (error) {
    return { errors: [yamlErrorMessage(error)] };
  }

  for (const error of document.errors) errors.push(yamlErrorMessage(error));
  if (errors.length > 0) return { errors };

  let data: unknown;
  try {
    data = document.toJS();
  } catch (error) {
    return { errors: [yamlErrorMessage(error)] };
  }

  if (data === null || data === undefined) {
    return { errors: ['The manifest is empty. Add apiVersion, kind, and spec.components.'] };
  }
  if (!isRecord(data)) {
    return { errors: ['The manifest must be a mapping with apiVersion, kind, and spec.'] };
  }

  if (data.apiVersion !== YAML_API_VERSION) {
    errors.push(
      data.apiVersion === undefined
        ? `apiVersion is required. Use "${YAML_API_VERSION}".`
        : `Unsupported apiVersion ${describeValue(data.apiVersion)}. Use "${YAML_API_VERSION}".`,
    );
  }
  if (data.kind !== YAML_KIND) {
    errors.push(
      data.kind === undefined
        ? `kind is required. Use "${YAML_KIND}".`
        : `Unsupported kind ${describeValue(data.kind)}. Use "${YAML_KIND}".`,
    );
  }

  if (data.metadata !== undefined) {
    if (!isRecord(data.metadata)) {
      errors.push('metadata must be a mapping.');
    } else if (data.metadata.name !== undefined && typeof data.metadata.name !== 'string') {
      errors.push('metadata.name must be a string.');
    }
  }

  const spec = data.spec;
  if (!isRecord(spec)) {
    errors.push('spec is required and must be a mapping with components and links.');
    return { errors };
  }

  const componentsRaw = spec.components;
  if (!Array.isArray(componentsRaw)) {
    errors.push('spec.components is required and must be a list.');
    return { errors };
  }
  if (componentsRaw.length === 0) {
    errors.push('spec.components must contain at least one component.');
  }

  const parsed: ParsedComponent[] = [];
  const seenIds = new Set<string>();
  componentsRaw.forEach((raw, index) => {
    const component = parseComponent(raw, index, world, errors);
    if (!component) return;
    if (seenIds.has(component.id)) {
      errors.push(`spec.components[${index}]: duplicate component id "${component.id}".`);
      return;
    }
    seenIds.add(component.id);
    parsed.push(component);
  });

  // Links -----------------------------------------------------------------
  const linkPairs: Array<{ from: string; to: string; id?: string }> = [];
  if (spec.links !== undefined) {
    if (!Array.isArray(spec.links)) {
      errors.push('spec.links must be a list.');
    } else {
      const seenPairs = new Set<string>();
      spec.links.forEach((raw, index) => {
        const path = `spec.links[${index}]`;
        if (!isRecord(raw)) {
          errors.push(`${path}: each link must be a mapping with from and to.`);
          return;
        }
        for (const key of Object.keys(raw)) {
          if (key !== 'from' && key !== 'to' && key !== 'id') {
            errors.push(`${path}: unknown link key "${key}". Links support from, to, and optional id.`);
          }
        }
        const from = raw.from;
        const to = raw.to;
        if (typeof from !== 'string' || from.trim() === '') {
          errors.push(`${path}: "from" is required and must be a component id.`);
          return;
        }
        if (typeof to !== 'string' || to.trim() === '') {
          errors.push(`${path}: "to" is required and must be a component id.`);
          return;
        }
        if (!seenIds.has(from)) {
          errors.push(`${path}: "from" references unknown component "${from}".`);
        }
        if (!seenIds.has(to)) {
          errors.push(`${path}: "to" references unknown component "${to}".`);
        }
        if (from === to) {
          errors.push(`${path}: a component cannot link to itself ("${from}").`);
        }
        const pairKey = `${from} -> ${to}`;
        if (seenPairs.has(pairKey)) {
          errors.push(`${path}: duplicate link from "${from}" to "${to}".`);
          return;
        }
        seenPairs.add(pairKey);
        const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id : undefined;
        linkPairs.push({ from, to, id });
      });
    }
  }

  if (errors.length > 0) return { errors };

  // Build nodes, preserving positions from the previous topology ----------
  const previousPositions = new Map(previous.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  let autoIndex = 0;
  const nodes: TopologyNode[] = parsed.map((component) => {
    const position = previousPositions.get(component.id) ?? autoPosition(autoIndex++);
    const node: TopologyNode = {
      id: component.id,
      kind: component.kind,
      name: component.name,
      config: component.config,
      x: position.x,
      y: position.y,
    };
    if (component.cloudId) node.cloudId = component.cloudId;
    if (component.regionId) node.regionId = component.regionId;
    if (component.zoneId) node.zoneId = component.zoneId;
    return node;
  });

  const nodeIds = new Set(nodes.map((node) => node.id));

  // Catalog cross-checks (HPA bounds, replica caps, ...). Placement messages
  // were already reported with better paths, so they are filtered out.
  const topology: Topology = { nodes, links: [] };
  for (const node of nodes) {
    for (const message of catalogErrors(node, topology, world)) {
      errors.push(`Component "${node.id}": ${message}`);
    }
  }

  const previousLinkIds = new Map(previous.links.map((link) => [`${link.from} -> ${link.to}`, link.id]));
  const takenLinkIds = new Set<string>();
  const links: TopologyLink[] = [];
  for (const pair of linkPairs) {
    if (!nodeIds.has(pair.from) || !nodeIds.has(pair.to)) continue;
    const key = `${pair.from} -> ${pair.to}`;
    const preferred = pair.id ?? previousLinkIds.get(key);
    let id: string;
    if (preferred && !takenLinkIds.has(preferred)) id = preferred;
    else id = uniqueLinkId(pair.from, pair.to, takenLinkIds);
    takenLinkIds.add(id);
    links.push({ id, from: pair.from, to: pair.to });
  }

  if (errors.length > 0) return { errors };

  return { topology: { nodes, links }, errors: [] };
}

/* -------------------------------------------------------------------------- */
/* Diff summary (optional helper for the IaC drawer)                           */
/* -------------------------------------------------------------------------- */

function placementLabel(node: TopologyNode): string {
  return [node.cloudId, node.regionId, node.zoneId].filter(Boolean).join('/') || 'global';
}

/** Human-readable list of changes between two topologies. Empty when equal. */
export function yamlDiffSummary(previous: Topology, next: Topology): string[] {
  const lines: string[] = [];
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));

  for (const node of next.nodes) {
    if (!previousNodes.has(node.id)) lines.push(`+ ${node.kind} "${node.name}" (${node.id})`);
  }
  for (const node of previous.nodes) {
    if (!nextNodes.has(node.id)) lines.push(`- ${node.kind} "${node.name}" (${node.id})`);
  }

  for (const node of next.nodes) {
    const before = previousNodes.get(node.id);
    if (!before) continue;
    if (before.name !== node.name) lines.push(`~ ${node.id}: name "${before.name}" -> "${node.name}"`);
    if (placementLabel(before) !== placementLabel(node)) {
      lines.push(`~ ${node.id}: placement ${placementLabel(before)} -> ${placementLabel(node)}`);
    }
    const keys = new Set([...Object.keys(before.config), ...Object.keys(node.config)]);
    for (const key of [...keys].sort()) {
      const from = before.config[key];
      const to = node.config[key];
      if (from === to) continue;
      if (from === undefined) lines.push(`~ ${node.id}: ${key} set to ${String(to)}`);
      else if (to === undefined) lines.push(`~ ${node.id}: ${key} removed`);
      else lines.push(`~ ${node.id}: ${key} ${String(from)} -> ${String(to)}`);
    }
  }

  const pair = (link: TopologyLink) => `${link.from} -> ${link.to}`;
  const previousLinks = new Set(previous.links.map(pair));
  const nextLinks = new Set(next.links.map(pair));
  for (const link of next.links) {
    if (!previousLinks.has(pair(link))) lines.push(`+ link ${pair(link)}`);
  }
  for (const link of previous.links) {
    if (!nextLinks.has(pair(link))) lines.push(`- link ${pair(link)}`);
  }

  return lines;
}
