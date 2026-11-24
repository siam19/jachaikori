import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ExternalLink, Filter, Search } from 'lucide-react';
import { entitySuggestQuery, searchArticlesQuery } from '../../api/queries';
import { outletLabel, tt } from '../../i18n/tt';
import { formatDhakaDate } from '../../lib/dates';
import { useLang } from '../../lib/useLang';
import { useTrail } from '../explore/trail/TrailContext';
import { usePeek } from '../explore/peek/PeekContext';
import { ACCREDITED_OUTLETS } from '../events/Lanes';
import { OutletName } from '../../ui/OutletName';
import { Verbatim } from '../../ui/Verbatim';
import { Sheet } from '../../ui/Sheet';
import { StateCard } from '../../ui/StateCard';

export function SearchPage() {
  const [lang] = useLang();
  const [sp, setSp] = useSearchParams();
  const { pushStop } = useTrail();
  const { openEventPeek } = usePeek();

  const q = sp.get('q') ?? '';
  const outlet = sp.get('outlet') ?? '';
  const fromDate = sp.get('from') ?? '';
  const toDate = sp.get('to') ?? '';

  const [input, setInput] = useState(q);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  useEffect(() => {
    setInput(q);
  }, [q]);

  useEffect(() => {
    if (!q.trim()) return;
    pushStop({
      kind: 'search',
      id: q.trim(),
      label: { en: `“${q.trim()}”`, bn: `“${q.trim()}”` },
    });
  }, [q, pushStop]);

  const searchQ = useQuery(
    searchArticlesQuery({
      q: q.trim(),
      outlet: outlet || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      limit: 25,
    })
  );

  const suggestQ = useQuery({
    ...entitySuggestQuery(q.trim()),
    enabled: q.trim().length >= 2,
  });

  const updateParam = (patch: Record<string, string | null>) => {
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (!v) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true }
    );
  };

  const hits = searchQ.data?.hits ?? [];
  const expandedTerms = searchQ.data?.expandedTerms ?? [];
  const entityHits = suggestQ.data?.entities ?? [];

  const filterForm = (
    <div className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <label htmlFor="search-outlet-select" className="block font-medium text-ink">
          {tt('outlets.indexed', lang)}
        </label>
        <select
          id="search-outlet-select"
          value={outlet}
          onChange={(e) => updateParam({ outlet: e.target.value || null })}
          className="w-full rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-2 text-xs text-ink min-h-[40px]"
        >
          <option value="">{tt('search.outlet.all', lang)}</option>
          {ACCREDITED_OUTLETS.map((o) => (
            <option key={o} value={o}>
              {outletLabel(o, lang)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="search-from-date" className="block font-medium text-ink">
          {tt('search.from', lang)}
        </label>
        <input
          id="search-from-date"
          type="date"
          value={fromDate}
          onChange={(e) => updateParam({ from: e.target.value || null })}
          className="w-full rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-2 text-xs text-ink min-h-[40px]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="search-to-date" className="block font-medium text-ink">
          {tt('search.to', lang)}
        </label>
        <input
          id="search-to-date"
          type="date"
          value={toDate}
          onChange={(e) => updateParam({ to: e.target.value || null })}
          className="w-full rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-2 text-xs text-ink min-h-[40px]"
        />
      </div>

      {outlet || fromDate || toDate ? (
        <button
          type="button"
          onClick={() => updateParam({ outlet: null, from: null, to: null })}
          className="w-full rounded-xl border border-rule-strong py-2 text-xs text-ink hover:bg-paper-sunk cursor-pointer"
        >
          {tt('lens.clear', lang)}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParam({ q: input.trim() || null });
        }}
        className="flex flex-wrap items-center gap-2 border-b border-rule pb-4"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pencil"
            strokeWidth={1.5}
          />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tt('search.placeholder', lang)}
            className="w-full rounded-xl border border-rule-strong bg-paper-raised pl-9 pr-3 py-2.5 text-base text-ink placeholder:text-pencil min-h-[44px]"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:opacity-90 cursor-pointer min-h-[44px]"
        >
          {tt('nav.search', lang)}
        </button>
        <button
          type="button"
          onClick={() => setMobileFilterOpen(true)}
          className="lg:hidden inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper-raised px-3.5 py-2.5 text-sm text-ink min-h-[44px] cursor-pointer"
        >
          <Filter className="h-4 w-4" strokeWidth={1.5} />
          <span>{tt('search.filters', lang)}</span>
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Desktop filter sidebar */}
        <aside className="hidden lg:block lg:col-span-3 space-y-3 border-e border-rule pr-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
            {tt('search.filters', lang)}
          </h2>
          {filterForm}
        </aside>

        {/* Results column */}
        <div className="lg:col-span-9 space-y-5">
          {/* Expanded terms pills */}
          {expandedTerms.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-pencil">
              <span>{tt('search.alsoSearched', lang)}:</span>
              {expandedTerms.map((term) => (
                <span
                  key={term}
                  className="rounded-xl border border-rule bg-paper-raised px-2 py-0.5 text-ink"
                >
                  {term}
                </span>
              ))}
            </div>
          ) : null}

          {/* Matching entity chips */}
          {entityHits.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-pencil">
                {tt('search.group.entities', lang)}
              </div>
              <div className="flex flex-wrap gap-2">
                {entityHits.slice(0, 6).map((ent) => {
                  const name =
                    lang === 'bn'
                      ? ent.canonicalBn || ent.canonicalEn || ent.id
                      : ent.canonicalEn || ent.canonicalBn || ent.id;
                  return (
                    <Link
                      key={ent.id}
                      to={`/entities/${encodeURIComponent(ent.id)}`}
                      className="rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper-sunk"
                    >
                      {name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!q.trim() ? (
            <p className="text-sm text-pencil py-6">{tt('search.placeholder', lang)}</p>
          ) : searchQ.isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-paper-sunk" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <StateCard
              dashed
              title={tt('search.noResults', lang, { q })}
              action={
                outlet || fromDate || toDate ? (
                  <button
                    type="button"
                    onClick={() => updateParam({ outlet: null, from: null, to: null })}
                    className="rounded-xl bg-ink text-paper px-3.5 py-2 text-xs font-medium cursor-pointer"
                  >
                    {tt('lens.clear', lang)}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ol className="divide-y divide-rule border-t border-rule m-0 p-0 list-none">
              {hits.map((hit) => (
                <li key={hit.articleId} className="py-4 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
                    <div className="flex items-center gap-2">
                      <OutletName id={hit.outlet} lang={lang} />
                      {hit.publishedAt ? (
                        <>
                          <span>·</span>
                          <span>{formatDhakaDate(hit.publishedAt, lang, 'medium')}</span>
                        </>
                      ) : null}
                    </div>
                    {hit.clusterId ? (
                      <button
                        type="button"
                        onClick={() => openEventPeek(hit.clusterId!, hit.title)}
                        className="text-xs text-ink underline underline-offset-2 hover:text-pencil cursor-pointer"
                      >
                        {tt('src.compare', lang)}
                        {hit.clusterOutletCount && hit.clusterOutletCount > 1
                          ? ` · ${tt('src.coverage', lang, { n: hit.clusterOutletCount })}`
                          : ''}
                      </button>
                    ) : null}
                  </div>
                  <a
                    href={hit.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-start gap-1.5 text-ink hover:underline"
                  >
                    <Verbatim
                      text={hit.title}
                      outlet={hit.outlet}
                      as="h2"
                      className="text-lg font-medium leading-snug m-0"
                    />
                    <ExternalLink
                      className="h-3.5 w-3.5 mt-1.5 shrink-0 text-pencil group-hover:text-ink"
                      strokeWidth={1.5}
                    />
                  </a>
                  {hit.snippet ? (
                    <Verbatim
                      text={hit.snippet}
                      outlet={hit.outlet}
                      as="p"
                      className="text-sm leading-relaxed text-ink/85 m-0 line-clamp-3"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Mobile filters sheet */}
      <Sheet
        open={mobileFilterOpen}
        onClose={() => setMobileFilterOpen(false)}
        title={tt('search.filters', lang)}
        lang={lang}
      >
        {filterForm}
      </Sheet>
    </div>
  );
}
