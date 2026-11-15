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
  });

  it('wins level 1 after adding a second zonal VM and tuning the LB', () => {
    const game = useGame.getState();
    game.openLevel('one-is-none');
    const before = useGame.getState();
    expect(before.issues.filter((issue) => issue.severity === 'error')).toEqual([]);

    const lb = useGame.getState().draft!.nodes.find((node) => node.id === 'lb')!;
    expect(lb).toBeTruthy();
    useGame.getState().updateNode('lb', { config: TUNED_HEALTH_CHECKS });
    useGame.getState().addNode('vm', 570, 340, { regionId: 'us-east', zoneId: 'us-east-b' });
    const app = useGame.getState().draft!.nodes.find(
      (node) => node.kind === 'vm' && node.zoneId === 'us-east-b',
    )!;
    expect(app).toBeTruthy();

    useGame.getState().beginLink('lb');
    useGame.getState().completeLink(app.id);
    useGame.getState().beginLink(app.id);
    useGame.getState().completeLink('db');

    const state = useGame.getState();
    expect(state.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    state.deploy();
    useGame.getState().startRun();
    runToEnd();

    const ended = useGame.getState();
    expect(ended.postmortem?.outcome).toBe('success');
    expect(ended.postmortem?.metrics.errorSeconds).toBeLessThanOrEqual(10);
    expect(ended.postmortem?.stars).toBeGreaterThanOrEqual(1);
    expect(ended.profile.completed).toContain('one-is-none');
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
});
