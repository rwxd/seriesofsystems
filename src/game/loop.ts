import { useEffect } from 'react';
import { useGame } from './store';

/**
 * Drives the simulation from the browser animation loop. Mount exactly once,
 * at the application root. The store owns all game state; this hook only
 * advances simulated time when the run is active.
 */
export function useSimLoop(): void {
  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const tick = (now: number): void => {
      const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const state = useGame.getState();
      if (state.phase === 'running' && state.sim) {
        state.advance(realDt * state.speed);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
}
