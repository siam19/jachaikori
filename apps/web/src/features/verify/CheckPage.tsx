import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Link2,
  RefreshCw,
  Search,
  Share2,
} from 'lucide-react';
import type { ClaimDiffFlag, VerificationCheck } from '@jachaikori/schema';
import { checkQuery } from '../../api/queries';
import { resolveApiUrl, verifyText } from '../../api/client';
import { tt, type Lang, type StringKey } from '../../i18n/tt';
import { formatDhakaDate } from '../../lib/dates';
import { formatNumber } from '../../i18n/format';
import { useLang } from '../../lib/useLang';
import { inferScript, outletScript } from '../../lib/scripts';
import { usePeek } from '../explore/peek/PeekContext';
import { useTrail } from '../explore/trail/TrailContext';
import { useScrapbook } from '../scrapbook/useScrapbook';
import { Clipping } from '../../ui/Clipping';
import { Verbatim } from '../../ui/Verbatim';
import { OutletName } from '../../ui/OutletName';
import { FlagChip } from '../../ui/Chip';
import { StateCard } from '../../ui/StateCard';
import { Banner } from '../../ui/Banner';
import { ProofStrip } from '../../diff/ProofStrip';
import { Receipt } from '../../diff/Receipt';
import { Lineup } from '../../diff/Lineup';

const RAW_ENUM_CLEANUP: Record<string, { en: string; bn: string }> = {
  mismatch_number: { en: 'numbers', bn: 'সংখ্যা' },
  mismatch_date: { en: 'dates', bn: 'তারিখ' },
  mismatch_speaker: { en: 'speaker attribution', bn: 'বক্তার পরিচয়' },
  mismatch_quote: { en: 'quote wording', bn: 'উদ্ধৃতির ভাষা' },
  hedging_shift: { en: 'certainty framing', bn: 'নিশ্চয়তার মাত্রা' },
  missing_context: { en: 'omitted context', bn: 'বাদ পড়া প্রসঙ্গ' },
};

/** Defensive UI sanitizer in case older cached checks contain raw enum tokens. */
function cleanSummaryCopy(text: string, lang: Lang): string {
  let out = text;
  for (const [token, repl] of Object.entries(RAW_ENUM_CLEANUP)) {
    out = out.replaceAll(token, repl[lang]);
  }
  return out;
}

function statusPillKey(check: VerificationCheck): StringKey {
  if (check.status === 'non_claim') return 'res.status.nonclaim';
  if (check.status === 'no_coverage') return 'res.status.nocoverage';
  switch (check.overallDiffStatus) {
    case 'aligned':
      return 'res.status.aligned';
    case 'minor_differences':
      return 'res.status.minor';
    case 'significant_differences':
      return 'res.status.significant';
    default:
      return 'res.status.insufficient';
  }
}

