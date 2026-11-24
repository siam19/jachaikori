import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { tt, type Lang } from '../i18n/tt';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  lang: Lang;
  children: ReactNode;
  headerAction?: ReactNode;
}

/**
 * Accessible slide-over drawer (desktop) / bottom sheet (mobile) with soft rounded corners.
 */
export function Sheet({ open, onClose, title, lang, children, headerAction }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[86dvh] md:max-h-none w-full md:w-[460px] flex-col bg-paper rounded-t-3xl md:rounded-t-none md:rounded-s-3xl border-t md:border-t-0 md:border-s border-rule/80 shadow-2xl outline-none overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 border-b border-rule/60 px-5 py-4 bg-paper-raised">
          <div className="min-w-0 flex-1 font-display text-base font-medium text-ink truncate">
            {title}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              aria-label={tt('nav.close', lang)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rule/80 text-ink hover:bg-paper-sunk cursor-pointer"
            >
              <X className="h-4 w-4" strokeWidth={1.6} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
