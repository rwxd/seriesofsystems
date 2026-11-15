# Series of Systems — Architecture & Build Spec

A single-player, browser-only game about systems engineering. Think *Series of
Tubes*, but the map is a system topology: DNS → CDN → LB → nginx → VMs/K8s →
cache → database, spread across clouds, regions, and zones.

- Stack: TypeScript, Vite, React, custom SVG canvas, Zustand, `yaml`.
- No backend, no accounts, no multiplayer.
- Simulation is deterministic and pure TypeScript.
- Save data lives in `localStorage`.

## Repo map and ownership

```
src/
  sim/          pure simulation (no React, no DOM)
    types.ts    shared contracts (do not break)
    config.ts   config getters (do not break)
    catalog.ts  component specs, costs, defaults (do not break)
    engine.ts   Simulation implementation (sim lane)
    rng.ts      seeded RNG (sim lane)
    heap.ts     binary heap (sim lane)
    metrics.ts  rolling metrics / quantiles (sim lane)
    availability.ts  theoretical availability estimate (sim lane)
    security.ts      security score and findings (security lane)
  content/      worlds, levels, sandbox, YAML, copy (content lane)
    worlds.ts
    levels.ts
    career.ts    five-stage career ladder
    scenarios.ts five standalone challenges
    sandbox.ts
    iac.ts
    postmortem.ts
  game/         store, commands, persistence, loop (integration lane)
    store.ts
    topology.ts
    save.ts
    loop.ts
  ui/           React UI (designer lane)
    components/ primitives, icons
    screens/    Title, Campaign, Career, Scenarios, HowTo, Settings
    game/       Game screen, canvas, inspector, HUD, dashboard, modals
  styles/       CSS tokens, base, game styles
```

Never edit another lane's files. `src/sim/types.ts`, `config.ts`, and
`catalog.ts` are frozen contracts; ask before changing them.

## Product flow

Screens: **Title → Campaign map / Career / Scenarios → Game**. Sandbox starts
from the Campaign map and opens a difficulty choice. How to Play and Settings
are modals/screens.

Three single-player modes share the same run screen:

- **Campaign** — seven fixed shifts, unlocked in order.
- **Career** — five stages starting with one web server in a closet and growing
  to multi-region. Stage N unlocks when stage N-1 is completed.
- **Scenarios** — self-contained bad days, all available: Black Friday, Bad
  Deploy, Region Down, Zero Day, and The Leak.

A run:

1. **Briefing** — customer message, objectives, starting topology. `Start shift`.
2. **Editing / Running** — the sim starts paused on the briefing, then runs.
   Any topology edit auto-pauses the run and marks a deploy pending. `Deploy`
   applies the draft to the live sim.
3. **Incidents** — a pager alert appears. The player can diagnose (metrics,
   traces, logs, alerts, security findings), edit/deploy, or use a runbook.
4. **End** — after `scenario.duration` seconds, generate a postmortem with
   objectives, stars, timeline, root cause, and action items. The postmortem
   returns to the mode the run came from and only advances if the next stage is
   actually unlocked.

Stars: 0 = failed, 1 = survived, 2 = survived under budget, 3 = all objectives.
Progress persists for campaign, career, scenarios, and sandbox best score.

## Simulation spec

### Time and determinism

- Simulated seconds. `tick(dt)` advances at most `MAX_TICK = 0.5` seconds per
  call internally, but the engine should loop over the requested `dt` so a 10×
  speed remains accurate. The UI passes `realDt * speed`.
- Seeded RNG (mulberry32 or xorshift128). Every random decision uses it.
- Two identical runs with the same seed/topology/incidents/actions must produce
  identical metrics. This is a hard requirement for tests.

### Traffic

- `traffic` points are linearly interpolated: `rpsAt(t)`.
- Entry points: `scenario.entryNodeIds` if present; otherwise nodes with no
  incoming links (normally the DNS node).
- Emit requests every 100 ms. At `rps` requests/sec, expected arrivals per tick
  is `rps * 0.1`; carry the fractional accumulator. Add small seeded jitter.
