import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Modal } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { DIFFICULTIES } from '@/ui/lib/campaign';

export function SandboxSetup() {
  const open = useGame((state) => state.ui.sandboxSetupOpen);
  const togglePanel = useGame((state) => state.togglePanel);
  const openSandbox = useGame((state) => state.openSandbox);
  const [difficulty, setDifficulty] = useState<'relaxed' | 'normal' | 'chaos'>('normal');

  const close = () => togglePanel('sandboxSetup');

  return (
    <Modal
      open={open}
      onClose={close}
      kicker="Sandbox"
      title="Pick a difficulty"
      sub="Every component unlocked. Random incidents, growing traffic, one score."
      icon="bolt"
      size="sm"
      footer={
        <>
          <Btn variant="ghost" onClick={close}>
            Cancel
          </Btn>
          <span className="spacer" />
          <Btn
            variant="primary"
            icon="play"
            onClick={() => {
              openSandbox(difficulty);
              close();
            }}
          >
            Start sandbox
          </Btn>
        </>
      }
    >
      <div className="difficulty-grid" role="radiogroup" aria-label="Sandbox difficulty">
        {DIFFICULTIES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="difficulty"
            role="radio"
            aria-checked={difficulty === option.id}
            onClick={() => setDifficulty(option.id)}
          >
            <span
              className="difficulty__icon"
              style={{
                background:
                  option.id === 'relaxed'
                    ? 'var(--mint-soft)'
                    : option.id === 'normal'
                      ? 'var(--sky-soft)'
                      : 'var(--orange-soft)',
              }}
            >
              <Icon name={option.id === 'relaxed' ? 'shield' : option.id === 'normal' ? 'gauge' : 'bolt'} size={19} />
            </span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span className="difficulty__name">{option.name}</span>
              <span className="difficulty__blurb">{option.blurb}</span>
            </span>
            <span className="difficulty__pick" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
        {DIFFICULTIES.find((option) => option.id === difficulty)?.detail}
      </p>
    </Modal>
  );
}
