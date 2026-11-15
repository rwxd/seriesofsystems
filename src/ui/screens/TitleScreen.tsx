import { useGame } from '@/game/store';
import { Btn, StarRow } from '@/ui/components/ui';
import { LogoLockup, LogoMark } from '@/ui/components/Logo';
import { totalStars, sandboxBest, CAMPAIGN_LEVELS } from '@/ui/lib/campaign';
import { fmtNum } from '@/ui/lib/format';
import { Icon } from '@/ui/components/Icon';

export function TitleScreen() {
  const profile = useGame((state) => state.profile);
  const go = useGame((state) => state.go);
  const togglePanel = useGame((state) => state.togglePanel);

  const stars = totalStars(profile);
  const completed = profile.completed.length;
  const best = sandboxBest(profile);
  const hasProgress = completed > 0 || stars > 0 || best > 0;

  return (
    <div className="screen blueprint-bg">
      <div className="title-screen">
        <div className="title__left">
          <div className="title__meta">
            <span>
              <Icon name="series" size={13} /> series
            </span>
            <span>
              <Icon name="layers" size={13} /> parallel
            </span>
            <span>
              <Icon name="gauge" size={13} /> p95
            </span>
            <span>
              <Icon name="bell" size={13} /> 3 a.m.
            </span>
          </div>

          <div className="title__plate">
            <div className="title__logo">
              <LogoMark size={64} />
              <div className="title__wordmark">
                <span className="eyebrow" style={{ color: 'var(--ink-soft)' }}>
                  A game about systems engineering
                </span>
                <h1>
                  Series
                  <br />
                  of Systems
                </h1>
              </div>
            </div>

            <p className="title__tagline">
              One request goes in. A dozen things can go wrong. <strong>Design for failure</strong>,
              survive pager duty, and keep the site up while everything burns.
            </p>

            {hasProgress ? (
              <div className="title__continue">
                <span style={{ display: 'grid', gap: 2, flex: 1 }}>
                  <span className="eyebrow">Last shift recorded</span>
                  <span className="row" style={{ gap: 8 }}>
                    <StarRow value={Math.min(3, Math.round(stars / Math.max(1, completed || 1)))} />
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      {completed}/{CAMPAIGN_LEVELS.length || '—'} levels · {fmtNum(stars)} stars
                    </span>
                  </span>
                </span>
                <Btn variant="ink" size="sm" icon="arrow-right" onClick={() => go('campaign')}>
                  Resume
                </Btn>
              </div>
            ) : (
              <div className="title__continue" style={{ borderStyle: 'solid', background: 'var(--paper-3)' }}>
                <Icon name="bulb" size={18} />
                <span style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.35 }}>
                  <strong>First shift:</strong> add a second app instance in another zone. Trust us on
                  this one.
                </span>
              </div>
            )}

            <div className="title__actions">
              <Btn variant="primary" size="lg" icon="play" onClick={() => go('campaign')}>
                {hasProgress ? 'Continue campaign' : 'Play campaign'}
              </Btn>
              <Btn size="lg" icon="bolt" onClick={() => togglePanel('sandboxSetupOpen')}>
                Sandbox
              </Btn>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                <Btn icon="book" onClick={() => go('howto')}>
                  How to play
                </Btn>
                <Btn icon="settings" onClick={() => go('settings')}>
                  Settings
                </Btn>
              </div>
            </div>
          </div>
        </div>

        <div className="title__right">
          <div className="hero-card">
            <span className="hero-card__tape" aria-hidden="true" />
            <div className="hero-card__fig">
              <HeroDiagram />
            </div>
            <div className="hero-card__caption">
              <span>Fig. 1 — the happy path</span>
              <span>not to scale</span>
            </div>
            {best > 0 && (
              <div className="hero-note">
                <strong>Sandbox best:</strong> {fmtNum(best)} pts. The database still remembers.
              </div>
            )}
          </div>
        </div>

        <div className="title__footer">
          <span className="row" style={{ gap: 14 }}>
            <LogoLockup compact />
          </span>
          <span>No accounts · no network · progress saved in this browser</span>
          <span>v0.1 · single player</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Decorative schematic                                                */
/* ------------------------------------------------------------------ */

