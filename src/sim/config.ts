import type { ConfigValue, NodeConfig, TopologyNode } from './types';

export function cfgValue(node: TopologyNode, key: string): ConfigValue | undefined {
  return node.config[key];
}

export function cfgNumber(node: TopologyNode, key: string, fallback = 0): number {
  const value = node.config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function cfgString(node: TopologyNode, key: string, fallback = ''): string {
  const value = node.config[key];
  return typeof value === 'string' ? value : fallback;
}

export function cfgBool(node: TopologyNode, key: string, fallback = false): boolean {
  const value = node.config[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function withConfig(node: TopologyNode, patch: NodeConfig): TopologyNode {
  return { ...node, config: { ...node.config, ...patch } };
}
