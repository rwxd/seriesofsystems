import { useGame } from '@/game/store';
import type { SimSnapshot } from '@/sim/types';
import { Btn } from '@/ui/components/ui';
import { LogoMark } from '@/ui/components/Logo';
import { Icon } from '@/ui/components/Icon';
import { fmtClock, fmtMoney, fmtRps, shortName } from '@/ui/lib/format';

export function TopBar({ snapshot }: { snapshot: SimSnapshot | null }) {
  const scenario = useGame((state) => state.scenario);
  const phase = useGame((state) => state.phase);
  const speed = useGame((state) => state.speed);
  const deployPending = useGame((state) => state.deployPending);
  const unreadAlerts = useGame((state) => state.unreadAlerts);
  const closeGame = useGame((state) => state.closeGame);
  const pause = useGame((state) => state.pause);
  const resume = useGame((state) => state.resume);
  const setSpeed = useGame((state) => state.setSpeed);
  const deploy = useGame((state) => state.deploy);
  const togglePanel = useGame((state) => state.togglePanel);
  const openIac = useGame((state) => state.openIac);

  if (!scenario) return null;

  const time = snapshot?.time ?? 0;
  const duration = scenario.duration;
  const objectives = scenario.objectives;
  const errorSeconds = snapshot?.errorSeconds ?? 0;
  const monthlyCost = snapshot?.monthlyCost ?? 0;
  const budget = scenario.startingBudgetPerMonth;
  const activeIncidents = snapshot?.incidents.length ?? 0;
  const dataLoss = snapshot?.dataLossEvents ?? 0;

  const budgetOver = objectives.maxErrorSeconds !== undefined && errorSeconds > objectives.maxErrorSeconds;
  const budgetWarn =
    !budgetOver && objectives.maxErrorSeconds !== undefined && errorSeconds > objectives.maxErrorSeconds * 0.6;
  const costOver = monthlyCost > budget;
  const costWarn = !costOver && monthlyCost > budget * 0.85;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <button
          type="button"
          className="topbar__brand-mark"
          onClick={() => closeGame()}
          aria-label="Leave shift and return to campaign"
          title="Back to campaign"
        >
          <LogoMark size={30} />
        </button>
        <div className="topbar__level">
          <strong>{scenario.title}</strong>
          <span title={scenario.customer}>
            Act {scenario.act} · {shortName(scenario.customer)}
          </span>
        </div>
        <Btn
          variant="outline"
          size="sm"
          className="only-narrow"
          icon="layers"
          aria-label="Open component palette"
          onClick={() => togglePanel('paletteOpen')}
        >
          Add
        </Btn>
      </div>

      <div className="topbar__clock" title={`Shift clock: ${fmtClock(time)} of ${fmtClock(duration)}`}>
        <strong>{fmtClock(time)}</strong>
        <span>/ {fmtClock(duration)}</span>
      </div>

      <span className={`phase-pill phase-pill--${phase}`}>
        <Icon
          name={phase === 'running' ? 'play' : phase === 'paused' ? 'pause' : phase === 'ended' ? 'check' : 'book'}
          size={10}
        />
        {phase}
      </span>

      <div className="topbar__stats">
        <div
          className={`stat${budgetOver ? ' stat--over' : budgetWarn ? ' stat--warn' : ''}`}
          title="Error seconds: every second with at least one failed request"
        >
          <span className="stat__label">Error budget</span>
          <span className="stat__value">
            {Math.round(errorSeconds)}s
            <small>
              {objectives.maxErrorSeconds !== undefined ? `/ ≤${Math.round(objectives.maxErrorSeconds)}s` : 'spent'}
            </small>
          </span>
        </div>

        <div
          className={`stat${costOver ? ' stat--over' : costWarn ? ' stat--warn' : ''}`}
          title="Projected monthly cost of the deployed topology"
        >
          <span className="stat__label">Cost / mo</span>
          <span className="stat__value">
            {fmtMoney(monthlyCost)}
            <small>/ {fmtMoney(budget)}</small>
          </span>
        </div>

        <div className="stat stat--optional stat--p95" title="95th percentile latency">
          <span className="stat__label">p95</span>
          <span className="stat__value">
            {Math.round(snapshot?.p95 ?? 0)}
            <small>ms</small>
          </span>
        </div>

        <div className="stat stat--optional stat--rps" title="Requests per second right now">
          <span className="stat__label">Load</span>
          <span className="stat__value">
            {fmtRps(snapshot?.rps ?? 0)}
            <small>rps</small>
          </span>
        </div>

        {dataLoss > 0 && (
          <div className="stat stat--over" title="Data loss events this shift">
            <span className="stat__label">Data loss</span>
            <span className="stat__value">
              {dataLoss}
              <small>event{dataLoss === 1 ? '' : 's'}</small>
            </span>
          </div>
        )}
      </div>

      <div className="topbar__actions">
        <div className="segmented" role="group" aria-label="Simulation speed">
          {[1, 2, 5, 10].map((value) => (
            <button
              key={value}
              type="button"
              className="segmented__item"
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
              title={`Run at ${value}× speed`}
            >
              {value}×
            </button>
          ))}
        </div>

        <div className="topbar__divider" />

        <Btn
          variant="ghost"
          size="sm"
          icon="gauge"
          aria-label="Open metrics dashboard"
          title="Metrics dashboard (D)"
          onClick={() => togglePanel('dashboardOpen')}
        />
        <Btn
          variant="ghost"
          size="sm"
          icon="code"
          aria-label="Open infrastructure as code"
          title="IaC editor"
          onClick={openIac}
        />
        <Btn
          variant="ghost"
          size="sm"
          icon="help"
          aria-label="How to play"
          title="Help"
          onClick={() => togglePanel('helpOpen')}
        />

        <button
          type="button"
          className={`btn btn--ghost btn--icon bell${activeIncidents > 0 ? ' bell--live' : ''}`}
          onClick={() => togglePanel('incidentOpen')}
          aria-label={
            unreadAlerts > 0
              ? `Pager: ${unreadAlerts} unread incident${unreadAlerts === 1 ? '' : 's'}`
              : activeIncidents > 0
                ? `Pager: ${activeIncidents} active incident${activeIncidents === 1 ? '' : 's'}`
                : 'Pager: no active incidents'
          }
          title={
            unreadAlerts > 0
              ? `${unreadAlerts} unread page${unreadAlerts === 1 ? '' : 's'}`
              : activeIncidents > 0
                ? `${activeIncidents} active incident${activeIncidents === 1 ? '' : 's'}`
                : 'No active incidents'
          }
        >
          <Icon name="bell" size={17} />
          {unreadAlerts > 0 && <span className="bell__count">{unreadAlerts}</span>}
        </button>

        <div className="topbar__divider" />

        {phase === 'running' && (
          <Btn size="sm" icon="pause" onClick={pause} title="Pause the shift (Space)">
            Pause
          </Btn>
        )}
        {(phase === 'paused' || phase === 'briefing') && (
          <Btn size="sm" icon="play" onClick={resume} title="Resume the shift (Space)" disabled={phase === 'briefing'}>
            Resume
          </Btn>
        )}
        {phase === 'ended' && (
          <Btn size="sm" icon="book" variant="ink" onClick={() => togglePanel('postmortemOpen')}>
            Report
          </Btn>
        )}

        <Btn
          size="sm"
          variant={deployPending ? 'primary' : 'ghost'}
          icon="rocket"
          onClick={deploy}
          disabled={!deployPending || phase === 'ended'}
          title={deployPending ? 'Apply draft changes to the live system' : 'No unpublished changes'}
        >
          Deploy
          {deployPending && <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: 9, background: '#fff', marginLeft: 2 }} />}
        </Btn>
      </div>
    </header>
  );
}
