import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowUpLeft } from 'lucide-react';
import { popularChecksQuery } from '../../api/queries';
import { tt, type Lang } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { Verbatim } from '../../ui/Verbatim';
import { OutletName } from '../../ui/OutletName';

export function PopularRail({ lang, limit = 6 }: { lang: Lang; limit?: number }) {
  const q = useQuery(popularChecksQuery(limit));
  const checks = q.data?.checks ?? [];

  if (q.isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-xl bg-paper-sunk" />
        ))}
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-rule-strong bg-paper-raised p-4 space-y-2">
          <div className="font-display text-sm font-medium text-ink">
            {tt('empty.popular.title', lang)}
          </div>
          <p className="text-xs text-pencil m-0 leading-relaxed">
            {tt('empty.popular.body', lang)}
          </p>
          <a
            href="#capture-zone"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink underline underline-offset-2 pt-1"
          >
            <ArrowUpLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            {tt('cap.add', lang)}
          </a>
        </div>
        {/* Three dashed ghost clippings */}
        <div className="space-y-2 opacity-50" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded-xl border border-dashed border-rule-strong bg-paper"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-rule border-t border-rule m-0 p-0 list-none">
      {checks.map((chk, idx) => (
        <li key={chk.id} className="py-3">
          <Link
            to={`/checks/${encodeURIComponent(chk.id)}`}
            className="group flex items-start gap-3 text-left"
          >
            <span className="font-mono-data text-xs text-pencil pt-0.5 w-4 shrink-0">
              {formatNumber(idx + 1, lang)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm leading-snug text-ink group-hover:underline line-clamp-2">
                <Verbatim text={chk.headline || chk.quotedSpeaker || chk.id} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-pencil">
                {chk.topOutlet ? <OutletName id={chk.topOutlet} lang={lang} /> : null}
                <span>
                  {tt('res.hits', lang, { n: chk.hitCount })}
                </span>
                {chk.status === 'no_coverage' ? (
                  <span>· {tt('res.status.nocoverage', lang)}</span>
                ) : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
