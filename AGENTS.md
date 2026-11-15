# Series of Systems

Read `docs/ARCHITECTURE.md` before editing. It is the source of truth for the
game design, simulation behavior, file ownership, and contracts.

## Commands

- `npm run dev` — Vite dev server
- `npm run typecheck` — TypeScript, no emit
- `npm test` — Vitest
- `npm run build` — typecheck + production build
- `npm run check` — typecheck + tests + build

## Rules

- `src/sim/types.ts`, `src/sim/config.ts`, and `src/sim/catalog.ts` are frozen
  shared contracts. Don't change them without an explicit request.
- `src/sim/**` must stay pure TypeScript. No React, DOM, or browser APIs.
- Do not edit files outside your assigned lane.
- Use semantic commit messages only when asked to commit.
- Deterministic simulation: no `Math.random()` and no wall-clock time inside
  `src/sim/**`.
- Keep the game playable offline. No runtime network calls.
