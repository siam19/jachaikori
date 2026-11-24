import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { eventComparisonQuery } from '../../../api/queries';
import { tt, type Lang } from '../../../i18n/tt';
import { formatDhakaDate } from '../../../lib/dates';
import { Verbatim } from '../../../ui/Verbatim';
import { OutletName } from '../../../ui/OutletName';

export function EventPeek({
  eventId,
  lang,
  onClose,
}: {
  eventId: string;
  lang: Lang;
  onClose: () => void;
}) {
  const cmpQ = useQuery(eventComparisonQuery(eventId));

  if (cmpQ.isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 w-3/4 rounded bg-paper-sunk" />
        <div className="h-4 w-1/2 rounded bg-paper-sunk" />
        <div className="h-24 w-full rounded bg-paper-sunk" />
      </div>
    );
  }

  if (cmpQ.isError || !cmpQ.data) {
    return <p className="text-sm text-pencil">{tt('empty.panel', lang)}</p>;
  }

  const cmp = cmpQ.data;
  const covered = cmp.outletCoverage.filter((c) => c.covered && c.leadArticle);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
          <span>{tt('evt.outletsCount', lang, { n: cmp.event.outletCount })}</span>
          <span>·</span>
          <span>{tt('evt.articlesCount', lang, { n: cmp.event.articleCount })}</span>
          {cmp.event.firstSeen ? (
            <>
              <span>·</span>
              <span>{formatDhakaDate(cmp.event.firstSeen, lang, 'medium')}</span>
            </>
          ) : null}
        </div>
        <h2 className="font-read text-lg font-medium text-ink m-0">
          <Verbatim text={cmp.event.label} />
        </h2>
      </div>

      {cmp.crossOutletDifferences.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-pencil">
            {tt('cmp.differ', lang)}
          </h3>
          <ul className="space-y-2">
            {cmp.crossOutletDifferences.slice(0, 3).map((d, i) => (
              <li
                key={i}
                className="rounded-xl border border-rule bg-paper-raised p-2.5 text-xs text-ink leading-relaxed"
              >
                {lang === 'bn' ? d.summaryBn : d.summaryEn}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-pencil">
          {tt('outlets.indexed', lang)}
        </h3>
        <ul className="divide-y divide-rule border-t border-rule">
          {covered.map((c) => (
            <li key={c.outlet} className="py-2 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <OutletName id={c.outlet} lang={lang} />
                {c.firstPublishedAt ? (
                  <span className="text-[11px] text-pencil">
                    {formatDhakaDate(c.firstPublishedAt, lang, 'short')}
                  </span>
                ) : null}
              </div>
              {c.leadArticle ? (
                <a
                  href={c.leadArticle.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-ink hover:underline"
                >
                  <Verbatim text={c.leadArticle.title} outlet={c.outlet} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-2">
        <Link
          to={`/events/${encodeURIComponent(cmp.event.id)}`}
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
