import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { entityEgoQuery } from '../../api/queries';
import { tt, type Lang } from '../../i18n/tt';
import type { Lens } from '../../lib/useLens';
import { usePeek } from '../explore/peek/PeekContext';

const LazyOrbit = lazy(() => import('./Orbit'));

interface AssociatedPanelProps {
  entityId: string;
  centerName: string;
  lens: Lens;
  setLens: (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => void;
  lang: Lang;
}

export function AssociatedPanel({
  entityId,
  centerName,
  lens,
  setLens,
  lang,
}: AssociatedPanelProps) {
  const [view, setView] = useState<'list' | 'orbit'>('list');
  const { openEntityPeek, hoveredEntityId, setHoveredEntityId } = usePeek();
  const q = useQuery(entityEgoQuery(entityId, lens));
  const neighbors = q.data?.neighbors ?? [];

  const handleToggleWith = (id: string) => {
    setLens({ with: lens.with === id ? null : id });
  };

  return (
    <section id="sec-associated" className="space-y-3 scroll-mt-28">
      <div className="flex items-center justify-between gap-2 border-b border-rule pb-2">
        <h2 className="font-display text-base font-medium text-ink m-0">
          {tt('ent.sec.associated', lang)}
        </h2>
        <div className="inline-flex rounded-xl border border-rule-strong bg-paper-raised overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => setView('list')}
            className={`px-2 py-0.5 cursor-pointer ${
              view === 'list' ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('ent.assoc.list', lang)}
          </button>
          <button
            type="button"
            onClick={() => setView('orbit')}
            className={`px-2 py-0.5 border-s border-rule-strong cursor-pointer ${
              view === 'orbit' ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('ent.assoc.orbit', lang)}
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-paper-sunk" />
          ))}
        </div>
      ) : neighbors.length === 0 ? (
        <p className="text-xs text-pencil">{tt('empty.panel', lang)}</p>
      ) : view === 'orbit' ? (
        <Suspense fallback={<div className="h-60 rounded-xl bg-paper-sunk animate-pulse" />}>
          <LazyOrbit
            centerName={centerName}
            neighbors={neighbors}
            selectedId={lens.with}
            onSelect={(id) => handleToggleWith(id)}
            lang={lang}
          />
        </Suspense>
      ) : (
        <ul className="divide-y divide-rule border-t border-rule m-0 p-0 list-none">
          {neighbors.slice(0, 12).map((nb) => {
            const name =
              lang === 'bn'
                ? nb.canonicalBn || nb.canonicalEn || nb.id
                : nb.canonicalEn || nb.canonicalBn || nb.id;
            const active = lens.with === nb.id;
            const highlighted = hoveredEntityId === nb.id;

            return (
              <li
                key={nb.id}
                onMouseEnter={() => setHoveredEntityId(nb.id)}
                onMouseLeave={() => setHoveredEntityId(null)}
                className={`py-2 flex items-center justify-between gap-2 transition-colors ${
                  active || highlighted ? 'bg-paper-sunk/70 -mx-2 px-2 rounded-xl' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggleWith(nb.id)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className={`text-sm truncate ${active ? 'font-semibold text-ink' : 'text-ink hover:underline'}`}>
                    {name}
                  </div>
                  <div className="text-[11px] text-pencil">
                    {tt('ent.assoc.shared', lang, { n: nb.together ?? 0 })}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => openEntityPeek(nb.id, name)}
                  title={tt('peek.openFull', lang)}
                  aria-label={name}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer shrink-0"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
