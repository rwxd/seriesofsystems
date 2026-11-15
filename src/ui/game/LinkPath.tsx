import { memo } from 'react';
import type { LinkMetrics, TopologyLink, TopologyNode } from '@/sim/types';
import type { Box } from './layout';
import { NODE_H, NODE_W } from './layout';
import { fmtRps } from '@/ui/lib/format';

export interface LinkGeometry {
  d: string;
  mid: { x: number; y: number };
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export function linkGeometry(from: Box, to: Box): LinkGeometry {
  const ac = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const bc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy) * 1.15;

  if (horizontal) {
    const sign = dx >= 0 ? 1 : -1;
    const sx = ac.x + (from.w / 2) * sign;
    const sy = ac.y;
    const ex = bc.x - (to.w / 2) * sign;
    const ey = bc.y;
    const offset = Math.min(170, Math.max(38, Math.abs(ex - sx) * 0.48));
    const c1 = { x: sx + offset * sign, y: sy };
    const c2 = { x: ex - offset * sign, y: ey };
    return {
      d: `M${sx.toFixed(1)} ${sy.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      mid: {
        x: (sx + 3 * c1.x + 3 * c2.x + ex) / 8,
        y: (sy + 3 * c1.y + 3 * c2.y + ey) / 8,
      },
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
    };
  }

  const sign = dy >= 0 ? 1 : -1;
  const sx = ac.x;
  const sy = ac.y + (from.h / 2) * sign;
  const ex = bc.x;
  const ey = bc.y - (to.h / 2) * sign;
  const offset = Math.min(150, Math.max(34, Math.abs(ey - sy) * 0.5));
  const c1 = { x: sx, y: sy + offset * sign };
  const c2 = { x: ex, y: ey - offset * sign };
  return {
    d: `M${sx.toFixed(1)} ${sy.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`,
    mid: {
      x: (sx + 3 * c1.x + 3 * c2.x + ex) / 8,
      y: (sy + 3 * c1.y + 3 * c2.y + ey) / 8,
    },
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
  };
}

export interface LinkPathProps {
  link: TopologyLink;
  from: TopologyNode;
  to: TopologyNode;
  metrics: LinkMetrics | undefined;
  selected: boolean;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
}

function LinkPathImpl({ link, from, to, metrics, selected, reducedMotion, onSelect }: LinkPathProps) {
  const geometry = linkGeometry(
    { x: from.x, y: from.y, w: NODE_W, h: NODE_H },
    { x: to.x, y: to.y, w: NODE_W, h: NODE_H },
  );
  const status = metrics?.status ?? 'up';
  const utilization = metrics?.utilization ?? 0;
  const rps = metrics?.rps ?? 0;
  const hot = status === 'up' && utilization >= 0.8;
  const state = status === 'down' ? 'down' : status === 'degraded' ? 'degraded' : hot ? 'hot' : 'up';
  const marker = `url(#arrow-${state})`;
  const packetClass = `packet${state === 'down' ? ' packet--down' : state === 'degraded' || state === 'hot' ? ' packet--warn' : ''}`;

  const packetCount = reducedMotion || rps < 0.4 || status === 'down' ? 0 : Math.min(3, 1 + Math.floor(rps / 40));
  const duration = Math.min(3.4, Math.max(0.9, 80 / (rps + 12)));

  const label = selected ? `${from.name} → ${to.name}, ${fmtRps(rps)} rps` : undefined;

  return (
    <g>
      <title>{label ?? `${from.name} to ${to.name}`}</title>
      <path
        className={`link link--${state}${selected ? ' link--selected' : ''}`}
        d={geometry.d}
        markerEnd={marker}
        pointerEvents="none"
      />

      {packetCount > 0 &&
        Array.from({ length: packetCount }, (_, index) => (
          <circle className={packetClass} key={index} r={2.8}>
            <animateMotion
              dur={`${duration.toFixed(2)}s`}
              begin={`${((duration / packetCount) * index).toFixed(2)}s`}
              repeatCount="indefinite"
              path={geometry.d}
              rotate="auto"
            />
          </circle>
        ))}

      {selected && (
        <g pointerEvents="none" transform={`translate(${geometry.mid.x} ${geometry.mid.y})`}>
          <rect className="link__label-bg" x={-34} y={-11} width={68} height={22} rx={6} />
          <text className="link__label" x={0} y={4} textAnchor="middle">
            {fmtRps(rps)} rps
          </text>
        </g>
      )}

      <path
        className="link__hit"
        d={geometry.d}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(link.id);
        }}
        role="button"
        aria-label={`Link from ${from.name} to ${to.name}`}
        tabIndex={-1}
      />
    </g>
  );
}

export const LinkPath = memo(LinkPathImpl);
