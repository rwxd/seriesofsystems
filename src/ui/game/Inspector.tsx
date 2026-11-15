import { useEffect, useId, useState } from 'react';
import { useGame } from '@/game/store';
import { COMPONENT_SPECS } from '@/sim/catalog';
import type { ConfigField, TopologyNode, World } from '@/sim/types';
import { Btn, EmptyState, Pill } from '@/ui/components/ui';
import { Icon, iconForKind } from '@/ui/components/Icon';
import { fmtMoney, fmtMs, fmtNum, fmtPct, fmtRps } from '@/ui/lib/format';
import { latencyBetween, placementLabel } from './layout';

const SCOPE_NOTE: Record<string, string> = {
  global: 'Global component — no region or zone. Survives regional failures.',
  regional: 'Regional component. A zone failure should not take it down.',
  zonal: 'Zonal component. A zone failure takes this node with it.',
};

export function Inspector({ world }: { world: World }) {
  const draft = useGame((state) => state.draft);
  const scenario = useGame((state) => state.scenario);
  const snapshot = useGame((state) => state.snapshot);
  const selectedNodeId = useGame((state) => state.selectedNodeId);
  const selectedLinkId = useGame((state) => state.selectedLinkId);
  const storeIssues = useGame((state) => state.issues);
  const selectNode = useGame((state) => state.selectNode);
  const selectLink = useGame((state) => state.selectLink);
  const issueCount = storeIssues.length;

  const topology = draft ?? scenario?.initialTopology ?? null;
  const node = topology?.nodes.find((candidate) => candidate.id === selectedNodeId) ?? null;
  const link = topology?.links.find((candidate) => candidate.id === selectedLinkId) ?? null;
  const open = Boolean(node || link);

  return (
    <aside className={`inspector${open ? ' is-open' : ''}`} aria-label="Inspector">
      <div className="inspector__head">
        <Icon name={node ? 'settings' : link ? 'link' : 'search'} size={14} />
        <h2>{node ? 'Component' : link ? 'Link' : 'Inspector'}</h2>
        {node && <Pill tone="ghost">{COMPONENT_SPECS[node.kind].shortLabel}</Pill>}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm inspector__close"
          onClick={() => {
            selectNode(null);
            selectLink(null);
          }}
          aria-label="Close inspector"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      {node && (
        <NodeInspector
          key={node.id}
          node={node}
          world={world}
          topologyNodes={topology?.nodes ?? []}
          onClose={() => selectNode(null)}
        />
      )}

      {!node && link && (
        <LinkInspector
          key={link.id}
          linkId={link.id}
          fromId={link.from}
          toId={link.to}
          world={world}
          onClose={() => selectLink(null)}
        />
      )}

      {!node && !link && <InspectorEmpty issueCount={issueCount} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

function InspectorEmpty({ issueCount }: { issueCount: number }) {
  const draft = useGame((state) => state.draft);
  const scenario = useGame((state) => state.scenario);
  const togglePanel = useGame((state) => state.togglePanel);
  const topology = draft ?? scenario?.initialTopology ?? null;
  const world = scenario?.world;
  const cost =
    topology && world
      ? topology.nodes.reduce((sum, node) => sum + COMPONENT_SPECS[node.kind].costPerMonth(node, world, 0), 0)
      : 0;

  return (
    <div className="inspector__scroll">
      <div className="inspector__body">
        <EmptyState icon="search" title="Nothing selected">
          <p>Click a node to edit it, or click a link to see its latency and throughput.</p>
        </EmptyState>

        <div className="section">
          <div className="section__title">
            <Icon name="info" size={11} /> Canvas controls
          </div>
          <ul style={{ display: 'grid', gap: 6 }}>
            {[
              ['grip', 'Drag a node to move it. Layout is saved with the topology.'],
              ['link', 'Select a node, then press L or Link to draw a connection.'],
              ['zoom-in', 'Scroll to zoom, drag the background to pan.'],
              ['trash', 'Delete removes the selected node or link.'],
            ].map(([icon, text]) => (
              <li key={text} style={{ display: 'flex', gap: 7, fontSize: 11.5, lineHeight: 1.4 }}>
                <Icon name={icon as 'grip'} size={13} style={{ flex: 'none', marginTop: 1, color: 'var(--ink-soft)' }} />
                <span style={{ color: 'var(--ink-2)' }}>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {topology && (
          <div className="section">
            <div className="section__title">
              <Icon name="server" size={11} /> Topology
            </div>
            <div className="stat-grid">
              <StatCell label="Nodes" value={String(topology.nodes.length)} />
              <StatCell label="Links" value={String(topology.links.length)} />
              <StatCell label="Cost / mo" value={fmtMoney(cost)} />
              <StatCell
                label="Validation"
                value={issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Clean'}
                alert={issueCount > 0}
              />
            </div>
          </div>
        )}

        <Btn variant="outline" size="sm" icon="gauge" block onClick={() => togglePanel('dashboardOpen')}>
          Open metrics
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

function NodeInspector({
  node,
  world,
  topologyNodes,
  onClose,
}: {
  node: TopologyNode;
  world: World;
  topologyNodes: TopologyNode[];
  onClose: () => void;
}) {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const snapshot = useGame((state) => state.snapshot);
  const updateNode = useGame((state) => state.updateNode);
  const updateConfig = useGame((state) => state.updateConfig);
  const deleteNode = useGame((state) => state.deleteNode);
  const beginLink = useGame((state) => state.beginLink);

  const [tab, setTab] = useState<'overview' | 'config'>('overview');
  const [name, setName] = useState(node.name);

  useEffect(() => {
    setName(node.name);
  }, [node.id, node.name]);

  const spec = COMPONENT_SPECS[node.kind];
  const metrics = snapshot?.nodes[node.id];
  const rps = metrics?.rps ?? 0;
  const cost = spec.costPerMonth(node, world, rps);
  const storeIssues = useGame((state) => state.issues);
  const issues = [
    ...new Set([
      ...(spec.validate?.(node, draft ?? { nodes: topologyNodes, links: [] }, world) ?? []),
      ...storeIssues
        .filter((issue) => issue.nodeId === node.id && issue.severity === 'error')
        .map((issue) => issue.message),
    ]),
  ];

  const sections = spec.fields.reduce<Record<string, ConfigField[]>>((groups, field) => {
    const key = field.section ?? 'Configuration';
    groups[key] = groups[key] ?? [];
    groups[key].push(field);
    return groups;
  }, {});

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(node.name);
      return;
    }
    if (trimmed !== node.name) updateNode(node.id, { name: trimmed });
  };

  return (
    <>
      <div className="inspector__scroll">
        <div className="inspector__body">
          <div className="inspector__identity">
            <span className="inspector__icon">
              <Icon name={iconForKind(node.kind)} size={24} />
            </span>
            <div style={{ minWidth: 0 }}>
              <input
                className="inspector__name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setName(node.name);
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Component name"
                spellCheck={false}
              />
              <div className="inspector__sub">
                <StatusPill status={metrics?.status ?? 'healthy'} />
                <span>{spec.label}</span>
                <span>·</span>
                <span>{placementLabel(node, world)}</span>
              </div>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Inspector tabs">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === 'overview'}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === 'config'}
              onClick={() => setTab('config')}
            >
              Config
            </button>
          </div>

          {tab === 'overview' ? (
            <>
              <div className="section">
                <div className="section__title">
                  <Icon name="gauge" size={11} /> Live
                </div>
                <div className="stat-grid">
                  <StatCell label="Throughput" value={`${fmtRps(rps)} rps`} />
                  <StatCell label="p95" value={fmtMs(metrics?.p95 ?? 0)} />
                  <StatCell label="In flight" value={`${fmtNum(metrics?.inFlight ?? 0)} / ${fmtNum(metrics?.capacity ?? 0)}`} />
                  <StatCell label="Queue" value={fmtNum(metrics?.queue ?? 0)} alert={(metrics?.queue ?? 0) > 0} />
                  <StatCell
                    label="Utilization"
                    value={fmtPct(metrics?.utilization ?? 0, 0)}
                    alert={(metrics?.utilization ?? 0) >= 0.9}
                  />
                  <StatCell
                    label="Error rate"
                    value={fmtPct(metrics?.errorRate ?? 0, 1)}
                    alert={(metrics?.errorRate ?? 0) > 0.01}
                  />
                  <StatCell label="Requests" value={fmtNum(metrics?.requests ?? 0)} />
                  <StatCell label="Failures" value={fmtNum(metrics?.failures ?? 0)} alert={(metrics?.failures ?? 0) > 0} />
                </div>
                {metrics?.note && (
                  <p style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                    <Icon name="info" size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
                    {metrics.note}
                  </p>
                )}
                {metrics && metrics.replicasTotal > 1 && (
                  <p style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-soft)' }}>
                    Replicas up: <b className="mono">{metrics.replicasUp}</b> / {metrics.replicasTotal}
                  </p>
                )}
              </div>

              <div className="section">
                <div className="section__title">
                  <Icon name="dollar" size={11} /> Cost
                </div>
                <div className="cost-line">
                  <span>
                    {fmtMoney(cost)} <span className="muted">/ month</span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                    {fmtMoney(spec.baseCostPerMonth)} base
                  </span>
                </div>
              </div>

              <div className="section">
                <div className="section__title">
                  <Icon name="shield" size={11} /> Placement
                </div>
                <PlacementEditor node={node} world={world} updateNode={updateNode} />
                <p style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                  {SCOPE_NOTE[spec.scope]}
                </p>
              </div>

              <div className="section">
                <div className="section__title">
                  <Icon name="warning" size={11} /> Validation
                </div>
                {issues.length === 0 ? (
                  <div className="cost-line" style={{ background: 'var(--mint-soft)', borderColor: '#a7e3cd' }}>
                    <span className="row" style={{ gap: 6, color: '#0a6448' }}>
                      <Icon name="check-circle" size={13} /> No issues found
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 5 }}>
                    {issues.map((issue) => (
                      <div className="issue" key={issue}>
                        <Icon name="alert" size={12} />
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {Object.entries(sections).map(([section, fields]) => (
                <div className="config-section" key={section}>
                  <div className="section__title">{section}</div>
                  <div className="section__grid">
                    {fields.map((field) => (
                      <ConfigControl
                        key={field.key}
                        field={field}
                        value={node.config[field.key]}
                        onChange={(value) => updateConfig(node.id, field.key, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="inspector__foot">
        <Btn size="sm" icon="link" variant="outline" onClick={() => beginLink(node.id)} title="Draw a link from this node">
          Link
        </Btn>
        <Btn
          size="sm"
          icon="trash"
          variant="danger"
          onClick={() => {
            deleteNode(node.id);
            onClose();
          }}
        >
          Delete
        </Btn>
        <span className="spacer" />
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
          {node.id}
        </span>
      </div>
    </>
  );
}

function PlacementEditor({
  node,
  world,
  updateNode,
}: {
  node: TopologyNode;
  world: World;
  updateNode: (id: string, patch: Partial<TopologyNode>) => void;
}) {
  const spec = COMPONENT_SPECS[node.kind];
  if (spec.scope === 'global') {
    return (
      <div className="cost-line">
        <span className="muted">Global — no region required</span>
        <Icon name="dns" size={14} />
      </div>
    );
  }

  const region = world.regions.find((candidate) => candidate.id === node.regionId) ?? world.regions[0];

  return (
    <div className="section__grid section__grid--2">
      <label className="field">
        <span className="field__label">Region</span>
        <select
          className="select"
          value={region?.id ?? ''}
          onChange={(event) => {
            const next = world.regions.find((candidate) => candidate.id === event.target.value);
            if (!next) return;
            updateNode(node.id, {
              cloudId: next.cloudId,
              regionId: next.id,
              zoneId: spec.scope === 'zonal' ? next.zones[0]?.id : undefined,
            });
          }}
        >
          {world.regions.map((candidate) => {
            const cloud = world.clouds.find((entry) => entry.id === candidate.cloudId);
            return (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {cloud?.name ?? candidate.cloudId}
              </option>
            );
          })}
        </select>
      </label>

      {spec.scope === 'zonal' && (
        <label className="field">
          <span className="field__label">Zone</span>
          <select
            className="select"
            value={node.zoneId ?? region?.zones[0]?.id ?? ''}
            onChange={(event) => updateNode(node.id, { zoneId: event.target.value })}
          >
            {(region?.zones ?? []).map((zone) => (
              <option key={zone.id} value={zone.id}>
                Zone {zone.shortName} · {zone.id}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Link                                                                */
/* ------------------------------------------------------------------ */

function LinkInspector({
  linkId,
  fromId,
  toId,
  world,
  onClose,
}: {
  linkId: string;
  fromId: string;
  toId: string;
  world: World;
  onClose: () => void;
}) {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const snapshot = useGame((state) => state.snapshot);
  const deleteLink = useGame((state) => state.deleteLink);
  const selectNode = useGame((state) => state.selectNode);
  const topology = draft ?? scenario?.initialTopology ?? null;
  const from = topology?.nodes.find((node) => node.id === fromId) ?? null;
  const to = topology?.nodes.find((node) => node.id === toId) ?? null;
  const metrics = snapshot?.links[linkId];
  const latency = latencyBetween(from, to, world);

  return (
    <>
      <div className="inspector__scroll">
        <div className="inspector__body">
          <div className="inspector__identity">
            <span className="inspector__icon">
              <Icon name="link" size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>
                {from?.name ?? fromId} → {to?.name ?? toId}
              </div>
              <div className="inspector__sub">
                <Pill tone={metrics?.status === 'down' ? 'red' : metrics?.status === 'degraded' ? 'orange' : 'mint'}>
                  {metrics?.status ?? 'up'}
                </Pill>
                <span className="mono" style={{ fontSize: 10 }}>
                  {linkId}
                </span>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section__title">
              <Icon name="activity" size={11} /> Link telemetry
            </div>
            <div className="stat-grid">
              <StatCell label="Throughput" value={`${fmtRps(metrics?.rps ?? 0)} rps`} />
              <StatCell label="Utilization" value={fmtPct(metrics?.utilization ?? 0, 0)} alert={(metrics?.utilization ?? 0) > 0.85} />
              <StatCell label="Hop latency" value={latency === null ? '—' : fmtMs(latency)} />
              <StatCell label="State" value={metrics?.status ?? 'up'} />
            </div>
            <p style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
              Latency is estimated from placement: same zone, cross-zone, cross-region, or cross-cloud.
              Every hop you add is latency every request pays.
            </p>
          </div>

          <div className="section">
            <div className="section__title">Endpoints</div>
            <div style={{ display: 'grid', gap: 5 }}>
              <button
                type="button"
                className="cost-line"
                onClick={() => from && selectNode(from.id)}
                style={{ textAlign: 'left', width: '100%' }}
              >
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="arrow-right" size={13} /> {from?.name ?? fromId}
                </span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                  source
                </span>
              </button>
              <button
                type="button"
                className="cost-line"
                onClick={() => to && selectNode(to.id)}
                style={{ textAlign: 'left', width: '100%' }}
              >
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="arrow-right" size={13} /> {to?.name ?? toId}
                </span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                  target
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="inspector__foot">
        <Btn
          size="sm"
          icon="trash"
          variant="danger"
          onClick={() => {
            deleteLink(linkId);
            onClose();
          }}
        >
          Delete link
        </Btn>
        <span className="spacer" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Config controls                                                     */
/* ------------------------------------------------------------------ */

function ConfigControl({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (value: string | number | boolean) => void;
}) {
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);

  if (field.type === 'boolean') {
    return (
      <div className="field" style={{ padding: '2px 0' }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span className="field__label" style={{ margin: 0 }}>
            {field.label}
          </span>
          <label className="switch" style={{ flex: 'none' }}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(event) => onChange(event.target.checked)}
              aria-label={field.label}
            />
            <span className="switch__track" aria-hidden="true">
              <span className="switch__knob" />
            </span>
          </label>
        </div>
        {field.help && (
          <button
            type="button"
            className="field__hint"
            onClick={() => setHelpOpen((open) => !open)}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            style={{ textAlign: 'left', display: 'flex', gap: 4, alignItems: 'center' }}
          >
            <Icon name="info" size={10} /> {helpOpen ? field.help : 'What does this do?'}
          </button>
        )}
      </div>
    );
  }

  return (
    <label className="field">
      <span className="field__label">
        {field.label}
        {field.unit && <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: 9 }}>({field.unit})</span>}
        {field.help && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setHelpOpen((open) => !open);
            }}
            aria-label={`About ${field.label}`}
            aria-expanded={helpOpen}
            style={{ color: helpOpen ? 'var(--ink)' : 'var(--ink-faint)', display: 'grid', placeItems: 'center' }}
          >
            <Icon name="info" size={11} />
          </button>
        )}
      </span>

      {field.type === 'select' && (
        <select
          className="select"
          value={String(value ?? '')}
          onChange={(event) => {
            const option = field.options?.find((candidate) => String(candidate.value) === event.target.value);
            onChange(option ? option.value : event.target.value);
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {field.type === 'number' && (
        <input
          className="input mono"
          type="number"
          value={typeof value === 'number' ? value : Number(value) || 0}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      )}

      {field.type === 'text' && (
        <input className="input" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
      )}

      {field.help && helpOpen && (
        <span className="field__hint" id={helpId}>
          {field.help}
        </span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

export function StatusPill({ status }: { status: 'healthy' | 'degraded' | 'down' }) {
  if (status === 'down') return <Pill tone="red">Down</Pill>;
  if (status === 'degraded') return <Pill tone="orange">Degraded</Pill>;
  return <Pill tone="mint">Healthy</Pill>;
}

export function StatCell({
  label,
  value,
  alert,
  good,
}: {
  label: string;
  value: string;
  alert?: boolean;
  good?: boolean;
}) {
  return (
    <div className={`stat-cell${alert ? ' stat-cell--alert' : good ? ' stat-cell--good' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
