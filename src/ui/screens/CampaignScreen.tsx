import { useState } from 'react';
import { useGame } from '@/game/store';
import type { Profile, Scenario } from '@/sim/types';
import { Btn, Pill, StarRow } from '@/ui/components/ui';
import { LogoLockup } from '@/ui/components/Logo';
import { Icon } from '@/ui/components/Icon';
import {
  CAMPAIGN_LEVELS,
  groupByAct,
  isLevelUnlocked,
  previousLevelTitle,
  sandboxBest,
  starsFor,
  totalStars,
} from '@/ui/lib/campaign';
import { fmtDuration, fmtMoney, objectiveTargets } from '@/ui/lib/format';

export function CampaignScreen() {
  const profile = useGame((state) => state.profile);
  const go = useGame((state) => state.go);
  const openLevel = useGame((state) => state.openLevel);
  const resetProgress = useGame((state) => state.resetProgress);
  const togglePanel = useGame((state) => state.togglePanel);
  const [confirmReset, setConfirmReset] = useState(false);

  const stars = totalStars(profile);
  const acts = groupByAct(CAMPAIGN_LEVELS);
  const best = sandboxBest(profile);

  return (
    <div className="screen paper-bg campaign">
      <header className="campaign__top">
        <button
          type="button"
          className="campaign__brand"
          onClick={() => go('title')}
          style={{ padding: 2 }}
          aria-label="Back to title screen"
        >
          <LogoLockup compact />
        </button>
        <span className="spacer" />
        <span className="campaign__stat" title="Total stars earned">
          <Icon name="star" size={13} style={{ color: 'var(--amber)' }} />
          {stars} / {CAMPAIGN_LEVELS.length * 3 || 0}
        </span>
        <span className="campaign__stat" title="Levels completed">
          <Icon name="check-circle" size={13} style={{ color: 'var(--mint-2)' }} />
          {profile.completed.length} done
        </span>
        {best > 0 && (
          <span className="campaign__stat" title="Best sandbox score">
            <Icon name="bolt" size={13} style={{ color: 'var(--orange)' }} />
            best {Math.round(best).toLocaleString('en-US')}
          </span>
        )}
        <Btn variant="ghost" size="sm" icon="settings" onClick={() => go('settings')} aria-label="Settings" />
      </header>

      <div className="page">
        <div className="campaign__intro">
          <div style={{ flex: 1, minWidth: 260 }}>
            <span className="eyebrow">Pager duty, act by act</span>
            <h1 className="page__title" style={{ marginTop: 4 }}>
              Campaign
            </h1>
            <p className="page__lede" style={{ marginTop: 8 }}>
              Each shift is one system, one customer, and a handful of things that will break at the
              worst possible moment. Fix the design, not just the alert.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="outline" size="sm" icon="bolt" onClick={() => togglePanel('sandboxSetupOpen')}>
              Sandbox
            </Btn>
            <Btn
              variant={confirmReset ? 'danger' : 'ghost'}
              size="sm"
              icon="reset"
              onClick={() => {
                if (confirmReset) {
                  resetProgress();
                  setConfirmReset(false);
                } else {
                  setConfirmReset(true);
                  window.setTimeout(() => setConfirmReset(false), 4000);
                }
              }}
            >
              {confirmReset ? 'Really reset?' : 'Reset progress'}
            </Btn>
          </div>
        </div>

        {acts.length === 0 && (
          <div className="panel" style={{ padding: 24 }}>
            <p className="muted">Level content is still loading. Check back after the next deploy.</p>
          </div>
        )}

        {acts.map((group, index) => (
          <section className="act" key={group.meta.act} style={{ animationDelay: `${index * 60}ms` }}>
            <div className="act__head">
              <span className="act__num">{String(group.meta.act).padStart(2, '0')}</span>
              <div className="act__titles">
                <h2>{group.meta.title}</h2>
                <span>{group.meta.blurb}</span>
              </div>
              <span className="act__rule" />
              <span className="eyebrow" style={{ whiteSpace: 'nowrap' }}>
                {group.levels.length} shift{group.levels.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="levels">
              {group.levels.map((level) => (
                <LevelCard
                  key={level.id}
                  level={level}
                  index={CAMPAIGN_LEVELS.findIndex((candidate) => candidate.id === level.id) + 1}
                  profile={profile}
                  onOpen={() => openLevel(level.id)}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="sandbox-card">
          <span className="sandbox-card__icon">
            <Icon name="bolt" size={26} />
          </span>
          <div style={{ display: 'grid', gap: 3 }}>
            <div className="row" style={{ gap: 8 }}>
              <h3>Sandbox</h3>
              <Pill tone="ghost">no score to protect</Pill>
            </div>
            <p>
              Every component unlocked, random incidents, traffic that keeps climbing. Score is
              survival plus availability plus a little frugality.
            </p>
          </div>
          <div className="sandbox-card__best">
            <span className="eyebrow">Best score</span>
            <strong>{best > 0 ? Math.round(best).toLocaleString('en-US') : '—'}</strong>
            <Btn size="sm" icon="play" variant="ink" onClick={() => togglePanel('sandboxSetupOpen')}>
              Set up
            </Btn>
          </div>
        </section>

        <p className="muted" style={{ marginTop: 26, fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={13} />
          Progress saves in this browser. Three stars means you survived, stayed under budget, and met
          every objective.
        </p>
      </div>
    </div>
  );
}

function LevelCard({
  level,
  index,
  profile,
  onOpen,
}: {
  level: Scenario;
  index: number;
  profile: Profile;
  onOpen: () => void;
}) {
  const unlocked = isLevelUnlocked(level.id, profile);
  const stars = starsFor(profile, level.id);
  const completed = profile.completed.includes(level.id) || stars > 0;
  const objectives = objectiveTargets(level.objectives);
  const previous = previousLevelTitle(level.id);
  const teaser = level.brief.split(/(?<=\.)\s/)[0] ?? level.brief;

  return (
    <button
      type="button"
      className={`level-card${unlocked ? '' : ' level-card--locked'}${completed ? ' level-card--done' : ''}`}
      onClick={unlocked ? onOpen : undefined}
      disabled={!unlocked}
      aria-label={
        unlocked
          ? `${level.title}. ${completed ? `${stars} stars.` : 'Not completed.'} Open briefing.`
          : `${level.title}. Locked. Finish ${previous ?? 'the previous shift'} first.`
      }
    >
      <div className="level-card__top">
        <span className="level-card__index">{String(index).padStart(2, '0')}</span>
        <span className="level-card__titles">
          <span className="level-card__title">{level.title}</span>
          <span className="level-card__sub">{level.subtitle}</span>
        </span>
      </div>

      {completed && (
        <span className="level-card__stamp" aria-hidden="true">
          <Icon name="check" size={15} strokeWidth={2.6} />
        </span>
      )}

      <span className="level-card__customer">
        <strong>{level.customer}</strong>
        <span>{teaser}</span>
      </span>

      <span className="level-card__objectives">
        {objectives.slice(0, 3).map((objective) => (
          <span className="pill" key={objective.key}>
            {objective.label} {objective.target}
          </span>
        ))}
        {objectives.length === 0 && <span className="pill pill--ghost">survive the shift</span>}
      </span>

      {unlocked ? (
        <span className="level-card__foot">
          <span className="pill pill--ghost" title="Starting budget">
            {fmtMoney(level.startingBudgetPerMonth)}/mo
          </span>
          <span className="pill pill--ghost" title="Shift length">
            {fmtDuration(level.duration)}
          </span>
          <span className="spacer" />
          <span className="level-card__stars" title={`${stars} of 3 stars`}>
            <StarRow value={stars} />
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
            {completed ? 'Replay' : 'Start'}{' '}
            <Icon name="arrow-right" size={11} style={{ display: 'inline-block', verticalAlign: '-1px' }} />
          </span>
        </span>
      ) : (
        <span className="level-card__lock">
          <Icon name="lock" size={13} />
          Finish {previous ? `“${previous}”` : 'the previous shift'} to unlock
          <span className="spacer" />
          <span className="level-card__stars" title={`${stars} of 3 stars`}>
            <StarRow value={stars} />
          </span>
        </span>
      )}
    </button>
  );
}
