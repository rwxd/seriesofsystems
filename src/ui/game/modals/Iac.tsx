import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Modal } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';

export function IacModal() {
  const open = useGame((state) => state.ui.iacOpen);
  const yamlText = useGame((state) => state.ui.yamlText);
  const yamlErrors = useGame((state) => state.ui.yamlErrors);
  const setYamlText = useGame((state) => state.setYamlText);
  const applyYaml = useGame((state) => state.applyYaml);
  const togglePanel = useGame((state) => state.togglePanel);
  const notify = useGame((state) => state.notify);
  const deployPending = useGame((state) => state.deployPending);
  const [editing, setEditing] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yamlText ?? '');
      notify('YAML copied to the clipboard');
    } catch {
      notify('Copy blocked by the browser — select the text instead');
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setEditing(false);
        togglePanel('iacOpen');
      }}
      kicker="Infrastructure as code"
      title="Topology manifest"
      sub="The draft topology, serialized. Edit it, apply it, then deploy like any other change."
      icon="code"
      size="lg"
      blueprint={false}
      footer={
        <>
          <Btn variant="ghost" icon="close" onClick={() => togglePanel('iacOpen')}>
            Close
          </Btn>
          <span className="spacer" />
          <Btn variant="outline" icon="copy" onClick={copy}>
            Copy
          </Btn>
          <Btn
            variant="primary"
            icon="check"
            onClick={() => applyYaml()}
            title="Parse the YAML and replace the draft topology"
          >
            Apply YAML
          </Btn>
        </>
      }
    >
      <div className="iac">
        <div className="iac__toolbar">
          <div className="segmented" role="group" aria-label="YAML mode">
            <button
              type="button"
              className="segmented__item"
              aria-pressed={!editing}
              onClick={() => setEditing(false)}
            >
              Read
            </button>
            <button
              type="button"
              className="segmented__item"
              aria-pressed={editing}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          </div>
          <span className="pill pill--ghost">
            <Icon name="code" size={10} /> apiVersion seriesofsystems/v1
          </span>
          {deployPending && <span className="pill pill--orange">draft has unpublished changes</span>}
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-faint)' }}>
            {(yamlText ?? '').split('\n').length} lines
          </span>
        </div>

        <div className="iac__editor">
          <textarea
            className="textarea"
            value={yamlText ?? ''}
            onChange={(event) => setYamlText(event.target.value)}
            readOnly={!editing}
            spellCheck={false}
            aria-label="Topology YAML"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              event.preventDefault();
              const target = event.currentTarget;
              const start = target.selectionStart;
              const value = target.value;
              const next = `${value.slice(0, start)}  ${value.slice(target.selectionEnd)}`;
              setYamlText(next);
              requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 2;
              });
            }}
          />
        </div>

        {yamlErrors.length > 0 && (
          <div className="iac__errors" role="alert">
            {yamlErrors.map((error, index) => (
              <div key={`${error}-${index}`}>
                <Icon name="alert" size={12} />
                <span>{error}</span>
              </div>
            ))}
          </div>
        )}

        <div className="iac__note">
          <Icon name="info" size={14} style={{ flex: 'none', marginTop: 1 }} />
          <span>
            Applying YAML replaces the draft topology. Existing nodes keep their positions; new nodes
            are auto-placed. Nothing reaches users until you deploy.
          </span>
        </div>
      </div>
    </Modal>
  );
}
