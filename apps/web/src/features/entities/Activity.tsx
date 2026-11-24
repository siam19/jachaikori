import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, X } from 'lucide-react';
import { entityActivityQuery, entityArticlesQuery } from '../../api/queries';
import { tt, type Lang } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate } from '../../lib/dates';
import type { Lens } from '../../lib/useLens';
import { OutletName } from '../../ui/OutletName';
import { Verbatim } from '../../ui/Verbatim';

interface ActivityPanelProps {
  entityId: string;
  lens: Lens;
  setLens: (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => void;
  lang: Lang;
}

/**
 * Full-series SVG coverage bar chart.
 * Intentionally ignores the date lens when fetching so bars outside the selected
 * window stay visible and the brush can always be widened again.
 */
export function ActivityPanel({ entityId, lens, setLens, lang }: ActivityPanelProps) {
  const q = useQuery(entityActivityQuery(entityId));
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx] = useState<number | null>(null);
  const [peekDay, setPeekDay] = useState<string | null>(null);

  const series = useMemo(() => {
    const raw = q.data?.series ?? [];
    return raw.slice(-90);
  }, [q.data]);

  const maxArticles = Math.max(1, ...series.map((p) => p.articleCount));

  const dayPeekQ = useQuery({
    ...entityArticlesQuery(entityId, { from: peekDay ?? undefined, to: peekDay ?? undefined, hubs: false }, 0, 5),
    enabled: Boolean(peekDay),
  });

  const commitBrush = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo === hi) {
      const day = series[lo]?.date;
      if (day) setPeekDay((cur) => (cur === day ? null : day));
      return;
    }
    const from = series[lo]?.date;
    const to = series[hi]?.date;
    if (from && to) {
      setLens({ from, to });
      setPeekDay(null);
    }
  };

  return (
    <section id="sec-activity" className="space-y-3 scroll-mt-28">
      <div className="flex items-center justify-between gap-2 border-b border-rule pb-2">
        <h2 className="font-display text-base font-medium text-ink m-0">
          {tt('ent.sec.activity', lang)}
        </h2>
        {lens.from || lens.to ? (
          <button
            type="button"
            onClick={() => setLens({ from: null, to: null })}
            className="text-[11px] text-pencil underline hover:text-ink cursor-pointer"
          >
            {tt('lens.clear', lang)}
          </button>
        ) : null}
      </div>

      {q.isLoading ? (
        <div className="h-28 rounded-xl bg-paper-sunk animate-pulse" />
      ) : series.length === 0 ? (
        <p className="text-xs text-pencil">{tt('empty.panel', lang)}</p>
      ) : (
        <div className="space-y-2">
          <div
            className="rounded-xl border border-rule bg-paper-raised p-3 select-none"
            onPointerLeave={() => {
              if (dragStartIdx !== null && dragEndIdx !== null) {
                commitBrush(dragStartIdx, dragEndIdx);
              }
              setDragStartIdx(null);
              setDragEndIdx(null);
            }}
          >
            <svg
              viewBox={`0 0 ${Math.max(series.length * 6, 120)} 76`}
              className="w-full h-24 overflow-visible"
              role="img"
              aria-label={tt('ent.sec.activity', lang)}
            >
              {series.map((pt, idx) => {
                const h = Math.max(4, Math.round((pt.articleCount / maxArticles) * 64));
                const x = idx * 6;
                const inLens =
                  (!lens.from || pt.date >= lens.from) && (!lens.to || pt.date <= lens.to);
                const inDrag =
                  dragStartIdx !== null &&
                  dragEndIdx !== null &&
                  idx >= Math.min(dragStartIdx, dragEndIdx) &&
                  idx <= Math.max(dragStartIdx, dragEndIdx);
                const isPeek = peekDay === pt.date;

                return (
                  <rect
                    key={pt.date}
                    x={x + 0.75}
                    y={70 - h}
                    width={4.5}
                    height={h}
                    rx={1}
                    className="cursor-pointer transition-opacity"
                    fill={
                      isPeek
                        ? 'var(--color-rust)'
                        : inDrag
                        ? 'var(--color-ochre)'
                        : inLens
                        ? 'var(--color-ink)'
                        : 'var(--color-rule-strong)'
                    }
                    opacity={inLens || inDrag || isPeek ? 0.9 : 0.35}
                    onPointerDown={() => {
                      setDragStartIdx(idx);
                      setDragEndIdx(idx);
                    }}
                    onPointerEnter={() => {
                      if (dragStartIdx !== null) setDragEndIdx(idx);
                    }}
                    onPointerUp={() => {
                      if (dragStartIdx !== null) {
                        commitBrush(dragStartIdx, idx);
                      }
                      setDragStartIdx(null);
                      setDragEndIdx(null);
                    }}
                  >
                    <title>
                      {`${pt.date}: ${formatNumber(pt.articleCount, lang)} ${tt('ent.stats.articles', lang)}`}
                    </title>
                  </rect>
                );
              })}
            </svg>
            <div className="flex justify-between text-[10px] font-mono-data text-pencil mt-1">
              <span>{series[0]?.date}</span>
              <span>{series.at(-1)?.date}</span>
            </div>
          </div>

          <p className="text-[11px] text-pencil m-0">{tt('lens.brushHint', lang)}</p>

          {/* Day-bar headline peek */}
          {peekDay ? (
            <div className="rounded-xl border border-rule-strong bg-paper-raised p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono-data font-medium text-ink">
                  {formatDhakaDate(peekDay, lang, 'medium')}
                </span>
                <button
                  type="button"
                  onClick={() => setPeekDay(null)}
                  aria-label={tt('nav.close', lang)}
                  className="text-pencil hover:text-ink cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              {dayPeekQ.isLoading ? (
                <div className="h-12 bg-paper-sunk animate-pulse rounded" />
              ) : (dayPeekQ.data?.articles ?? []).length === 0 ? (
                <p className="text-xs text-pencil m-0">{tt('empty.panel', lang)}</p>
              ) : (
                <ul className="space-y-1.5 m-0 p-0 list-none">
                  {(dayPeekQ.data?.articles ?? []).map((art) => (
                    <li key={art.id} className="text-xs space-y-0.5">
                      <OutletName id={art.outlet} lang={lang} />
                      <a
                        href={art.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-1 text-ink hover:underline"
                      >
                        <Verbatim text={art.title} outlet={art.outlet} className="text-xs" />
                        <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-pencil" strokeWidth={1.5} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
