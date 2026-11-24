import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Bookmark, Check, ChevronDown, ChevronUp, ExternalLink, Link2 } from 'lucide-react';
import { entityEgoQuery, entityProfileQuery } from '../../api/queries';
import { tt, type StringKey } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate } from '../../lib/dates';
import { useLang } from '../../lib/useLang';
import { useLens } from '../../lib/useLens';
import { useTrail } from '../explore/trail/TrailContext';
import { useScrapbook } from '../scrapbook/useScrapbook';
import { Banner } from '../../ui/Banner';
import { StateCard } from '../../ui/StateCard';
import { LensBar } from '../explore/lens/LensBar';
import { RelationsPanel } from './Relations';
import { ActivityPanel } from './Activity';
import { AssociatedPanel } from './Associated';
import { ArticlesPanel } from './Articles';
import type { GraphHistoryEntry } from './EntityGraph';

export function EntityDossier() {
  const { id = '' } = useParams();
  const [lang] = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [lens, setLens, clearLens] = useLens();
  const { pushStop } = useTrail();
  const { isPinned, togglePin } = useScrapbook();
  const [copied, setCopied] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [graphHistory, setGraphHistory] = useState<GraphHistoryEntry[]>([]);

  const profileQ = useQuery(entityProfileQuery(id));
  const egoQ = useQuery(entityEgoQuery(id, lens));

  const profile = profileQ.data;

  // Merge-redirect URL healing with one-time dismissible notice (no scroll reset!)
  useEffect(() => {
    if (profile?.redirectedFrom && profile.id !== id && !profileQ.isPlaceholderData) {
      navigate(`/entities/${encodeURIComponent(profile.id)}${location.search}`, {
        replace: true,
        preventScrollReset: true,
        state: { redirectedFrom: profile.redirectedFrom },
      });
    }
  }, [profile?.id, profile?.redirectedFrom, profileQ.isPlaceholderData, id, location.search, navigate]);

  // Record in Reading Trail
  useEffect(() => {
    if (!profile || profileQ.isPlaceholderData) return;
    pushStop({
      kind: 'entity',
      id: profile.id,
      label: {
        en: profile.canonicalEn || profile.canonicalBn || profile.id,
        bn: profile.canonicalBn || profile.canonicalEn || profile.id,
      },
    });
  }, [profile, profileQ.isPlaceholderData, pushStop]);

  const primaryName = profile
    ? lang === 'bn'
      ? profile.canonicalBn || profile.canonicalEn || profile.id
      : profile.canonicalEn || profile.canonicalBn || profile.id
    : id;

  // In-place entity jump inside the graph: pushes current entity to graphHistory and NEVER reloads or resets scroll!
  const handleNavigateEntity = useCallback(
    (targetId: string) => {
      if (targetId === id) return;
      if (profile) {
        setGraphHistory((prev) => [
          ...prev.filter((h) => h.id !== profile.id).slice(-14),
          { id: profile.id, name: primaryName },
        ]);
      }
      navigate(`/entities/${encodeURIComponent(targetId)}`, { preventScrollReset: true });
    },
    [id, profile, primaryName, navigate]
  );

  const handleGoBack = useCallback(() => {
    setGraphHistory((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1]!;
      navigate(`/entities/${encodeURIComponent(target.id)}`, { preventScrollReset: true });
      return prev.slice(0, -1);
    });
  }, [navigate]);

  const handleJumpHistory = useCallback(
    (index: number) => {
      setGraphHistory((prev) => {
        const target = prev[index];
        if (!target) return prev;
        navigate(`/entities/${encodeURIComponent(target.id)}`, { preventScrollReset: true });
        return prev.slice(0, index);
      });
    },
    [navigate]
  );

  // Only show initial skeleton on the very first cold visit when no profile is cached yet
  if (profileQ.isLoading && !profile) {
    return (
      <div className="space-y-4 animate-pulse py-4">
        <div className="h-16 w-full rounded-3xl bg-paper-sunk/70" />
        <div className="h-[520px] w-full rounded-3xl bg-paper-sunk/70" />
      </div>
    );
  }

  if ((profileQ.isError && !profile) || !profile) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <StateCard
          title={tt('empty.panel', lang)}
          action={
            <Link
              to="/entities"
              className="inline-flex items-center rounded-full bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90"
            >
              {tt('nav.people', lang)}
            </Link>
          }
        />
      </div>
    );
  }

  const secondaryName = lang === 'bn' ? profile.canonicalEn : profile.canonicalBn;
  const tagline =
    lang === 'bn'
      ? profile.shortTaglineBn || profile.shortTaglineEn
      : profile.shortTaglineEn || profile.shortTaglineBn;
  const description =
    lang === 'bn'
      ? profile.descriptionBn || profile.descriptionEn
      : profile.descriptionEn || profile.descriptionBn;
  const typeKey = `ent.type.${profile.entityType}` as StringKey;

  const redirectFrom = (location.state as { redirectedFrom?: string } | null)?.redirectedFrom;
  const pinned = isPinned(profile.id, 'entity');

  const withNeighbor = lens.with
    ? egoQ.data?.neighbors.find((n) => n.id === lens.with)
    : undefined;
  const withLabel = withNeighbor
    ? lang === 'bn'
      ? withNeighbor.canonicalBn || withNeighbor.canonicalEn || lens.with
      : withNeighbor.canonicalEn || withNeighbor.canonicalBn || lens.with
    : lens.with;

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
    <div className="space-y-5">
      {redirectFrom ? (
        <Banner
          onDismiss={() =>
            navigate(location.pathname + location.search, {
              replace: true,
              preventScrollReset: true,
              state: null,
            })
          }
        >
          {tt('redirect.entity', lang, { name: primaryName })}
        </Banner>
      ) : null}

      {/* Compact, above-the-fold entity header so the Relationship Graph is IMMEDIATELY visible with zero scrolling */}
      <header className="clipping-surface rounded-3xl px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink m-0 leading-tight">
                {primaryName}
              </h1>
              {secondaryName && secondaryName !== primaryName ? (
                <span
                  lang={lang === 'bn' ? 'en' : 'bn'}
                  className="text-sm text-pencil"
                >
                  {secondaryName}
                </span>
              ) : null}
              <span className="rounded-full bg-paper-sunk/80 px-2.5 py-0.5 text-[11px] font-medium text-ink">
                {tt(typeKey, lang)}
              </span>
              {profile.isHub ? (
                <span className="rounded-full border border-rule/80 px-2 py-0.5 text-[11px] text-pencil">
                  {tt('ent.hub.badge', lang)}
                </span>
              ) : null}
            </div>

            {tagline ? (
              <p className="text-xs sm:text-sm text-pencil m-0 line-clamp-1">{tagline}</p>
            ) : null}
          </div>

          {/* Compact stats + actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-paper/80 border border-rule/60 px-3 py-1 text-xs text-pencil font-mono-data">
              <strong className="text-ink font-medium">{formatNumber(profile.stats.articleCount, lang)}</strong>{' '}
              {tt('ent.stats.articles', lang)}
              <span>·</span>
              <strong className="text-ink font-medium">{formatNumber(profile.stats.relationCount, lang)}</strong>{' '}
              {tt('ent.stats.relations', lang)}
            </span>

            {description ? (
              <button
                type="button"
                onClick={() => setBioOpen((v) => !v)}
                aria-expanded={bioOpen}
                className="inline-flex items-center gap-1 rounded-full border border-rule/80 bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer transition-colors"
              >
                <span>{bioOpen ? tt('ent.bio.toggleHide', lang) : tt('ent.bio.toggleShow', lang)}</span>
                {bioOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                )}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() =>
                void togglePin({
                  id: profile.id,
                  kind: 'entity',
                  label: {
                    en: profile.canonicalEn || profile.canonicalBn || profile.id,
                    bn: profile.canonicalBn || profile.canonicalEn || profile.id,
                  },
                  subtitle: tagline ?? undefined,
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                pinned
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule/80 bg-paper text-ink hover:bg-paper-sunk'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" strokeWidth={1.6} />
              <span className="hidden sm:inline">
                {pinned ? tt('scrap.pinned', lang) : tt('scrap.pin', lang)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={tt('res.copyLink', lang)}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule/80 bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer transition-colors"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-sage" strokeWidth={1.6} />
              ) : (
                <Link2 className="h-3.5 w-3.5" strokeWidth={1.6} />
              )}
              <span className="hidden md:inline">
                {copied ? tt('res.copied', lang) : tt('res.copyLink', lang)}
              </span>
            </button>
          </div>
        </div>

        {/* Collapsible bio, citations, aliases & office tenure (keeps graph immediately in view!) */}
        {bioOpen ? (
          <div className="border-t border-rule/50 pt-3.5 space-y-3">
            {description ? (
              <p lang={lang} className="text-sm leading-relaxed text-ink m-0 max-w-[76ch]">
                {description}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-pencil">
              {profile.descriptionSources.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>
                    {tt('ent.bio.sources', lang, { n: profile.descriptionSources.length })}:
                  </span>
                  {profile.descriptionSources.map((src, i) => (
                    <a
                      key={src.articleId}
                      href={src.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 rounded-full border border-rule/80 bg-paper px-2 py-0.5 font-mono-data text-[11px] text-ink hover:bg-paper-sunk"
                    >
                      {formatNumber(i + 1, lang)}
                      <ExternalLink className="h-2.5 w-2.5" strokeWidth={1.6} />
                    </a>
                  ))}
                </div>
              ) : null}

              {profile.aliases.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{tt('ent.aliases', lang)}:</span>
                  {profile.aliases.slice(0, 8).map((a, i) => (
                    <span
                      key={`${a.aliasRaw}-${i}`}
                      className="rounded-full bg-paper-sunk/70 px-2.5 py-0.5 text-ink"
                    >
                      {a.aliasRaw}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {profile.roleTerms.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-pencil">{tt('ent.tenure', lang)}:</span>
                {profile.roleTerms.map((term) => {
                  const roleLabel =
                    lang === 'bn'
                      ? term.roleNameBn || term.roleNameEn || term.roleEntityId
                      : term.roleNameEn || term.roleNameBn || term.roleEntityId;
                  const holderLabel =
                    lang === 'bn'
                      ? term.holderNameBn || term.holderNameEn || term.holderEntityId
                      : term.holderNameEn || term.holderNameBn || term.holderEntityId;

                  return (
                    <span
                      key={term.id}
                      className="inline-flex items-center gap-2 rounded-full bg-paper border border-rule/70 px-3 py-1 text-xs"
                    >
                      <span className="font-medium text-ink">
                        {term.holderEntityId === profile.id ? roleLabel : holderLabel}
                      </span>
                      <span className="font-mono-data text-[11px] text-pencil">
                        {formatDhakaDate(term.validFrom, lang, 'medium')} →{' '}
                        {term.validTo
                          ? formatDhakaDate(term.validTo, lang, 'medium')
                          : tt('ent.tenure.present', lang)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* IMMEDIATELY ABOVE THE FOLD: Interactive Asymmetrical D3 Ego Graph + Source Side Panel */}
      <RelationsPanel
        entityId={id}
        entityName={primaryName}
        entityType={profile.entityType}
        lens={lens}
        setLens={setLens}
        lang={lang}
        history={graphHistory}
        onNavigateEntity={handleNavigateEntity}
        onGoBack={handleGoBack}
        onJumpHistory={handleJumpHistory}
      />

      {/* Lens bar sits cleanly below the hero graph so it filters Articles, Activity, Associated, and Graph */}
      <LensBar
        lens={lens}
        setLens={setLens}
        clearLens={clearLens}
        withEntityLabel={withLabel}
        lang={lang}
      />

      {/* Secondary detail panels: Articles (cols 1-8) + Activity & Associated (cols 9-12) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start pt-1">
        <div className="lg:col-span-8">
          <ArticlesPanel
            entityId={id}
            entityName={primaryName}
            lens={lens}
            setLens={setLens}
            lang={lang}
          />
        </div>
        <aside className="lg:col-span-4 space-y-7">
          <ActivityPanel entityId={id} lens={lens} setLens={setLens} lang={lang} />
          <AssociatedPanel
            entityId={id}
            centerName={primaryName}
            lens={lens}
            setLens={setLens}
            lang={lang}
          />
        </aside>
      </div>
    </div>
  );
}
