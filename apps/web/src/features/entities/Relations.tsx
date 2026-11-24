import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink, List, Share2 } from 'lucide-react';
import { entityRelationsQuery } from '../../api/queries';
import { tt, type Lang, type StringKey } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate } from '../../lib/dates';
import { withNeighbour, type Lens, type RelationCategoryId } from '../../lib/useLens';
import { usePeek } from '../explore/peek/PeekContext';
import { Verbatim } from '../../ui/Verbatim';
import { OutletName } from '../../ui/OutletName';
import type { GraphHistoryEntry } from './EntityGraph';

const LazyEntityGraph = lazy(() => import('./EntityGraph'));

const CATEGORIES: Array<{ id: RelationCategoryId; key: StringKey }> = [
  { id: 'all', key: 'ent.rel.all' },
  { id: 'structure', key: 'ent.rel.cat.structure' },
  { id: 'stance', key: 'ent.rel.cat.stance' },
  { id: 'economy', key: 'ent.rel.cat.economy' },
  { id: 'law', key: 'ent.rel.cat.law' },
  { id: 'diplomacy', key: 'ent.rel.cat.diplomacy' },
];

interface RelationsPanelProps {
  entityId: string;
  entityName: string;
  entityType: string;
  lens: Lens;
  setLens: (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => void;
  lang: Lang;
  history: GraphHistoryEntry[];
  onNavigateEntity: (targetId: string, targetName: string) => void;
  onGoBack: () => void;
  onJumpHistory: (index: number) => void;
}

export function RelationsPanel({
  entityId,
  entityName,
  entityType,
  lens,
  setLens,
  lang,
  history,
  onNavigateEntity,
  onGoBack,
  onJumpHistory,
}: RelationsPanelProps) {
  const { hoveredEntityId, setHoveredEntityId } = usePeek();
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const q = useQuery(entityRelationsQuery(entityId, lens));
  const rawRows = q.data?.relations ?? [];
  const rows = withNeighbour(rawRows, lens);
  const maxWeight = Math.max(1, ...rows.map((r) => r.weight));
  const graphCenterId = q.data?.entityId ?? entityId;
  const graphCenterName =
    graphCenterId === entityId
      ? entityName
      : history.find((h) => h.id === graphCenterId)?.name ?? entityName;

  const activeCat: RelationCategoryId = lens.cat ?? 'all';

  return (
    <section id="sec-relations" className="space-y-3.5 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Category pill filter directly inline with Graph | List toggle for compact above-the-fold height */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={tt('ent.sec.relations', lang)}>
          {CATEGORIES.map((c) => {
            const active = activeCat === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLens({ cat: c.id === 'all' ? null : c.id })}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  active
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule/80 bg-paper-raised text-ink hover:bg-paper-sunk'
                }`}
              >
                {tt(c.key, lang)}
              </button>
            );
          })}
          <span className="rounded-full bg-paper-sunk/80 px-2.5 py-1 font-mono-data text-[11px] text-pencil ml-1">
            {formatNumber(rows.length, lang)}
          </span>
        </div>

        {/* Soft pill Graph | List toggle */}
        <div className="inline-flex rounded-full border border-rule/80 bg-paper-raised p-1 text-xs shadow-xs shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 cursor-pointer transition-colors ${
              viewMode === 'graph'
                ? 'bg-ink text-paper font-medium'
                : 'text-pencil hover:text-ink'
            }`}
          >
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span>{tt('graph.viewGraph', lang)}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 cursor-pointer transition-colors ${
              viewMode === 'list'
                ? 'bg-ink text-paper font-medium'
                : 'text-pencil hover:text-ink'
            }`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span>{tt('graph.viewList', lang)}</span>
          </button>
        </div>
      </div>

      {viewMode === 'graph' ? (
        <Suspense
          fallback={
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-8 h-[540px] rounded-3xl bg-paper-sunk/60 animate-pulse" />
              <div className="lg:col-span-4 h-[540px] rounded-3xl bg-paper-sunk/60 animate-pulse" />
            </div>
          }
        >
          <LazyEntityGraph
            centerId={graphCenterId}
            centerName={graphCenterName}
            centerType={entityType}
            relations={rows}
            lang={lang}
            loading={q.isLoading}
            fetching={q.isFetching}
            history={history}
            onNavigateEntity={onNavigateEntity}
            onGoBack={onGoBack}
            onJumpHistory={onJumpHistory}
          />
        </Suspense>
      ) : q.isLoading && rows.length === 0 ? (
        <div className="space-y-2.5 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-paper-sunk/70" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-pencil py-4">{tt('empty.panel', lang)}</p>
      ) : (
        <ul className="space-y-2.5 m-0 p-0 list-none">
          {rows.map((rel, idx) => {
            const rowKey = `${rel.direction}-${rel.relationType}-${rel.otherEntity.id}-${idx}`;
            const isOpen = expandedKey === rowKey;
            const otherName =
              lang === 'bn'
                ? rel.otherEntity.canonicalBn || rel.otherEntity.canonicalEn || rel.otherEntity.id
                : rel.otherEntity.canonicalEn || rel.otherEntity.canonicalBn || rel.otherEntity.id;
            const predicate = rel.predicateLabels[0] ?? rel.relationType.replace(/_/g, ' ');
            const barPct = Math.max(4, Math.round((rel.weight / maxWeight) * 100));
            const highlighted = hoveredEntityId === rel.otherEntity.id;

            return (
              <li
                key={rowKey}
                className={`rounded-2xl border border-rule/75 bg-paper-raised p-4 transition-colors ${
                  highlighted ? 'bg-paper-sunk/70' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-sm leading-relaxed text-ink">
                      {rel.direction === 'out' ? (
                        <>
                          <span className="font-medium">{entityName}</span>{' '}
                          <span className="text-pencil italic">— {predicate} →</span>{' '}
                          <button
                            type="button"
                            onClick={() => onNavigateEntity(rel.otherEntity.id, otherName)}
                            onMouseEnter={() => setHoveredEntityId(rel.otherEntity.id)}
                            onMouseLeave={() => setHoveredEntityId(null)}
                            className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink cursor-pointer"
                          >
                            {otherName}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onNavigateEntity(rel.otherEntity.id, otherName)}
                            onMouseEnter={() => setHoveredEntityId(rel.otherEntity.id)}
                            onMouseLeave={() => setHoveredEntityId(null)}
                            className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink cursor-pointer"
                          >
                            {otherName}
                          </button>{' '}
                          <span className="text-pencil italic">— {predicate} →</span>{' '}
                          <span className="font-medium">{entityName}</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="h-[4px] flex-1 max-w-[180px] bg-rule/70 rounded-full overflow-hidden">
                        <div className="h-full bg-ink/70 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="font-mono-data text-[11px] text-pencil">
                        {tt('evt.articlesCount', lang, { n: rel.weight })}
                      </span>
                      {rel.latestAt ? (
                        <span className="text-[11px] text-pencil hidden sm:inline">
                          · {formatDhakaDate(rel.latestAt, lang, 'short')}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {rel.evidence.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedKey(isOpen ? null : rowKey)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 rounded-full border border-rule/80 bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paper-sunk cursor-pointer shrink-0"
                    >
                      <span>{tt('ent.rel.evidence', lang, { n: rel.evidence.length })}</span>
                      {isOpen ? (
                        <ChevronUp className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                      )}
                    </button>
                  ) : null}
                </div>

                {isOpen ? (
                  <div className="mt-3 space-y-2.5 pl-3 border-s border-rule">
                    {rel.evidence.map((ev, evIdx) => (
                      <div
                        key={`${ev.articleId}-${evIdx}`}
                        className="rounded-xl border border-rule/70 bg-paper/70 p-3.5 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-pencil">
                          <div className="flex items-center gap-2">
                            <OutletName id={ev.outlet} lang={lang} />
                            {ev.publishedAt ? (
                              <>
                                <span>·</span>
                                <span>{formatDhakaDate(ev.publishedAt, lang, 'medium')}</span>
                              </>
                            ) : null}
                          </div>
                          <a
                            href={ev.canonicalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-ink underline underline-offset-2"
                          >
                            <span>{tt('src.open', lang)}</span>
                            <ExternalLink className="h-3 w-3" strokeWidth={1.6} />
                          </a>
                        </div>
                        <Verbatim
                          text={`“…${(ev.snippet || ev.title).trim().replace(/^[“"‘']+|[”"’']+$/g, '').replace(/^\.{3}|^…|\.{3}$|…$/g, '').trim()}…”`}
                          outlet={ev.outlet}
                          as="p"
                          className="!text-pencil text-xs leading-relaxed m-0"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
