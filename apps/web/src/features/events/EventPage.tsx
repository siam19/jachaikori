import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Bookmark, Check, ChevronDown, ChevronUp, ExternalLink, Link2 } from 'lucide-react';
import type { CrossOutletDifference, OutletId } from '@jachaikori/schema';
import { eventComparisonQuery, eventGraphQuery, eventsListQuery } from '../../api/queries';
import { tt, type Lang, type StringKey } from '../../i18n/tt';
import { formatDhakaDate, formatDhakaDayIso } from '../../lib/dates';
import { useLang } from '../../lib/useLang';
import { useTrail } from '../explore/trail/TrailContext';
import { usePeek } from '../explore/peek/PeekContext';
import { useScrapbook } from '../scrapbook/useScrapbook';
import { Banner } from '../../ui/Banner';
import { Clipping } from '../../ui/Clipping';
import { Verbatim } from '../../ui/Verbatim';
import { OutletName } from '../../ui/OutletName';
import { StateCard } from '../../ui/StateCard';
import { Lanes } from './Lanes';

function diffKindKey(kind: CrossOutletDifference['kind']): StringKey {
  switch (kind) {
    case 'consensus_number':
      return 'cmp.kind.consensus';
    case 'number_difference':
      return 'cmp.kind.number';
    case 'hedging_difference':
      return 'cmp.kind.hedging';
    case 'date_difference':
      return 'cmp.kind.date';
  }
}

function diffFlagDataAttr(kind: CrossOutletDifference['kind']): string {
  switch (kind) {
    case 'consensus_number':
      return 'match';
    case 'number_difference':
      return 'mismatch_number';
    case 'hedging_difference':
      return 'hedging_shift';
    case 'date_difference':
      return 'mismatch_date';
  }
}

function hedgingLabel(level: string, lang: Lang): string {
  if (level === 'certain') return tt('gauge.certain', lang);
  if (level === 'hedged' || level === 'conditional') return tt('gauge.cautious', lang);
  return tt('gauge.stated', lang);
}

