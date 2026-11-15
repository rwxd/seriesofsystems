import { useGame } from '@/game/store';
import type { SimSnapshot } from '@/sim/types';
import { Icon } from '@/ui/components/Icon';
import { Sparkline } from '@/ui/components/Chart';
import { fmtClock, liveObjectives } from '@/ui/lib/format';

export function Timeline({ snapshot }: { snapshot: SimSnapshot | null }) {
  const scenario = useGame((state) => state.scenario);
  const phase = useGame((state) => state.phase);
  const events = useGame((state) => state.events);
  const dashboardOpen = useGame((state) => state.ui.dashboardOpen);
  const togglePanel = useGame((state) => state.togglePanel);
  const endRun = useGame((state) => state.endRun);

  if (!scenario) return null;

  const time = snapshot?.time ?? 0;
  const duration = Math.max(1, scenario.duration);
  const progress = Math.max(0, Math.min(1, time / duration));
  const objectives = liveObjectives(scenario.objectives, snapshot);

  const markers: Array<{ id: string; at: number; kind: 'incident' | 'deploy' | 'recovery' }> = [];
  for (const event of events) {
    if (event.at > time) continue;
    if (event.kind === 'incident' || event.kind === 'deploy' || event.kind === 'recovery') {
      markers.push({ id: event.id, at: event.at, kind: event.kind as 'incident' | 'deploy' | 'recovery' });
    }
  }

  return (
    <div className="timeline">
      <div className="timeline__block timeline__block--rail">
        <div className="timeline__head">
          <Icon name="clock" size={10} />
          Shift timeline
          <span className="spacer" />
          <span className="mono">{fmtClock(time)}</span>
        </div>
        <div className="timeline__rail">
          <div className="timeline__track">
            <div className="timeline__fill" style={{ width: `${progress * 100}%` }} />
          </div>
          {markers.map((marker) => (
            <span
              key={marker.id}
              className={`timeline__marker timeline__marker--${marker.kind}`}
              style={{ left: `${Math.min(100, Math.max(0, (marker.at / duration) * 100))}%` }}
              title={`${marker.kind} at ${fmtClock(marker.at)}`}
            />
          ))}
          <span className="timeline__needle" style={{ left: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="timeline__block timeline__block--spark">
        <div className="timeline__head">
          <Icon name="activity" size={10} />
          Traffic
          <span className="spacer" />
          <span className="mono">
            {snapshot ? Math.round(snapshot.rps) : 0} rps
          </span>
        </div>
        <div className="timeline__spark">
          <Sparkline
            points={snapshot?.series.rps ?? []}
            height={34}
            color="var(--orange)"
            ariaLabel="Request rate over the last two minutes"
          />
        </div>
      </div>

      <div className="timeline__block timeline__block--objectives">
        <div className="timeline__head">
          <Icon name="check-circle" size={10} />
          Objectives
          <span className="spacer" />
          <span className="mono">
            {objectives.filter((objective) => objective.met).length}/{objectives.length} on track
          </span>
        </div>
        <div className="timeline__objectives">
          {objectives.length === 0 && <span className="chip">Survive until the shift ends</span>}
          {objectives.map((objective) => (
            <span
              key={objective.key}
              className={`chip${objective.met ? ' chip--ok' : ' chip--bad'}`}
              title={`${objective.label}: ${objective.actual} (target ${objective.target})`}
            >
              <span className="chip__dot" aria-hidden="true" />
              {objective.label} <b>{objective.actual}</b>
              <span className="faint" style={{ fontSize: 9.5 }}>
                {objective.target}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="timeline__actions">
        {scenario.sandbox && (phase === 'running' || phase === 'paused') && (
          <button
            type="button"
            className="expand-btn"
            onClick={() => endRun()}
            title="End the sandbox shift and generate a postmortem"
          >
            <Icon name="check" size={12} />
            End shift
          </button>
        )}
        <button
          type="button"
          className="expand-btn"
          aria-expanded={dashboardOpen}
          onClick={() => togglePanel('dashboardOpen')}
          title="Toggle metrics drawer (D)"
        >
          <Icon name="chevron-up" size={13} />
          Metrics
        </button>
      </div>
    </div>
  );
}
