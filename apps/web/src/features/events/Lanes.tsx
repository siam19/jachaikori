import type { EventComparisonResponse, OutletId } from '@jachaikori/schema';
import { ExternalLink } from 'lucide-react';
import { tt, type Lang } from '../../i18n/tt';
import { formatLag } from '../../lib/dates';
import { OutletName } from '../../ui/OutletName';

export const ACCREDITED_OUTLETS: readonly OutletId[] = [
  'prothom-alo',
  'daily-star',
  'business-standard',
  'bdnews24',
  'ittefaq',
  'jugantor',
  'kaler-kantho',
  'bangladesh-protidin',
] as const;

interface LanesProps {
  cmp: EventComparisonResponse;
  lang: Lang;
  selectedOutlet: OutletId | null;
  onSelectOutlet: (outlet: OutletId | null) => void;
}

/**
 * 8-outlet linear coverage timeline driven by `cmp.outletCoverage`.
 * Strictly guards `leadArticle` and `lagMinutesFromFirst !== null`:
 * - A `null` lag renders a "Time unavailable" pill instead of falsely plotting at +0m.
 * - Uncovered lanes read "No matching article in our index" (never "did not cover").
 */
export function Lanes({ cmp, lang, selectedOutlet, onSelectOutlet }: LanesProps) {
  const maxLag = Math.max(
    1,
    ...cmp.outletCoverage.map((c) => c.lagMinutesFromFirst ?? 0),
    ...cmp.timeline.map((t) => t.lagMinutesFromFirst ?? 0)
  );

  const pct = (m: number) => `${Math.min(92, (m / maxLag) * 86)}%`;

  return (
    <section className="clipping-surface p-4 sm:p-5 space-y-3" aria-label={tt('lanes.title', lang)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
          {tt('lanes.title', lang)}
        </h2>
        <div className="flex items-center gap-3 text-[11px] font-mono-data text-pencil">
          <span>{formatLag(0, lang)}</span>
          <span aria-hidden="true">···</span>
          <span>{formatLag(maxLag, lang)}</span>
        </div>
      </div>

      <ol className="space-y-2 m-0 p-0 list-none">
        {ACCREDITED_OUTLETS.map((outletId, idx) => {
          const cov = cmp.outletCoverage.find((x) => x.outlet === outletId);
          const extraTicks = cmp.timeline
            .filter((t) => t.outlet === outletId && t.lagMinutesFromFirst !== null)
            .slice(1);
          const isSelected = selectedOutlet === outletId;

          if (!cov || !cov.covered || !cov.leadArticle) {
            return (
              <li
                key={outletId}
                className="lane-stagger grid grid-cols-12 items-center gap-2 py-1.5 opacity-65"
                style={{ animationDelay: `${idx * 35}ms` }}
              >
                <div className="col-span-4 sm:col-span-3 truncate">
                  <OutletName id={outletId} lang={lang} />
                </div>
                <div className="col-span-8 sm:col-span-9 flex items-center gap-2">
                  <div className="flex-1 border-b border-dashed border-rule-strong" />
                  <span className="text-[11px] text-pencil shrink-0">
                    {tt('lanes.none', lang)}
                  </span>
                </div>
              </li>
            );
          }

          const isFirst = cov.lagMinutesFromFirst === 0;

          return (
            <li
              key={outletId}
              className={`lane-stagger grid grid-cols-12 items-center gap-2 py-1.5 rounded-xl px-1.5 -mx-1.5 transition-colors ${
                isSelected ? 'bg-paper-sunk' : 'hover:bg-paper-sunk/50'
              }`}
              style={{ animationDelay: `${idx * 35}ms` }}
            >
              <button
                type="button"
                onClick={() => onSelectOutlet(isSelected ? null : outletId)}
                className="col-span-4 sm:col-span-3 text-left truncate cursor-pointer min-h-[32px] flex items-center gap-1.5"
              >
                <OutletName
                  id={outletId}
                  lang={lang}
                  className={isSelected ? 'underline underline-offset-2' : ''}
                />
              </button>

              <div className="col-span-8 sm:col-span-9 relative h-8 flex items-center">
                <div className="h-[1px] w-full bg-rule" />

                {cov.lagMinutesFromFirst === null ? (
                  <a
                    href={cov.leadArticle.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={cov.leadArticle.title}
                    className="absolute left-0 inline-flex items-center gap-1 rounded-xl border border-rule-strong bg-paper-raised px-2 py-0.5 text-[11px] text-pencil hover:text-ink"
                  >
                    <span>{tt('lanes.noTime', lang)}</span>
                    <ExternalLink className="h-2.5 w-2.5" strokeWidth={1.5} />
                  </a>
                ) : (
                  <a
                    href={cov.leadArticle.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={cov.leadArticle.title}
                    style={{ insetInlineStart: pct(cov.lagMinutesFromFirst) }}
                    className={`absolute inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-[11px] font-mono-data transition-transform hover:scale-105 ${
                      isFirst
                        ? 'bg-ink text-paper font-medium'
                        : 'border border-rule-strong bg-paper-raised text-ink hover:border-ink'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${isFirst ? 'bg-paper' : 'bg-ink'}`}
                      aria-hidden="true"
                    />
                    <span>
                      {isFirst
                        ? tt('lanes.first', lang)
                        : formatLag(cov.lagMinutesFromFirst, lang)}
                    </span>
                  </a>
                )}

                {extraTicks.map((t, i) => (
                  <span
                    key={`${t.articleId}-${i}`}
                    title={t.title}
                    style={{ insetInlineStart: pct(t.lagMinutesFromFirst!) }}
                    className="absolute h-2.5 w-[2px] bg-pencil/70 pointer-events-none"
                  />
                ))}

                {cov.articleCount > 1 ? (
                  <span className="absolute right-0 text-[10px] font-mono-data text-pencil bg-paper-raised/90 px-1">
                    {tt('lanes.more', lang, { n: cov.articleCount - 1 })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
