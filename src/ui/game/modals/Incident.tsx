import { useGame } from '@/game/store';
import type { ActiveIncident, IncidentKind, RunbookKind } from '@/sim/types';
import { Btn, Modal, Pill } from '@/ui/components/ui';
import { Icon, type IconName } from '@/ui/components/Icon';
import { fmtClock, shortName } from '@/ui/lib/format';

interface RunbookMeta {
  kind: RunbookKind;
  label: string;
  blurb: string;
  icon: IconName;
}

const RUNBOOKS: RunbookMeta[] = [
  { kind: 'restart', label: 'Restart node', blurb: 'Bring a down node back after 3 seconds.', icon: 'reset' },
  { kind: 'failover-db', label: 'Fail over database', blurb: 'Promote a standby. Async can lose writes.', icon: 'db' },
  { kind: 'failover-dns', label: 'Force DNS refresh', blurb: 'Drop cached answers, resolve again.', icon: 'dns' },
  { kind: 'scale-out', label: 'Scale out', blurb: 'Add a replica or pod. Costs more.', icon: 'layers' },
  { kind: 'rollback', label: 'Roll back deploy', blurb: 'End a bad deploy immediately.', icon: 'reset' },
  { kind: 'flush-cache', label: 'Flush cache', blurb: 'Clear keys. Expect a hit-ratio dip.', icon: 'cache' },
  { kind: 'rate-limit', label: 'Rate limit', blurb: 'Set the limit to current request rate.', icon: 'shield' },
  { kind: 'drain', label: 'Drain node', blurb: 'Finish in-flight work, then pull from rotation.', icon: 'arrow-right' },
  { kind: 'renew-cert', label: 'Renew certificate', blurb: 'Restore external traffic after an expiry.', icon: 'shield' },
];

const RECOMMENDED: Record<IncidentKind, RunbookKind[]> = {
  'zone-down': ['failover-dns', 'scale-out', 'restart'],
  'region-down': ['failover-dns', 'failover-db', 'scale-out'],
  'node-crash': ['restart', 'drain', 'scale-out'],
  'node-slow': ['scale-out', 'restart', 'drain'],
  'bad-deploy': ['rollback', 'drain'],
  'traffic-spike': ['scale-out', 'rate-limit'],
  'cache-stampede': ['flush-cache', 'scale-out', 'rate-limit'],
  'network-partition': ['failover-db'],
  'cert-expiry': ['renew-cert'],
  'disk-full': ['restart', 'scale-out'],
  'db-failover': ['failover-db', 'restart'],
  'control-plane-outage': ['restart', 'drain'],
  'noisy-neighbor': ['drain', 'scale-out'],
  ddos: ['rate-limit', 'scale-out'],
  'credential-leak': ['rollback', 'rate-limit', 'restart'],
  vulnerability: ['rollback', 'restart', 'drain'],
  'brute-force': ['rate-limit', 'drain', 'scale-out'],
};

