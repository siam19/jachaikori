import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface BannerProps {
  children: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}

export function Banner({ children, onDismiss, action, className = '' }: BannerProps) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 rounded-2xl border border-rule/80 bg-paper-raised px-4 py-3 text-sm text-ink shadow-xs ${className}`.trim()}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer"
          >
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
