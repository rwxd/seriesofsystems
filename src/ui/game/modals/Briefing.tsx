import { useGame } from '@/game/store';
import { COMPONENT_SPECS } from '@/sim/catalog';
import { Btn, Modal, Pill } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { fmtDuration, fmtMoney, objectiveTargets } from '@/ui/lib/format';

export function BriefingModal() {
  const scenario = useGame((state) => state.scenario);
  const phase = useGame((state) => state.phase);
  const screen = useGame((state) => state.screen);
  const showHints = useGame((state) => state.profile.settings.showHints);
  const startRun = useGame((state) => state.startRun);
  const closeGame = useGame((state) => state.closeGame);

  if (!scenario) return null;
  const open = screen === 'game' && phase === 'briefing';
  const objectives = objectiveTargets(scenario.objectives);
  const startingCost = scenario.initialTopology.nodes.reduce(
    (sum, node) => sum + COMPONENT_SPECS[node.kind].costPerMonth(node, scenario.world, 0),
    0,
  );
  const kinds = new Map<string, number>();
  for (const node of scenario.initialTopology.nodes) {
    kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
  }

  return (
    <Modal
      open={open}
      onClose={() => closeGame()}
      kicker={`Shift briefing · Act ${scenario.act}`}
      title={scenario.title}
      sub={scenario.subtitle}
      icon="book"
      size="lg"
      dismissable={false}
      footer={
        <>
          <Btn variant="ghost" icon="arrow-left" onClick={() => closeGame()}>
            Campaign map
          </Btn>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
            {scenario.incidents.length} known risk{scenario.incidents.length === 1 ? '' : 's'} scheduled
          </span>
          <Btn
            variant="primary"
            size="lg"
            icon="play"
            onClick={() => startRun()}
            autoFocus
          >
            Start shift
          </Btn>
        </>
      }
    >
      <div className="brief">
        <div>
          <div className="brief__customer">
            <span className="brief__avatar">
              <Icon name="customer" size={18} />
            </span>
            <div>
              <strong>{scenario.customer}</strong>
              <span>has paged you at an unreasonable hour</span>
            </div>
          </div>
          <p className="brief__text">{scenario.brief}</p>

          {showHints && scenario.hints.length > 0 && (
            <div className="brief__block" style={{ marginTop: 14, background: 'var(--amber-soft)', borderStyle: 'dashed' }}>
              <h4>
                <Icon name="bulb" size={11} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Hints
              </h4>
              <ul className="hintlist">
                {scenario.hints.map((hint) => (
                  <li key={hint}>
                    <Icon name="bulb" size={13} />
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="brief__sub">
          <div className="brief__block">
            <h4>Objectives</h4>
            {objectives.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Survive until the shift ends.</p>
            ) : (
              objectives.map((objective) => (
                <div className="objective" key={objective.key}>
                  <Icon name="check-circle" size={13} className="objective__icon" />
                  <span>{objective.label}</span>
                  <b>{objective.target}</b>
                </div>
              ))
            )}
          </div>

          <div className="brief__block">
            <h4>Starting point</h4>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {[...kinds.entries()].map(([kind, count]) => (
                <Pill key={kind} tone="ghost">
                  {COMPONENT_SPECS[kind as keyof typeof COMPONENT_SPECS].shortLabel}
                  {count > 1 ? ` ×${count}` : ''}
                </Pill>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Current cost</span>
              <span className="brief__cost">
                <strong>{fmtMoney(startingCost)}</strong>
                <span className="muted" style={{ fontSize: 10 }}>
                  /mo · budget {fmtMoney(scenario.startingBudgetPerMonth)}
                </span>
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Shift length</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fmtDuration(scenario.duration)}
              </span>
            </div>
            {scenario.requiresDatabase && (
              <div className="brief__topology" style={{ marginTop: 10 }}>
                <Pill tone="orange">every compute node needs a path to a database</Pill>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
