import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { divergentEventsQuery, eventsListQuery } from '../../api/queries';
import { tt } from '../../i18n/tt';
import { formatDhakaDate } from '../../lib/dates';
import { useLang } from '../../lib/useLang';
import { Clipping } from '../../ui/Clipping';
import { Verbatim } from '../../ui/Verbatim';
import { Chip } from '../../ui/Chip';

export function EventList() {
  const [lang] = useLang();
  const [minOutlets, setMinOutlets] = useState(2);

  const divQ = useQuery(divergentEventsQuery(6));
  const recentQ = useQuery(eventsListQuery({ minOutlets, limit: 30 }));

  const divergent = divQ.data?.events ?? [];
  const events = recentQ.data?.events ?? [];

  return (
    <div className="space-y-8">
      <header className="space-y-1 border-b border-rule pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink m-0">
          {tt('evt.list.title', lang)}
        </h1>
        <p className="text-sm text-pencil m-0">{tt('evt.list.subtitle', lang)}</p>
      </header>

      {/* Where outlets differ */}
      {divergent.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
            {tt('evt.list.divergent', lang)}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {divergent.map((ev) => {
              const flag =
                ev.headlineDifference.kind === 'number_difference'
                  ? 'mismatch_number'
                  : 'hedging_shift';
              return (
                <Link
                  key={ev.id}
                  to={`/events/${encodeURIComponent(ev.id)}`}
                  className="group block text-left"
                >
                  <Clipping className="h-full flex flex-col justify-between gap-3 group-hover:border-ink/60 transition-colors">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          data-flag={flag}
                          className="rounded-xl px-2 py-0.5 font-medium"
                          style={{ color: 'var(--flag)', backgroundColor: 'var(--flag-wash)' }}
                        >
                          {tt(
                            ev.headlineDifference.kind === 'number_difference'
                              ? 'cmp.kind.number'
                              : 'cmp.kind.hedging',
                            lang
                          )}
                        </span>
                        <span className="text-pencil">
                          {tt('evt.outletsCount', lang, { n: ev.outletCount })}
                        </span>
                      </div>
                      <h3 className="font-read text-base font-medium text-ink group-hover:underline leading-snug m-0 line-clamp-2">
                        <Verbatim text={ev.label} />
                      </h3>
                      <p className="text-xs text-pencil leading-relaxed m-0 line-clamp-3">
                        {lang === 'bn'
                          ? ev.headlineDifference.summaryBn
                          : ev.headlineDifference.summaryEn}
                      </p>
                    </div>
                    <div className="text-[11px] text-pencil border-t border-rule pt-2 flex justify-between">
                      <span>{formatDhakaDate(ev.lastSeen, lang, 'medium')}</span>
                      <span className="text-ink font-medium">{tt('src.compare', lang)} →</span>
                    </div>
                  </Clipping>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Recent multi-outlet events */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
            {tt('evt.list.recent', lang)}
          </h2>
          <div className="flex items-center gap-1.5">
            {[2, 3, 5].map((n) => (
              <Chip key={n} active={minOutlets === n} onClick={() => setMinOutlets(n)}>
                {tt('evt.outletsCount', lang, { n })}+
              </Chip>
            ))}
          </div>
        </div>

        {recentQ.isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-paper-sunk" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-pencil py-4">{tt('empty.panel', lang)}</p>
        ) : (
          <ol className="divide-y divide-rule border-b border-rule m-0 p-0 list-none">
            {events.map((ev) => (
              <li key={ev.id} className="py-3.5">
                <Link
                  to={`/events/${encodeURIComponent(ev.id)}`}
                  className="group flex flex-wrap items-baseline justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="font-read text-base font-medium text-ink group-hover:underline leading-snug m-0">
                      <Verbatim text={ev.label} />
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
                      <span>{tt('evt.outletsCount', lang, { n: ev.outletCount })}</span>
                      <span>·</span>
                      <span>{tt('evt.articlesCount', lang, { n: ev.articleCount })}</span>
                      {ev.lastSeen ? (
                        <>
                          <span>·</span>
                          <span>{formatDhakaDate(ev.lastSeen, lang, 'medium')}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-ink group-hover:underline shrink-0">
                    {tt('src.compare', lang)} →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
