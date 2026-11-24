import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { entityProfileQuery, entityRelationsQuery } from '../../../api/queries';
import { tt, type Lang, type StringKey } from '../../../i18n/tt';
import { formatNumber } from '../../../i18n/format';
import { usePeek } from './PeekContext';

export function EntityPeek({
  entityId,
  lang,
  onClose,
}: {
  entityId: string;
  lang: Lang;
  onClose: () => void;
}) {
  const { openEntityPeek } = usePeek();
  const profileQ = useQuery(entityProfileQuery(entityId));
  const relsQ = useQuery(entityRelationsQuery(entityId, { hubs: false }));

  if (profileQ.isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 w-2/3 rounded bg-paper-sunk" />
        <div className="h-4 w-1/2 rounded bg-paper-sunk" />
        <div className="h-20 w-full rounded bg-paper-sunk" />
      </div>
    );
  }

  if (profileQ.isError || !profileQ.data) {
    return <p className="text-sm text-pencil">{tt('empty.panel', lang)}</p>;
  }

  const p = profileQ.data;
  const primaryName = lang === 'bn' ? p.canonicalBn || p.canonicalEn : p.canonicalEn || p.canonicalBn;
  const secondaryName = lang === 'bn' ? p.canonicalEn : p.canonicalBn;
  const tagline = lang === 'bn' ? p.shortTaglineBn || p.shortTaglineEn : p.shortTaglineEn || p.shortTaglineBn;
  const desc = lang === 'bn' ? p.descriptionBn || p.descriptionEn : p.descriptionEn || p.descriptionBn;
  const typeKey = `ent.type.${p.entityType}` as StringKey;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
          <span className="uppercase tracking-wider font-medium">{tt(typeKey, lang)}</span>
          {p.isHub ? (
            <span className="rounded-xl border border-rule-strong px-1.5 py-0.5 text-[11px]">
              {tt('ent.hub.badge', lang)}
            </span>
          ) : null}
        </div>
        <h2 className="font-display text-xl font-medium text-ink m-0">{primaryName}</h2>
        {secondaryName && secondaryName !== primaryName ? (
          <div className="text-sm text-pencil">{secondaryName}</div>
        ) : null}
        {tagline ? <p className="text-sm text-pencil pt-1 m-0">{tagline}</p> : null}
      </div>

      {desc ? (
        <p className="text-sm text-ink leading-relaxed border-s-2 border-rule-strong pl-3 m-0">
          {desc}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2 border-y border-rule py-3 text-center">
        <div>
          <div className="font-mono-data text-base font-medium text-ink">
            {formatNumber(p.stats.articleCount, lang)}
          </div>
          <div className="text-[11px] text-pencil">{tt('ent.stats.articles', lang)}</div>
        </div>
        <div>
          <div className="font-mono-data text-base font-medium text-ink">
            {formatNumber(p.stats.eventCount, lang)}
          </div>
          <div className="text-[11px] text-pencil">{tt('ent.stats.events', lang)}</div>
        </div>
        <div>
          <div className="font-mono-data text-base font-medium text-ink">
            {formatNumber(p.stats.relationCount, lang)}
          </div>
          <div className="text-[11px] text-pencil">{tt('ent.stats.relations', lang)}</div>
        </div>
      </div>

      {relsQ.data && relsQ.data.relations.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-pencil">
            {tt('ent.sec.relations', lang)}
          </h3>
          <ul className="divide-y divide-rule border-t border-rule">
            {relsQ.data.relations.slice(0, 6).map((r, i) => {
              const otherName =
                lang === 'bn'
                  ? r.otherEntity.canonicalBn || r.otherEntity.canonicalEn || r.otherEntity.id
                  : r.otherEntity.canonicalEn || r.otherEntity.canonicalBn || r.otherEntity.id;
              const pred = r.predicateLabels[0] ?? r.relationType.replace(/_/g, ' ');
              return (
                <li key={`${r.otherEntity.id}-${r.relationType}-${i}`} className="py-2 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-pencil">
                      {r.direction === 'out' ? '→ ' : '← '}
                      {pred}
                    </span>
                    <span className="font-mono-data text-[11px] text-pencil shrink-0">
                      {formatNumber(r.weight, lang)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEntityPeek(r.otherEntity.id, otherName)}
                    className="text-sm font-medium text-ink hover:underline cursor-pointer text-left mt-0.5"
                  >
                    {otherName}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="pt-2">
        <Link
          to={`/entities/${encodeURIComponent(p.id)}`}
          onClick={onClose}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink text-paper px-4 py-2.5 text-sm font-medium hover:opacity-90"
        >
          <span>{tt('peek.openFull', lang)}</span>
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </div>
    </div>
  );
}
