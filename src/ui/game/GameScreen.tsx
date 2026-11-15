import { useEffect, useRef } from 'react';
import { useGame } from '@/game/store';
import { Btn } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { playCue } from '@/ui/lib/sound';
import { fmtMoney } from '@/ui/lib/format';
import { TopBar } from './TopBar';
import { Palette } from './Palette';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { Dashboard } from './Dashboard';
import { BriefingModal } from './modals/Briefing';
import { IncidentModal } from './modals/Incident';
import { PostmortemModal } from './modals/Postmortem';
import { IacModal } from './modals/Iac';

export function GameScreen() {
  const scenario = useGame((state) => state.scenario);
  const draft = useGame((state) => state.draft);
  const snapshot = useGame((state) => state.snapshot);
  const phase = useGame((state) => state.phase);
  const events = useGame((state) => state.events);
  const deployPending = useGame((state) => state.deployPending);
  const selectedNodeId = useGame((state) => state.selectedNodeId);
  const selectedLinkId = useGame((state) => state.selectedLinkId);
  const linkFrom = useGame((state) => state.linkFrom);
  const paletteOpen = useGame((state) => state.ui.paletteOpen);
  const reducedMotion = useGame((state) => state.profile.settings.reducedMotion);
  const sound = useGame((state) => state.profile.settings.sound);

  const selectNode = useGame((state) => state.selectNode);
  const selectLink = useGame((state) => state.selectLink);
  const deleteNode = useGame((state) => state.deleteNode);
  const deleteLink = useGame((state) => state.deleteLink);
  const beginLink = useGame((state) => state.beginLink);
  const cancelLink = useGame((state) => state.cancelLink);
  const togglePanel = useGame((state) => state.togglePanel);
  const setSpeed = useGame((state) => state.setSpeed);
  const pause = useGame((state) => state.pause);
  const resume = useGame((state) => state.resume);
  const deploy = useGame((state) => state.deploy);
  const closeGame = useGame((state) => state.closeGame);
  const retry = useGame((state) => state.retry);

  const lastIncident = useRef<string | null>(null);
  const lastDeployCount = useRef(0);
  const endedRef = useRef(false);

  /* Audio cues + pager auto-open for critical incidents. */
  useEffect(() => {
    if (!scenario || !snapshot) return;
    const active = snapshot.incidents;
    const newest = active[active.length - 1];
    if (newest && newest.id !== lastIncident.current) {
      lastIncident.current = newest.id;
      playCue('page', sound);
      const ui = useGame.getState().ui;
      if (
        newest.severity === 'critical' &&
        !ui.incidentOpen &&
        !ui.helpOpen &&
        !ui.iacOpen &&
        !ui.postmortemOpen
      ) {
        togglePanel('incident');
      }
    }
  }, [snapshot, scenario, sound, togglePanel]);

  useEffect(() => {
    if (!snapshot) return;
    const deploys = events.filter((event) => event.kind === 'deploy' && event.at <= snapshot.time + 0.5).length;
    if (deploys > lastDeployCount.current) {
      lastDeployCount.current = deploys;
      playCue('deploy', sound);
    }
  }, [events, snapshot, sound]);

  useEffect(() => {
    if (phase !== 'ended') {
      endedRef.current = false;
      return;
    }
    if (endedRef.current) return;
    endedRef.current = true;
    playCue((snapshot?.errorSeconds ?? 0) > 0 ? 'fail' : 'success', sound);
  }, [phase, snapshot, sound]);

  /* Keyboard shortcuts. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (event.key === 'Escape') {
        cancelLink();
        selectNode(null);
        selectLink(null);
        return;
      }
      if (
        target?.closest?.(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="tab"], [role="radio"]',
        )
      ) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeId) {
          event.preventDefault();
          deleteNode(selectedNodeId);
        } else if (selectedLinkId) {
          event.preventDefault();
          deleteLink(selectedLinkId);
        }
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        if (useGame.getState().phase === 'running') pause();
        else resume();
        return;
      }
      if (event.key === 'd' || event.key === 'D') {
        togglePanel('dashboard');
        return;
      }
      if (event.key === 'l' || event.key === 'L') {
        const id = useGame.getState().selectedNodeId;
        if (id) beginLink(id);
        return;
      }
      if (['1', '2', '5', '0'].includes(event.key)) {
        const speed = event.key === '0' ? 10 : Number(event.key);
        setSpeed(speed);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelLink, selectNode, selectLink, deleteNode, deleteLink, beginLink, setSpeed, pause, resume, togglePanel]);

  if (!scenario) {
    return (
      <div className="screen paper-bg" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ padding: 28, maxWidth: 420, textAlign: 'center', display: 'grid', gap: 12 }}>
          <span className="eyebrow">No shift loaded</span>
          <h2 className="display" style={{ fontSize: 24 }}>
            The pager is quiet
          </h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Pick a level from the campaign map and we will find you something to fix.
          </p>
          <Btn variant="primary" icon="arrow-left" onClick={() => closeGame()}>
            Back to campaign
          </Btn>
        </div>
      </div>
    );
  }

  const topology = draft ?? scenario.initialTopology;
  const errorSeconds = snapshot?.errorSeconds ?? 0;
  const maxErrors = scenario.objectives.maxErrorSeconds;
  const sloBreached = (maxErrors !== undefined && errorSeconds > maxErrors) || (snapshot?.dataLossEvents ?? 0) > 0;
  const costOver = (snapshot?.monthlyCost ?? 0) > scenario.startingBudgetPerMonth;

  return (
    <div className="game">
      <TopBar snapshot={snapshot} />

      <div className="workspace">
        <Palette />
        <Canvas
          topology={topology}
          world={scenario.world}
          snapshot={snapshot}
          scenarioId={scenario.id}
          selectedNodeId={selectedNodeId}
          selectedLinkId={selectedLinkId}
          linkFrom={linkFrom}
          reducedMotion={reducedMotion}
        />
        <Inspector world={scenario.world} />

        <div className="game-alerts">
          {deployPending && (
            <div className="game-banner game-banner--deploy" role="status">
              <Icon name="rocket" size={14} />
              <span>
                <strong>Draft changes.</strong> The run is paused until you deploy.
              </span>
              <span className="game-banner__spacer" />
              <Btn size="sm" variant="primary" icon="rocket" onClick={() => deploy()}>
                Deploy
              </Btn>
            </div>
          )}
          {sloBreached && (
            <div className="game-banner game-banner--slo" role="alert">
              <Icon name="alert" size={14} />
              <span>
                <strong>Error budget blown.</strong>{' '}
                {maxErrors !== undefined ? `${Math.round(errorSeconds)}s of ${Math.round(maxErrors)}s used. ` : ''}
                {(snapshot?.dataLossEvents ?? 0) > 0 ? 'Data loss recorded. ' : ''}
                Keep it up and the postmortem writes itself.
              </span>
              <span className="game-banner__spacer" />
              <Btn size="sm" variant="outline" onClick={() => togglePanel('dashboard')}>
                Metrics
              </Btn>
            </div>
          )}
          {costOver && !sloBreached && (
            <div className="game-banner" role="status">
              <Icon name="dollar" size={14} />
              <span>
                <strong>Over budget.</strong> {fmtMoney(snapshot?.monthlyCost ?? 0)}/mo against{' '}
                {fmtMoney(scenario.startingBudgetPerMonth)}/mo.
              </span>
            </div>
          )}
        </div>

        {phase === 'ended' && (
          <div className="ended-panel">
            <div className="ended-panel__card">
              <span className="eyebrow">Shift ended</span>
              <h3>The pager goes quiet</h3>
              <p>
                {snapshot
                  ? `${Math.round(snapshot.requests).toLocaleString('en-US')} requests handled, ${Math.round(
                      snapshot.errorSeconds,
                    )} error seconds spent.`
                  : 'The simulation wrapped up.'}
              </p>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <Btn variant="primary" icon="book" onClick={() => togglePanel('postmortem')}>
                  Read the report
                </Btn>
                <Btn icon="reset" onClick={() => retry()}>
                  Retry
                </Btn>
                <Btn variant="ghost" icon="arrow-left" onClick={() => closeGame()}>
                  Campaign
                </Btn>
              </div>
            </div>
          </div>
        )}

        {paletteOpen && (
          <button
            type="button"
            className="palette-scrim"
            onClick={() => togglePanel('palette')}
            aria-label="Close component palette"
          />
        )}
      </div>

      <Dashboard snapshot={snapshot} />
      <Timeline snapshot={snapshot} />

      <BriefingModal />
      <IncidentModal />
      <PostmortemModal />
      <IacModal />
    </div>
  );
}
