import { useGame } from '@/game/store';
import { Btn, Kbd, Pill } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LogoLockup } from '@/ui/components/Logo';

export function HowToScreen() {
  const go = useGame((state) => state.go);
  return (
    <div className="screen paper-bg howto">
      <div className="howto__wrap">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
          <button
            type="button"
            className="campaign__brand"
            onClick={() => go('title')}
            aria-label="Back to title screen"
          >
            <LogoLockup compact />
          </button>
          <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => go('title')}>
            Back
          </Btn>
        </div>

        <div className="howto__hero">
          <span className="eyebrow">Read this once, then wing it</span>
          <h1>How to play</h1>
          <p>
            You are the person on call. A request arrives at your edge, walks through every component
            you placed, and either gets answered or becomes a graph that goes up. Your job is to make
            the second case rare, short, and survivable.
          </p>
          <div className="howto__steps">
            {[
              ['01', 'Read the brief', 'One customer, one objective, one starting topology.'],
              ['02', 'Place components', 'Click the palette. Wire them in order. Watch the cost.'],
              ['03', 'Deploy', 'Edits are a draft. Deploy applies them to the running system.'],
              ['04', 'Survive the pager', 'Diagnose, edit, deploy, repeat until the shift ends.'],
            ].map(([num, title, body]) => (
              <div className="step" key={num}>
                <span className="step__n">Step {num}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>

        <HowToContent />
      </div>
    </div>
  );
}

export function HowToContent({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: compact ? 12 : 0 }}>
      {!compact && (
        <section className="howto__section">
          <div className="howto__copy">
            <h2>Draft, deploy, get paged, fix</h2>
            <p>
              Nothing you edit takes effect immediately. Changes land in a <strong>draft</strong>{' '}
              topology, the run pauses, and a deploy banner appears. Press Deploy when you are ready
              to put it in front of users.
            </p>
            <p>
              That pause is a gift. It is also the entire mechanic: you get to think before the next
              request hits the thing you just changed.
            </p>
            <ul>
              <li>
                <Icon name="info" size={14} /> Every edit auto-pauses the simulation.
              </li>
              <li>
                <Icon name="rocket" size={14} /> Deploy logs an event on the timeline.
              </li>
              <li>
                <Icon name="bell" size={14} /> Incidents keep happening while you edit.
              </li>
            </ul>
          </div>
          <figure className="howto__figure">
            <LoopDiagram />
          </figure>
        </section>
      )}

      <section className="howto__section">
        <div className="howto__copy">
          <h2>Series vs parallel availability</h2>
          <p>
            Availability <strong>multiplies</strong> along a path. Three components at 99.9% each
            give you 99.7%. Adding a hop always costs you nines.
          </p>
          <p>
            Redundancy works the other way: two independent copies fail together only by accident, so
            failure probability <strong>multiplies</strong> instead. Two 99% app servers give 99.99%.
          </p>
          <ul>
            <li>
              <Icon name="series" size={14} /> Series: <span className="mono">0.999 × 0.999 × 0.999 = 99.7%</span>
            </li>
            <li>
              <Icon name="layers" size={14} /> Parallel: <span className="mono">1 − 0.01² = 99.99%</span>
            </li>
            <li>
              <Icon name="warning" size={14} /> Redundancy in the same zone is not redundancy.
            </li>
          </ul>
        </div>
        <figure className="howto__figure">
          <SeriesParallelDiagram />
        </figure>
      </section>

      <section className="howto__section">
        <div className="howto__copy">
          <h2>Health checks are a delay you choose</h2>
          <p>
            A load balancer only knows a backend is broken after it probes and fails enough times.
            With a 5-second interval and 3 failures, that is up to 15 seconds of users hitting a dead
            box.
          </p>
          <p>
            Faster checks and lower thresholds shrink the window. They also add probe traffic and can
            eject a backend that was merely having a bad second.
          </p>
          <Pill tone="orange">probe interval × failure threshold = your outage window</Pill>
        </div>
        <figure className="howto__figure">
          <HealthCheckDiagram />
        </figure>
      </section>

      <section className="howto__section">
        <div className="howto__copy">
          <h2>An error budget is permission to fail</h2>
          <p>
            Objectives cap the damage: error seconds, p95 latency, monthly cost, data loss. Error
            seconds are the honest one — every second with at least one failed request counts.
          </p>
          <p>
            Spending the budget early is fine. Spending it in the first ten seconds and then watching
            the graph for eight minutes is not.
          </p>
          <ul>
            <li>
              <Icon name="gauge" size={14} /> p95 ignores the worst 5% of requests — except in real life.
            </li>
            <li>
              <Icon name="dollar" size={14} /> Cost is monthly, counted live. Bigger is not free.
            </li>
          </ul>
        </div>
        <figure className="howto__figure">
          <ErrorBudgetDiagram />
        </figure>
      </section>

      <div className="howto__callout">
        <Icon name="bug" size={20} />
        <span>
          <strong>If in doubt, add a second instance in another zone.</strong> It is the answer to more
          incidents than anyone would like to admit.
        </span>
      </div>

      <div className="howto__callout">
        <Icon name="gauge" size={20} />
        <span>
          <strong>Monitoring is part of the game.</strong> Open Metrics (<kbd>D</kbd>), then use the
          Nodes, Traces, Logs, Alerts, and Security tabs. Tune alert rules so you hear about a problem
          before the customer does.
        </span>
      </div>

      <div className="howto__callout">
        <Icon name="waf" size={20} />
        <span>
          <strong>Security is configuration.</strong> A WAF, TLS renewal, private databases, encryption,
          backups, automatic patching, and secret management all live in the inspector. The security
          score tells you which one is currently the weakest.
        </span>
      </div>

      {!compact && (
        <div className="howto__foot">
          <Btn variant="primary" icon="play" onClick={() => useGame.getState().go('campaign')}>
            Go to campaign
          </Btn>
          <Btn variant="ghost" icon="arrow-left" onClick={() => useGame.getState().go('title')}>
            Title screen
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagrams                                                            */
/* ------------------------------------------------------------------ */

const INK = 'var(--ink)';
const PAPER = 'var(--paper-2)';
const SOFT = 'var(--ink-soft)';
const MONO = 'var(--font-mono)';
const DISPLAY = 'var(--font-display)';

function DiagramBox({
  x,
  y,
  w = 56,
  h = 30,
  label,
  sub,
  tone = 'paper',
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  sub?: string;
  tone?: 'paper' | 'mint' | 'orange' | 'faded';
}) {
  const fill =
    tone === 'mint' ? 'var(--mint-soft)' : tone === 'orange' ? 'var(--orange-soft)' : PAPER;
  return (
    <g>
      <rect x={x + 2} y={y + 2} width={w} height={h} rx="6" fill="rgba(23,33,43,0.16)" />
      <rect x={x} y={y} width={w} height={h} rx="6" fill={fill} stroke={INK} strokeWidth="2" />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 1 : h / 2 + 4)} textAnchor="middle" fontFamily={DISPLAY} fontSize="10.5" fontWeight="800" fill={tone === 'faded' ? SOFT : INK}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontFamily={MONO} fontSize="7" letterSpacing="0.5" fill={SOFT}>
          {sub}
        </text>
      )}
    </g>
  );
}

