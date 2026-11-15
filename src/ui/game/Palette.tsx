import { useGame } from '@/game/store';
import { COMPONENT_ORDER, COMPONENT_SPECS } from '@/sim/catalog';
import type { ComponentCategory, ComponentKind } from '@/sim/types';
import { Icon, iconForKind } from '@/ui/components/Icon';
import { autoPlacement } from './layout';
import { unlockHintFor } from '@/ui/lib/campaign';
import { fmtMoney } from '@/ui/lib/format';

const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  edge: 'Edge',
  ingress: 'Ingress',
  compute: 'Compute',
  data: 'Data',
};

export function Palette() {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const selectedNodeId = useGame((state) => state.selectedNodeId);
  const addNode = useGame((state) => state.addNode);
  const togglePanel = useGame((state) => state.togglePanel);
  const paletteOpen = useGame((state) => state.ui.paletteOpen);

  if (!scenario) return null;

  const unlocked = new Set<ComponentKind>(scenario.unlockedKinds);
  const topology = draft ?? scenario.initialTopology;
  const selected = topology.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const categories: ComponentCategory[] = ['edge', 'ingress', 'compute', 'data'];

  return (
    <aside className={`palette${paletteOpen ? ' is-open' : ''}`} aria-label="Component palette">
      <div className="palette__head">
        <Icon name="layers" size={14} />
        <h2>Components</h2>
        <span className="pill pill--ghost">
          {unlocked.size}/{COMPONENT_ORDER.length}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm only-narrow"
          onClick={() => togglePanel('palette')}
          aria-label="Close palette"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="palette__scroll">
        {categories.map((category) => {
          const kinds = COMPONENT_ORDER.filter((kind) => COMPONENT_SPECS[kind].category === category);
          if (kinds.length === 0) return null;
          return (
            <div className="palette__group" key={category}>
              <div className="palette__group-title">{CATEGORY_LABEL[category]}</div>
              {kinds.map((kind) => {
                const spec = COMPONENT_SPECS[kind];
                const isUnlocked = unlocked.has(kind);
                return (
                  <div key={kind}>
                    <button
                      type="button"
                      className={`palette-item${isUnlocked ? '' : ' palette-item--locked'}`}
                      disabled={!isUnlocked}
                      title={
                        isUnlocked
                          ? `${spec.label} — ${spec.description}`
                          : `${spec.label} is locked. ${unlockHintFor(kind)}.`
                      }
                      onClick={() => {
                        const placement = autoPlacement(kind, spec.scope, scenario.world, topology, selected);
                        addNode(kind, placement.placement, placement.x, placement.y);
                      }}
                      aria-label={isUnlocked ? `Add ${spec.label}` : `${spec.label} locked`}
                    >
                      <span className="palette-item__icon">
                        <Icon name={iconForKind(kind)} size={17} />
                      </span>
                      <span className="palette-item__labels">
                        <span className="palette-item__name">{spec.label}</span>
                        <span className="palette-item__sub">
                          {spec.shortLabel} · {fmtMoney(spec.baseCostPerMonth)}/mo
                        </span>
                      </span>
                      <span className="palette-item__add">
                        <Icon name={isUnlocked ? 'plus' : 'lock'} size={14} />
                      </span>
                    </button>
                    {!isUnlocked && (
                      <div className="palette-item__unlock">
                        <Icon name="lock" size={10} style={{ marginTop: 1, flex: 'none' }} />
                        {unlockHintFor(kind)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="palette__foot">
        <strong>Click to place.</strong> New components land near your selection. Everything you edit is
        a draft until you deploy.
      </div>
    </aside>
  );
}
