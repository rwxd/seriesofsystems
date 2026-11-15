import { beforeEach, describe, expect, it } from 'vitest';
import { TUNED_HEALTH_CHECKS } from '@/content/levels';
import { useGame } from '@/game/store';

function reset(): void {
  useGame.getState().resetProgress();
}

function runToEnd(): void {
  let guard = 0;
  while (useGame.getState().phase !== 'ended' && guard < 400) {
    const state = useGame.getState();
    if (state.phase === 'paused') state.resume();
    state.advance(5);
    guard += 1;
  }
}

function winLevelOne(): void {
  useGame.getState().openLevel('one-is-none');
  useGame.getState().updateNode('lb', { config: TUNED_HEALTH_CHECKS });
  useGame.getState().addNode('vm', 570, 340, { regionId: 'us-east', zoneId: 'us-east-b' });
  const app = useGame.getState().draft!.nodes.find(
    (node) => node.kind === 'vm' && node.zoneId === 'us-east-b',
  )!;
  useGame.getState().beginLink('lb');
  useGame.getState().completeLink(app.id);
  useGame.getState().beginLink(app.id);
  useGame.getState().completeLink('db');
  useGame.getState().deploy();
  useGame.getState().startRun();
  runToEnd();
}

describe('game store integration', () => {
  beforeEach(reset);

  it('loses level 1 with the starting topology', () => {
    const game = useGame.getState();
    game.openLevel('one-is-none');
    useGame.getState().startRun();
    runToEnd();
    const state = useGame.getState();
    expect(state.phase).toBe('ended');
    expect(state.postmortem?.outcome).toBe('failure');
    expect(state.postmortem?.metrics.errorSeconds).toBeGreaterThan(10);
    useGame.getState().nextLevel();
    expect(useGame.getState().screen).toBe('campaign');
  });

  it('wins level 1 after adding a second zonal VM and tuning the LB', () => {
    winLevelOne();
    const ended = useGame.getState();
    expect(ended.postmortem?.outcome).toBe('success');
    expect(ended.postmortem?.metrics.errorSeconds).toBeLessThanOrEqual(10);
    expect(ended.postmortem?.stars).toBeGreaterThanOrEqual(1);
    expect(ended.profile.completed).toContain('one-is-none');
  });

  it('advances to the next level after a win', () => {
    winLevelOne();
    useGame.getState().nextLevel();
    const next = useGame.getState();
    expect(next.scenario?.id).toBe('two-is-one');
    expect(next.phase).toBe('briefing');
    expect(next.screen).toBe('game');
  });

  it('refuses to open a locked level', () => {
    useGame.getState().openLevel('two-is-one');
    expect(useGame.getState().scenario).toBeNull();
    expect(useGame.getState().toast?.tone).toBe('danger');
  });

  it('blocks a second VM without a database connection', () => {
    const game = useGame.getState();
    game.openLevel('one-is-none');
    useGame.getState().addNode('vm', 570, 340, { regionId: 'us-east', zoneId: 'us-east-b' });
    const app = useGame.getState().draft!.nodes.find(
      (node) => node.kind === 'vm' && node.zoneId === 'us-east-b',
    )!;
    useGame.getState().beginLink('lb');
    useGame.getState().completeLink(app.id);
    expect(
      useGame.getState().issues.some((issue) => issue.message.includes('cannot reach a database')),
    ).toBe(true);
    useGame.getState().startRun();
    expect(useGame.getState().phase).toBe('briefing');
  });

  it('opens career stage one and keeps later stages locked', () => {
    useGame.getState().openCareerStage('career-one-box');
    expect(useGame.getState().scenario?.id).toBe('career-one-box');
    expect(useGame.getState().runMode).toBe('career');
    useGame.getState().openCareerStage('career-database');
    expect(useGame.getState().scenario?.id).toBe('career-one-box');
    expect(useGame.getState().toast?.tone).toBe('danger');
  });

  it('opens a standalone security scenario', () => {
    useGame.getState().openScenario('scenario-zero-day');
    expect(useGame.getState().scenario?.id).toBe('scenario-zero-day');
    expect(useGame.getState().runMode).toBe('scenario');
    expect(useGame.getState().scenario?.unlockedKinds).toContain('waf');
  });

  it('raises a monitoring alert when availability falls', () => {
    useGame.getState().openLevel('one-is-none');
    useGame.getState().startRun();
    runToEnd();
    const state = useGame.getState();
    expect(state.firedAlerts.some((alert) => alert.ruleId === 'availability')).toBe(true);
    expect(state.firedAlerts.some((alert) => alert.severity === 'critical')).toBe(true);
  });

  it('lets the player tune alert rules', () => {
    useGame.getState().toggleAlertRule('p95');
    expect(useGame.getState().alertRules.find((rule) => rule.id === 'p95')?.enabled).toBe(false);
    useGame.getState().updateAlertRule('p95', { threshold: 500 });
    expect(useGame.getState().alertRules.find((rule) => rule.id === 'p95')?.threshold).toBe(500);
  });
});