function HeroDiagram() {
  return (
    <svg viewBox="0 0 520 386" role="img" aria-label="Schematic of a web stack with one zone failing">
      <defs>
        <pattern id="heroDots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="rgba(23,33,43,0.13)" />
        </pattern>
        <marker id="heroArrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 8 4 0 8z" fill="var(--ink-soft)" />
        </marker>
      </defs>

      <rect x="0" y="0" width="520" height="386" rx="14" fill="url(#heroDots)" />

      {/* links */}
      <g fill="none" stroke="var(--ink-soft)" strokeWidth="2" markerEnd="url(#heroArrow)">
        <path d="M260 56v18" />
        <path d="M236 122c-20 12-42 22-52 36" />
        <path d="M284 122c20 12 42 22 52 36" />
        <path d="M124 262c0 24 46 24 118 32" />
        <path d="M396 262c0 24-46 24-118 32" />
      </g>

      {/* packets */}
      <g fill="var(--orange)">
        <circle r="3">
          <animateMotion dur="2.6s" repeatCount="indefinite" path="M260 56v18" />
        </circle>
        <circle r="3">
          <animateMotion dur="3.1s" begin="0.4s" repeatCount="indefinite" path="M236 122c-20 12-42 22-52 36" />
        </circle>
        <circle r="3">
          <animateMotion dur="3.4s" begin="1.1s" repeatCount="indefinite" path="M284 122c20 12 42 22 52 36" />
        </circle>
      </g>

      {/* zones */}
      <g>
        <rect x="16" y="164" width="216" height="128" rx="10" fill="rgba(92,184,234,0.12)" stroke="rgba(92,184,234,0.5)" strokeWidth="2" strokeDasharray="7 5" />
        <rect x="288" y="164" width="216" height="128" rx="10" fill="rgba(155,140,245,0.12)" stroke="rgba(155,140,245,0.5)" strokeWidth="2" strokeDasharray="7 5" />
        <rect x="28" y="152" width="98" height="18" rx="4" fill="#5cb8ea" stroke="var(--ink)" strokeWidth="1.6" />
        <text x="77" y="165" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5" fontWeight="700" letterSpacing="1" fill="#062539">
          US-EAST-A
        </text>
        <rect x="300" y="152" width="98" height="18" rx="4" fill="#9b8cf5" stroke="var(--ink)" strokeWidth="1.6" />
        <text x="349" y="165" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5" fontWeight="700" letterSpacing="1" fill="#0b0730">
          US-EAST-B
        </text>
      </g>

      {/* DNS */}
      <g>
        <rect x="182" y="6" width="156" height="50" rx="10" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2.4" />
        <rect x="184" y="8" width="5" height="46" rx="2.5" fill="var(--mint)" />
        <g transform="translate(196 18)" color="var(--ink-2)">
          <Icon name="dns" size={24} />
        </g>
        <text x="228" y="25" fontFamily="var(--font-display)" fontSize="12" fontWeight="800" fill="var(--ink)">
          DNS
        </text>
        <text x="228" y="39" fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1" fill="var(--ink-soft)">
          TTL 60s
        </text>
      </g>

      {/* LB */}
      <g>
        <rect x="192" y="78" width="136" height="46" rx="10" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2.4" />
        <rect x="194" y="80" width="5" height="42" rx="2.5" fill="var(--mint)" />
        <g transform="translate(204 88)" color="var(--ink-2)">
          <Icon name="lb" size={22} />
        </g>
        <text x="234" y="95" fontFamily="var(--font-display)" fontSize="11.5" fontWeight="800" fill="var(--ink)">
          Load balancer
        </text>
        <text x="234" y="110" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.8" fill="var(--ink-soft)">
          least-conn
        </text>
      </g>

      {/* VMs */}
      {[
        { x: 40, label: 'App A', status: 'down' },
        { x: 312, label: 'App B', status: 'ok' },
      ].map((node) => (
        <g key={node.label}>
          <rect x={node.x + 2} y={196} width="168" height="62" rx="10" fill="rgba(23,33,43,0.18)" />
          <rect x={node.x} y={194} width="168" height="62" rx="10" fill={node.status === 'down' ? '#f7e6e2' : 'var(--paper-2)'} stroke="var(--ink)" strokeWidth="2.2" />
          <rect x={node.x + 2} y={196} width="5" height="58" rx="2.5" fill={node.status === 'down' ? 'var(--red)' : 'var(--mint)'} />
          <g transform={`translate(${node.x + 16} 208)`} color="var(--ink-2)">
            <Icon name="vm" size={22} />
          </g>
          <text x={node.x + 46} y={220} fontFamily="var(--font-display)" fontSize="11.5" fontWeight="800" fill="var(--ink)">
            {node.label}
          </text>
          <text x={node.x + 46} y={232} fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.8" fill={node.status === 'down' ? 'var(--red-2)' : 'var(--ink-soft)'}>
            {node.status === 'down' ? 'DOWN · ZONE A' : 'HEALTHY'}
          </text>
          <rect x={node.x + 16} y={240} width="136" height="6" rx="3" fill="var(--paper-sunk)" stroke="var(--ink)" strokeWidth="1" />
          <rect x={node.x + 17} y={241} width={node.status === 'down' ? 12 : 92} height="4" rx="2" fill={node.status === 'down' ? 'var(--red)' : 'var(--mint)'} />
        </g>
      ))}

      {/* incident burst */}
      <g transform="translate(40 194)">
        <circle cx="0" cy="0" r="16" fill="rgba(229,71,77,0.18)" />
        <path d="M-7 -7 7 7M7 -7-7 7" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" />
        <path d="M-16 -22c-4-8 4-10 0-18M6 -24c-4-8 4-10 0-18M24 -20c-4-8 4-10 0-18" stroke="rgba(23,33,43,0.35)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </g>

      {/* DB */}
      <g>
        <rect x="196" y="296" width="128" height="52" rx="10" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2.4" />
        <rect x="198" y="298" width="5" height="48" rx="2.5" fill="var(--amber)" />
        <g transform="translate(208 308)" color="var(--ink-2)">
          <Icon name="db" size={24} />
        </g>
        <text x="240" y="316" fontFamily="var(--font-display)" fontSize="11.5" fontWeight="800" fill="var(--ink)">
          Postgres
        </text>
        <text x="240" y="330" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.8" fill="var(--ink-soft)">
          multi-AZ off
        </text>
      </g>

      {/* annotations */}
      <g fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1.4" fill="var(--ink-soft)">
        <text x="24" y="364">ONE ZONE · TWO VMS · ZERO EXCUSES</text>
      </g>
      <g transform="translate(430 300)">
        <rect x="0" y="0" width="74" height="46" rx="4" fill="var(--amber-soft)" stroke="var(--ink)" strokeWidth="1.6" transform="rotate(3 37 23)" />
        <text x="37" y="18" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--ink-2)" transform="rotate(3 37 23)">
          p95
        </text>
        <text x="37" y="33" textAnchor="middle" fontFamily="var(--font-display)" fontSize="14" fontWeight="800" fill="var(--ink)" transform="rotate(3 37 23)">
          2.4 s
        </text>
      </g>
    </svg>
  );
}