- Default client timeout: 3000 ms. Each request has a deadline.
- Entry choice: weighted equally across entry nodes.

### Request state machine

A request carries: id, entryId, arrival time, deadline, hop trace, retry count,
and flags (cacheHit, hitDb, dataLost).

At a node:

- If the node or its placement is down, fail.
- Acquire capacity: `inFlight < capacity`. Otherwise queue FIFO.
- Service time = spec latency + small jitter (0.8–1.2×). Add link latency when
  scheduling arrival at the next node.
- On completion, release capacity, start the next queued request, then route.

Routing by component kind:

- `dns`: choose one outgoing target. Respect cached DNS decision for
  `ttlSeconds`; on refresh choose a healthy target (all down → fail).
- `cdn`: decide cache hit from `cacheHitRatio(ttl, cacheablePct, 100)`; hit →
  complete. Miss → forward to origin. `originShield` halves miss load on origin.
- `lb`: pick a backend by algorithm, skipping ejected/down backends. No healthy
  backend → 503. Keep per-backend in-flight counts for least-conn.
- `proxy`: enforce `rateLimitRps` (excess = 429), `workerConnections` capacity,
  and read timeouts; balance across upstreams with `algorithm` (`round-robin` or
  `least-conn`), skipping down/drained backends, then forward to one backend.
- `waf`: a global edge filter. Enforce its `rateLimitRps`, forward to one
  upstream, and mitigate DDoS/brute-force incidents in `block` mode (partial
  mitigation in `monitor` mode). The security score only credits a WAF that is
  actually linked into the request path.
- `vm`: serve the app. If the scenario requires a database and this VM has no
  path to a db, fail 500 with a clear issue. If a cache is connected, consult it
  (cache hit ratio from cache spec); on hit complete, on miss go to db. If a db
  is connected, query it then complete. If multiple dependencies, cache first,
  then db. Link latency applies per hop.
- `k8s`: like VM, with pod capacity. Pods are spread over zones. A zone failure
  removes pods in that zone; reschedule them after `RESCHEDULE_SECONDS = 8` if
  capacity exists. Readiness/liveness affect bad deploys. HPA adjusts pod count
  every `HPA_INTERVAL = 5` seconds toward `cpuTargetPct`, clamped to min/max,
  with a 10 s cooldown.
- `db`: query. Capacity = `min(size capacity, connectionLimit)`. Track lag:
  async replicas lag 50–300 ms; sync replicas 5 ms. A db with `multiAz` survives
  zone failures with a `FAILOVER_SECONDS = 6` blip. Without multiAz but with
  replicas and `automaticFailover`, a primary failure causes
  `FAILOVER_SECONDS = 20` downtime; async loses one write batch (`dataLoss`).
  Without HA, the db is down for the incident duration.
- `cache`: hit → complete; miss → forward to db (cache must be linked to db).
  `stampedeProtection` coalesces misses: only 10% of misses reach the db during
  a cold-cache / stampede period.
- `storage`: terminal success.

Retries:

- Max retries comes from the entry proxy/VM config (`retries`), default 0.
- Retry budget (`retryBudgetPct`, default 10%) caps retries as a share of total
  requests in the last 10 s. Exceeding it stops retrying.
- Retries restart at the entry after `50ms * 2^attempt` and count as new
  requests. This is how retry storms emerge.

### Health checks

- LB probes each backend every `healthCheckInterval` seconds.
- A backend is healthy if its node is up and not ejected.
- After `unhealthyThreshold` consecutive failures, eject. After
  `healthyThreshold` successes, restore.
- Until ejection, requests to a down backend fail. This detection window is a
  core mechanic.

### Failure domains and incidents

Apply incidents at their scheduled time and recover at `at + duration`.
Incident semantics:

- `zone-down`: every zonal node in the zone is down. Regional nodes survive if
  their `multiAz`/redundancy config says so. Links touching the zone degrade.
  Recovery brings nodes back.
- `region-down`: every node in the region is down. DNS may fail over.
- `node-crash`: target node down for duration; auto-restart after 3 s if the
  incident duration is longer? Keep it simple: down for duration, then healthy.