export function CheckPage() {
  const { id = '' } = useParams();
  const [lang] = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openEntityPeek, openEventPeek, hoveredEntityId, setHoveredEntityId } = usePeek();
  const { pushStop } = useTrail();
  const { isPinned, togglePin } = useScrapbook();

  const [filterMode, setFilterMode] = useState<'all' | 'diff'>('all');
  const [traceOpen, setTraceOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const initialState = (location.state as { freshCheck?: VerificationCheck } | null)?.freshCheck;

  const q = useQuery({
    ...checkQuery(id),
    initialData: initialState && initialState.id === id ? initialState : undefined,
  });

  const recheckMutation = useMutation({
    mutationFn: (text: string) => verifyText({ text, bypassCache: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(['check', next.id], next);
      navigate(`/checks/${encodeURIComponent(next.id)}`, {
        replace: true,
        state: { freshCheck: next },
      });
    },
  });

  const check = q.data;

  useEffect(() => {
    if (!check) return;
    const label = check.extraction.headline || check.extraction.ocrText.slice(0, 60) || check.id;
    pushStop({
      kind: 'check',
      id: check.id,
      label: { en: label, bn: label },
    });
  }, [check, pushStop]);

  const diffTallies = useMemo(() => {
    if (!check) return { differCount: 0, alignCount: 0 };
    let differCount = 0;
    let alignCount = 0;
    for (const src of check.sources) {
      const diffs = src.diffs ?? [];
      for (const d of diffs) {
        if (d.flag === 'match') alignCount++;
        else differCount++;
      }
    }
    return { differCount, alignCount };
  }, [check]);

  if (q.isLoading) {
    return (
      <div className="space-y-4 animate-pulse py-6">
        <div className="h-7 w-1/3 rounded bg-paper-sunk" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 h-72 rounded bg-paper-sunk" />
          <div className="lg:col-span-8 space-y-4">
            <div className="h-28 rounded bg-paper-sunk" />
            <div className="h-48 rounded bg-paper-sunk" />
          </div>
        </div>
      </div>
    );
  }

  if (q.isError || !check) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <StateCard
          title={tt('err.notFound.title', lang)}
          body={tt('err.notFound.body', lang)}
          action={
            <Link
              to="/"
              className="inline-flex items-center rounded-xl bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90"
            >
              {tt('err.notFound.action', lang)}
            </Link>
          }
        />
      </div>
    );
  }

  const cardHeadline =
    check.extraction.headline || check.extraction.attributedStatement || check.extraction.ocrText;
  const cardScript =
    check.extraction.language === 'en'
      ? 'en'
      : check.extraction.language === 'bn'
      ? 'bn'
      : inferScript(cardHeadline, 'bn');

  const summaryText =
    check.status === 'matched' && check.overallDiffSummary
      ? cleanSummaryCopy(check.overallDiffSummary[lang], lang)
      : check.emptyStateNotice?.[lang] ?? tt(statusPillKey(check), lang);

  const visibleSources =
    filterMode === 'diff'
      ? check.sources.filter((s) => (s.diffFlags ?? []).some((f) => f !== 'match'))
      : check.sources;

  const pinned = isPinned(check.id, 'check');

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share) {
      void handleCopyLink();
      return;
    }
    try {
      await navigator.share({
        title: `${tt('app.name', lang)} — ${cardHeadline.slice(0, 80)}`,
        url: window.location.href,
      });
    } catch {
      // cancelled
    }
  };

  return (
    <div className="space-y-6">
      {/* Cache-hit banner */}
      {check.cacheHit !== 'none' ? (
        <Banner
          action={
            check.extraction.ocrText ? (
              <button
                type="button"
                disabled={recheckMutation.isPending}
                onClick={() => recheckMutation.mutate(check.extraction.ocrText)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper px-2.5 py-1 text-xs text-ink hover:bg-paper-sunk cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${recheckMutation.isPending ? 'animate-spin' : ''}`}
                  strokeWidth={1.5}
                />
                {tt('cap.cache.recheck', lang)}
              </button>
            ) : null
          }
        >
          {tt('cap.cache.hit', lang)}
        </Banner>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* LEFT RAIL (cols 1-4 sticky on desktop): EXHIBIT */}
        <aside className="lg:col-span-4 lg:sticky lg:top-16 space-y-4">
          <Clipping className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-rule pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-pencil">
                {tt('res.exhibit', lang)}
              </span>
              <span className="text-[11px] text-pencil">
                {tt('res.checkedOn', lang, {
                  date: formatDhakaDate(check.createdAt, lang, 'short'),
                })}
              </span>
            </div>

            {check.imageUrl ? (
              <div className="rounded-xl border border-rule bg-paper-sunk overflow-hidden">
                <img
                  src={resolveApiUrl(check.imageUrl)}
                  alt={tt('cap.preview.alt', lang)}
                  decoding="async"
                  className="w-full max-h-72 object-contain block"
                />
              </div>
            ) : null}

            {/* Extracted card headline in ink */}
            {cardHeadline ? (
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-wider text-pencil">
                  {tt('res.headline', lang)}
                </div>
                <div className="clipping-ink-rule">
                  <Verbatim
                    text={cardHeadline}
                    base={cardScript}
                    as="p"
                    className="text-base leading-relaxed m-0"
                  />
                </div>
              </div>
            ) : null}

            {/* Structured card fields */}
            <dl className="space-y-2.5 text-xs border-t border-rule pt-3 m-0">
              {check.extraction.quotedSpeaker ? (
                <div>
                  <dt className="text-pencil">{tt('res.speaker', lang)}</dt>
                  <dd className="m-0 mt-0.5 text-ink font-medium">
                    <Verbatim text={check.extraction.quotedSpeaker} base={cardScript} />
                  </dd>
                </div>
              ) : null}

              {check.extraction.claimedNumbers.length > 0 ? (
                <div>
                  <dt className="text-pencil">{tt('res.numbers', lang)}</dt>
                  <dd className="m-0 mt-1 flex flex-wrap gap-1.5">
                    {check.extraction.claimedNumbers.map((num, i) => (
                      <span
                        key={i}
                        className="rounded-xl border border-rule-strong bg-paper px-2 py-0.5 text-ink"
                      >
                        <Verbatim text={num} base={cardScript} />
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}

              {check.extraction.claimedDates.length > 0 ? (
                <div>
                  <dt className="text-pencil">{tt('res.dates', lang)}</dt>
                  <dd className="m-0 mt-1 flex flex-wrap gap-1.5">
                    {check.extraction.claimedDates.map((dt, i) => (
                      <span
                        key={i}
                        className="rounded-xl border border-rule-strong bg-paper px-2 py-0.5 text-ink"
                      >
                        <Verbatim text={dt} base={cardScript} />
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}

              {check.extraction.publisherLogo ? (
                <div>
                  <dt className="text-pencil">{tt('res.publisher', lang)}</dt>
                  <dd className="m-0 mt-0.5 text-ink">
                    {check.extraction.publisherLogoOutletId ? (
                      <OutletName id={check.extraction.publisherLogoOutletId} lang={lang} />
                    ) : (
                      <Verbatim text={check.extraction.publisherLogo} base={cardScript} />
                    )}
                  </dd>
                </div>
              ) : null}

              {check.resolvedEntities.length > 0 ? (
                <div>
                  <dt className="text-pencil">{tt('res.people', lang)}</dt>
                  <dd className="m-0 mt-1.5 flex flex-wrap gap-1.5">
                    {check.resolvedEntities.map((ent) => {
                      const label =
                        lang === 'bn'
                          ? ent.canonicalBn || ent.canonicalEn || ent.surfaceForm
                          : ent.canonicalEn || ent.canonicalBn || ent.surfaceForm;
                      const highlighted = hoveredEntityId === ent.entityId;
                      return (
                        <button
                          key={ent.entityId}
                          type="button"
                          onClick={() => openEntityPeek(ent.entityId, label)}
                          onMouseEnter={() => setHoveredEntityId(ent.entityId)}
                          onMouseLeave={() => setHoveredEntityId(null)}
                          className={`rounded-xl border px-2 py-1 text-xs cursor-pointer transition-colors ${
                            highlighted
                              ? 'border-ink bg-ink text-paper'
                              : 'border-rule-strong bg-paper text-ink hover:bg-paper-sunk'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* Collapsible pipeline trace */}
            <div className="border-t border-rule pt-3">
              <button
                type="button"
                onClick={() => setTraceOpen((v) => !v)}
                aria-expanded={traceOpen}
                className="flex w-full items-center justify-between text-xs text-pencil hover:text-ink cursor-pointer"
              >
                <span>{tt('trace.title', lang)}</span>
                <span className="inline-flex items-center gap-1 font-mono-data">
                  {tt('trace.ms', lang, { n: check.latencyMs })}
                  {traceOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </span>
              </button>
              {traceOpen ? (
                <dl className="mt-2.5 space-y-1 text-[11px] font-mono-data text-pencil m-0">
                  {(
                    [
                      ['trace.cache', check.stageTimingsMs.cacheLookupMs],
                      ['trace.extract', check.stageTimingsMs.extractMs],
                      ['trace.entities', check.stageTimingsMs.entityResolveMs],
                      ['trace.retrieval', check.stageTimingsMs.retrievalMs],
                      ['trace.rerank', check.stageTimingsMs.rerankMs],
                      ['trace.diff', check.stageTimingsMs.diffMs],
                      ['trace.persist', check.stageTimingsMs.persistMs],
                    ] as const
                  ).map(([key, ms]) => (
                    <div key={key} className="flex justify-between">
                      <dt>{tt(key, lang)}</dt>
                      <dd className="m-0 text-ink">{tt('trace.ms', lang, { n: ms })}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-rule pt-1 font-medium text-ink">
                    <dt>{tt('trace.total', lang)}</dt>
                    <dd className="m-0">{tt('trace.ms', lang, { n: check.latencyMs })}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </Clipping>
        </aside>

        {/* RIGHT COLUMN (cols 5-12): WHAT WE FOUND + LINEUP + SOURCES */}
        <div className="lg:col-span-8 space-y-6">
          {/* Summary header */}
          <section className="space-y-3 border-b border-rule pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-pencil">
                  {tt('res.found', lang)}
                </span>
                <span className="rounded-xl border border-rule-strong bg-paper-raised px-2 py-0.5 text-xs font-medium text-ink">
                  {tt(statusPillKey(check), lang)}
                </span>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void togglePin({
                      id: check.id,
                      kind: 'check',
                      label: {
                        en: cardHeadline.slice(0, 100) || check.id,
                        bn: cardHeadline.slice(0, 100) || check.id,
                      },
                      subtitle: tt(statusPillKey(check), lang),
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium cursor-pointer min-h-[36px] ${
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
                  onClick={() => void handleCopyLink()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer min-h-[36px]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-sage" strokeWidth={1.5} />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  <span>{copied ? tt('res.copied', lang) : tt('res.copyLink', lang)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleNativeShare()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer min-h-[36px]"
                >
                  <Share2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{tt('res.share', lang)}</span>
                </button>
              </div>
            </div>

            <p className="font-display text-lg sm:text-xl text-ink leading-snug m-0">
              {summaryText}
            </p>

            {/* Tally strip — counts differing details, never a truth score */}
            {check.sources.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-pencil pt-1">
                <span>{tt('res.compared', lang, { n: check.sources.length })}</span>
                {diffTallies.differCount > 0 ? (
                  <>
                    <span>·</span>
                    <span className="text-rust font-medium">
                      {tt('res.tally.differ', lang, { n: diffTallies.differCount })}
                    </span>
                  </>
                ) : null}
                {diffTallies.alignCount > 0 ? (
                  <>
                    <span>·</span>
                    <span className="text-sage font-medium">
                      {tt('res.tally.align', lang, { n: diffTallies.alignCount })}
                    </span>
                  </>
                ) : null}
                <div className="flex items-center gap-1" aria-hidden="true">
                  {check.sources.map((s) => {
                    const hasDiff = (s.diffFlags ?? []).some((f) => f !== 'match');
                    return (
                      <span
                        key={s.articleId}
                        className={`h-2 w-2 rounded-full ${hasDiff ? 'bg-rust' : 'bg-sage'}`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            <p className="text-xs text-pencil m-0">{tt('res.note', lang)}</p>
          </section>

          {/* Lineup log-scale numeric ruler (if numeric diffs exist) */}
          <Lineup sources={check.sources} lang={lang} />

          {/* Honest empty state for no_coverage or non_claim */}
          {check.sources.length === 0 ? (
            <StateCard
              dashed
              title={tt(statusPillKey(check), lang)}
              body={summaryText}
              action={
                <Link
                  to={`/search?q=${encodeURIComponent(cardHeadline.slice(0, 120))}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90"
                >
                  <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{tt('nav.search', lang)}</span>
                </Link>
              }
              secondaryAction={
                <Link
                  to="/"
                  className="inline-flex items-center rounded-xl border border-rule-strong bg-paper-raised px-3.5 py-2 text-xs font-medium text-ink hover:bg-paper-sunk"
                >
                  {tt('cap.tab.text', lang)}
                </Link>
              }
            />
          ) : (
            /* Accredited sources list */
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
                  {tt('res.sources', lang)} ({formatNumber(visibleSources.length, lang)})
                </h2>
                <div className="inline-flex rounded-xl border border-rule-strong bg-paper-raised overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-3 py-1 cursor-pointer ${
                      filterMode === 'all' ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
                    }`}
                  >
                    {tt('res.filter.all', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('diff')}
                    className={`px-3 py-1 border-s border-rule-strong cursor-pointer ${
                      filterMode === 'diff' ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
                    }`}
                  >
                    {tt('res.filter.diff', lang)}
                  </button>
                </div>
              </div>

              {visibleSources.length === 0 ? (
                <p className="text-sm text-pencil">{tt('empty.panel', lang)}</p>
              ) : (
                <div className="space-y-4">
                  {visibleSources.map((src, idx) => {
                    const artScript = outletScript(src.outlet);
                    const diffs = src.diffs ?? [];
                    const nonMatchDiffs = diffs.filter((d) => d.flag !== 'match');
                    const flags: ClaimDiffFlag[] =
                      src.diffFlags && src.diffFlags.length > 0
                        ? src.diffFlags
                        : diffs.length > 0
                        ? Array.from(new Set(diffs.map((d) => d.flag)))
                        : [];

                    return (
                      <Clipping key={src.articleId} className="space-y-3">
                        {/* Outlet nameplate + date + cluster comparison link */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
                          <div className="flex flex-wrap items-center gap-2">
                            <OutletName id={src.outlet} lang={lang} />
                            {src.publishedAt ? (
                              <>
                                <span>·</span>
                                <span>
                                  {tt('src.published', lang, {
                                    date: formatDhakaDate(src.publishedAt, lang, 'medium'),
                                  })}
                                </span>
                              </>
                            ) : null}
                          </div>
                          {src.clusterId ? (
                            <button
                              type="button"
                              onClick={() => openEventPeek(src.clusterId!, src.title)}
                              className="text-xs text-ink underline underline-offset-2 hover:text-pencil cursor-pointer"
                            >
                              {tt('src.compare', lang)}
                              {src.clusterOutletCount
                                ? ` · ${tt('src.coverage', lang, { n: src.clusterOutletCount })}`
                                : ''}
                            </button>
                          ) : null}
                        </div>

                        {/* Original headline in ink */}
                        <a
                          href={src.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-start gap-1.5 text-ink hover:underline"
                        >
                          <h3 className="font-read text-lg font-medium leading-snug m-0">
                            <Verbatim text={src.title} outlet={src.outlet} />
                          </h3>
                          <ExternalLink
                            className="h-3.5 w-3.5 mt-1.5 shrink-0 text-pencil group-hover:text-ink"
                            strokeWidth={1.5}
                          />
                        </a>

                        {/* Glance chips (Level 1) */}
                        {flags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {nonMatchDiffs.length > 0
                              ? nonMatchDiffs.map((d, dIdx) => (
                                  <FlagChip
                                    key={`${d.flag}-${dIdx}`}
                                    flag={d.flag}
                                    lang={lang}
                                    detail={
                                      d.cardSpan && d.articleSpan && d.flag === 'mismatch_number'
                                        ? `${d.cardSpan} → ${d.articleSpan}`
                                        : undefined
                                    }
                                  />
                                ))
                              : flags.map((f) => <FlagChip key={f} flag={f} lang={lang} />)}
                          </div>
                        ) : null}

                        {/* Proof Strip + Rack (Level 2) */}
                        {nonMatchDiffs.length > 0 ? (
                          <div className="pt-1">
                            <ProofStrip
                              headline={cardHeadline}
                              diffs={diffs}
                              cardScript={cardScript}
                              articleScript={artScript}
                              lang={lang}
                            />
                          </div>
                        ) : (
                          <div className="clipping-ink-rule py-0.5">
                            <Verbatim
                              text={src.snippet}
                              outlet={src.outlet}
                              as="p"
                              className="text-sm leading-relaxed m-0"
                            />
                          </div>
                        )}

                        {/* Expandable Receipt (Level 3) */}
                        <Receipt
                          source={src}
                          lang={lang}
                          defaultOpen={idx === 0 && nonMatchDiffs.length > 0}
                        />
                      </Clipping>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
