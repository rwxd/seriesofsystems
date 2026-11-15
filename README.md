# Series of Systems

A free cartoon browser game about how systems really work. Design for failure,
survive pager duty, and keep the site up while everything burns.

You start with one VM and one database. You end up with load balancers, nginx,
Kubernetes, caches, CDNs, multiple datacenters, multiple clouds, and a very
tired pager. Every dependency in series multiplies failure; every redundant path
in parallel divides it.

## Play

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Develop

```bash
npm run typecheck   # TypeScript
npm test            # simulation and content tests
npm run build       # production build
npm run check       # all of the above
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the simulation contract,
game design, file ownership, and level list.

## Principles

- Browser-only, static, no accounts, no backend, no multiplayer.
- Deterministic simulation: the same seed and choices produce the same run.
- Configuration is gameplay: timeouts, retries, health checks, quorum, TTLs.
- Reliability has a price. Over-engineering loses too.
- Failure is the content. The postmortem is the lesson.
