# Series of Systems

A free cartoon browser game about how systems really work. Design for failure,
survive pager duty, and keep the site up while everything burns.

You start with one VM and one database. You grow into load balancers, nginx,
Kubernetes, caches, CDNs, multiple datacenters, multiple clouds, and a very
tired pager. Every dependency in series multiplies failure; every redundant path
in parallel divides it.

Single-player only. No accounts, no backend, no telemetry, no network calls at
runtime. Progress is saved in this browser.

## Inspiration

*Series of Systems* is inspired by **Series of Tubes** — [seriesoftub.es](https://seriesoftub.es),
[github.com/fjaeckel/seriesoftubes](https://github.com/fjaeckel/seriesoftubes) — a free
cartoon browser game about how the internet really works. This game applies the
same spirit to systems engineering: requests, queues, failure domains, and the
pager.

## Play

Hosted: **https://seriesofsystems.wrage.eu** (single-player, no accounts).

Locally:

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Releases and CI

CI and releases run on Forgejo Actions, not GitHub Actions:

- `.forgejo/workflows/build.yaml` — typecheck/tests, multi-arch image build,
  registry push, image pruning, and semantic-release.
- `.forgejo/workflows/prune.yaml` — daily pruning of old `sha-*` and per-arch
  image tags.
- `.releaserc.yml` — Conventional Commits releases on `main`.

The GitHub repository is a read-only push mirror. It contains `.forgejo/` for
reference but does not run GitHub Actions.

## What is in the game

- **Seven campaign shifts** plus **a five-stage career**, **five standalone
  scenarios**, and an endless sandbox.
  - **Career:** start with one web server in a closet and grow through a
    database, load balancing, caching, Kubernetes, and multi-region.
  - **Scenarios:** Black Friday, Bad Deploy, Region Down, Zero Day, and The Leak.
  - **Campaign:**
    1. *One Is None* — app HA, load balancers, health checks
    2. *Two Is One* — database replication and failover
    3. *The Split Brain* — partitions, sync vs async, data loss
    4. *Pets and Cattle* — Kubernetes, readiness probes, rolling deploys
    5. *Cache Rules Everything* — CDN, cache TTLs, stampedes
    6. *Retry Harder* — slow backends, timeouts, retries, rate limits
    7. *Cloudy with a Chance of Outage* — multi-region and DNS failover
- **Components:** DNS, CDN, load balancer, nginx proxy, app VMs, Kubernetes,
  Postgres, Redis, and object storage, across Cumulus, Stratus, and Nimbus
  clouds, regions, and zones.
- **Real knobs:** balancing algorithms, health-check intervals and thresholds,
  connection draining, timeouts, retry budgets, rate limits, replication mode,
  Multi-AZ, HPA, readiness probes, cache TTLs, stampede protection, CDN TTLs,
  origin shield, and DNS TTLs.
- **Incidents:** zone and region outages, node crashes, slow nodes, bad deploys,
  traffic spikes, cache stampedes, partitions, disk-full, cert expiry, DDoS,
  noisy neighbors, and control-plane outages.
- **Runbooks:** restart, drain, scale out, roll back, promote a database, flush a
  cache, rate limit, fail over DNS, or renew a certificate.
- **Diagnostics:** live metrics, per-node saturation, request traces, a log
  stream, configurable alert rules, an incident timeline, and a generated
  postmortem with root cause, contributing factors, action items, and stars.
- **Security:** a WAF, TLS and certificate auto-renewal, database encryption and
  backups, private data stores, automatic patching, secret management, a
  security score with concrete findings, and incidents that exploit weak
  settings.
- **Infrastructure as code:** every design serializes to a readable YAML
  manifest. Edit it, validate it, apply it to the draft, then deploy.

## Controls

- **Space** — pause or resume
- **1 / 2 / 5 / 0** — 1×, 2×, 5×, or 10× speed
- **L** — start a link from the selected component
- **D** — open the metrics dashboard
- **Delete / Backspace** — remove the selected node or link
- **Escape** — cancel linking or clear the selection
- **Drag** — move a node, or drag the canvas background to pan
- **Wheel** — zoom the canvas

Any topology edit pauses the run and marks a deploy pending. Press **Deploy** to
apply it to the live system. Incidents pause the run when they need attention.
When a scenario exposes more than one region, the **Place in** selector at the
top of the component palette chooses where the next component lands.

## Develop

```bash
npm run typecheck   # TypeScript
npm test            # simulation, content, and integration tests
npm run build       # production build
npm run check       # all of the above
```

The simulation is deterministic: the same seed, topology, incidents, and actions
produce the same run. Tests cover the request engine, health-check detection,
zone and region failures, database failover, cache stampedes, Kubernetes
readiness, YAML round-trips, postmortems, and full campaign acceptance runs.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the simulation contract,
design notes, and file map.

## Design principles

- **Failure is the content.** Every component has failure modes; the game teaches
  blast radius, redundancy, and graceful degradation.
- **Configuration is gameplay.** Timeouts, retries, health checks, quorum, TTLs,
  and autoscaling all change the outcome.
- **Reliability has a price.** Budgets matter; over-engineering loses too.
- **The postmortem is the lesson.** The game explains why it broke, not just that
  it broke.

## License

MIT. See [LICENSE](LICENSE).