- `node-slow`: target capacity ×0.4 and latency ×20 (the "slow backend" is a
  dramatic slowdown, not a polite one).
- `db-failover`: force the DB HA path described above.
- `network-partition`: db replica/standby is stale for the duration; if
  `replication=async`, mark `staleReplica`; if `sync`, writes fail fast.
- `bad-deploy`: k8s/proxy app tier. If readiness probe is on, only
  `maxUnavailable` pods fail readiness for 20 s; if off, all fail for 20 s.
- `cache-stampede`: cache hit ratio drops to 0 for duration; stampede protection
  determines db amplification.
- `traffic-spike`: multiply traffic by 1.8–3× for duration.
- `ddos`: extra traffic + 429s; a WAF in block mode absorbs most of it, monitor
  mode partially, no WAF leaves the origin exposed.
- `cert-expiry`: all external traffic fails unless a load balancer or CDN has
  `tlsAutoRenew` on; the `renew-cert` runbook fixes it manually.
- `credential-leak`: data loss and 401s if any database/storage is publicly
  reachable or any compute node keeps secrets in plain config; otherwise
  contained.
- `vulnerability`: target compute node goes down unless `patching=auto`.
- `brute-force`: credential stuffing pressure; WAF block mode or a proxy rate
  limit mitigates it.
- `disk-full`: db capacity ×0.5 and writes fail 10% of the time.
- `control-plane-outage`: HPA/reschedule/automatic recovery disabled.
- `noisy-neighbor`: target capacity ×0.6.

Runbooks (available in the incident UI):

- `restart`: target down node returns after 3 s.
- `failover-db`: promote standby after 5 s; async loses data.
- `failover-dns`: force DNS target refresh.
- `scale-out`: add one replica/pod to target, +cost.
- `rollback`: end bad-deploy immediately.
- `flush-cache`: clear cache (brief hit-ratio drop).
- `rate-limit`: set rate limit to current RPS (protects origin).
- `drain`: drain target, then remove it from LB rotation.
- `renew-cert`: fix cert-expiry.

### Metrics

Per 1 s bucket:

- arrivals, completions, failures, p50/p95/p99 (reservoir of last 2000
  completions, or histogram), per-node RPS/in-flight/queue/utilization/error
  rate/p95, per-link RPS/utilization/state.
- `errorSeconds`: number of seconds with at least one failed request.
- `availability` = successful / total.
- `monthlyCost` = `topologyCostPerMonth(topology, world, currentRps)`.
- `dataLossEvents`: increments on async failover, partition, disk-full data loss.
- Keep the last 120 points for charts in `series`.
- Keep the last 30 failed and last 10 slow traces (slow = p95 > 500 ms).

Theoretical availability (`availability.ts`) is optional but nice: recursively
combine series nodes and parallel backends from the entry to the data tier.
Show it in the UI as "estimated path availability".

### Security posture and monitoring

- `src/sim/security.ts` computes a deterministic 0-100 security score and a list
  of actionable findings from the deployed/draft topology: WAF mode and edge
  rate limit, TLS and auto-renew, DB/storage encryption, backups, public access,
  patching, secrets, and proxy rate limits. A WAF only counts when it is linked
  into the request path.
- The UI shows the score and findings in the dashboard Security tab and in the
  selected component's inspector.
- Monitoring is client-side on top of snapshots: configurable alert rules
  (error rate, p95, max queue, availability, security score), a fired-alert
  history, a log stream synthesized from events/issues/traces, trace filters
  (failed/slow/search), a per-node metrics explorer, and an error-budget-left
  readout. Alerts fire on rising edges and become toasts, log lines, and
  timeline events.

### Snapshot

`snapshot()` returns a stable object with current metrics, incidents, issues,
and the `series` arrays. It must never expose mutable internal state.

### Events

`onEvent` receives `GameEvent` for incidents, recoveries, deploys, alerts,
runbooks, data loss, and objectives. The store mirrors them into the UI.

## Content spec

### World

One campaign world:

