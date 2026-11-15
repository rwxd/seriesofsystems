import type { CSSProperties, ReactNode } from 'react';
import type { ComponentKind } from '@/sim/types';

/**
 * Custom SVG icon set. Chunky 24×24 outline style so icons read at
 * small sizes without turning into soup.
 */
export type IconName =
  // ui
  | 'play'
  | 'pause'
  | 'bell'
  | 'gauge'
  | 'code'
  | 'help'
  | 'close'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'lock'
  | 'unlock'
  | 'star'
  | 'check'
  | 'check-circle'
  | 'warning'
  | 'down'
  | 'alert'
  | 'arrow-right'
  | 'arrow-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'link'
  | 'settings'
  | 'volume'
  | 'volume-off'
  | 'motion'
  | 'bulb'
  | 'reset'
  | 'clock'
  | 'dollar'
  | 'activity'
  | 'rocket'
  | 'book'
  | 'bug'
  | 'grip'
  | 'search'
  | 'copy'
  | 'info'
  | 'server'
  | 'trace'
  | 'customer'
  | 'shield'
  | 'waf'
  | 'bolt'
  | 'layers'
  | 'series'
  | 'terminal'
  // components
  | 'dns'
  | 'cdn'
  | 'lb'
  | 'nginx'
  | 'vm'
  | 'k8s'
  | 'db'
  | 'cache'
  | 'storage';

