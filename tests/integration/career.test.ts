import { describe, expect, it } from 'vitest';
import { getCareerStage, nextCareerStage } from '@/content/career';
import { buildPostmortem } from '@/content/postmortem';
import { cloneTopology } from '@/game/topology';
import { createSimulation } from '@/sim/engine';

describe('career stage 1: one box', () => {
  const stage = getCareerStage('career-one-box')!;

  it('wins with the restart runbook and explains the remaining single point of failure', () => {
    const topology = cloneTopology(stage.initialTopology);
    const sim = createSimulation(stage, topology);
    sim.start();
    while (sim.time < 121) sim.tick(0.5);
    const restart = sim.runRunbook('restart', 'app-1');
    expect(restart.ok).toBe(true);
    while (!sim.ended) sim.tick(0.5);

    const snapshot = sim.snapshot();
    const postmortem = buildPostmortem(stage, snapshot, sim.eventLog(), topology);
    expect(snapshot.errorSeconds).toBeLessThanOrEqual(10);
    expect(postmortem.outcome).toBe('success');
    expect(postmortem.rootCause).toMatch(/only compute|one machine|single/i);
    expect(postmortem.actionItems.join(' ')).toMatch(/second compute replica/i);
  });

  it('unlocks the database stage after the first', () => {
    expect(nextCareerStage('career-one-box')?.id).toBe('career-database');
    expect(nextCareerStage('career-planet')).toBeUndefined();
  });
});
