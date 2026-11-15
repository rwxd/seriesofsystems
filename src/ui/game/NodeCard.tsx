import { memo } from 'react';
import type { NodeMetrics, TopologyNode } from '@/sim/types';
import { COMPONENT_SPECS } from '@/sim/catalog';
import { Icon, iconForKind } from '@/ui/components/Icon';
import { NODE_H, NODE_W } from './layout';

const STATUS_LABEL: Record<NodeMetrics['status'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
};

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export interface NodeCardProps {
  node: TopologyNode;
  metrics: NodeMetrics | undefined;
  selected: boolean;
  linkSource: boolean;
  issueCount: number;
  x: number;
  y: number;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent<SVGGElement>, id: string) => void;
}

function NodeCardImpl({
  node,
  metrics,
  selected,
  linkSource,
  issueCount,
  x,
  y,
  onSelect,
  onPointerDown,
}: NodeCardProps) {
  const spec = COMPONENT_SPECS[node.kind];
  const status = metrics?.status ?? 'healthy';
  const utilization = Math.max(0, Math.min(1, metrics?.utilization ?? 0));
  const replicas = metrics?.replicasTotal ?? 1;
  const replicasUp = metrics?.replicasUp ?? replicas;
  const showBadge = replicas > 1 || replicasUp !== replicas;
  const badgeLabel = replicasUp < replicas ? `${replicasUp}/${replicas}` : `×${replicas}`;
  const tone =
    utilization >= 0.9 ? 'bad' : utilization >= 0.75 ? 'hot' : utilization >= 0.55 ? 'warn' : 'mint';
  const meterWidth = Math.max(0, 115.6 * utilization);
  const name = truncate(node.name, showBadge ? 13 : 21);
  const nameWidth = showBadge ? 84 : 120;
  const nameEstimate = name.length * 6.3;
  const squeeze = nameEstimate > nameWidth ? nameWidth : undefined;
  const aria = `${node.name}, ${spec.label}, ${STATUS_LABEL[status]}, ${Math.round(
    utilization * 100,
  )}% utilized${replicas > 1 ? `, ${metrics?.replicasUp ?? replicas} of ${replicas} replicas up` : ''}`;

  return (
    <g
      className={`node node--${status}${selected ? ' node--selected' : ''}`}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={aria}
      aria-pressed={selected}
      onPointerDown={(event) => onPointerDown(event, node.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <title>{aria}</title>

      {status !== 'healthy' && (
        <rect
          className={`node__ring${status === 'down' ? ' node__ring--down' : ''}`}
          x={-4}
          y={-4}
          width={NODE_W + 8}
          height={NODE_H + 8}
          rx={17}
        />
      )}

      {selected && (
        <rect className="node__select" x={-6} y={-6} width={NODE_W + 12} height={NODE_H + 12} rx={19} />
      )}

      {status === 'down' && (
        <g className="node__smoke" aria-hidden="true">
          <circle cx={NODE_W - 64} cy={-3} r={5.2} />
          <circle cx={NODE_W - 52} cy={-9} r={3.8} />
          <circle cx={NODE_W - 74} cy={-11} r={3.2} />
        </g>
      )}

      <rect className="node__shadow" x={3} y={4} width={NODE_W} height={NODE_H} rx={14} />
      <rect className="node__card" x={0} y={0} width={NODE_W} height={NODE_H} rx={14} />

      {/* status accent */}
      <rect className="node__stripe" x={3.5} y={9} width={4} height={NODE_H - 18} rx={2} />

      {/* icon */}
      <rect className="node__icon-box" x={12} y={12} width={28} height={28} rx={7} />
      <g className="node__icon" transform="translate(15 15)" color="var(--ink-2)">
        <Icon name={iconForKind(node.kind)} size={22} strokeWidth={1.9} />
      </g>

      {/* labels */}
      <text
        className="node__name"
        x={46}
        y={26}
        textLength={squeeze}
        lengthAdjust={squeeze ? 'spacingAndGlyphs' : undefined}
      >
        {name}
      </text>
      <text className="node__kind" x={46} y={39}>
        {spec.shortLabel}
      </text>

      {/* replica badge */}
      {showBadge && (
        <>
          <rect
            className="node__badge"
            x={badgeLabel.length > 3 ? 132 : 140}
            y={9}
            width={badgeLabel.length > 3 ? 36 : 28}
            height={16}
            rx={5}
            fill={replicasUp === 0 ? 'var(--red-2)' : 'var(--ink)'}
          />
          <text className="node__badge-text" x={badgeLabel.length > 3 ? 150 : 154} y={20} textAnchor="middle">
            {badgeLabel}
          </text>
        </>
      )}

      {/* issue marker */}
      {issueCount > 0 && (
        <>
          <circle className="node__issue" cx={167} cy={43} r={6} />
          <text className="node__issue-text" x={167} y={46} textAnchor="middle">
            !
          </text>
        </>
      )}

      {/* status row */}
      <circle className="node__status-dot" cx={54} cy={55} r={3.4} />
      <text className="node__status" x={62} y={58}>
        {STATUS_LABEL[status]}
      </text>
      <text
        x={164}
        y={58}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="8.5"
        fontWeight="700"
        fill={tone === 'bad' ? 'var(--red-2)' : tone === 'hot' ? 'var(--orange-2)' : 'var(--ink-soft)'}
      >
        {Math.round(utilization * 100)}%
      </text>

      {/* utilization */}
      <rect className="node__meter-track" x={48} y={66} width={118} height={7} rx={3.5} />
      <rect
        className={`node__meter-fill${tone !== 'mint' ? ` node__meter-fill--${tone}` : ''}`}
        x={49.2}
        y={67.2}
        width={meterWidth}
        height={4.6}
        rx={2.3}
      />

      {linkSource && (
        <rect className="node__link-source" x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={17} />
      )}
    </g>
  );
}

export const NodeCard = memo(NodeCardImpl);
