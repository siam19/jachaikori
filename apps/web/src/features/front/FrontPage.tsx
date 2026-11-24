import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowRight,
  ImagePlus,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { VerificationCheck } from '@jachaikori/schema';
import {
  entitySuggestQuery,
  eventsListQuery,
  healthQuery,
} from '../../api/queries';
import { verifyImage, verifyText } from '../../api/client';
import { ApiError, classify, type Failure } from '../../api/errors';
import { tt, type Lang } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate, formatRelativeTime } from '../../lib/dates';
import { useLang } from '../../lib/useLang';
import {
  downscaleIfLarge,
  MAX_UPLOAD_BYTES,
  SUPPORTED_IMAGE_TYPES,
} from '../../lib/downscale';
import { PressRun } from '../verify/PressRun';
import { Verbatim } from '../../ui/Verbatim';
import { StateCard } from '../../ui/StateCard';
import { Banner } from '../../ui/Banner';

export function FrontPage() {
  const [lang] = useLang();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [clientFailure, setClientFailure] = useState<Failure | null>(null);
  const [sharedNotice, setSharedNotice] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const healthQ = useQuery(healthQuery());
  const recentEventsQ = useQuery(eventsListQuery({ minOutlets: 2, limit: 9 }));
  const suggestQ = useQuery({
    ...entitySuggestQuery(query.trim()),
    enabled: focused && query.trim().length >= 2,
  });

  const onSuccessCheck = useCallback(
    (check: VerificationCheck) => {
      queryClient.setQueryData(['check', check.id], check);
      void queryClient.invalidateQueries({ queryKey: ['checks', 'popular'] });
      navigate(`/checks/${encodeURIComponent(check.id)}`, {
        state: { freshCheck: check },
      });
    },
    [navigate, queryClient]
  );

  const imageMutation = useMutation({
    mutationFn: async (file: File) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      return verifyImage({ file, signal: ctrl.signal });
    },
    retry: (failureCount, err) => {
      if (classify(err) === 'upstream' && failureCount < 2) {
        setRetryAttempt(failureCount + 1);
        return true;
      }
      return false;
    },
    retryDelay: (attempt) => 2000 * (attempt + 1),
    onSuccess: (data) => {
      setRetryAttempt(0);
      onSuccessCheck(data);
    },
    onError: () => {
      setRetryAttempt(0);
    },
  });

  const textVerifyMutation = useMutation({
    mutationFn: async (text: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      return verifyText({ text, signal: ctrl.signal });
    },
    retry: (failureCount, err) => {
      if (classify(err) === 'upstream' && failureCount < 2) {
        setRetryAttempt(failureCount + 1);
        return true;
      }
      return false;
    },
    retryDelay: (attempt) => 2000 * (attempt + 1),
    onSuccess: (data) => {
      setRetryAttempt(0);
      onSuccessCheck(data);
    },
    onError: () => {
      setRetryAttempt(0);
    },
  });

  const submitFile = useCallback(
    async (rawFile: File) => {
      setClientFailure(null);
      imageMutation.reset();
      textVerifyMutation.reset();

      if (!SUPPORTED_IMAGE_TYPES.has(rawFile.type)) {
        setClientFailure('bad_format');
        return;
      }

      let prepared = rawFile;
      try {
        prepared = await downscaleIfLarge(rawFile);
      } catch {
        // Fallback to raw file if bitmap decode fails
      }

      if (prepared.size > MAX_UPLOAD_BYTES) {
        setClientFailure('too_large');
        return;
      }

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(prepared));
      setLastFile(prepared);
      imageMutation.mutate(prepared);
    },
    [imageMutation, previewUrl, textVerifyMutation]
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Global Ctrl+V / Cmd+V photo paste directly on home page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            void submitFile(f);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [submitFile]);

  // PWA Android Share Target inbox pickup (`/?shared=1`)
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;
    let cancelled = false;
    (async () => {
      try {
        if (!('caches' in window)) return;
        const inbox = await caches.open('share-inbox');
        const imgRes = await inbox.match('/inbox/image');
        const txtRes = await inbox.match('/inbox/text');
        await inbox.delete('/inbox/image');
        await inbox.delete('/inbox/text');

        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('shared');
            return next;
          },
          { replace: true }
        );

        if (imgRes) {
          const blob = await imgRes.blob();
          const name = decodeURIComponent(imgRes.headers.get('x-filename') || 'shared-card.jpg');
          const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
          setSharedNotice(true);
          void submitFile(file);
        } else if (txtRes) {
          const sharedText = (await txtRes.text()).trim();
          if (sharedText) {
            setQuery(sharedText);
            setSharedNotice(true);
            textVerifyMutation.mutate(sharedText);
          }
        }
      } catch {
        // ignore cache errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, submitFile, textVerifyMutation]);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submitFile(file);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim();
    if (!clean) return;
    setFocused(false);
    navigate(`/search?q=${encodeURIComponent(clean)}`);
  };

  const handleCompareClaim = () => {
    const clean = query.trim();
    if (clean.length < 3) return;
    setFocused(false);
    setClientFailure(null);
    imageMutation.reset();
    textVerifyMutation.mutate(clean);
  };

  const isRunning = imageMutation.isPending || textVerifyMutation.isPending;
  const activeError =
    clientFailure ??
    (imageMutation.error ? classify(imageMutation.error) : null) ??
    (textVerifyMutation.error ? classify(textVerifyMutation.error) : null);

  const health = healthQ.data;
  const articlesCount = health?.counts.articles;
  const entitiesCount = health?.activeEntities ?? health?.counts.entities;
  const outletsCount = health?.outlets ?? 8;
  const lastUpdatedAt = health?.lastUpdatedAt;

  const recentEvents = recentEventsQ.data?.events ?? [];
  const suggestions = suggestQ.data?.entities ?? [];

  return (
    <div className="space-y-14 pb-8">
      {/* Centered clean search & photo-attach hero */}
      <section className="mx-auto max-w-2xl pt-8 sm:pt-14 space-y-5 text-center">
        <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight text-ink m-0">
          {lang === 'bn' ? 'যাচাই করি' : 'JachaiKori'}
        </h1>

        {sharedNotice ? (
          <div className="text-left">
            <Banner onDismiss={() => setSharedNotice(false)}>{tt('cap.shared', lang)}</Banner>
          </div>
        ) : null}

        {isRunning ? (
          <div className="text-left">
            <PressRun
              previewUrl={imageMutation.isPending ? previewUrl : null}
              previewText={textVerifyMutation.isPending ? query : null}
              retryAttempt={retryAttempt}
              lang={lang}
              onCancel={() => {
                abortRef.current?.abort();
                imageMutation.reset();
                textVerifyMutation.reset();
              }}
            />
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className="relative text-left"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void submitFile(f);
                e.target.value = '';
              }}
            />

            <form
              onSubmit={handleSearchSubmit}
              className={`search-bar-surface rounded-3xl transition-all ${
                dragActive
                  ? 'ring-2 ring-ink/50 bg-paper-sunk/60'
                  : 'focus-within:ring-2 focus-within:ring-ink/20'
              }`}
            >
              <div className="flex items-center gap-2 px-3 sm:px-4 py-2">
                <Search className="h-5 w-5 text-pencil shrink-0 ml-1" strokeWidth={1.6} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setTimeout(() => setFocused(false), 180)}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tt('home.searchPlaceholder', lang)}
                  aria-label={tt('home.searchPlaceholder', lang)}
                  className="flex-1 min-w-0 bg-transparent py-2.5 text-base text-ink placeholder:text-pencil/80 outline-none"
                />

                {/* Attach photo button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title={tt('home.attachPhoto', lang)}
                  aria-label={tt('home.attachPhoto', lang)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rule/80 bg-paper/80 px-3 py-2 text-xs font-medium text-ink hover:bg-paper-sunk transition-colors cursor-pointer shrink-0 min-h-[40px]"
                >
                  <ImagePlus className="h-4 w-4 text-pencil" strokeWidth={1.6} />
                  <span className="hidden sm:inline">{tt('home.attachPhoto', lang)}</span>
                </button>

                {/* Primary search button */}
                <button
                  type="submit"
                  disabled={!query.trim()}
                  aria-label={tt('nav.search', lang)}
                  className="inline-flex h-10 w-10 sm:w-auto sm:px-4 items-center justify-center gap-1.5 rounded-full bg-ink text-paper text-sm font-medium hover:opacity-90 disabled:opacity-35 transition-opacity cursor-pointer shrink-0"
                >
                  <span className="hidden sm:inline">{tt('nav.search', lang)}</span>
                  <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>

              {/* Optional secondary action when user types a longer claim */}
              {query.trim().length >= 12 ? (
                <div className="flex items-center justify-between gap-2 border-t border-rule/50 px-4 py-2 text-xs text-pencil">
                  <span className="truncate">{tt('app.tagline', lang)}</span>
                  <button
                    type="button"
                    onClick={handleCompareClaim}
                    className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunk/90 px-3 py-1 text-xs font-medium text-ink hover:bg-paper-sunk transition-colors cursor-pointer shrink-0"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                    <span>{tt('home.verifyClaim', lang)}</span>
                  </button>
                </div>
              ) : null}
            </form>

            {/* Subtle inline entity suggestions dropdown */}
            {focused && suggestions.length > 0 ? (
              <div className="absolute left-0 right-0 top-full mt-2 z-20 rounded-2xl border border-rule/80 bg-paper-raised shadow-xl p-2 space-y-1">
                <div className="px-3 py-1 text-[11px] font-medium text-pencil">
                  {tt('search.group.entities', lang)}
                </div>
                <ul className="m-0 p-0 list-none">
                  {suggestions.slice(0, 5).map((ent) => {
                    const name =
                      lang === 'bn'
                        ? ent.canonicalBn || ent.canonicalEn || ent.id
                        : ent.canonicalEn || ent.canonicalBn || ent.id;
                    const tagline =
                      lang === 'bn'
                        ? ent.shortTaglineBn || ent.shortTaglineEn
                        : ent.shortTaglineEn || ent.shortTaglineBn;
                    return (
                      <li key={ent.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            navigate(`/entities/${encodeURIComponent(ent.id)}`);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-paper-sunk/70 transition-colors cursor-pointer"
                        >
                          <UserRound className="h-4 w-4 text-pencil shrink-0" strokeWidth={1.6} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink truncate">{name}</div>
                            {tagline ? (
                              <div className="text-xs text-pencil truncate">{tagline}</div>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {/* Calm error card if upload/verify fails */}
        {activeError ? (
          <div className="text-left">
            <HomeErrorCard
              failure={activeError}
              lang={lang}
              rawError={imageMutation.error ?? textVerifyMutation.error}
              onRetry={() => {
                setClientFailure(null);
                if (lastFile) imageMutation.mutate(lastFile);
                else if (query.trim().length >= 3) textVerifyMutation.mutate(query.trim());
                else fileInputRef.current?.click();
              }}
            />
          </div>
        ) : null}

        {/* Live database stats line directly below the search bar */}
        <p className="text-xs sm:text-sm text-pencil m-0 pt-1">
          {articlesCount !== undefined && entitiesCount !== undefined
            ? tt('home.statsLine', lang, {
                articles: formatNumber(articlesCount, lang),
                entities: formatNumber(entitiesCount, lang),
                outlets: formatNumber(outletsCount, lang),
                ago: formatRelativeTime(lastUpdatedAt, lang),
              })
            : tt('app.about', lang)}
        </p>
      </section>

      {/* Single clean home section: Recent Events */}
      <section className="space-y-5 pt-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl sm:text-2xl font-medium text-ink m-0">
            {tt('home.recentEvents', lang)}
          </h2>
          <Link
            to="/events"
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-pencil hover:text-ink hover:bg-paper-sunk/70 transition-colors"
          >
            <span>{tt('front.seeAll', lang)}</span>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.6} />
          </Link>
        </div>

        {recentEventsQ.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-paper-sunk/70" />
            ))}
          </div>
        ) : recentEvents.length === 0 ? (
          <p className="text-sm text-pencil">{tt('empty.panel', lang)}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentEvents.map((ev) => (
              <Link
                key={ev.id}
                to={`/events/${encodeURIComponent(ev.id)}`}
                className="group block text-left"
              >
                <article className="clipping-surface rounded-2xl h-full p-5 flex flex-col justify-between gap-4 transition-all group-hover:-translate-y-0.5 group-hover:border-rule-strong/60">
                  <h3 className="font-read text-base sm:text-[17px] font-medium text-ink group-hover:underline leading-snug m-0 line-clamp-3">
                    <Verbatim text={ev.label} />
                  </h3>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-rule/50 text-xs text-pencil">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-paper-sunk/80 px-2.5 py-0.5 font-medium text-ink">
                        {tt('evt.articlesCount', lang, { n: ev.articleCount })}
                      </span>
                      <span>{tt('evt.outletsCount', lang, { n: ev.outletCount })}</span>
                    </div>
                    {ev.lastSeen ? (
                      <span>{formatDhakaDate(ev.lastSeen, lang, 'short')}</span>
                    ) : null}
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HomeErrorCard({
  failure,
  lang,
  rawError,
  onRetry,
}: {
  failure: Failure;
  lang: Lang;
  rawError?: unknown;
  onRetry: () => void;
}) {
  const keyMap = {
    bad_format: { title: 'err.badFormat.title', body: 'err.badFormat.body', action: 'err.badFormat.action' },
    too_large: { title: 'err.tooLarge.title', body: 'err.tooLarge.body', action: 'err.tooLarge.action' },
    upstream: { title: 'err.upstream.title', body: 'err.upstream.body', action: 'err.upstream.action' },
    offline: { title: 'err.offline.title', body: 'err.offline.body', action: 'err.offline.action' },
    not_found: { title: 'err.notFound.title', body: 'err.notFound.body', action: 'err.notFound.action' },
    unknown: { title: 'err.unknown.title', body: 'err.unknown.body', action: 'err.upstream.action' },
  } as const;

  const keys = keyMap[failure];
  const apiMsg =
    rawError instanceof ApiError &&
    rawError.body &&
    typeof rawError.body === 'object' &&
    'error' in rawError.body &&
    typeof (rawError.body as { error?: unknown }).error === 'string'
      ? (rawError.body as { error: string }).error
      : null;

  return (
    <StateCard
      title={tt(keys.title, lang)}
      body={apiMsg ? `${tt(keys.body, lang)} (${apiMsg})` : tt(keys.body, lang)}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center rounded-full bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90 cursor-pointer"
        >
          {tt(keys.action, lang)}
        </button>
      }
    />
  );
}
