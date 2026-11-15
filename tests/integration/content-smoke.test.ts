import { describe, expect, it } from 'vitest';
import { CAREER_STAGES } from '@/content/career';
import { SCENARIOS } from '@/content/scenarios';
import { createSimulation } from '@/sim/engine';

const cases = [
  ...CAREER_STAGES.map((scenario) => ({ label: `career:${scenario.id}`, scenario })),
  ...SCENARIOS.map((scenario) => ({ label: `scenario:${scenario.id}`, scenario })),
];

describe('career and scenario smoke tests', () => {
  for (const { label, scenario } of cases) {
    it(`${label} runs to the end without crashing`, () => {
      const sim = createSimulation(scenario, structuredClone(scenario.initialTopology));
      sim.start();
      let guard = 0;
      while (!sim.ended && guard < 5000) {
        sim.tick(0.5);
        guard += 1;
      }
      const snapshot = sim.snapshot();
      expect(snapshot.ended).toBe(true);
      expect(snapshot.time).toBeGreaterThanOrEqual(scenario.duration);
      expect(snapshot.requests).toBeGreaterThan(0);
      expect(Number.isFinite(snapshot.p95)).toBe(true);
      expect(snapshot.monthlyCost).toBeGreaterThan(0);
    });
  }
});