export function EventPage() {
  const { id = '' } = useParams();
  const [lang] = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const { pushStop } = useTrail();
  const { openEntityPeek } = usePeek();
  const { isPinned, togglePin } = useScrapbook();

  const [selectedOutlet, setSelectedOutlet] = useState<OutletId | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [copied, setCopied] = useState(false);

  const cmpQ = useQuery(eventComparisonQuery(id));
  const graphQ = useQuery(eventGraphQuery(id, false));

  const cmp = cmpQ.data;
  const eventDay = formatDhakaDayIso(cmp?.event.firstSeen);

  const sameDayQ = useQuery({
    ...eventsListQuery({
      from: eventDay ?? undefined,
      to: eventDay ?? undefined,
      limit: 6,
    }),
    enabled: Boolean(eventDay),
  });

  // Merge-redirect URL healing
  useEffect(() => {
    if (cmp?.event.redirectedFrom && cmp.event.id !== id) {
      navigate(`/events/${encodeURIComponent(cmp.event.id)}${location.search}`, {
        replace: true,
        state: { redirectedFrom: cmp.event.redirectedFrom },
      });
    }
  }, [cmp?.event.id, cmp?.event.redirectedFrom, id, location.search, navigate]);

  // Reading Trail
  useEffect(() => {
    if (!cmp) return;
    pushStop({
      kind: 'event',
      id: cmp.event.id,
      label: { en: cmp.event.label, bn: cmp.event.label },
    });
  }, [cmp, pushStop]);

  if (cmpQ.isLoading) {
    return (
      <div className="space-y-5 animate-pulse py-6">
        <div className="h-8 w-2/3 rounded bg-paper-sunk" />
        <div className="h-60 rounded bg-paper-sunk" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 h-48 rounded bg-paper-sunk" />
          <div className="lg:col-span-8 h-64 rounded bg-paper-sunk" />
        </div>
      </div>
    );
  }

  if (cmpQ.isError || !cmp) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <StateCard
          title={tt('empty.panel', lang)}
          action={
            <Link
              to="/events"
              className="inline-flex items-center rounded-xl bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90"
            >
              {tt('nav.events', lang)}
            </Link>
          }
        />
      </div>
    );
  }

  const redirectFrom = (location.state as { redirectedFrom?: string } | null)?.redirectedFrom;
  const pinned = isPinned(cmp.event.id, 'event');

  const agreements = cmp.crossOutletDifferences.filter((d) => d.kind === 'consensus_number');
  const divergences = cmp.crossOutletDifferences.filter((d) => d.kind !== 'consensus_number');
  const coveredOutlets = cmp.outletCoverage.filter((c) => c.covered && c.leadArticle);
  const visibleCoverage = selectedOutlet
    ? coveredOutlets.filter((c) => c.outlet === selectedOutlet)
    : coveredOutlets;

  const peopleNodes = (graphQ.data?.nodes ?? [])
    .filter((n) => !n.isHub)
    .sort((a, b) => (b.articleCount ?? b.mentionCount ?? 0) - (a.articleCount ?? a.mentionCount ?? 0))
    .slice(0, 10);

  const otherSameDay = (sameDayQ.data?.events ?? [])
    .filter((e) => e.id !== cmp.event.id)
    .slice(0, 5);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {redirectFrom ? (
        <Banner
          onDismiss={() =>
            navigate(location.pathname + location.search, { replace: true, state: null })
          }
        >
          {tt('redirect.event', lang)}
        </Banner>
      ) : null}

      {/* Event header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
            <span className="uppercase tracking-wider font-semibold">{tt('nav.events', lang)}</span>
            <span>·</span>
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
          <h1 className="font-read text-2xl sm:text-3xl font-medium text-ink m-0 leading-snug">
            <Verbatim text={cmp.event.label} />
          </h1>
          {cmp.firstToPublish ? (
            <div className="text-xs text-pencil pt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{tt('evt.firstToPublish', lang)}:</span>
              <OutletName id={cmp.firstToPublish.outlet} lang={lang} />
              <span>· {formatDhakaDate(cmp.firstToPublish.publishedAt, lang, 'datetime')}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() =>
              void togglePin({
                id: cmp.event.id,
                kind: 'event',
                label: { en: cmp.event.label, bn: cmp.event.label },
                subtitle: tt('evt.outletsCount', lang, { n: cmp.event.outletCount }),
              })
            }
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium cursor-pointer min-h-[38px] ${
              pinned
                ? 'border-ink bg-ink text-paper'
                : 'border-rule-strong bg-paper-raised text-ink hover:bg-paper-sunk'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>{pinned ? tt('scrap.pinned', lang) : tt('scrap.pin', lang)}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer min-h-[38px]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-sage" strokeWidth={1.5} />
            ) : (
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            <span>{copied ? tt('res.copied', lang) : tt('res.copyLink', lang)}</span>
          </button>
        </div>
      </header>

      {/* 8-outlet timeline lanes */}
      <Lanes
        cmp={cmp}
        lang={lang}
        selectedOutlet={selectedOutlet}
        onSelectOutlet={setSelectedOutlet}
      />

      {/* 2-column comparison body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Cols 1-4: Cross-outlet consensus & differences */}
        <aside className="lg:col-span-4 space-y-5">
          {divergences.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                {tt('cmp.differ', lang)}
              </h2>
              <div className="space-y-2.5">
                {divergences.map((d, i) => (
                  <div
                    key={i}
                    data-flag={diffFlagDataAttr(d.kind)}
                    className="rounded-xl border bg-paper-raised p-3.5 space-y-2"
                    style={{
                      borderColor: 'color-mix(in oklab, var(--flag) 45%, var(--color-rule-strong))',
                    }}
                  >
                    <span
                      className="inline-block rounded-xl px-2 py-0.5 text-[11px] font-medium"
                      style={{ color: 'var(--flag)', backgroundColor: 'var(--flag-wash)' }}
                    >
                      {tt(diffKindKey(d.kind), lang)}
                    </span>
                    <p className="text-sm text-ink leading-relaxed m-0">
                      {lang === 'bn' ? d.summaryBn : d.summaryEn}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {d.outlets.map((o) => (
                        <OutletName key={o} id={o} lang={lang} className="text-[11px]" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {agreements.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                {tt('cmp.agree', lang)}
              </h2>
              <div className="space-y-2.5">
                {agreements.map((d, i) => (
                  <div
                    key={i}
                    data-flag="match"
                    className="rounded-xl border border-rule bg-paper-raised p-3.5 space-y-1.5"
                  >
                    <span
                      className="inline-block rounded-xl px-2 py-0.5 text-[11px] font-medium"
                      style={{ color: 'var(--flag)', backgroundColor: 'var(--flag-wash)' }}
                    >
                      {tt(diffKindKey(d.kind), lang)}
                    </span>
                    <p className="text-sm text-ink leading-relaxed m-0">
                      {lang === 'bn' ? d.summaryBn : d.summaryEn}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {agreements.length === 0 && divergences.length === 0 ? (
            <p className="text-xs text-pencil">{tt('cmp.claimsEmpty', lang)}</p>
          ) : null}
        </aside>

        {/* Cols 5-12: Claims by outlet + optional entity connections */}
        <div className="lg:col-span-8 space-y-5">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                {tt('cmp.claimsTitle', lang)}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedOutlet(null)}
                  className={`rounded-xl border px-2.5 py-1 text-xs cursor-pointer ${
                    selectedOutlet === null
                      ? 'border-ink bg-ink text-paper font-medium'
                      : 'border-rule-strong bg-paper-raised text-ink hover:bg-paper-sunk'
                  }`}
                >
                  {tt('res.filter.all', lang)}
                </button>
                {coveredOutlets.map((c) => (
                  <button
                    key={c.outlet}
                    type="button"
                    onClick={() =>
                      setSelectedOutlet(selectedOutlet === c.outlet ? null : c.outlet)
                    }
                    className={`rounded-xl border px-2.5 py-1 text-xs cursor-pointer ${
                      selectedOutlet === c.outlet
                        ? 'border-ink bg-ink text-paper font-medium'
                        : 'border-rule-strong bg-paper-raised text-ink hover:bg-paper-sunk'
                    }`}
                  >
                    <OutletName
                      id={c.outlet}
                      lang={lang}
                      className={selectedOutlet === c.outlet ? '!text-paper' : ''}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {visibleCoverage.map((cov) => (
                <Clipping key={cov.outlet} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
                    <OutletName id={cov.outlet} lang={lang} />
                    {cov.firstPublishedAt ? (
                      <span>{formatDhakaDate(cov.firstPublishedAt, lang, 'datetime')}</span>
                    ) : null}
                  </div>
                  {cov.leadArticle ? (
                    <a
                      href={cov.leadArticle.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-start gap-1.5 text-ink hover:underline"
                    >
                      <Verbatim
                        text={cov.leadArticle.title}
                        outlet={cov.outlet}
                        as="h3"
                        className="text-base font-medium leading-snug m-0"
                      />
                      <ExternalLink
                        className="h-3.5 w-3.5 mt-1 shrink-0 text-pencil group-hover:text-ink"
                        strokeWidth={1.5}
                      />
                    </a>
                  ) : null}

                  {cov.claims.length === 0 ? (
                    <p className="text-xs text-pencil m-0">{tt('cmp.claimsEmpty', lang)}</p>
                  ) : (
                    <ul className="divide-y divide-rule border-t border-rule m-0 p-0 list-none">
                      {cov.claims.map((cl) => (
                        <li key={cl.id} className="py-2.5 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="rounded-xl border border-rule-strong bg-paper px-1.5 py-0.5 text-pencil">
                              {hedgingLabel(cl.hedgingLevel, lang)}
                            </span>
                            {cl.numbers.map((n, i) => (
                              <span
                                key={`n-${i}`}
                                className="rounded-xl border border-rule bg-paper px-1.5 py-0.5 font-mono-data text-ink"
                              >
                                {n}
                              </span>
                            ))}
                            {cl.dates.map((d, i) => (
                              <span
                                key={`d-${i}`}
                                className="rounded-xl border border-rule bg-paper px-1.5 py-0.5 font-mono-data text-pencil"
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                          <Verbatim
                            text={cl.evidenceSnippet || cl.claimText}
                            outlet={cov.outlet}
                            as="p"
                            className="text-sm leading-relaxed m-0"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Clipping>
              ))}
            </div>
          </section>

          {/* Optional expandable entity connections panel */}
          <div className="border-t border-rule pt-3">
            <button
              type="button"
              onClick={() => setShowGraph((v) => !v)}
              aria-expanded={showGraph}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline cursor-pointer"
            >
              <span>{tt('cmp.graphToggle', lang)}</span>
              {showGraph ? (
                <ChevronUp className="h-3.5 w-3.5 text-pencil" strokeWidth={1.5} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-pencil" strokeWidth={1.5} />
              )}
            </button>

            {showGraph ? (
              <div className="mt-3 rounded-xl border border-rule bg-paper-raised p-4 space-y-3">
                {graphQ.isLoading ? (
                  <div className="h-20 bg-paper-sunk animate-pulse rounded" />
                ) : (graphQ.data?.edges ?? []).length === 0 ? (
                  <p className="text-xs text-pencil m-0">{tt('empty.panel', lang)}</p>
                ) : (
                  <ul className="divide-y divide-rule text-xs m-0 p-0 list-none">
                    {(graphQ.data?.edges ?? []).slice(0, 12).map((e, i) => {
                      const srcNode = graphQ.data?.nodes.find((n) => n.id === e.source);
                      const tgtNode = graphQ.data?.nodes.find((n) => n.id === e.target);
                      const sName =
                        (lang === 'bn' ? srcNode?.canonicalBn || srcNode?.canonicalEn : srcNode?.canonicalEn || srcNode?.canonicalBn) ||
                        e.source;
                      const tName =
                        (lang === 'bn' ? tgtNode?.canonicalBn || tgtNode?.canonicalEn : tgtNode?.canonicalEn || tgtNode?.canonicalBn) ||
                        e.target;
                      return (
                        <li key={i} className="py-2 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEntityPeek(e.source, sName)}
                            className="font-medium text-ink hover:underline cursor-pointer"
                          >
                            {sName}
                          </button>
                          <span className="text-pencil">
                            — {(e.relationType ?? 'linked').replace(/_/g, ' ')} →
                          </span>
                          <button
                            type="button"
                            onClick={() => openEntityPeek(e.target, tName)}
                            className="font-medium text-ink hover:underline cursor-pointer"
                          >
                            {tName}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Keep reading rails */}
      {peopleNodes.length > 0 || otherSameDay.length > 0 ? (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-rule pt-6">
          {peopleNodes.length > 0 ? (
            <div className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                {tt('rail.peopleInStory', lang)}
              </h2>
              <div className="flex flex-wrap gap-2">
                {peopleNodes.map((n) => {
                  const name =
                    lang === 'bn'
                      ? n.canonicalBn || n.canonicalEn || n.id
                      : n.canonicalEn || n.canonicalBn || n.id;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => openEntityPeek(n.id, name)}
                      className="rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer"
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {otherSameDay.length > 0 ? (
            <div className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                {tt('rail.thatDay', lang)}
              </h2>
              <ul className="divide-y divide-rule border-t border-rule m-0 p-0 list-none">
                {otherSameDay.map((ev) => (
                  <li key={ev.id} className="py-2">
                    <Link
                      to={`/events/${encodeURIComponent(ev.id)}`}
                      className="block text-sm text-ink hover:underline"
                    >
                      <Verbatim text={ev.label} />
                    </Link>
                    <div className="text-[11px] text-pencil mt-0.5">
                      {tt('evt.outletsCount', lang, { n: ev.outletCount })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
