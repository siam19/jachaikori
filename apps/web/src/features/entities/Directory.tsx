import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Dices, Search } from 'lucide-react';
import { entitiesListQuery } from '../../api/queries';
import { getRandomEntity } from '../../api/client';
import { tt, type StringKey } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { useLang } from '../../lib/useLang';
import { Clipping } from '../../ui/Clipping';
import { Chip } from '../../ui/Chip';

const ENTITY_TYPES = [
  { id: '', key: 'ent.type.all' },
  { id: 'person', key: 'ent.type.person' },
  { id: 'org', key: 'ent.type.org' },
  { id: 'location', key: 'ent.type.location' },
  { id: 'role', key: 'ent.type.role' },
  { id: 'event_topic', key: 'ent.type.event_topic' },
] as const;

export function EntitiesDirectory() {
  const [lang] = useLang();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [qInput, setQInput] = useState(sp.get('q') ?? '');

  const type = sp.get('type') ?? '';
  const q = sp.get('q') ?? '';
  const includeHubs = sp.get('hubs') === '1';

  const listQ = useQuery(
    entitiesListQuery({
      q: q || undefined,
      type: type || undefined,
      includeHubs,
      limit: 60,
    })
  );

  const surpriseMutation = useMutation({
    mutationFn: () => getRandomEntity(),
    onSuccess: (profile) => {
      navigate(`/entities/${encodeURIComponent(profile.id)}`);
    },
  });

  const updateParam = (key: string, value: string | null) => {
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true }
    );
  };

  const entities = listQ.data?.entities ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink m-0">
            {tt('ent.dir.title', lang)}
          </h1>
          <p className="text-sm text-pencil m-0">{tt('ent.dir.subtitle', lang)}</p>
        </div>

        <button
          type="button"
          disabled={surpriseMutation.isPending}
          onClick={() => surpriseMutation.mutate()}
          className="inline-flex items-center gap-2 rounded-full border border-rule/80 bg-paper-raised px-4 py-2 text-sm font-medium text-ink hover:bg-paper-sunk cursor-pointer min-h-[42px] shadow-xs disabled:opacity-50 transition-colors"
        >
          <Dices className="h-4 w-4 text-pencil" strokeWidth={1.6} />
          <span>{tt('ent.surprise', lang)}</span>
        </button>
      </header>

      {/* Filters */}
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParam('q', qInput.trim() || null);
          }}
          className="flex flex-wrap items-center gap-2.5"
        >
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pencil"
              strokeWidth={1.6}
            />
            <input
              type="search"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                if (e.target.value === '') updateParam('q', null);
              }}
              placeholder={tt('ent.dir.search', lang)}
              className="w-full rounded-full border border-rule/80 bg-paper-raised pl-10 pr-4 py-2 text-sm text-ink placeholder:text-pencil min-h-[44px] shadow-xs outline-none focus:border-ink/40"
            />
          </div>
          <Chip
            active={includeHubs}
            onClick={() => updateParam('hubs', includeHubs ? null : '1')}
            title={tt('ent.hub.tip', lang)}
          >
            {tt('ent.hub.toggle', lang)}
          </Chip>
        </form>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt('ent.type.all', lang)}>
          {ENTITY_TYPES.map((t) => (
            <Chip
              key={t.id || 'all'}
              active={type === t.id}
              onClick={() => updateParam('type', t.id || null)}
            >
              {tt(t.key, lang)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Results grid */}
      {listQ.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-paper-sunk" />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <p className="text-sm text-pencil py-6">{tt('empty.panel', lang)}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entities.map((ent) => {
            const primary =
              lang === 'bn'
                ? ent.canonicalBn || ent.canonicalEn || ent.id
                : ent.canonicalEn || ent.canonicalBn || ent.id;
            const secondary = lang === 'bn' ? ent.canonicalEn : ent.canonicalBn;
            const tagline =
              lang === 'bn'
                ? ent.shortTaglineBn || ent.shortTaglineEn
                : ent.shortTaglineEn || ent.shortTaglineBn;
            const typeKey = `ent.type.${ent.entityType}` as StringKey;

            return (
              <Link
                key={ent.id}
                to={`/entities/${encodeURIComponent(ent.id)}`}
                className="group block text-left"
              >
                <Clipping className="h-full flex flex-col justify-between gap-2.5 transition-all group-hover:-translate-y-0.5 group-hover:border-rule-strong/60">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-pencil">
                      <span className="rounded-full bg-paper-sunk/70 px-2.5 py-0.5 font-medium text-ink">
                        {tt(typeKey, lang)}
                      </span>
                      {ent.isHub ? (
                        <span className="rounded-full border border-rule/80 px-2 py-0.5 text-[10px]">
                          {tt('ent.hub.badge', lang)}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="font-display text-lg font-medium text-ink group-hover:underline m-0 leading-snug">
                      {primary}
                    </h2>
                    {secondary && secondary !== primary ? (
                      <div className="text-xs text-pencil">{secondary}</div>
                    ) : null}
                    {tagline ? (
                      <p className="text-xs text-pencil m-0 line-clamp-2 pt-0.5">{tagline}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono-data text-pencil border-t border-rule pt-2">
                    <span>
                      {formatNumber(ent.articleCount, lang)} {tt('ent.stats.articles', lang)}
                    </span>
                    {ent.eventCount ? (
                      <>
                        <span>·</span>
                        <span>
                          {formatNumber(ent.eventCount, lang)} {tt('ent.stats.events', lang)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </Clipping>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