- Clouds: `cumulus` (Cumulus Cloud), `stratus` (Stratus), `nimbus` (Nimbus).
- Regions/zones:
  - `us-east` / `us-east-a,b,c` on cumulus
  - `eu-west` / `eu-west-a,b` on cumulus
  - `us-west` / `us-west-a,b` on stratus
  - `ap-south` / `ap-south-a,b` on nimbus
- Latency: same zone 1 ms, cross zone 2 ms, cross region 45 ms, cross cloud 70 ms.

Each level selects the regions it exposes (e.g. level 1 only `us-east`).

### Levels

Use stable node IDs; incidents target them.

1. **One Is None** (Act 1) — app HA. Initial: dns→lb→app-1 (us-east-a) + db
   (multiAz). Player adds app-2 in us-east-b, links lb→app-2 and app-2→db, tunes
   LB health checks. Incident: `zone-down us-east-a` at 180 s for 60 s.
   Objectives: ≤10 error seconds, p95 ≤ 250 ms, ≤ $600/mo, no data loss.
2. **Two Is One** (Act 1) — DB HA. Initial: dns→lb→app-1/app-2 + single db
   (async, no HA). Incident: `db-failover` at 180 s for 90 s. Player enables
   multiAz or replicas+sync+auto failover. Objectives: ≤15 error seconds, no
   data loss, p95 ≤ 300 ms.
3. **The Split Brain** (Act 1) — `network-partition` on the db at 180 s for 45 s,
   then `db-failover` at 240 s. Async + auto failover loses data; sync or manual
   failover is safe. Objectives: no data loss, ≤50 error seconds.
4. **Pets and Cattle** (Act 2) — k8s. Initial: dns→lb→k8s (3 nodes, 3 pods,
   readiness off) + db. Incidents: bad deploy at 120 s, node failure at 240 s,
   traffic spike at 360 s. Objectives: ≤20 error seconds, p95 ≤ 300 ms.
5. **Cache Rules Everything** (Act 2) — CDN+cache. Initial: dns→cdn→lb→2 VMs
   + cache→db. Incidents: traffic spike 3× at 120 s, `cache-stampede` at 240 s.
   Objectives: p95 ≤ 250 ms, ≤15 error seconds, ≤ $1500/mo.
6. **Retry Harder** (Act 3) — nginx starts on round-robin with 3 retries and no
   retry budget, while `node-slow` makes App A ~20× slower at 120 s (60 s). The
   traffic spike lands at 240 s. Player switches upstream balancing to least-conn
   (or sizes the slow backend), shortens timeouts, caps retries, or rate limits.
   Objectives: p95 ≤ 400 ms, ≤25 error seconds.
7. **Cloudy with a Chance of Outage** (Act 3) — multi-region. Initial: us-east
   stack + eu-west region available. Player adds eu-west LB/VMs/DB replica and
   wires DNS failover. Incident: `region-down us-east` at 180 s for 120 s.
   Objectives: ≤30 error seconds, p95 ≤ 600 ms, ≤ $2500/mo.
8. **Sandbox** — all components unlocked, random incidents every 60–120 s,
   traffic grows, score = survival + availability + cost efficiency. Persist
   best score.

Traffic curves should ramp, not step, and stay under ~200 RPS in campaign.

### YAML (IaC)

`topologyToYaml(topology, world): string`:

```yaml
apiVersion: seriesofsystems/v1
kind: Topology
metadata:
  name: production
spec:
  components:
    - id: dns
      type: dns
      name: DNS
      config:
        ttlSeconds: 60
        routing: failover
        healthChecks: true
    - id: app-1
      type: vm
      name: App A
      placement:
        cloud: cumulus
        region: us-east
        zone: us-east-a
      config:
        size: small
        replicas: 1
  links:
    - from: lb
      to: app-1
```

`parseTopologyYaml(text, world, previous): { topology?: Topology; errors: string[] }`.
Validate kinds, required placement, unique IDs, link endpoints, config field
values, and scenario constraints. Preserve x/y from `previous` by ID; auto-place
new nodes in a grid.

### Postmortems

