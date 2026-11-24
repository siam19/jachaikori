import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Sheet } from '../../../ui/Sheet';
import { EntityPeek } from './EntityPeek';
import { EventPeek } from './EventPeek';
import { useLang } from '../../../lib/useLang';
import { ArrowLeft } from 'lucide-react';
import { tt } from '../../../i18n/tt';

export type PeekTarget =
  | { kind: 'entity'; id: string; label?: string }
  | { kind: 'event'; id: string; label?: string };

interface PeekContextValue {
  openEntityPeek: (id: string, label?: string) => void;
  openEventPeek: (id: string, label?: string) => void;
  closePeek: () => void;
  hoveredEntityId: string | null;
  setHoveredEntityId: (id: string | null) => void;
}

const PeekContext = createContext<PeekContextValue | null>(null);

export function PeekProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<PeekTarget[]>([]);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [lang] = useLang();

  const openEntityPeek = useCallback((id: string, label?: string) => {
    setStack((prev) => {
      const top = prev.at(-1);
      if (top && top.kind === 'entity' && top.id === id) return prev;
      return [...prev, { kind: 'entity', id, label }];
    });
  }, []);

  const openEventPeek = useCallback((id: string, label?: string) => {
    setStack((prev) => {
      const top = prev.at(-1);
      if (top && top.kind === 'event' && top.id === id) return prev;
      return [...prev, { kind: 'event', id, label }];
    });
  }, []);

  const popPeek = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const closePeek = useCallback(() => {
    setStack([]);
  }, []);

  const current = stack.at(-1) ?? null;

  return (
    <PeekContext.Provider
      value={{ openEntityPeek, openEventPeek, closePeek, hoveredEntityId, setHoveredEntityId }}
    >
      {children}
      <Sheet
        open={Boolean(current)}
        onClose={closePeek}
        lang={lang}
        title={
          <div className="flex items-center gap-2 min-w-0">
            {stack.length > 1 ? (
              <button
                type="button"
                onClick={popPeek}
                aria-label={tt('nav.back', lang)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-rule-strong text-ink hover:bg-paper-sunk cursor-pointer shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            ) : null}
            <span className="truncate">
              {current?.label ?? (current?.kind === 'entity' ? tt('nav.people.short', lang) : tt('nav.events', lang))}
            </span>
          </div>
        }
      >
        {current?.kind === 'entity' ? (
          <EntityPeek entityId={current.id} lang={lang} onClose={closePeek} />
        ) : current?.kind === 'event' ? (
          <EventPeek eventId={current.id} lang={lang} onClose={closePeek} />
        ) : null}
      </Sheet>
    </PeekContext.Provider>
  );
}

export function usePeek() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeek must be used inside PeekProvider');
  return ctx;
}