function LoopDiagram() {
  return (
    <svg viewBox="0 0 400 232" role="img" aria-label="Draft topology is deployed into the live run, which pages you, which sends you back to the draft">
      <g>
        <rect x="22" y="46" width="150" height="104" rx="10" fill={PAPER} stroke={INK} strokeWidth="2.2" strokeDasharray="7 5" />
        <text x="34" y="66" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
          DRAFT
        </text>
        <DiagramBox x={40} y={80} w={52} label="LB" />
        <DiagramBox x={104} y={80} w={52} label="App" tone="mint" />
        <text x="34" y="136" fontFamily={MONO} fontSize="7.5" letterSpacing="0.8" fill={SOFT}>
          paused · editing
        </text>
      </g>

      <g>
        <rect x="228" y="46" width="150" height="104" rx="10" fill={PAPER} stroke={INK} strokeWidth="2.2" />
        <text x="240" y="66" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
          LIVE
        </text>
        <DiagramBox x={246} y={80} w={52} label="LB" />
        <DiagramBox x={310} y={80} w={52} label="App" tone="orange" sub="p95 2.4s" />
        <text x="240" y="136" fontFamily={MONO} fontSize="7.5" letterSpacing="0.8" fill="var(--orange-2)">
          running · 128 rps
        </text>
      </g>

      <g stroke={INK} strokeWidth="2.4" fill="none">
        <path d="M176 98h44" strokeDasharray="6 4" />
        <path d="M212 90l8 8-8 8" />
        <path d="M228 168c-40 0-72 0-100-14" strokeWidth="2" />
        <path d="M136 146l-8 8 8 8" />
      </g>
      <text x="198" y="88" textAnchor="middle" fontFamily={MONO} fontSize="8" fontWeight="700" letterSpacing="1" fill={INK}>
        DEPLOY
      </text>

      <g>
        <rect x="140" y="176" width="120" height="34" rx="8" fill="var(--red-soft)" stroke="var(--ink)" strokeWidth="2" />
        <text x="200" y="192" textAnchor="middle" fontFamily={DISPLAY} fontSize="10" fontWeight="800" fill="var(--red-2)">
          PAGER
        </text>
        <text x="200" y="203" textAnchor="middle" fontFamily={MONO} fontSize="7" letterSpacing="0.6" fill="var(--red-2)">
          03:12 · zone down
        </text>
      </g>
      <path d="M156 176v-22" stroke={INK} strokeWidth="2" fill="none" />
    </svg>
  );
}

