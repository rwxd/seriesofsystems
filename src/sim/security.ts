/**
 * Security posture analysis for a topology.
 *
 * Pure TypeScript: no React, no DOM, no randomness. The score and findings are
 * advisory — the simulation does not read them; the inspector, dashboard and
 * postmortem use them to explain what an incident exposed.
 */

import { cfgBool, cfgNumber, cfgString } from './config';
import type { ID, Topology, TopologyNode } from './types';

export type SecuritySeverity = 'critical' | 'warning' | 'info';

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  action: string;
  nodeId?: ID;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodesOfKind(topology: Topology, kind: TopologyNode['kind']): TopologyNode[] {
  return topology.nodes.filter((node) => node.kind === kind);
}

function isLinked(topology: Topology, node: TopologyNode): boolean {
  return (
    topology.links.some((link) => link.to === node.id) &&
    topology.links.some((link) => link.from === node.id)
  );
}

function connectedWaf(topology: Topology): TopologyNode | undefined {
  return nodesOfKind(topology, 'waf').find((node) => isLinked(topology, node));
}

function edgeNodes(topology: Topology): TopologyNode[] {
  return topology.nodes.filter((node) => node.kind === 'lb' || node.kind === 'cdn');
}

function computeNodes(topology: Topology): TopologyNode[] {
  return topology.nodes.filter((node) => node.kind === 'vm' || node.kind === 'k8s');
}

function secretsLabel(secrets: string): string {
  if (secrets === 'vault') return 'a secrets manager';
  if (secrets === 'plain') return 'plain config files';
  return 'environment variables';
}

/**
 * Score 0-100. Higher is better. The penalty weights mirror the severity of the
 * corresponding findings so the two views never disagree about priorities.
 */
export function computeSecurityScore(topology: Topology): number {
  if (topology.nodes.length === 0) return 0;

  let score = 100;

  // --- Edge protection ---------------------------------------------------
  const waf = connectedWaf(topology);
  if (!waf) {
    score -= 18;
  } else {
    if (cfgString(waf, 'mode', 'block') !== 'block') score -= 9;
    if (cfgNumber(waf, 'rateLimitRps', 0) <= 0) score -= 4;
    if (!cfgBool(waf, 'botProtection', true)) score -= 3;
  }

  // --- TLS ---------------------------------------------------------------
  const edges = edgeNodes(topology);
  for (const node of edges) {
    if (!cfgBool(node, 'tls', true)) score -= 10;
    if (!cfgBool(node, 'tlsAutoRenew', false)) score -= 5;
  }
  if (edges.length === 0) score -= 5;

  // --- Data tier ---------------------------------------------------------
  for (const node of topology.nodes) {
    if (node.kind === 'db') {
      if (!cfgBool(node, 'encryption', false)) score -= 8;
      if (!cfgBool(node, 'backups', false)) score -= 10;
      if (cfgBool(node, 'publicAccess', false)) score -= 20;
    } else if (node.kind === 'storage') {
      if (!cfgBool(node, 'encryption', false)) score -= 5;
      if (cfgBool(node, 'publicAccess', false)) score -= 18;
    } else if (node.kind === 'vm' || node.kind === 'k8s') {
      const patching = cfgString(node, 'patching', 'manual');
      if (patching === 'never') score -= 10;
      else if (patching !== 'auto') score -= 5;

      const secrets = cfgString(node, 'secrets', 'env');
      if (secrets === 'plain') score -= 14;
      else if (secrets !== 'vault') score -= 4;
    }
  }

  // --- Edge rate limiting ------------------------------------------------
  const proxies = nodesOfKind(topology, 'proxy');
  const wafLimit = waf ? cfgNumber(waf, 'rateLimitRps', 0) > 0 : false;
  const proxyLimit = proxies.some((node) => cfgNumber(node, 'rateLimitRps', 0) > 0);
  if (!wafLimit && !proxyLimit) score -= proxies.length > 0 ? 6 : 3;

  return Math.round(clamp(score, 0, 100));
}

