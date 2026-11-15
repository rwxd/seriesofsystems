import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnVariant = 'default' | 'primary' | 'mint' | 'ink' | 'ghost' | 'outline' | 'danger' | 'blueprint';

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
}

export function Btn({
  variant = 'default',
  size = 'md',
  icon,
  iconRight,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: BtnProps) {
  const classes = [
    'btn',
    variant !== 'default' && `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    size === 'lg' && 'btn--lg',
    !children && 'btn--icon',
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 15 : 17;
  return (
    <button type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} size={iconSize} strokeWidth={2.1} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} strokeWidth={2.1} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

export function Pill({
  children,
  tone = 'default',
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'mint' | 'orange' | 'red' | 'sky' | 'ink' | 'ghost' | 'solid-mint' | 'solid-orange';
  title?: string;
}) {
  return (
    <span className={`pill${tone !== 'default' ? ` pill--${tone}` : ''}`} title={title}>
      {children}
    </span>
  );
}

export function StarRow({ value, max = 3, large = false }: { value: number; max?: number; large?: boolean }) {
  return (
    <span
      className={`stars${large ? ' stars--lg' : ''}`}
      role="img"
      aria-label={`${value} of ${max} stars`}
    >
      {Array.from({ length: max }, (_, index) => (
        <Icon
          key={index}
          name="star"
          size={large ? 30 : 15}
          className={index < value ? 'stars__on' : undefined}
          style={{ opacity: index < value ? 1 : 0.35 }}
        />
      ))}
    </span>
  );
}

export function Meter({
  value,
  tone,
  large,
  label,
}: {
  value: number;
  tone?: 'mint' | 'warn' | 'hot' | 'bad';
  large?: boolean;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const resolved =
    tone ?? (pct >= 0.9 ? 'bad' : pct >= 0.75 ? 'hot' : pct >= 0.55 ? 'warn' : 'mint');
  return (
    <div
      className={`meter${large ? ' meter--lg' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={label ?? 'utilization'}
    >
      <div className={`meter__fill meter__fill--${resolved}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  describedBy?: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
        aria-describedby={describedBy}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__knob" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  blueprint = false,
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  blueprint?: boolean;
}) {
  return (
    <div className={`segmented${blueprint ? ' segmented--blueprint' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="segmented__item"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="empty__title">{title}</span>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  title: string;
  sub?: string;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
  blueprint?: boolean;
  dismissable?: boolean;
}

export function Modal({
  open,
  onClose,
  kicker,
  title,
  sub,
  icon,
  size = 'md',
  footer,
  children,
  blueprint = false,
  dismissable = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && dismissable) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissable, onClose],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissable) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal${size !== 'md' ? ` modal--${size}` : ''}${blueprint ? ' modal--blueprint' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={sub ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ outline: 'none' }}
      >
        <header className="modal__head">
          {icon && (
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 38,
                height: 38,
                flex: 'none',
                border: '2px solid var(--ink)',
                borderRadius: 'var(--r-sm)',
                background: blueprint ? 'rgba(233,242,255,0.14)' : 'var(--paper-2)',
                color: blueprint ? 'var(--bp-ink)' : 'var(--ink)',
              }}
            >
              <Icon name={icon} size={21} />
            </span>
          )}
          <div className="modal__titles">
            {kicker && <span className="modal__kicker">{kicker}</span>}
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {sub && (
              <p className="modal__sub" id={descId}>
                {sub}
              </p>
            )}
          </div>
          {dismissable && (
            <Btn
              variant="ghost"
              className="modal__close"
              icon="close"
              aria-label="Close dialog"
              onClick={onClose}
            />
          )}
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
