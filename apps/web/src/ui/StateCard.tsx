import type { ReactNode } from 'react';
import { FileQuestion } from 'lucide-react';

interface StateCardProps {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  dashed?: boolean;
  className?: string;
}

/**
 * Calm, soft, blame-free state card (never rust).
 */
export function StateCard({
  title,
  body,
  icon,
  action,
  secondaryAction,
  dashed = false,
  className = '',
}: StateCardProps) {
  return (
    <div
      className={`rounded-2xl bg-paper-raised p-5 sm:p-6 border shadow-sm ${
        dashed ? 'border-dashed border-rule-strong/70' : 'border-rule/90'
      } ${className}`.trim()}
    >
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 text-pencil shrink-0" aria-hidden="true">
          {icon ?? <FileQuestion className="h-5 w-5" strokeWidth={1.6} />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="font-display text-base font-medium text-ink m-0">{title}</h3>
          {body ? <p className="text-sm text-pencil leading-relaxed m-0">{body}</p> : null}
          {action || secondaryAction ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {action}
              {secondaryAction}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