const PATHS: Record<IconName, ReactNode> = {
  play: <path d="M8 5.2v13.6a.9.9 0 0 0 1.36.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M12 3.6a5.5 5.5 0 0 0-5.5 5.5v3.5L4.7 16.2h14.6l-1.8-3.6V9.1A5.5 5.5 0 0 0 12 3.6Z" />
      <path d="M9.6 19a2.6 2.6 0 0 0 4.8 0" />
    </>
  ),
  gauge: (
    <>
      <path d="M3.6 17.4a9 9 0 1 1 16.8 0" />
      <path d="M12 13.8 16.4 9" />
      <circle cx="12" cy="14.2" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  code: <path d="m9 8-5 4 5 4M15 8l5 4-5 4" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2-2.6 3.8" />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13M10.2 11v5.5M13.8 11v5.5" />,
  lock: (
    <>
      <rect x="4.8" y="10.5" width="14.4" height="9.6" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.2" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.8" y="10.5" width="14.4" height="9.6" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.4-2.1" />
    </>
  ),
  star: <path d="m12 3.4 2.66 5.45 6 .86-4.36 4.2 1.04 5.95L12 16.98l-5.34 2.88 1.04-5.95-4.36-4.2 6-.86Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  check: <path d="m4.6 12.6 4.8 4.8L19.4 6.6" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.9 2.8L16.3 9" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.1 21 19.3H3z" />
      <path d="M12 9.6v4.2" />
      <circle cx="12" cy="16.7" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  down: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  alert: (
    <>
      <path d="m8.2 3.4 7.6 0 4.8 4.8v7.6l-4.8 4.8H8.2l-4.8-4.8V8.2z" />
      <path d="M12 7.8v5" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'arrow-right': <path d="M4.6 12h14.2m-5.6-5.6L19 12l-5.8 5.6" />,
  'arrow-left': <path d="M19.4 12H5.2m5.6-5.6L5 12l5.8 5.6" />,
  'chevron-down': <path d="m6 9.4 6 6 6-6" />,
  'chevron-up': <path d="m6 14.6 6-6 6 6" />,
  'chevron-right': <path d="m9.4 6 6 6-6 6" />,
  'zoom-in': (
    <>
      <circle cx="10.6" cy="10.6" r="6.6" />
      <path d="m15.5 15.5 4.5 4.5M10.6 7.7v5.8M7.7 10.6h5.8" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.6" cy="10.6" r="6.6" />
      <path d="m15.5 15.5 4.5 4.5M7.7 10.6h5.8" />
    </>
  ),
  fit: <path d="M4 9.2V5.6A1.6 1.6 0 0 1 5.6 4H9.2M14.8 4h3.6A1.6 1.6 0 0 1 20 5.6v3.6M20 14.8v3.6a1.6 1.6 0 0 1-1.6 1.6h-3.6M9.2 20H5.6A1.6 1.6 0 0 1 4 18.4v-3.6" />,
  link: (
    <>
      <path d="M9.7 14.3a4.2 4.2 0 0 1 0-6l2.2-2.2a4.2 4.2 0 0 1 5.9 5.9l-1.5 1.5" />
      <path d="M14.3 9.7a4.2 4.2 0 0 1 0 6l-2.2 2.2a4.2 4.2 0 0 1-5.9-5.9l1.5-1.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.4M12 18.4v2.4M4.8 12H2.4M21.6 12h-2.4M6.9 6.9 5.2 5.2M18.8 18.8l-1.7-1.7M17.1 6.9l1.7-1.7M5.2 18.8l1.7-1.7" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5.4 6.8 9H3.6v6h3.2L11 18.6z" />
      <path d="M15.2 9.2a4 4 0 0 1 0 5.6M18 6.4a8 8 0 0 1 0 11.2" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M11 5.4 6.8 9H3.6v6h3.2L11 18.6z" />
      <path d="m15.6 9.6 4.8 4.8M20.4 9.6l-4.8 4.8" />
    </>
  ),
  motion: (
    <>
      <path d="M3 8.4h9a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 12.4h13a2.5 2.5 0 1 1-2.5 2.5" />
      <path d="M3 16.4h6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9.2 17.2a6 6 0 1 1 5.6 0v1.2a1.6 1.6 0 0 1-1.6 1.6h-2.4a1.6 1.6 0 0 1-1.6-1.6z" />
      <path d="M9.6 20.8h4.8" />
    </>
  ),
  reset: (
    <>
      <path d="M4.6 12a7.6 7.6 0 1 1 2.7 5.8" />
      <path d="M4.2 6.4V11h4.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3.6v16.8" />
      <path d="M16 7.4c-.8-1-2.2-1.6-4-1.6-2.2 0-3.8 1.1-3.8 2.8 0 3.9 7.6 2.2 7.6 6.1 0 1.8-1.7 2.9-4 2.9-1.9 0-3.4-.7-4.2-1.8" />
    </>
  ),
  activity: <path d="M2.8 12.2h3.6l2.4 6.6 4.4-13.6 2.6 7h5.4" />,
  rocket: (
    <>
      <path d="M13.4 4.6c2.6-2.1 5.6-2.3 6-2.3.6.4.4 3.4-1.7 6-2.4 2.9-5.3 5-5.3 5l-4-4s2.1-2.9 5-4.7Z" />
      <circle cx="16" cy="8" r="1.6" />
      <path d="m9.6 12.4-3.9.7-2.2 2.2 3.6.8" />
      <path d="m11.6 14.4-.7 3.9-2.2 2.2-.8-3.6" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.4A2.2 2.2 0 0 1 6.2 3.2H19v15.4H6.2A2.2 2.2 0 0 0 4 20.8z" />
      <path d="M4 18.6a2.2 2.2 0 0 1 2.2-2.2H19" />
    </>
  ),
  bug: (
    <>
      <rect x="7.6" y="7.6" width="8.8" height="11" rx="4.4" />
      <path d="M9.6 7.6V6a2.4 2.4 0 0 1 4.8 0v1.6M12 7.6v11M7.4 11H4M7.4 15.4H4.4M16.6 11H20M16.6 15.4H19.6M7.6 18 5.6 20M16.4 18l2 2" />
    </>
  ),
  grip: (
    <>
      {[8, 12, 16].map((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" stroke="none" />),
      )}
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.6" />
      <path d="m15.9 15.9 4.3 4.3" />
    </>
  ),
  copy: (
    <>
      <rect x="8.6" y="8.6" width="11" height="11" rx="2" />
      <path d="M15.4 5.6H6.6a2 2 0 0 0-2 2v9.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5.4" />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  server: (
    <>
      <rect x="3.4" y="4" width="17.2" height="6.6" rx="1.8" />
      <rect x="3.4" y="13.4" width="17.2" height="6.6" rx="1.8" />
      <circle cx="7" cy="7.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="16.7" r="1" fill="currentColor" stroke="none" />
      <path d="M11 7.3h6M11 16.7h6" />
    </>
  ),
  trace: (
    <>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M7.2 6h6a3 3 0 0 1 0 6H9.2a3 3 0 0 0 0 6h7.6" />
    </>
  ),
  customer: (
    <>
      <circle cx="9.2" cy="8" r="3.4" />
      <path d="M3.4 20a5.9 5.9 0 0 1 11.6 0" />
      <path d="M16.2 5.2a3.4 3.4 0 0 1 0 6M17.6 14.6A5.4 5.4 0 0 1 21 20" />
    </>
  ),
  shield: <path d="M12 3.4 19.5 6v6c0 4.3-3 7.3-7.5 9-4.5-1.7-7.5-4.7-7.5-9V6z" />,
  waf: (
    <>
      <path d="M12 3.4 19.5 6v6c0 4.3-3 7.3-7.5 9-4.5-1.7-7.5-4.7-7.5-9V6z" />
      <path d="M8.4 10.2h7.2M8.4 13.2h7.2M10.6 8.4v6.6M13.4 8.4v6.6" />
    </>
  ),
  bolt: <path d="M13.2 2.6 5.8 13.4h5.2l-1.4 8 7.6-11h-5.4z" fill="currentColor" stroke="none" />,
  layers: (
    <>
      <path d="m12 3.4 8.6 4.3L12 12 3.4 7.7z" />
      <path d="m3.4 12.1 8.6 4.3 8.6-4.3" />
      <path d="m3.4 16.4 8.6 4.3 8.6-4.3" />
    </>
  ),
  series: (
    <>
      <rect x="2.9" y="9" width="7.2" height="6" rx="1.6" />
      <rect x="13.9" y="9" width="7.2" height="6" rx="1.6" />
      <path d="M10.1 12h3.8" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.4" width="18" height="15.2" rx="2" />
      <path d="m7.4 9.4 3.2 2.6-3.2 2.6M12.8 15h4" />
    </>
  ),

  // ---- components ----
  dns: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2" />
      <path d="M12 3.4c2.4 2.3 3.7 5.3 3.7 8.6s-1.3 6.3-3.7 8.6c-2.4-2.3-3.7-5.3-3.7-8.6S9.6 5.7 12 3.4Z" />
    </>
  ),
  cdn: (
    <>
      <path d="M7 17.4a4 4 0 0 1-.3-8 5.2 5.2 0 0 1 9.9-1.2A4.4 4.4 0 0 1 17 17.4H7Z" />
      <circle cx="9.3" cy="13.1" r=".95" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.1" r=".95" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="13.1" r=".95" fill="currentColor" stroke="none" />
    </>
  ),
  lb: (
    <>
      <path d="M3.6 12h4" />
      <path d="m7.6 12 5.2-6h6.6M7.6 12h11.8M7.6 12l5.2 6h6.6" />
      <circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20.2" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20.2" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20.2" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  nginx: (
    <>
      <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" />
      <path d="M8.8 15.2V8.8l6.4 6.4V8.8" />
    </>
  ),
  vm: (
    <>
      <rect x="2.8" y="4.6" width="18.4" height="12.4" rx="1.8" />
      <path d="M8.6 20.8h6.8M12 17v3.8" />
      <path d="M6.4 8.2h4.4M6.4 11.2h7.4" />
    </>
  ),
  k8s: (
    <>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M12 3v3.1M12 17.9V21M3.7 7.6l2.7 1.6M17.6 14.8l2.7 1.6M3.7 16.4l2.7-1.6M17.6 9.2l2.7-1.6M14.5 5 13.3 7.9M10.7 16.1 9.5 19M20.3 12h-3.1M6.8 12H3.7" />
    </>
  ),
  db: (
    <>
      <path d="M4 6.8c0-1.6 3.6-2.9 8-2.9s8 1.3 8 2.9-3.6 2.9-8 2.9-8-1.3-8-2.9Z" />
      <path d="M4 6.8v10.4c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9V6.8" />
      <path d="M4 12c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9" />
    </>
  ),
  cache: (
    <>
      <rect x="3.2" y="3.6" width="17.6" height="16.8" rx="3" />
      <path d="M13.2 7.4 9 13h3.2l-1 4.2 4.4-6h-3.2z" fill="currentColor" stroke="none" />
    </>
  ),
  storage: (
    <>
      <path d="M3.4 7.2 12 3.2l8.6 4v9.6l-8.6 4-8.6-4z" />
      <path d="m3.4 7.2 8.6 4 8.6-4M12 11.2v9.6" />
    </>
  ),
};

const KIND_ICON: Record<ComponentKind, IconName> = {
  dns: 'dns',
  waf: 'waf',
  cdn: 'cdn',
  lb: 'lb',
  proxy: 'nginx',
  vm: 'vm',
  k8s: 'k8s',
  db: 'db',
  cache: 'cache',
  storage: 'storage',
};

export function iconForKind(kind: ComponentKind): IconName {
  return KIND_ICON[kind];
}

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, strokeWidth = 2, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