function SeriesParallelDiagram() {
  return (
    <svg viewBox="0 0 400 232" role="img" aria-label="In series availability multiplies down; in parallel failure probability multiplies down">
      <text x="18" y="22" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
        IN SERIES
      </text>
      <g>
        <DiagramBox x={18} y={32} w={62} label="DNS" sub="99.99%" />
        <DiagramBox x={112} y={32} w={62} label="LB" sub="99.9%" />
        <DiagramBox x={206} y={32} w={62} label="App" sub="99.9%" />
        <DiagramBox x={300} y={32} w={62} label="DB" sub="99.5%" />
      </g>
      <g stroke={INK} strokeWidth="2" fill="none">
        <path d="M80 47h32M174 47h32M268 47h32" />
        <path d="M106 42l6 5-6 5M200 42l6 5-6 5M294 42l6 5-6 5" />
      </g>
      <text x="18" y="94" fontFamily={MONO} fontSize="10" fontWeight="700" fill={INK}>
        0.9999 × 0.999 × 0.999 × 0.995 ≈ 99.3%
      </text>
      <text x="18" y="108" fontFamily={MONO} fontSize="7.5" letterSpacing="0.5" fill={SOFT}>
        every hop takes a bite
      </text>

      <line x1="18" y1="124" x2="382" y2="124" stroke="var(--line-soft)" strokeWidth="1.5" strokeDasharray="3 4" />

      <text x="18" y="146" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
        IN PARALLEL
      </text>
      <g>
        <DiagramBox x={18} y={166} w={62} label="LB" sub="99.9%" />
        <DiagramBox x={132} y={152} w={70} label="App A" sub="99%" tone="mint" />
        <DiagramBox x={132} y={196} w={70} label="App B" sub="99%" tone="mint" />
        <DiagramBox x={252} y={174} w={62} label="DB" sub="99.5%" />
      </g>
      <g stroke={INK} strokeWidth="2" fill="none">
        <path d="M80 181c18 0 18-14 52-14M80 181c18 0 18 14 52 14" />
        <path d="M202 167c18 0 18 7 50 7M202 211c18 0 18-23 50-23" />
        <path d="M314 181h44" />
      </g>
      <text x="252" y="152" fontFamily={MONO} fontSize="9" fontWeight="700" fill="var(--mint-2)">
        1 − 0.01² = 99.99%
      </text>
      <text x="252" y="224" fontFamily={MONO} fontSize="7.5" letterSpacing="0.5" fill={SOFT}>
        independent copies fail together less
      </text>
    </svg>
  );
}

function HealthCheckDiagram() {
  const startX = 40;
  const width = 320;
  const failuresAt = 5;
  const ejectedAt = failuresAt + 15;
  const total = 28;
  const x = (t: number) => startX + (t / total) * width;
  return (
    <svg viewBox="0 0 400 232" role="img" aria-label="Timeline showing a backend failing at 5 seconds and being ejected 15 seconds later">
      <text x="18" y="24" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
        DETECTION WINDOW
      </text>

      <rect x={x(failuresAt)} y="46" width={x(ejectedAt) - x(failuresAt)} height="50" fill="rgba(229,71,77,0.16)" stroke="var(--red)" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x={x(0)} y="46" width={x(failuresAt) - x(0)} height="50" fill="rgba(67,214,164,0.16)" />
      <rect x={x(ejectedAt)} y="46" width={x(total) - x(ejectedAt)} height="50" fill="rgba(67,214,164,0.16)" />

      <text x={x(failuresAt) + 5} y="62" fontFamily={MONO} fontSize="7.5" fontWeight="700" fill="var(--red-2)">
        BACKEND DEAD
      </text>
      <text x={x(failuresAt) + 5} y="84" fontFamily={MONO} fontSize="7.5" fill="var(--red-2)">
        15 s of 5xx
      </text>
      <text x={x(0) + 5} y="62" fontFamily={MONO} fontSize="7.5" fill="#0a6448">
        HEALTHY
      </text>
      <text x={x(ejectedAt) + 5} y="62" fontFamily={MONO} fontSize="7.5" fill="#0a6448">
        EJECTED
      </text>

      <line x1={startX} y1="112" x2={startX + width} y2="112" stroke={INK} strokeWidth="2" />
      {Array.from({ length: 6 }, (_, index) => {
        const t = index * 5;
        return (
          <g key={t}>
            <line x1={x(t)} y1="106" x2={x(t)} y2="118" stroke={INK} strokeWidth="2" />
            <circle cx={x(t)} cy="90" r="3.4" fill={t >= failuresAt && t < ejectedAt ? 'var(--red)' : 'var(--mint)'} stroke={INK} strokeWidth="1.3" />
            <text x={x(t)} y="132" textAnchor="middle" fontFamily={MONO} fontSize="7.5" fill={SOFT}>
              {t}s
            </text>
          </g>
        );
      })}
      <text x={x(2.5)} y="152" textAnchor="middle" fontFamily={MONO} fontSize="7" letterSpacing="0.5" fill={SOFT}>
        probe
      </text>

      <g>
        <rect x="18" y="168" width="174" height="44" rx="8" fill={PAPER} stroke={INK} strokeWidth="1.8" />
        <text x="30" y="185" fontFamily={MONO} fontSize="8" letterSpacing="0.8" fill={SOFT}>
          INTERVAL
        </text>
        <text x="30" y="201" fontFamily={MONO} fontSize="11" fontWeight="700" fill={INK}>
          5 s
        </text>
        <text x="106" y="185" fontFamily={MONO} fontSize="8" letterSpacing="0.8" fill={SOFT}>
          THRESHOLD
        </text>
        <text x="106" y="201" fontFamily={MONO} fontSize="11" fontWeight="700" fill={INK}>
          3 fails
        </text>
      </g>
      <g>
        <rect x="206" y="168" width="174" height="44" rx="8" fill="var(--orange-soft)" stroke={INK} strokeWidth="1.8" />
        <text x="218" y="185" fontFamily={MONO} fontSize="8" letterSpacing="0.8" fill="var(--orange-2)">
          = USERS NOTICE FOR
        </text>
        <text x="218" y="201" fontFamily={MONO} fontSize="11" fontWeight="700" fill="var(--orange-2)">
          15 seconds
        </text>
      </g>
    </svg>
  );
}