`buildPostmortem(scenario, snapshot, events, topology)` returns a `Postmortem`.
Use heuristics for root cause and contributing factors:

- no replica in the failed zone
- health check detection window too slow
- DB without multiAz / async failover
- retries without budget
- cache without stampede protection
- single region / DNS TTL too long
- k8s without readiness
- rate limit off

Action items should name concrete config changes. Keep the copy dry and funny.

## UI spec

Visual direction: **cartoon schematic**. Blueprint-paper canvas, chunky dark
outlines, warm paper panels, signal-orange alerts, mint success. Rounded cards,
slight rotations/shadows, playful but readable. No emoji as primary iconography;
use the custom SVG icon set. Motion is subtle: packets as dots, a breathing
ring on incidents, a little smoke puff on down nodes. Respect
`prefers-reduced-motion`.

Layout:

- Top bar: logo, level name, clock, speed (1×/2×/5×/10×), error budget, cost,
  pager bell, dashboard/IaC/help buttons.
- Left: component palette, grouped by category, locked items dimmed with
  unlock hint.
- Center: SVG canvas with world/region/zone containers, nodes, links, animated
  traffic. Pan (drag background), zoom (wheel/buttons), click select, drag node,
  link mode (click source, click target), delete key, fit view.
- Right: inspector for selected node/link. Node: name, placement, config fields
  generated from `ComponentSpec.fields`, live stats, cost, validation errors,
  delete. Link: endpoints, latency, delete.
- Bottom: timeline strip with traffic sparkline, incident markers, deploy
  markers, and speed/run controls. Expandable metrics drawer with RPS, errors,
  p95, cost, per-node table, traces.
- Modals: briefing, incident/pager, postmortem, IaC, help, sandbox setup.

Canvas node visuals: icon + name + status dot + utilization bar + replica badge.
Links: orthogonal/bezier with arrowheads; red when down; pulse when saturated.
Zone containers labeled and tinted by cloud. Region labels outside.

Responsive: desktop-first; below 1100 px, palette collapses into a drawer and
inspector becomes a bottom sheet. Keep it playable on a laptop.

Accessibility: color is never the only signal (icons + text), focus states,
keyboard delete/escape, reduced motion.

## Store API (integration lane)

`src/game/store.ts` exports `useGame` (Zustand). UI imports it directly. See the
store for the full action list. Key shape:

```ts
interface GameStore {
  screen: 'title' | 'campaign' | 'game' | 'howto' | 'settings';
  profile: Profile;
  scenario: Scenario | null;
  phase: 'briefing' | 'running' | 'paused' | 'ended';
  speed: number;
  draft: Topology | null;
  deployed: Topology | null;
  snapshot: SimSnapshot | null;
  events: GameEvent[];
  traces: RequestTrace[];
  postmortem: Postmortem | null;
  deployPending: boolean;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  linkFrom: string | null;
  ui: { dashboardOpen; iacOpen; helpOpen; incidentOpen; postmortemOpen; paletteOpen; inspectorTab; yamlText; yamlErrors };
  toast: { message; tone } | null;
  // actions: go, openLevel, openSandbox, startRun, pause, resume, setSpeed,
  // endRun, retry, nextLevel, selectNode, selectLink, beginLink, completeLink,
  // cancelLink, addNode, moveNode, updateNode, updateConfig, deleteNode,
  // deleteLink, deploy, togglePanel, openIac, setYamlText, applyYaml,
  // runRunbook, notify, dismissToast
}
```

Any topology mutation during a run auto-pauses and sets `deployPending`.
`deploy` applies the draft to the live simulation and logs a deploy event.

## Testing and verification

- `npm run typecheck`, `npm test`, `npm run build`.
- Sim tests must cover: success path, queueing, timeout, retry budget, LB health
  check detection, zone failure with 1 vs 2 VMs, DB multiAz vs no HA, cache hit
  ratio, k8s readiness, YAML round-trip, postmortem objectives.
- Level 1 acceptance test: default topology loses; adding app-2 in us-east-b and
  linking lb→app-2 / app-2→db wins with tuned health checks.
- No network calls at runtime. No backend.
