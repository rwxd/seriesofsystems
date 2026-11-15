/**
 * Brand mark: one request enters, three paths leave. The whole game
 * in a 40px square.
 */
export function LogoMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Series of Systems mark"
    >
      <rect x="0.5" y="0.5" width="39" height="39" rx="10" fill="var(--bp)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M7 20h4" stroke="var(--paper-2)" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M14 20h5M14 20l4-7h3M14 20l4 7h3"
        stroke="var(--paper-2)"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="20" r="2.6" fill="var(--mint)" stroke="var(--ink)" strokeWidth="1.4" />
      <circle cx="26" cy="13" r="3.1" fill="var(--mint)" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="27.5" cy="20" r="3.1" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="26" cy="27" r="3.1" fill="var(--orange)" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M33 6.5v5M30.5 9h5" stroke="var(--orange)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="row" style={{ gap: compact ? 7 : 12 }}>
      <LogoMark size={compact ? 30 : 46} />
      <span style={{ display: 'grid', gap: 0 }}>
        <span
          className="display"
          style={{
            fontSize: compact ? 14 : 24,
            lineHeight: 1,
            letterSpacing: '-0.03em',
          }}
        >
          Series of Systems
        </span>
        {!compact && (
          <span
            className="mono"
            style={{ fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}
          >
            Field manual for broken infrastructure
          </span>
        )}
      </span>
    </span>
  );
}
