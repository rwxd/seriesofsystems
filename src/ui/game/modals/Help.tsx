import { useGame } from '@/game/store';
import { Btn, Modal } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { ControlsReference } from '@/ui/screens/HowToScreen';

export function HelpModal() {
  const open = useGame((state) => state.ui.helpOpen);
  const togglePanel = useGame((state) => state.togglePanel);
  const go = useGame((state) => state.go);

  return (
    <Modal
      open={open}
      onClose={() => togglePanel('help')}
      kicker="Field manual"
      title="How this works"
      sub="The short version. The long version is on the title screen."
      icon="help"
      size="lg"
      footer={
        <>
          <Btn
            variant="ghost"
            icon="book"
            onClick={() => {
              togglePanel('help');
              go('howto');
            }}
          >
            Full guide
          </Btn>
          <span className="spacer" />
          <Btn variant="primary" onClick={() => togglePanel('help')}>
            Back to the shift
          </Btn>
        </>
      }
    >
      <div className="help-sections">
        <section className="help-section">
          <h4>
            <Icon name="grip" size={14} /> Controls
          </h4>
          <ControlsReference />
        </section>

        <section className="help-section">
          <h4>
            <Icon name="series" size={14} /> The loop in one breath
          </h4>
          <p>
            Edit the topology (draft) → deploy → watch the metrics → get paged → run a runbook or fix
            the design → deploy again. Any edit pauses the simulation, so you always get a moment to
            think before the next request lands on the thing you just changed.
          </p>
        </section>

        <section className="help-section">
          <h4>
            <Icon name="warning" size={14} /> Things that will page you
          </h4>
          <ul style={{ display: 'grid', gap: 5 }}>
            <li>
              <b>Zone failure.</b> Everything zonal in that zone goes down. Regional components with
              multi-AZ survive.
            </li>
            <li>
              <b>Database failover.</b> Multi-AZ blips for a few seconds. Replicas without automatic
              failover mean real downtime, and async replication means lost writes.
            </li>
            <li>
              <b>Bad deploys and traffic spikes.</b> Readiness probes and rate limits are the difference
              between an incident and a non-event.
            </li>
            <li>
              <b>Certificates and caches.</b> Both expire. One takes the site down, the other takes the
              database down.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h4>
            <Icon name="gauge" size={14} /> Reading the dashboard
          </h4>
          <p>
            Utilization above 75% is a warning; above 90% a queue is forming. p95 above the objective
            means real users are waiting. Error seconds are the honest score: one failed request in a
            second counts the whole second.
          </p>
        </section>

        <section className="help-section">
          <h4>
            <Icon name="rocket" size={14} /> Deploying
          </h4>
          <p>
            Edits create a draft and pause the run. The Deploy button applies the draft and logs an
            event on the timeline. A deploy is not a save point: incidents keep firing on their own
            schedule.
          </p>
        </section>
      </div>
    </Modal>
  );
}