/**
 * Concrete, actionable findings, most severe first within each tier. The IDs are
 * stable so the UI can key lists without remounting rows.
 */
export function securityFindings(topology: Topology): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const waf = connectedWaf(topology);
  const isolatedWaf = nodesOfKind(topology, 'waf').find((node) => !isLinked(topology, node));

  // --- Edge protection ---------------------------------------------------
  if (!waf) {
    if (isolatedWaf) {
      findings.push({
        id: `waf-isolated:${isolatedWaf.id}`,
        severity: 'critical',
        title: `${isolatedWaf.name} is not in the request path`,
        detail: 'The WAF exists, but traffic never reaches it, so it protects nothing.',
        action: 'Wire the CDN or load balancer through the WAF, then to the origin.',
        nodeId: isolatedWaf.id,
      });
    } else {
      findings.push({
        id: 'waf-missing',
        severity: 'warning',
        title: 'No WAF at the edge',
        detail: 'DDoS floods and credential stuffing reach your origin unfiltered.',
        action: 'Add a WAF in block mode in front of the CDN or load balancer.',
      });
    }
  } else {
    if (cfgString(waf, 'mode', 'block') !== 'block') {
      findings.push({
        id: 'waf-monitor',
        severity: 'warning',
        title: 'WAF is only watching',
        detail: 'Monitor mode logs attacks and then forwards them to your origin anyway.',
        action: 'Switch the WAF to block mode once the ruleset is tuned.',
        nodeId: waf.id,
      });
    }
    if (cfgNumber(waf, 'rateLimitRps', 0) <= 0) {
      findings.push({
        id: 'waf-rate-limit',
        severity: 'info',
        title: 'No edge rate limit',
        detail: 'The WAF can filter known attacks, but a plain flood still reaches your origin.',
        action: 'Set an edge rate limit close to your normal peak traffic.',
        nodeId: waf.id,
      });
    }
    if (!cfgBool(waf, 'botProtection', true)) {
      findings.push({
        id: 'waf-bot-protection',
        severity: 'info',
        title: 'Bot protection disabled',
        detail: 'Automated traffic is unchallenged, which makes credential stuffing cheaper.',
        action: 'Enable bot protection on the WAF.',
        nodeId: waf.id,
      });
    }
  }

  // --- TLS ---------------------------------------------------------------
  const edges = edgeNodes(topology);
  if (edges.length === 0 && topology.nodes.length > 0) {
    findings.push({
      id: 'tls-no-terminator',
      severity: 'info',
      title: 'No TLS terminator',
      detail: 'There is no load balancer or CDN to terminate TLS, so certificates are out of your hands.',
      action: 'Put a load balancer or CDN in front of the app.',
    });
  }
  for (const node of edges) {
    if (!cfgBool(node, 'tls', true)) {
      findings.push({
        id: `tls-off:${node.id}`,
        severity: 'critical',
        title: `TLS is off on ${node.name}`,
        detail: 'External traffic is served in the clear and browsers will warn every visitor.',
        action: 'Enable TLS termination and serve HTTPS only.',
        nodeId: node.id,
      });
    }
    if (!cfgBool(node, 'tlsAutoRenew', false)) {
      findings.push({
        id: `cert-renew:${node.id}`,
        severity: 'warning',
        title: `Certificate auto-renew is off on ${node.name}`,
        detail: 'A cert-expiry incident will take external traffic down until someone renews it by hand.',
        action: 'Enable automatic certificate renewal.',
        nodeId: node.id,
      });
    }
  }

  // --- Data stores -------------------------------------------------------
  for (const node of topology.nodes) {
    if (node.kind === 'db') {
      if (!cfgBool(node, 'encryption', false)) {
        findings.push({
          id: `db-encryption:${node.id}`,
          severity: 'warning',
          title: `${node.name} is not encrypted at rest`,
          detail: 'Anyone with a disk, a snapshot, or a leaked backup can read production data.',
          action: 'Turn on encryption at rest.',
          nodeId: node.id,
        });
      }
      if (!cfgBool(node, 'backups', false)) {
        findings.push({
          id: `db-backups:${node.id}`,
          severity: 'warning',
          title: `${node.name} has no automated backups`,
          detail: 'A corrupted write or a disk incident becomes unrecoverable.',
          action: 'Enable automated point-in-time backups.',
          nodeId: node.id,
        });
      }
      if (cfgBool(node, 'publicAccess', false)) {
        findings.push({
          id: `db-public:${node.id}`,
          severity: 'critical',
          title: `${node.name} is publicly reachable`,
          detail: 'A leaked credential from anywhere on the internet reads production data.',
          action: 'Put the database in a private subnet and close public access.',
          nodeId: node.id,
        });
      }
    } else if (node.kind === 'storage') {
      if (!cfgBool(node, 'encryption', false)) {
        findings.push({
          id: `storage-encryption:${node.id}`,
          severity: 'warning',
          title: `${node.name} is not encrypted at rest`,
          detail: 'Objects and snapshots are readable by anyone who gets the underlying disk.',
          action: 'Turn on encryption at rest for the bucket.',
          nodeId: node.id,
        });
      }
      if (cfgBool(node, 'publicAccess', false)) {
        findings.push({
          id: `storage-public:${node.id}`,
          severity: 'critical',
          title: `${node.name} is a public bucket`,
          detail: 'Anyone with the URL can read it, which is how backups end up on the news.',
          action: 'Block public access and serve assets through the CDN.',
          nodeId: node.id,
        });
      }
    }
  }

  // --- Compute hygiene ---------------------------------------------------
  for (const node of computeNodes(topology)) {
    const patching = cfgString(node, 'patching', 'manual');
    if (patching === 'never') {
      findings.push({
        id: `patching-never:${node.id}`,
        severity: 'critical',
        title: `${node.name} never patches`,
        detail: 'A known vulnerability stays exploitable for the life of the host.',
        action: 'Move to automatic patching, or at least a weekly manual window.',
        nodeId: node.id,
      });
    } else if (patching !== 'auto') {
      findings.push({
        id: `patching-manual:${node.id}`,
        severity: 'warning',
        title: `${node.name} patches manually`,
        detail: 'A vulnerability incident takes it out of rotation until someone rolls the patch.',
        action: 'Enable automatic patching so advisories do not become outages.',
        nodeId: node.id,
      });
    }

    const secrets = cfgString(node, 'secrets', 'env');
    if (secrets === 'plain') {
      findings.push({
        id: `secrets-plain:${node.id}`,
        severity: 'critical',
        title: `${node.name} keeps plain secrets`,
        detail: 'A credential leak reads them straight off the host and becomes a data breach.',
        action: 'Move secrets into a managed secrets manager.',
        nodeId: node.id,
      });
    } else if (secrets !== 'vault') {
      findings.push({
        id: `secrets-env:${node.id}`,
        severity: 'info',
        title: `${node.name} keeps secrets in ${secretsLabel(secrets)}`,
        detail: 'Environment variables are easy to leak through logs, crash dumps, and child processes.',
        action: 'Move secrets into a managed secrets manager.',
        nodeId: node.id,
      });
    }
  }

  // --- Rate limiting -----------------------------------------------------
  const proxies = nodesOfKind(topology, 'proxy');
  const wafLimit = waf ? cfgNumber(waf, 'rateLimitRps', 0) > 0 : false;
  for (const node of proxies) {
    if (cfgNumber(node, 'rateLimitRps', 0) > 0 || wafLimit) continue;
    findings.push({
      id: `rate-limit:${node.id}`,
      severity: 'warning',
      title: `${node.name} has no rate limit`,
      detail: 'A flood or a retry storm reaches the app tier unchecked.',
      action: 'Set a rate limit close to your normal peak traffic.',
      nodeId: node.id,
    });
  }

  return findings;
}
