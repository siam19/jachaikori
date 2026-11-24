import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { entityArticlesQuery } from '../../api/queries';
import { tt, type Lang } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate } from '../../lib/dates';
import type { Lens } from '../../lib/useLens';
import { usePeek } from '../explore/peek/PeekContext';
import { OutletName } from '../../ui/OutletName';
import { Verbatim } from '../../ui/Verbatim';

interface ArticlesPanelProps {
  entityId: string;
  entityName: string;
  lens: Lens;
  setLens: (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => void;
  lang: Lang;
}

export function ArticlesPanel({
  entityId,
  entityName,
  lens,
  setLens,
  lang,
}: ArticlesPanelProps) {
  const { openEventPeek } = usePeek();
  const [limit, setLimit] = useState(15);

  const q = useQuery(entityArticlesQuery(entityId, lens, 0, limit));
  const articles = q.data?.articles ?? [];
  const total = q.data?.total ?? articles.length;

  return (
    <section id="sec-articles" className="space-y-4 scroll-mt-28">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
        <h2 className="font-display text-xl font-medium text-ink m-0">
          {tt('ent.sec.articles', lang, { name: entityName })}
        </h2>
        <span className="font-mono-data text-xs text-pencil">
          {formatNumber(total, lang)}
        </span>
      </div>

      {/* Sort & Role controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex rounded-xl border border-rule-strong bg-paper-raised overflow-hidden">
          <button
            type="button"
            onClick={() => setLens({ sort: 'recent' })}
            className={`px-2.5 py-1.5 cursor-pointer ${
              (lens.sort ?? 'recent') === 'recent'
                ? 'bg-ink text-paper font-medium'
                : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('ent.art.sort.recent', lang)}
          </button>
          <button
            type="button"
            onClick={() => setLens({ sort: 'salience' })}
            className={`px-2.5 py-1.5 border-s border-rule-strong cursor-pointer ${
              lens.sort === 'salience'
                ? 'bg-ink text-paper font-medium'
                : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('ent.art.sort.salience', lang)}
          </button>
        </div>

        <select
          aria-label={tt('ent.art.role.all', lang)}
          value={lens.role ?? ''}
          onChange={(e) => setLens({ role: e.target.value || null })}
          className="rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-1.5 text-xs text-ink min-h-[34px]"
        >
          <option value="">{tt('ent.art.role.all', lang)}</option>
          <option value="quoted_speaker">{tt('ent.art.role.quoted_speaker', lang)}</option>
          <option value="actor">{tt('ent.art.role.actor', lang)}</option>
          <option value="subject">{tt('ent.art.role.subject', lang)}</option>
        </select>
      </div>

      {q.isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-paper-sunk" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-pencil py-4">{tt('empty.panel', lang)}</p>
      ) : (
        <div className="space-y-4">
          <ol className="divide-y divide-rule border-y border-rule m-0 p-0 list-none">
            {articles.map((art) => {
              const snippet = art.snippet || art.lead;
              return (
                <li key={art.id || art.articleId} className="py-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
                    <div className="flex items-center gap-2">
                      <OutletName id={art.outlet} lang={lang} />
                      {art.publishedAt ? (
                        <>
                          <span>·</span>
                          <span>{formatDhakaDate(art.publishedAt, lang, 'medium')}</span>
                        </>
                      ) : null}
                    </div>
                    {art.clusterId ? (
                      <button
                        type="button"
                        onClick={() => openEventPeek(art.clusterId!, art.title)}
                        className="text-xs text-ink underline underline-offset-2 hover:text-pencil cursor-pointer"
                      >
                        {tt('src.compare', lang)}
                        {art.clusterOutletCount && art.clusterOutletCount > 1
                          ? ` · ${tt('evt.outletsCount', lang, { n: art.clusterOutletCount })}`
                          : ''}
                      </button>
                    ) : null}
                  </div>
                  <a
                    href={art.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-start gap-1.5 text-ink hover:underline"
                  >
                    <Verbatim
                      text={art.title}
                      outlet={art.outlet}
                      as="h3"
                      className="text-base font-medium leading-snug m-0"
                    />
                    <ExternalLink
                      className="h-3.5 w-3.5 mt-1 shrink-0 text-pencil group-hover:text-ink"
                      strokeWidth={1.5}
                    />
                  </a>
                  {snippet ? (
                    <Verbatim
                      text={snippet}
                      outlet={art.outlet}
                      as="p"
                      className="text-sm leading-relaxed text-ink/85 m-0 line-clamp-2"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {articles.length < total ? (
            <button
              type="button"
              onClick={() => setLimit((n) => n + 20)}
              className="w-full rounded-xl border border-rule-strong bg-paper-raised py-2.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer min-h-[44px]"
            >
              {tt('ent.art.loadMore', lang)}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
