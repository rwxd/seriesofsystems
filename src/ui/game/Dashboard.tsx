import { useState } from 'react';
import { useGame } from '@/game/store';
import type { RequestTrace, SimSnapshot } from '@/sim/types';
import { EmptyState, Pill } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LineChart, UtilBar } from '@/ui/components/Chart';
import { StatusPill, StatCell } from './Inspector';
import { fmtClock, fmtMs, fmtMoney, fmtNum, fmtPct, fmtRps } from '@/ui/lib/format';

type Tab = 'nodes' | 'traces' | 'incidents';

export function Dashboard({ snapshot }: { snapshot: SimSnapshot | null }) {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const events = useGame((state) => state.events);
  const traces = useGame((state) => state.traces);
  const dashboardOpen = useGame((state) => state.ui.dashboardOpen);
  const selectNode = useGame((state) => state.selectNode);
  const [tab, setTab] = useState<Tab>('nodes');
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  if (!scenario) return null;

  const nodes = snapshot ? Object.values(snapshot.nodes) : [];
  const sortedNodes = [...nodes].sort((a, b) => b.rps - a.rps);
  const incidents = snapshot?.incidents ?? [];
  const recentEvents = events.filter((event) => event.kind === 'incident').slice(-4).reverse();

  const topology = draft ?? scenario.initialTopology;
  const nameById = new Map(topology.nodes.map((node) => [node.id, node.name]));

  return (
    <section
      className={`drawer${dashboardOpen ? ' is-open' : ''}`}
      aria-label="Metrics drawer"
      aria-hidden={!dashboardOpen}
    >
      <div className="drawer__head">
        <Icon name="gauge" size={14} />
        <span className="drawer__title">Metrics</span>
        <div className="tabs" role="tablist" aria-label="Metrics views" style={{ marginLeft: 4 }}>
          {(
            [
              ['nodes', 'Nodes'],
              ['traces', 'Traces'],
              ['incidents', `Incidents${incidents.length ? ` (${incidents.length})` : ''}`],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-faint)' }}>
          {fmtNum(snapshot?.requests ?? 0)} requests · {fmtClock(snapshot?.time ?? 0)} elapsed
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => useGame.getState().togglePanel('dashboard')}
          aria-label="Close metrics drawer"
        >
          <Icon name="chevron-down" size={15} />
        </button>
      </div>

      <div className="drawer__body">
        <div className="drawer__grid">
          <MetricCard
            label="Requests / sec"
            value={fmtRps(snapshot?.rps ?? 0)}
            unit="rps"
            points={snapshot?.series.rps ?? []}
            color="var(--orange)"
          />
          <MetricCard
            label="Error rate"
            value={fmtPct(snapshot?.errorRate ?? 0, 2)}
            unit={`${fmtNum(snapshot?.failures ?? 0)} failed`}
            points={snapshot?.series.errors ?? []}
            color="var(--red)"
          />
          <MetricCard
            label="p95 latency"
            value={String(Math.round(snapshot?.p95 ?? 0))}
            unit="ms"
            points={snapshot?.series.p95 ?? []}
            color="var(--sky)"
          />
          <MetricCard
            label="Cost / month"
            value={fmtMoney(snapshot?.monthlyCost ?? 0)}
            unit={`budget ${fmtMoney(scenario.startingBudgetPerMonth)}`}
            points={snapshot?.series.cost ?? []}
            color="var(--violet)"
          />
        </div>

        <div className="drawer__panels">
          {tab === 'nodes' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="server" size={11} /> Per-node telemetry
                <span className="spacer" />
                <span>{sortedNodes.length} components</span>
              </div>
              <div className="drawer__panel-body">
                {sortedNodes.length === 0 ? (
                  <EmptyState icon="server" title="No telemetry yet">
                    <p>Deploy a topology and let traffic flow for a few seconds.</p>
                  </EmptyState>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th>Status</th>
                        <th className="num">rps</th>
                        <th>util</th>
                        <th className="num">p95</th>
                        <th className="num">errors</th>
                        <th className="num">replicas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedNodes.map((node) => {
                        const name = nameById.get(node.nodeId) ?? node.nodeId;
                        return (
                          <tr key={node.nodeId}>
                            <td>
                              <button
                                type="button"
                                onClick={() => selectNode(node.nodeId)}
                                style={{ fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}
                              >
                                {name}
                              </button>
                            </td>
                            <td>
                              <StatusPill status={node.status} />
                            </td>
                            <td className="num">{fmtRps(node.rps)}</td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                <UtilBar value={node.utilization} width={48} />
                                <span className="mono" style={{ fontSize: 10 }}>
                                  {Math.round(node.utilization * 100)}%
                                </span>
                              </div>
                            </td>
                            <td className="num">{fmtMs(node.p95)}</td>
                            <td className="num">{fmtPct(node.errorRate, 1)}</td>
                            <td className="num">
                              {node.replicasUp}/{node.replicasTotal}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {tab === 'traces' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="trace" size={11} /> Recent traces
                <span className="spacer" />
                <span>{traces.length} sampled</span>
              </div>
              <div className="drawer__panel-body">
                {traces.length === 0 ? (
                  <EmptyState icon="trace" title="No traces sampled">
                    <p>Failed and slow requests show up here with their full hop path.</p>
                  </EmptyState>
                ) : (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {traces.slice(0, 14).map((trace) => (
                      <TraceRow
                        key={trace.id}
                        trace={trace}
                        expanded={expandedTrace === trace.id}
                        onToggle={() => setExpandedTrace(expandedTrace === trace.id ? null : trace.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'incidents' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="bell" size={11} /> Incidents
                <span className="spacer" />
                <span>{incidents.length} active</span>
              </div>
              <div className="drawer__panel-body">
                {incidents.length === 0 && recentEvents.length === 0 ? (
                  <EmptyState icon="shield" title="All quiet">
                    <p>No active incidents. This is either good news or the calm before a zone failure.</p>
                  </EmptyState>
                ) : (
                  <>
                    {incidents.map((incident) => (
                      <div
                        className={`incident-mini${incident.severity === 'critical' ? ' incident-mini--critical' : ''}`}
                        key={incident.id}
                      >
                        <div className="incident-mini__meta">
                          <span>{incident.severity}</span>
                          <span>·</span>
                          <span>t+{fmtClock(incident.startedAt)}</span>
                          {incident.targetId && (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                style={{ textDecoration: 'underline', color: 'var(--ink-2)' }}
                                onClick={() => selectNode(incident.targetId!)}
                              >
                                {incident.targetId}
                              </button>
                            </>
                          )}
                        </div>
                        <strong>{incident.title}</strong>
                        <span>{incident.message}</span>
                      </div>
                    ))}
                    {recentEvents.map((event) => (
                      <div className="incident-mini" key={event.id} style={{ opacity: 0.75 }}>
                        <div className="incident-mini__meta">
                          <span>history</span>
                          <span>·</span>
                          <span>t+{fmtClock(event.at)}</span>
                        </div>
                        <strong>{event.title}</strong>
                        <span>{event.message}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="drawer__panel">
            <div className="drawer__panel-head">
              <Icon name="shield" size={11} /> Shift health
            </div>
            <div className="drawer__panel-body">
              <div className="stat-grid">
                <StatCell label="Availability" value={`${((snapshot?.availability ?? 1) * 100).toFixed(2)}%`} good={(snapshot?.availability ?? 1) > 0.99} />
                <StatCell label="Error seconds" value={`${Math.round(snapshot?.errorSeconds ?? 0)}s`} alert={(snapshot?.errorSeconds ?? 0) > 0} />
                <StatCell label="p50" value={fmtMs(snapshot?.p50 ?? 0)} />
                <StatCell label="p99" value={fmtMs(snapshot?.p99 ?? 0)} />
                <StatCell label="DB lag" value={fmtMs(snapshot?.dbLagMs ?? 0)} alert={(snapshot?.dbLagMs ?? 0) > 120} />
                <StatCell label="Data loss" value={String(snapshot?.dataLossEvents ?? 0)} alert={(snapshot?.dataLossEvents ?? 0) > 0} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  unit,
  points,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  points: Array<{ t: number; v: number }>;
  color: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-card__head">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__value">
          {value} <small>{unit}</small>
        </span>
      </div>
      <LineChart points={points} color={color} height={64} width={280} ariaLabel={`${label} chart`} />
    </div>
  );
}

function TraceRow({ trace, expanded, onToggle }: { trace: RequestTrace; expanded: boolean; onToggle: () => void }) {
  const path = trace.path.map((hop) => hop.nodeName).join(' → ');
  return (
    <div>
      <button type="button" className="trace-row" onClick={onToggle} aria-expanded={expanded}>
        <span className={`trace-row__status${trace.ok ? '' : ' trace-row__status--bad'}`}>{trace.status}</span>
        <span className="trace-row__path">
          {path || trace.entryId}
          {trace.retries > 0 ? ` · ${trace.retries} ${trace.retries === 1 ? 'retry' : 'retries'}` : ''}
        </span>
        <span className="trace-row__ms">
          {fmtMs(trace.latencyMs)} <span className="faint">t+{fmtClock(trace.at)}</span>
        </span>
      </button>
      {expanded && (
        <div className="trace-hops">
          {trace.path.length === 0 && <span className="muted">No hops recorded.</span>}
          {trace.path.map((hop, index) => (
            <div key={`${hop.nodeId}-${index}`}>
              <div className="trace-hop">
                <Icon name={hop.ok ? 'check' : 'down'} size={12} style={{ color: hop.ok ? 'var(--mint-2)' : 'var(--red)' }} />
                <span>
                  {hop.nodeName} <span className="faint">· {hop.kind}</span>
                </span>
                <span className="mono">{fmtMs(hop.durationMs)}</span>
              </div>
              {index < trace.path.length - 1 && <div className="trace-hop__line" />}
            </div>
          ))}
          {trace.error && (
            <div style={{ marginTop: 4 }}>
              <Pill tone="red">{trace.error}</Pill>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
