import { useEffect, useRef, useState } from 'react';
import { useGame, type AlertMetric, type AlertRule } from '@/game/store';
import type { RequestTrace, SimSnapshot, Topology } from '@/sim/types';
import { securityFindings, computeSecurityScore } from '@/sim/security';
import { EmptyState, Pill } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LineChart, Sparkline, UtilBar, type SeriesPoint } from '@/ui/components/Chart';
import { StatusPill, StatCell } from './Inspector';
import { fmtClock, fmtMs, fmtMoney, fmtNum, fmtPct, fmtRps } from '@/ui/lib/format';

type Tab = 'nodes' | 'traces' | 'incidents' | 'logs' | 'alerts' | 'security';
type TraceFilter = 'all' | 'failed' | 'slow';
type LogFilter = 'all' | 'warning' | 'error';

interface LogLine {
  id: string;
  at: number;
  severity: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  nodeId?: string;
}

export function Dashboard({ snapshot }: { snapshot: SimSnapshot | null }) {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const events = useGame((state) => state.events);
  const traces = useGame((state) => state.traces);
  const dashboardOpen = useGame((state) => state.ui.dashboardOpen);
  const selectNode = useGame((state) => state.selectNode);
  const alertRules = useGame((state) => state.alertRules);
  const firedAlerts = useGame((state) => state.firedAlerts);
  const firingAlertIds = useGame((state) => state.firingAlertIds);
  const updateAlertRule = useGame((state) => state.updateAlertRule);
  const toggleAlertRule = useGame((state) => state.toggleAlertRule);
  const acknowledgeAlert = useGame((state) => state.acknowledgeAlert);
  const clearFiredAlerts = useGame((state) => state.clearFiredAlerts);
  const [tab, setTab] = useState<Tab>('nodes');
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [traceFilter, setTraceFilter] = useState<TraceFilter>('all');
  const [traceQuery, setTraceQuery] = useState('');
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [logQuery, setLogQuery] = useState('');
  const [explorerNode, setExplorerNode] = useState('');
  const [explorerMetric, setExplorerMetric] = useState<'rps' | 'p95' | 'utilization' | 'queue'>('rps');
  const history = useRef<SeriesPoint[]>([]);
  const historyNode = useRef('');
  const historyMetric = useRef('');
  const lastHistoryTime = useRef(-1);

  useEffect(() => {
    const nodeId = explorerNode || (snapshot ? Object.keys(snapshot.nodes)[0] ?? '' : '');
    if (!snapshot || !nodeId) {
      history.current = [];
      return;
    }
    if (nodeId !== historyNode.current || explorerMetric !== historyMetric.current) {
      historyNode.current = nodeId;
      historyMetric.current = explorerMetric;
      history.current = [];
      lastHistoryTime.current = -1;
    }
    const node = snapshot.nodes[nodeId];
    if (!node || snapshot.time === lastHistoryTime.current) return;
    lastHistoryTime.current = snapshot.time;
    const value =
      explorerMetric === 'rps'
        ? node.rps
        : explorerMetric === 'p95'
          ? node.p95
          : explorerMetric === 'utilization'
            ? node.utilization * 100
            : node.queue;
    history.current = [...history.current, { t: snapshot.time, v: value }].slice(-120);
  }, [snapshot, explorerNode, explorerMetric]);

  if (!scenario) return null;

  const nodes = snapshot ? Object.values(snapshot.nodes) : [];
  const sortedNodes = [...nodes].sort((a, b) => b.rps - a.rps);
  const incidents = snapshot?.incidents ?? [];
  const recentEvents = events.filter((event) => event.kind === 'incident').slice(-4).reverse();
  const topology = draft ?? scenario.initialTopology;
  const nameById = new Map(topology.nodes.map((node) => [node.id, node.name]));
  const securityScore = computeSecurityScore(topology);
  const findings = securityFindings(topology);
  const activeAlertCount = firingAlertIds.length;
  const unacknowledged = firedAlerts.filter((alert) => !alert.acknowledged).length;
  const traceList = traces.filter((trace) => {
    if (traceFilter === 'failed' && trace.ok) return false;
    if (traceFilter === 'slow' && trace.latencyMs <= 500) return false;
    if (!traceQuery.trim()) return true;
    const needle = traceQuery.toLowerCase();
    return (
      trace.path.some((hop) => hop.nodeName.toLowerCase().includes(needle)) ||
      (trace.error ?? '').toLowerCase().includes(needle) ||
      String(trace.status).includes(needle)
    );
  });

  const logs: LogLine[] = [
    ...events.map((event) => ({
      id: `event-${event.id}`,
      at: event.at,
      severity:
        event.severity === 'critical' ? ('error' as const) : event.severity === 'warning' ? ('warning' as const) : ('info' as const),
      source: event.kind,
      message: `${event.title}: ${event.message}`,
      nodeId: event.nodeId,
    })),
    ...(snapshot?.issues ?? []).map((issue) => ({
      id: `issue-${issue.id}`,
      at: issue.at,
      severity: issue.severity === 'critical' ? ('error' as const) : issue.severity === 'warning' ? ('warning' as const) : ('info' as const),
      source: 'health check',
      message: `${issue.title}: ${issue.message}`,
      nodeId: issue.nodeId,
    })),
    ...traces
      .filter((trace) => !trace.ok || trace.latencyMs > 500)
      .map((trace) => ({
        id: `trace-${trace.id}`,
        at: trace.at,
        severity: trace.ok ? ('warning' as const) : ('error' as const),
        source: trace.path.map((hop) => hop.nodeName).join(' → ') || trace.entryId,
        message: trace.ok
          ? `slow request: ${fmtMs(trace.latencyMs)}`
          : `HTTP ${trace.status}${trace.error ? ` — ${trace.error}` : ''} after ${fmtMs(trace.latencyMs)}`,
        nodeId: trace.path[trace.path.length - 1]?.nodeId,
      })),
  ]
    .filter((line) => {
      if (logFilter === 'error' && line.severity !== 'error') return false;
      if (logFilter === 'warning' && line.severity === 'info') return false;
      if (!logQuery.trim()) return true;
      const needle = logQuery.toLowerCase();
      return line.message.toLowerCase().includes(needle) || line.source.toLowerCase().includes(needle);
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);

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
              ['logs', 'Logs'],
              ['alerts', `Alerts${activeAlertCount || unacknowledged ? ` (${activeAlertCount || unacknowledged})` : ''}`],
              ['security', `Security ${securityScore}`],
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
          onClick={() => useGame.getState().togglePanel('dashboardOpen')}
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
                  <>
                    <div className="explorer">
                      <div className="explorer__controls">
                        <label className="field">
                          <span className="field__label">Component</span>
                          <select
                            className="select"
                            value={explorerNode || sortedNodes[0]?.nodeId || ''}
                            onChange={(event) => setExplorerNode(event.target.value)}
                          >
                            {sortedNodes.map((node) => (
                              <option key={node.nodeId} value={node.nodeId}>
                                {nameById.get(node.nodeId) ?? node.nodeId}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field__label">Metric</span>
                          <select
                            className="select"
                            value={explorerMetric}
                            onChange={(event) => setExplorerMetric(event.target.value as typeof explorerMetric)}
                          >
                            <option value="rps">Requests / sec</option>
                            <option value="p95">p95 latency</option>
                            <option value="utilization">Utilization</option>
                            <option value="queue">Queue depth</option>
                          </select>
                        </label>
                        <div className="explorer__value">
                          <span className="eyebrow">live</span>
                          <strong>
                            {explorerMetric === 'rps'
                              ? fmtRps(snapshot?.nodes[explorerNode || sortedNodes[0]?.nodeId || '']?.rps ?? 0)
                              : explorerMetric === 'p95'
                                ? fmtMs(snapshot?.nodes[explorerNode || sortedNodes[0]?.nodeId || '']?.p95 ?? 0)
                                : explorerMetric === 'utilization'
                                  ? `${Math.round(
                                      (snapshot?.nodes[explorerNode || sortedNodes[0]?.nodeId || '']?.utilization ?? 0) * 100,
                                    )}%`
                                  : String(
                                      snapshot?.nodes[explorerNode || sortedNodes[0]?.nodeId || '']?.queue ?? 0,
                                    )}
                          </strong>
                        </div>
                      </div>
                      <div className="explorer__chart">
                        <Sparkline
                          points={history.current}
                          height={64}
                          color="var(--orange)"
                          ariaLabel="Selected node metric history"
                        />
                      </div>
                    </div>
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
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'traces' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="trace" size={11} /> Recent traces
                <span className="spacer" />
                <span>{traceList.length}/{traces.length} sampled</span>
              </div>
              <div className="drawer__panel-body">
                <div className="trace-filters">
                  <select
                    className="select"
                    value={traceFilter}
                    onChange={(event) => setTraceFilter(event.target.value as TraceFilter)}
                    aria-label="Filter traces"
                  >
                    <option value="all">All traces</option>
                    <option value="failed">Failures only</option>
                    <option value="slow">Slow (&gt;500ms)</option>
                  </select>
                  <input
                    className="input"
                    value={traceQuery}
                    onChange={(event) => setTraceQuery(event.target.value)}
                    placeholder="Filter by node, status or error"
                    aria-label="Search traces"
                  />
                </div>
                {traces.length === 0 ? (
                  <EmptyState icon="trace" title="No traces sampled">
                    <p>Failed and slow requests show up here with their full hop path.</p>
                  </EmptyState>
                ) : traceList.length === 0 ? (
                  <EmptyState icon="trace" title="No traces match">
                    <p>Try a different filter or clear the search.</p>
                  </EmptyState>
                ) : (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {traceList.slice(0, 20).map((trace) => (
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

          {tab === 'logs' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="bug" size={11} /> Logs & events
                <span className="spacer" />
                <span>{logs.length} lines</span>
              </div>
              <div className="drawer__panel-body">
                <div className="trace-filters">
                  <select
                    className="select"
                    value={logFilter}
                    onChange={(event) => setLogFilter(event.target.value as LogFilter)}
                    aria-label="Filter logs"
                  >
                    <option value="all">All severities</option>
                    <option value="warning">Warnings and errors</option>
                    <option value="error">Errors only</option>
                  </select>
                  <input
                    className="input"
                    value={logQuery}
                    onChange={(event) => setLogQuery(event.target.value)}
                    placeholder="Filter by message, source or node"
                    aria-label="Search logs"
                  />
                </div>
                {logs.length === 0 ? (
                  <EmptyState icon="bug" title="No log lines match">
                    <p>Clear the filter or wait for traffic, incidents or failed traces.</p>
                  </EmptyState>
                ) : (
                  <div className="log-list">
                    {logs.map((line) => (
                      <button
                        type="button"
                        className={`log-line log-line--${line.severity}`}
                        key={line.id}
                        onClick={() => line.nodeId && selectNode(line.nodeId)}
                      >
                        <span className="log-line__time">{fmtClock(line.at)}</span>
                        <span className="log-line__sev">{line.severity}</span>
                        <span className="log-line__source">{line.source}</span>
                        <span className="log-line__msg">{line.message}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'alerts' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="bell" size={11} /> Alert rules
                <span className="spacer" />
                <span>{activeAlertCount} firing</span>
                <button type="button" className="link-button" onClick={clearFiredAlerts}>
                  clear history
                </button>
              </div>
              <div className="drawer__panel-body">
                <div className="alert-rules">
                  {alertRules.map((rule) => (
                    <div className={`alert-rule${rule.enabled ? '' : ' alert-rule--off'}`} key={rule.id}>
                      <label className="alert-rule__toggle">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => toggleAlertRule(rule.id)}
                          aria-label={`Toggle ${rule.label} alert`}
                        />
                        <span>{rule.label}</span>
                      </label>
                      <span className="mono">{rule.operator}</span>
                      <input
                        className="input mono alert-rule__threshold"
                        type="number"
                        value={rule.threshold}
                        onChange={(event) =>
                          updateAlertRule(rule.id, { threshold: Number(event.target.value) })
                        }
                        step={rule.metric === 'p95' ? 10 : 1}
                        aria-label={`${rule.label} threshold`}
                      />
                      <span className="muted">{alertUnit(rule.metric)}</span>
                    </div>
                  ))}
                </div>
                <div className="section__title" style={{ marginTop: 10 }}>
                  Fired alerts
                </div>
                {firedAlerts.length === 0 ? (
                  <span className="muted">No alerts have fired yet.</span>
                ) : (
                  <div className="fired-alerts">
                    {firedAlerts.slice(0, 12).map((alert) => (
                      <div
                        className={`fired-alert fired-alert--${alert.severity}${alert.acknowledged ? ' fired-alert--ack' : ''}`}
                        key={alert.id}
                      >
                        <span className="fired-alert__time">t+{fmtClock(alert.at)}</span>
                        <strong>{alert.label}</strong>
                        <span>
                          {Math.round(alert.value * 10) / 10}
                          {alertUnit(
                            alertRules.find((rule) => rule.id === alert.ruleId)?.metric ?? 'maxQueue',
                          )}
                        </span>
                        {!alert.acknowledged && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => acknowledgeAlert(alert.id)}
                          >
                            ack
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="drawer__panel" style={{ gridColumn: 'span 2' }}>
              <div className="drawer__panel-head">
                <Icon name="waf" size={11} /> Security posture
                <span className="spacer" />
                <span>{findings.length} findings</span>
              </div>
              <div className="drawer__panel-body">
                <div className="security-head">
                  <div
                    className={`security-score${securityScore < 50 ? ' security-score--bad' : securityScore < 75 ? ' security-score--warn' : ''}`}
                  >
                    <strong>{securityScore}</strong>
                    <span>/100</span>
                  </div>
                  <div>
                    <strong>Security posture</strong>
                    <p className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
                      WAF, TLS, encryption, backups, patching, secrets and rate limits all move this
                      number. Incidents exploit the weakest setting.
                    </p>
                  </div>
                </div>
                {findings.length === 0 ? (
                  <div className="security-empty">
                    <Icon name="check-circle" size={15} /> No obvious weaknesses in the deployed topology.
                  </div>
                ) : (
                  <div className="security-findings">
                    {findings.map((finding) => (
                      <div className={`security-finding security-finding--${finding.severity}`} key={finding.id}>
                        <Icon
                          name={finding.severity === 'critical' ? 'alert' : finding.severity === 'warning' ? 'warning' : 'info'}
                          size={13}
                        />
                        <div>
                          <strong>{finding.title}</strong>
                          <p>{finding.detail}</p>
                          <span className="security-finding__action">Fix: {finding.action}</span>
                        </div>
                        {finding.nodeId && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => selectNode(finding.nodeId!)}
                          >
                            inspect
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
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
                <StatCell
                  label="Error budget left"
                  value={
                    scenario.objectives.maxErrorSeconds !== undefined
                      ? `${Math.max(0, Math.round(scenario.objectives.maxErrorSeconds - (snapshot?.errorSeconds ?? 0)))}s`
                      : 'n/a'
                  }
                  alert={
                    scenario.objectives.maxErrorSeconds !== undefined &&
                    (snapshot?.errorSeconds ?? 0) > scenario.objectives.maxErrorSeconds
                  }
                />
                <StatCell label="p50" value={fmtMs(snapshot?.p50 ?? 0)} />
                <StatCell label="p99" value={fmtMs(snapshot?.p99 ?? 0)} />
                <StatCell label="DB lag" value={fmtMs(snapshot?.dbLagMs ?? 0)} alert={(snapshot?.dbLagMs ?? 0) > 120} />
                <StatCell label="Data loss" value={String(snapshot?.dataLossEvents ?? 0)} alert={(snapshot?.dataLossEvents ?? 0) > 0} />
                <StatCell label="Security" value={`${securityScore}/100`} alert={securityScore < 60} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function alertUnit(metric: AlertMetric): string {
  switch (metric) {
    case 'errorRate':
    case 'availability':
      return '%';
    case 'p95':
      return 'ms';
    case 'security':
      return '/100';
    default:
      return '';
  }
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
