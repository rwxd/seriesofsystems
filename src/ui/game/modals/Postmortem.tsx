import { useGame } from '@/game/store';
import type { GameEvent } from '@/sim/types';
import { Btn, Modal, StarRow } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { fmtAvail, fmtClock, fmtMoney, fmtMs, fmtNum, shortName } from '@/ui/lib/format';
import { nextCampaignLevel } from '@/ui/lib/campaign';

export function PostmortemModal() {
  const open = useGame((state) => state.ui.postmortemOpen);
  const postmortem = useGame((state) => state.postmortem);
  const scenario = useGame((state) => state.scenario);
  const togglePanel = useGame((state) => state.togglePanel);
  const retry = useGame((state) => state.retry);
  const nextLevel = useGame((state) => state.nextLevel);
  const closeGame = useGame((state) => state.closeGame);

  if (!postmortem || !scenario) return null;
  const success = postmortem.outcome === 'success';
  const next = nextCampaignLevel(scenario.sandbox ? undefined : postmortem.levelId);

  return (
    <Modal
      open={open}
      onClose={() => togglePanel('postmortem')}
      kicker={`Postmortem · ${postmortem.levelTitle}`}
      title={success ? 'Shift survived' : 'Shift ended badly'}
      sub={`${postmortem.levelTitle} · ${shortName(scenario.customer)}`}
      icon={success ? 'check-circle' : 'alert'}
      size="xl"
      footer={
        <>
          <Btn variant="ghost" icon="arrow-left" onClick={() => closeGame()}>
            Campaign map
          </Btn>
          <span className="spacer" />
          <Btn icon="reset" onClick={() => retry()}>
            Retry shift
          </Btn>
          <Btn
            variant="primary"
            icon={next && !scenario.sandbox ? 'arrow-right' : 'arrow-left'}
            onClick={() => nextLevel()}
          >
            {next && !scenario.sandbox ? 'Next shift' : 'Campaign map'}
          </Btn>
        </>
      }
    >
      <div className={`pm${success ? '' : ' pm--failure'}`}>
        <div className="pm__head">
          <div>
            <StarRow value={postmortem.stars} large />
            <h3 className="pm__headline" style={{ marginTop: 6 }}>
              {postmortem.headline}
            </h3>
            <p className="pm__summary">{postmortem.summary}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="eyebrow">Stars</span>
            <div className="mono" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
              {postmortem.stars}
              <span style={{ fontSize: 18, opacity: 0.5 }}>/3</span>
            </div>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-soft)' }}>
              {success ? 'shift complete' : 'shift incomplete'}
            </span>
          </div>
        </div>

        <div className="pm__metrics">
          <Metric label="Availability" value={fmtAvail(postmortem.metrics.availability)} />
          <Metric label="Error seconds" value={`${Math.round(postmortem.metrics.errorSeconds)}s`} />
          <Metric label="p95" value={fmtMs(postmortem.metrics.p95)} />
          <Metric label="Cost / mo" value={fmtMoney(postmortem.metrics.monthlyCost)} />
          <Metric
            label="Data loss"
            value={postmortem.metrics.dataLossEvents === 0 ? 'none' : `${postmortem.metrics.dataLossEvents} ev`}
          />
        </div>

        <div className="brief__block" style={{ padding: '10px 14px' }}>
          <h4>Objectives</h4>
          <div className="objectives-result">
            {postmortem.objectives.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No explicit objectives for this shift.</span>
            )}
            {postmortem.objectives.map((objective) => (
              <div
                key={objective.key}
                className={`objectives-result__row objectives-result__row--${objective.met ? 'pass' : 'fail'}`}
              >
                <Icon
                  name={objective.met ? 'check-circle' : 'down'}
                  size={14}
                  className="objectives-result__icon"
                />
                <span>{objective.label}</span>
                <b>{objective.actual}</b>
                <span className="mono faint" style={{ fontSize: 10 }}>
                  {objective.target}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pm__cols">
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="pm__block">
              <h4>
                <Icon name="search" size={11} /> Root cause
              </h4>
              <p>{postmortem.rootCause}</p>
            </div>

            <div className="pm__block">
              <h4>
                <Icon name="check-circle" size={11} /> Action items
              </h4>
              <ul className="pm__list">
                {postmortem.actionItems.map((item) => (
                  <li key={item}>
                    <Icon name="arrow-right" size={12} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pm__block">
              <h4>
                <Icon name="layers" size={11} /> Contributing factors
              </h4>
              <ul className="pm__list">
                {postmortem.contributingFactors.map((factor) => (
                  <li key={factor}>
                    <Icon name="chevron-right" size={12} />
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div className="pm__block">
              <h4>
                <Icon name="clock" size={11} /> Timeline
              </h4>
              <div className="pm__timeline">
                {postmortem.timeline.length === 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Nothing happened, apparently.</span>
                )}
                {postmortem.timeline.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </div>

            <div className="pm__block">
              <h4>
                <Icon name="activity" size={11} /> Traffic handled
              </h4>
              <div className="stat-grid">
                <div className="stat-cell">
                  <span>Requests</span>
                  <strong>{fmtNum(postmortem.metrics.totalRequests)}</strong>
                </div>
                <div className="stat-cell">
                  <span>Failed</span>
                  <strong>{fmtNum(postmortem.metrics.failedRequests)}</strong>
                </div>
                <div className="stat-cell">
                  <span>Shift length</span>
                  <strong>{fmtClock(postmortem.metrics.duration)}</strong>
                </div>
                <div className="stat-cell">
                  <span>Budget</span>
                  <strong>{fmtMoney(scenario.startingBudgetPerMonth)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pm__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EventRow({ event }: { event: GameEvent }) {
  return (
    <div className={`pm__event pm__event--${event.kind}`}>
      <time>{fmtClock(event.at)}</time>
      <span className="pm__event-dot" />
      <span>
        <b>{event.title}</b> <span>{event.message}</span>
      </span>
    </div>
  );
}
