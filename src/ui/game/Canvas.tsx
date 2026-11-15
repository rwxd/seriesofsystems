import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import type { SimSnapshot, Topology, TopologyNode, World } from '@/sim/types';
import { Btn } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { clamp, hexAlpha } from '@/ui/lib/format';
import { NodeCard } from './NodeCard';
import { LinkPath } from './LinkPath';
import { computeContainers, sceneBounds, type Container } from './layout';

interface Viewport {
  x: number;
  y: number;
  k: number;
}

interface CanvasProps {
  topology: Topology;
  world: World;
  snapshot: SimSnapshot | null;
  scenarioId: string;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  linkFrom: string | null;
  reducedMotion: boolean;
}

export function Canvas({
  topology,
  world,
  snapshot,
  scenarioId,
  selectedNodeId,
  selectedLinkId,
  linkFrom,
  reducedMotion,
}: CanvasProps) {
  const draftIssues = useGame((state) => state.issues);
  const selectNode = useGame((state) => state.selectNode);
  const selectLink = useGame((state) => state.selectLink);
  const beginLink = useGame((state) => state.beginLink);
  const completeLink = useGame((state) => state.completeLink);
  const cancelLink = useGame((state) => state.cancelLink);
  const moveNode = useGame((state) => state.moveNode);

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [panning, setPanning] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const containers = useMemo(() => computeContainers(topology, world), [topology, world]);
  const nodesById = useMemo(() => {
    const map = new Map<string, TopologyNode>();
    for (const node of topology.nodes) map.set(node.id, node);
    return map;
  }, [topology]);

  const issuesByNode = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const issue of draftIssues) {
      if (!issue.nodeId) continue;
      counts[issue.nodeId] = (counts[issue.nodeId] ?? 0) + 1;
    }
    for (const issue of snapshot?.issues ?? []) {
      if (!issue.nodeId) continue;
      counts[issue.nodeId] = (counts[issue.nodeId] ?? 0) + 1;
    }
    return counts;
  }, [draftIssues, snapshot]);

  const nodesRef = useRef(nodesById);
  nodesRef.current = nodesById;
  const topologyRef = useRef(topology);
  topologyRef.current = topology;

  /* ---------------- sizing ---------------- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => observer.disconnect();
  }, []);

  /* ---------------- fit ---------------- */

  const fit = useCallback(() => {
    const bounds = sceneBounds(topologyRef.current, computeContainers(topologyRef.current, world));
    if (!bounds || size.w < 40 || size.h < 40) return;
    const padding = 56;
    const k = clamp(
      Math.min((size.w - padding * 2) / Math.max(1, bounds.w), (size.h - padding * 2) / Math.max(1, bounds.h)),
      0.28,
      1.15,
    );
    setView({
      k,
      x: size.w / 2 - (bounds.x + bounds.w / 2) * k,
      y: size.h / 2 - (bounds.y + bounds.h / 2) * k,
    });
  }, [size.w, size.h, world]);

  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (size.w < 40) return;
    if (fittedFor.current === scenarioId) return;
    fittedFor.current = scenarioId;
    fit();
  }, [scenarioId, size.w, size.h, fit]);

  const zoomBy = useCallback(
    (factor: number) => {
      setView((current) => {
        const nextK = clamp(current.k * factor, 0.25, 2.2);
        const scale = nextK / current.k;
        const cx = size.w / 2;
        const cy = size.h / 2;
        return {
          k: nextK,
          x: cx - (cx - current.x) * scale,
          y: cy - (cy - current.y) * scale,
        };
      });
    },
    [size.w, size.h],
  );

  /* ---------------- wheel zoom ---------------- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0016), 0.25, 2.2);
        const scale = nextK / current.k;
        return { k: nextK, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------------- pointer interactions ---------------- */

  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);

  const startPan = (event: React.PointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = { sx: event.clientX, sy: event.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    setPanning(true);
    selectNode(null);
    selectLink(null);
  };

  const onNodePointerDown = useCallback((event: React.PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const node = nodesRef.current.get(id);
    if (!node) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { id, sx: event.clientX, sy: event.clientY, ox: node.x, oy: node.y, moved: false };
    setDragId(id);
  }, []);

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const k = viewRef.current.k;
    if (panRef.current) {
      const { sx, sy, vx, vy } = panRef.current;
      setView((current) => ({ ...current, x: vx + (event.clientX - sx), y: vy + (event.clientY - sy) }));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.sx) / k;
    const dy = (event.clientY - drag.sy) / k;
    if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.moved) {
      const next = { x: Math.round(drag.ox + dx), y: Math.round(drag.oy + dy) };
      dragPosRef.current = next;
      setDragPos(next);
    }
  };

  const finishPointer = () => {
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      const position = dragPosRef.current;
      dragPosRef.current = null;
      setDragId(null);
      setDragPos(null);
      if (drag.moved && position) {
        moveNode(drag.id, position.x, position.y);
      } else if (linkFrom) {
        if (drag.id === linkFrom) cancelLink();
        else completeLink(drag.id);
      } else {
        selectNode(drag.id);
      }
    }
  };

  const onNodeSelect = useCallback(
    (id: string) => {
      if (linkFrom) {
        if (id === linkFrom) cancelLink();
        else completeLink(id);
        return;
      }
      selectNode(id);
    },
    [linkFrom, cancelLink, completeLink, selectNode],
  );

  const onLinkSelect = useCallback(
    (id: string) => {
      selectLink(id);
    },
    [selectLink],
  );

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  return (
    <div
      ref={hostRef}
      className={`canvas${linkFrom ? ' canvas--linking' : ''}`}
      style={{ position: 'relative' }}
    >
      <svg
        ref={svgRef}
        className={`canvas__svg${panning ? ' is-panning' : ''}`}
        role="group"
        aria-label="System topology canvas. Drag the background to pan, scroll to zoom, drag a node to move it."
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <defs>
          <pattern
            id="bp-grid"
            width={24 * view.k}
            height={24 * view.k}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x} ${view.y})`}
          >
            <path d={`M ${24 * view.k} 0 L 0 0 0 ${24 * view.k}`} fill="none" stroke="var(--bp-line)" strokeWidth="1" />
          </pattern>
          <pattern
            id="bp-grid-major"
            width={120 * view.k}
            height={120 * view.k}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x} ${view.y})`}
          >
            <path
              d={`M ${120 * view.k} 0 L 0 0 0 ${120 * view.k}`}
              fill="none"
              stroke="var(--bp-line-strong)"
              strokeWidth="1.2"
            />
          </pattern>
          {(['up', 'down', 'degraded', 'hot'] as const).map((state) => (
            <marker
              key={state}
              id={`arrow-${state}`}
              viewBox="0 0 10 10"
              refX="7.5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M0 1 9 5 0 9z"
                fill={
                  state === 'down'
                    ? 'var(--red)'
                    : state === 'degraded' || state === 'hot'
                      ? 'var(--orange)'
                      : 'rgba(214,235,255,0.6)'
                }
              />
            </marker>
          ))}
        </defs>

        <rect
          className="canvas__bg"
          width="100%"
          height="100%"
          fill="var(--bp)"
          onPointerDown={startPan}
        />
        <rect width="100%" height="100%" fill="url(#bp-grid)" pointerEvents="none" />
        <rect width="100%" height="100%" fill="url(#bp-grid-major)" pointerEvents="none" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {containers.map((container) => (
            <ContainerBox key={`${container.kind}-${container.id}`} container={container} />
          ))}

          {topology.links.map((link) => {
            const from = nodesById.get(link.from);
            const to = nodesById.get(link.to);
            if (!from || !to) return null;
            return (
              <LinkPath
                key={link.id}
                link={link}
                from={from}
                to={to}
                metrics={snapshot?.links[link.id]}
                selected={selectedLinkId === link.id}
                reducedMotion={reducedMotion}
                onSelect={onLinkSelect}
              />
            );
          })}

          {topology.nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              metrics={snapshot?.nodes[node.id]}
              selected={selectedNodeId === node.id}
              linkSource={linkFrom === node.id}
              issueCount={issuesByNode[node.id] ?? 0}
              x={dragPos && dragId === node.id ? dragPos.x : node.x}
              y={dragPos && dragId === node.id ? dragPos.y : node.y}
              onSelect={onNodeSelect}
              onPointerDown={onNodePointerDown}
            />
          ))}
        </g>
      </svg>

      <div className="canvas__vignette" />

      {linkFrom && (
        <div className="canvas__overlay-top">
          <div className="canvas__linkhint">
            <Icon name="link" size={14} />
            Linking from {nodesById.get(linkFrom)?.name ?? 'node'} — click a target
            <button
              type="button"
              onClick={cancelLink}
              style={{ color: 'inherit', display: 'grid', placeItems: 'center' }}
              aria-label="Cancel link"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>
      )}

      {topology.nodes.length === 0 && (
        <div className="canvas__empty">
          <span className="canvas__empty-icon">
            <Icon name="plus" size={22} />
          </span>
          <h3>An empty rack</h3>
          <p>
            Pick a component from the palette to place it here. Start at the edge: DNS, then a load
            balancer, then something that can answer a request.
          </p>
        </div>
      )}

      <div className="canvas__titleblock">
        <span>Series of Systems</span>
        <span>Topology · sheet 1/1</span>
        <span>
          {topology.nodes.length} nodes · {topology.links.length} links
        </span>
      </div>

      <div className="canvas__legend">
        <span>
          <i style={{ background: 'var(--mint)' }} /> healthy
        </span>
        <span>
          <i style={{ background: 'var(--amber)' }} /> degraded
        </span>
        <span>
          <i style={{ background: 'var(--red)' }} /> down
        </span>
      </div>

      <div className="canvas__zoombar">
        <Btn variant="ghost" icon="zoom-in" aria-label="Zoom in" onClick={() => zoomBy(1.25)} />
        <Btn variant="ghost" icon="zoom-out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} />
        <Btn variant="ghost" icon="fit" aria-label="Fit topology in view" onClick={fit} />
        <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--ink-faint)' }}>
          {Math.round(view.k * 100)}%
        </div>
      </div>

      {!linkFrom && selectedNode && (
        <div style={{ position: 'absolute', left: 10, top: 10, zIndex: 6 }}>
          <Btn
            size="sm"
            icon="link"
            variant="blueprint"
            onClick={() => beginLink(selectedNode.id)}
            title="Link from this node (L)"
          >
            Link from {selectedNode.name}
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Containers                                                          */
/* ------------------------------------------------------------------ */

const ContainerBox = memo(function ContainerBox({ container }: { container: Container }) {
  if (container.kind === 'zone') {
    return (
      <g pointerEvents="none">
        <rect
          x={container.x}
          y={container.y}
          width={container.w}
          height={container.h}
          rx={12}
          fill={hexAlpha(container.color, 0.13)}
          stroke={hexAlpha(container.color, 0.55)}
          strokeWidth={1.8}
          strokeDasharray="8 6"
        />
        <rect
          x={container.x + 10}
          y={container.y + 8}
          width={Math.min(Math.max(56, 20 + container.label.length * 6.6), container.w - 20)}
          height={19}
          rx={5}
          fill={container.color}
          stroke="var(--ink)"
          strokeWidth={1.4}
        />
        <text className="zone-name" x={container.x + 18} y={container.y + 21.5} style={{ fill: '#08202f' }}>
          {container.label}
        </text>
        <text className="zone-count" x={container.x + container.w - 12} y={container.y + 21} textAnchor="end">
          {container.count} node{container.count === 1 ? '' : 's'}
        </text>
      </g>
    );
  }

  if (container.kind === 'region') {
    return (
      <g pointerEvents="none">
        <rect
          x={container.x}
          y={container.y}
          width={container.w}
          height={container.h}
          rx={16}
          fill={hexAlpha(container.color, 0.07)}
          stroke={hexAlpha(container.color, 0.42)}
          strokeWidth={2}
        />
        <path
          d={`M${container.x + 14} ${container.y - 6} h${Math.max(0, container.label.length * 7 + 26)}`}
          stroke={hexAlpha(container.color, 0.8)}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <text className="region-name" x={container.x + 14} y={container.y - 14} style={{ fill: 'var(--bp-ink)' }}>
          {container.label}
        </text>
        {container.sub && (
          <text className="zone-count" x={container.x + container.w - 14} y={container.y - 14} textAnchor="end">
            {container.sub}
          </text>
        )}
      </g>
    );
  }

  return (
    <g pointerEvents="none">
      <rect
        x={container.x}
        y={container.y}
        width={container.w}
        height={container.h}
        rx={24}
        fill="rgba(233,242,255,0.028)"
        stroke={hexAlpha(container.color, 0.3)}
        strokeWidth={2}
        strokeDasharray="14 10"
      />
      <text className="cloud-name" x={container.x + 20} y={container.y + 24}>
        {container.label}
      </text>
    </g>
  );
});