function ErrorBudgetDiagram() {
  const budget = 10;
  const spent = 3.2;
  const start = Math.PI;
  const radius = 74;
  const cx = 200;
  const cy = 168;
  const point = (fraction: number) => {
    const angle = Math.PI + Math.PI * fraction;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  };
  const budgetEnd = point(spent / budget);
  const arc = `M${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${budgetEnd.x} ${budgetEnd.y}`;
  return (
    <svg viewBox="0 0 400 232" role="img" aria-label="Error budget gauge: 3.2 of 10 error seconds spent">
      <path d={`M${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`} fill="none" stroke="var(--paper-sunk)" strokeWidth="20" strokeLinecap="round" />
      <path d={arc} fill="none" stroke="var(--orange)" strokeWidth="20" strokeLinecap="round" />
      <path
        d={`M${point(spent / budget).x} ${point(spent / budget).y} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="var(--mint)"
        strokeWidth="20"
        strokeLinecap="round"
        opacity="0.35"
      />
      <text x={cx} y={cy - 26} textAnchor="middle" fontFamily={MONO} fontSize="8" letterSpacing="1.6" fill={SOFT}>
        ERROR BUDGET
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" fontFamily={DISPLAY} fontSize="30" fontWeight="800" fill={INK}>
        3.2s
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontFamily={MONO} fontSize="8.5" fill={SOFT}>
        of 10s allowed
      </text>
      <text x={cx - radius + 4} y={cy + 26} textAnchor="middle" fontFamily={MONO} fontSize="8" fill={SOFT}>
        0s
      </text>
      <text x={cx + radius - 4} y={cy + 26} textAnchor="middle" fontFamily={MONO} fontSize="8" fill={SOFT}>
        10s
      </text>
      <g>
        <rect x="24" y="24" width="112" height="26" rx="5" fill={PAPER} stroke={INK} strokeWidth="1.6" />
        <text x="34" y="41" fontFamily={MONO} fontSize="8" letterSpacing="0.8" fill={SOFT}>
          SPENT = 32%
        </text>
      </g>
    </svg>
  );
}

/* Keyboard reference, shared with the in-game help modal. */
export function ControlsReference() {
  return (
    <div className="help-keys">
      <span>
        <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>5</Kbd> <Kbd>0</Kbd>
      </span>
      <span>Run speed 1× / 2× / 5× / 10×</span>
      <span>
        <Kbd>Space</Kbd>
      </span>
      <span>Pause or resume the shift</span>
      <span>
        <Kbd>D</Kbd>
      </span>
      <span>Toggle the metrics drawer</span>
      <span>
        <Kbd>L</Kbd>
      </span>
      <span>Start a link from the selected node</span>
      <span>
        <Kbd>Del</Kbd>
      </span>
      <span>Delete the selected node or link</span>
      <span>
        <Kbd>Esc</Kbd>
      </span>
      <span>Cancel linking, close dialogs</span>
    </div>
  );
}