export function IncidentModal() {
  const open = useGame((state) => state.ui.incidentOpen);
  const togglePanel = useGame((state) => state.togglePanel);
  const snapshot = useGame((state) => state.snapshot);
  const events = useGame((state) => state.events);
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const selectNode = useGame((state) => state.selectNode);
  const runRunbook = useGame((state) => state.runRunbook);

  if (!scenario) return null;

  const active: ActiveIncident | undefined = snapshot?.incidents[snapshot.incidents.length - 1];
  const latestEvent = [...events].reverse().find((event) => event.kind === 'incident');
  const targetId = active?.targetId;
  const targetName =
    draft?.nodes.find((node) => node.id === targetId)?.name ??
    scenario.initialTopology.nodes.find((node) => node.id === targetId)?.name ??
    targetId;

  const kind = active?.kind;
  const recommended = kind ? RECOMMENDED[kind] : [];
  const ordered = [...RUNBOOKS].sort((a, b) => {
    const ai = recommended.indexOf(a.kind);
    const bi = recommended.indexOf(b.kind);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const title = active?.title ?? latestEvent?.title ?? 'Pager';
  const message =
    active?.message ??
    latestEvent?.message ??
    'Nothing is on fire right now. Enjoy it while the traffic curve climbs.';

  const severity = active?.severity ?? latestEvent?.severity ?? 'info';

  return (
    <Modal
      open={open}
      onClose={() => togglePanel('incidentOpen')}
      kicker={active ? 'Active incident' : 'Pager history'}
      title={title}
      sub={active ? 'The system is currently unhappy. Pick a response.' : 'Resolved — but the postmortem will remember.'}
      icon="bell"
      size="lg"
      footer={
        <>
          {targetId ? (
            <Btn
              icon="search"
              variant="outline"
              onClick={() => {
                selectNode(targetId);
                togglePanel('incidentOpen');
              }}
            >
              Jump to {targetName}
            </Btn>
          ) : (
            <Btn
              icon="gauge"
              variant="outline"
              onClick={() => {
                togglePanel('incidentOpen');
                togglePanel('dashboardOpen');
              }}
            >
              View metrics
            </Btn>
          )}
          <span className="spacer" />
          <Btn variant={active ? 'ink' : 'primary'} onClick={() => togglePanel('incidentOpen')}>
            {active ? 'Back to the fire' : 'Close'}
          </Btn>
        </>
      }
    >
      <div className="pager">
        <div
          className={`pager__flag${severity === 'critical' ? ' pager__flag--critical' : severity === 'info' ? ' pager__flag--info' : ''}`}
        >
          <Icon name={severity === 'critical' ? 'alert' : 'bell'} size={20} />
          <div style={{ display: 'grid', gap: 0, flex: 1 }}>
            <strong>{severity === 'critical' ? 'CRITICAL' : severity === 'warning' ? 'WARNING' : 'INFO'}</strong>
            <span>
              {active ? `started at ${fmtClock(active.startedAt)}` : latestEvent ? `at ${fmtClock(latestEvent.at)}` : 'page'}
              {active?.endsAt ? ` · expected to clear at ${fmtClock(active.endsAt)}` : ''}
            </span>
          </div>
          {active && <Pill tone="ink">{active.kind}</Pill>}
        </div>

        <p className="pager__message">{message}</p>

        <div className="pager__meta">
          {kind && <Pill tone="ghost">incident: {kind}</Pill>}
          {targetName && <Pill tone="ghost">target: {targetName}</Pill>}
          {active?.endsAt && <Pill tone="ghost">window: {Math.max(0, Math.round(active.endsAt - (snapshot?.time ?? 0)))}s left</Pill>}
          <Pill tone="ghost">{shortName(scenario.customer)}</Pill>
        </div>

        {active ? (
          <div>
            <div className="pager__section-title">Runbooks</div>
            <div className="runbooks">
              {ordered.map((runbook) => {
                const isRecommended = recommended.includes(runbook.kind);
                return (
                  <button
                    key={runbook.kind}
                    type="button"
                    className="runbook"
                    onClick={() => runRunbook(runbook.kind, targetId)}
                    title={runbook.blurb}
                  >
                    <span className="runbook__icon">
                      <Icon name={runbook.icon} size={14} />
                    </span>
                    <span>
                      <strong>
                        {runbook.label}
                        {isRecommended && (
                          <span
                            className="pill pill--mint"
                            style={{ marginLeft: 6, fontSize: 8, padding: '0 5px', letterSpacing: '0.04em' }}
                          >
                            likely
                          </span>
                        )}
                      </strong>
                      <span>{runbook.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p style={{ marginTop: 10, fontSize: 10.5, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
              Runbooks act on the live system right now. They are not free: scaling costs money and
              failovers can lose data. Reading the metrics first is allowed.
            </p>
          </div>
        ) : (
          <div className="pager__resolved">
            <span className="row" style={{ gap: 8 }}>
              <Icon name="check-circle" size={18} /> Resolved
            </span>
            <span>
              {latestEvent
                ? latestEvent.title
                : 'No incidents yet. The canvas is quiet, which usually means something is about to fail.'}
            </span>
            {latestEvent && <span style={{ fontSize: 11, opacity: 0.8 }}>{latestEvent.message}</span>}
          </div>
        )}

        {!active && scenario.incidents.length > 0 && (
          <div>
            <div className="pager__section-title">Scheduled risks (no spoilers)</div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
              This shift has {scenario.incidents.length} incidents scripted. They will not announce
              themselves; the pager will.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
