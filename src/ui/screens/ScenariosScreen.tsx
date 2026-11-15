import { useGame } from '@/game/store';
import { SCENARIOS } from '@/content/scenarios';
import type { Scenario } from '@/sim/types';
import { Btn, StarRow } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LogoMark } from '@/ui/components/Logo';
import { fmtDuration, fmtMoney, objectiveTargets } from '@/ui/lib/format';

export function ScenariosScreen() {
  const profile = useGame((state) => state.profile);
  const go = useGame((state) => state.go);
  const openScenario = useGame((state) => state.openScenario);

  const stars = SCENARIOS.reduce((sum, scenario) => sum + (profile.stars[scenario.id] ?? 0), 0);

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
          <Icon name="star" size={12} /> {stars}/{SCENARIOS.length * 3}
        </span>
        <Btn variant="ghost" size="sm" icon="settings" onClick={() => go('settings')} aria-label="Settings" />
      </header>

      <div className="page">
        <div className="campaign__intro">
          <div style={{ flex: 1, minWidth: 260 }}>
            <span className="eyebrow">Scenarios · isolated incidents with a point</span>
            <h1 className="page__title" style={{ marginTop: 4 }}>
              Scenarios
            </h1>
            <p className="page__lede" style={{ marginTop: 8 }}>
              No ladder, no unlocks. Pick a bad day, bring your own judgment, and see whether your
              architecture survives the specific thing that is about to happen.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="outline" size="sm" icon="arrow-left" onClick={() => go('title')}>
              Title
            </Btn>
            <Btn variant="outline" size="sm" icon="layers" onClick={() => go('campaign')}>
              Campaign
            </Btn>
            <Btn variant="outline" size="sm" icon="series" onClick={() => go('career')}>
              Career
            </Btn>
          </div>
        </div>

        <div className="levels" style={{ marginTop: 22 }}>
          {SCENARIOS.map((scenario, index) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              index={index + 1}
              stars={profile.stars[scenario.id] ?? 0}
              onOpen={() => openScenario(scenario.id)}
            />
          ))}
        </div>

        <div className="howto__callout" style={{ marginTop: 26 }}>
          <Icon name="bug" size={18} />
          <span>
            Scenarios are meant to be replayed. Change one assumption, rerun it, and watch the
            postmortem tell a different story.
          </span>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  index,
  stars,
  onOpen,
}: {
  scenario: Scenario;
  index: number;
  stars: number;
  onOpen: () => void;
}) {
  const objectives = objectiveTargets(scenario.objectives);
  const teaser = scenario.brief.split(/(?<=\.)\s/)[0] ?? scenario.brief;

  return (
    <button
      type="button"
      className="level-card"
      onClick={onOpen}
      aria-label={`${scenario.title}. ${stars} stars. Open briefing.`}
    >
      <div className="level-card__top">
        <span className="level-card__index">{String(index).padStart(2, '0')}</span>
        <span className="level-card__titles">
          <span className="level-card__title">{scenario.title}</span>
          <span className="level-card__sub">{scenario.subtitle}</span>
        </span>
      </div>

      <span className="level-card__customer">
        <strong>{scenario.customer}</strong>
        <span>{teaser}</span>
      </span>

      <span className="level-card__objectives">
        {objectives.slice(0, 3).map((objective) => (
          <span className="pill" key={objective.key}>
            {objective.label} {objective.target}
          </span>
        ))}
      </span>

      <span className="level-card__foot">
        <span className="pill pill--ghost">{fmtMoney(scenario.startingBudgetPerMonth)}/mo</span>
        <span className="pill pill--ghost">{fmtDuration(scenario.duration)}</span>
        <span className="spacer" />
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
          Start <Icon name="arrow-right" size={11} style={{ display: 'inline-block', verticalAlign: '-1px' }} />
        </span>
      </span>

      <span className="level-card__stars" title={`${stars} of 3 stars`}>
        <StarRow value={stars} />
      </span>
    </button>
  );
}
