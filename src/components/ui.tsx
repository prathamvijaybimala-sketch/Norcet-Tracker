import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ProgressBar({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'ok';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar ${tone === 'ok' ? 'ok' : ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatCard({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontWeight: 650, marginBottom: 4 }}>{title}</div>
      <div className="small">{children}</div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3 style={{ flex: 1, fontSize: 16 }}>{title}</h3>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="toast" role="status" onClick={onDismiss}>
      {message}
    </div>
  );
}
