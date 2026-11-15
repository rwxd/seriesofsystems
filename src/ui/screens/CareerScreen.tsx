import { useGame } from '@/game/store';
import { CAREER_STAGES, isCareerUnlocked } from '@/content/career';
import type { Scenario } from '@/sim/types';
import { Btn, StarRow } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LogoMark } from '@/ui/components/Logo';
import { fmtDuration, fmtMoney, objectiveTargets } from '@/ui/lib/format';

export function CareerScreen() {
  const profile = useGame((state) => state.profile);
  const go = useGame((state) => state.go);
  const openCareerStage = useGame((state) => state.openCareerStage);

  const done = CAREER_STAGES.filter((stage) => profile.completed.includes(stage.id)).length;
  const stars = CAREER_STAGES.reduce((sum, stage) => sum + (profile.stars[stage.id] ?? 0), 0);

  return (
    <div className="screen paper-bg campaign">
      <header className="campaign__top">
        <button
          type="button"
          className="campaign__brand"
          onClick={() => go('title')}
          aria-label="Back to title screen"
        >
          <LogoMark size={26} />
          <span>Series of Systems</span>
        </button>
        <span className="spacer" />
        <span className="campaign__stat">
          <Icon name="series" size={12} /> {done}/{CAREER_STAGES.length} stages
        </span>
        <span className="campaign__stat">
          <Icon name="star" size={12} /> {stars}/{CAREER_STAGES.length * 3}
        </span>
        <Btn variant="ghost" size="sm" icon="settings" onClick={() => go('settings')} aria-label="Settings" />
      </header>

      <div className="page">
        <div className="campaign__intro">
          <div style={{ flex: 1, minWidth: 260 }}>
            <span className="eyebrow">Career mode · one engineer, one box, one very long week</span>
            <h1 className="page__title" style={{ marginTop: 4 }}>
              From one box to planet scale
            </h1>
            <p className="page__lede" style={{ marginTop: 8 }}>
              No lab. No clean slate. You inherit a single web server in a closet and a customer who
              thinks backups are a subscription. Each stage adds another layer of reality: a database,
              a load balancer, a cache, Kubernetes, and eventually regions you have never visited.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="outline" size="sm" icon="arrow-left" onClick={() => go('title')}>
              Title
            </Btn>
            <Btn variant="outline" size="sm" icon="layers" onClick={() => go('campaign')}>
              Campaign
            </Btn>
            <Btn variant="outline" size="sm" icon="trace" onClick={() => go('scenarios')}>
              Scenarios
            </Btn>
          </div>
        </div>

        <div className="act">
          <div className="act__head">
            <span className="act__num">C</span>
            <div className="act__titles">
              <h2>The ladder</h2>
              <span>Finish a stage to unlock the next one. Replays keep your best stars.</span>
            </div>
            <span className="act__rule" />
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
              {done}/{CAREER_STAGES.length} survived
            </span>
          </div>

          <div className="levels">
            {CAREER_STAGES.map((stage, index) => {
              const unlocked = isCareerUnlocked(profile, stage.id);
              const completed = profile.completed.includes(stage.id);
              const stageStars = profile.stars[stage.id] ?? 0;
              return (
                <CareerCard
                  key={stage.id}
                  stage={stage}
                  index={index + 1}
                  unlocked={unlocked}
                  completed={completed}
                  stars={stageStars}
                  previous={index > 0 ? CAREER_STAGES[index - 1] : undefined}
                  onOpen={() => openCareerStage(stage.id)}
                />
              );
            })}
          </div>
        </div>

        <div className="howto__callout" style={{ marginTop: 26 }}>
          <Icon name="bulb" size={18} />
          <span>
            A career stage is a normal shift: deploy, run, get paged, fix, and read the postmortem. The
            difference is that the next stage assumes the previous one taught you something.
          </span>
        </div>
      </div>
    </div>
  );
}

function CareerCard({
  stage,
  index,
  unlocked,
  completed,
  stars,
  previous,
  onOpen,
}: {
  stage: Scenario;
  index: number;
  unlocked: boolean;
  completed: boolean;
  stars: number;
  previous?: Scenario;
  onOpen: () => void;
}) {
  const objectives = objectiveTargets(stage.objectives);
  const teaser = stage.brief.split(/(?<=\.)\s/)[0] ?? stage.brief;

  return (
    <button
      type="button"
      className={`level-card${unlocked ? '' : ' level-card--locked'}${completed ? ' level-card--done' : ''}`}
      onClick={unlocked ? onOpen : undefined}
      disabled={!unlocked}
      aria-label={
        unlocked
          ? `${stage.title}. ${completed ? `${stars} stars.` : 'Not completed.'} Open briefing.`
          : `${stage.title}. Locked. Finish ${previous?.title ?? 'the previous stage'} first.`
      }
    >
      <div className="level-card__top">
        <span className="level-card__index">{String(index).padStart(2, '0')}</span>
        <span className="level-card__titles">
          <span className="level-card__title">{stage.title}</span>
          <span className="level-card__sub">{stage.subtitle}</span>
        </span>
      </div>

      {completed && (
        <span className="level-card__stamp" aria-hidden="true">
          <Icon name="check" size={15} strokeWidth={2.6} />
        </span>
      )}

      <span className="level-card__customer">
        <strong>{stage.customer}</strong>
        <span>{teaser}</span>
      </span>

      <span className="level-card__objectives">
        {objectives.slice(0, 3).map((objective) => (
          <span className="pill" key={objective.key}>
            {objective.label} {objective.target}
          </span>
        ))}
      </span>

      {unlocked ? (
        <span className="level-card__foot">
          <span className="pill pill--ghost">{fmtMoney(stage.startingBudgetPerMonth)}/mo</span>
          <span className="pill pill--ghost">{fmtDuration(stage.duration)}</span>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
            {completed ? 'Replay' : index === 1 ? 'Start here' : 'Start'}{' '}
            <Icon name="arrow-right" size={11} style={{ display: 'inline-block', verticalAlign: '-1px' }} />
          </span>
        </span>
      ) : (
        <span className="level-card__lock">
          <Icon name="lock" size={13} />
          Finish “{previous?.title ?? 'the previous stage'}” to unlock
        </span>
      )}

      <span className="level-card__stars" title={`${stars} of 3 stars`}>
        <StarRow value={stars} />
      </span>
    </button>
  );
}
