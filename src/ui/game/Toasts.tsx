import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { Icon, type IconName } from '@/ui/components/Icon';

const ICONS: Record<string, IconName> = {
  success: 'check-circle',
  danger: 'alert',
  warning: 'warning',
  info: 'info',
};

export function Toasts() {
  const toast = useGame((state) => state.toast);
  const dismissToast = useGame((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const delay = toast.tone === 'danger' ? 6500 : 4200;
    const timer = window.setTimeout(() => dismissToast(), delay);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;
  const tone = toast.tone ?? 'info';

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <div className={`toast toast--${tone}`}>
        <span className="toast__icon">
          <Icon name={ICONS[tone] ?? 'info'} size={15} />
        </span>
        <span className="toast__body">{toast.message}</span>
        <button
          type="button"
          onClick={dismissToast}
          aria-label="Dismiss notification"
          style={{ color: 'var(--ink-soft)', display: 'grid', placeItems: 'center', padding: 2 }}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  );
}
