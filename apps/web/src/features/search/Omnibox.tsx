import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Search, UserRound, X } from 'lucide-react';
import { entitySuggestQuery, searchArticlesQuery } from '../../api/queries';
import { tt, type Lang } from '../../i18n/tt';
import { OutletName } from '../../ui/OutletName';
import { Verbatim } from '../../ui/Verbatim';

interface OmniboxProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
}

export function Omnibox({ open, onClose, lang }: OmniboxProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
      setDebounced('');
    }
  }, [open]);

  const suggestQ = useQuery({
    ...entitySuggestQuery(query.trim()),
    enabled: open && query.trim().length >= 1,
  });

  const articlesQ = useQuery({
    ...searchArticlesQuery({ q: debounced, limit: 5 }),
    enabled: open && debounced.length >= 2,
  });

  const entities = suggestQ.data?.entities ?? [];
  const hits = articlesQ.data?.hits ?? [];
  const expanded = articlesQ.data?.expandedTerms ?? [];

  type Item =
    | { kind: 'entity'; id: string; label: string }
    | { kind: 'search'; q: string };

  const items: Item[] = [
    ...entities.map((e) => ({
      kind: 'entity' as const,
      id: e.id,
      label:
        lang === 'bn'
          ? e.canonicalBn || e.canonicalEn || e.id
          : e.canonicalEn || e.canonicalBn || e.id,
    })),
    ...(query.trim() ? [{ kind: 'search' as const, q: query.trim() }] : []),
  ];

  const selectItem = (item: Item) => {
    onClose();
    if (item.kind === 'entity') {
      navigate(`/entities/${encodeURIComponent(item.id)}`);
    } else {
      navigate(`/search?q=${encodeURIComponent(item.q)}`);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={tt('nav.search', lang)}
    >
      <div
        className="fixed inset-0 bg-ink/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-xl rounded-xl border border-rule-strong bg-paper shadow-2xl overflow-hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (items[activeIdx]) {
              selectItem(items[activeIdx]!);
            } else if (query.trim()) {
              onClose();
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            }
          }}
          className="flex items-center gap-2 border-b border-rule px-3.5 py-2.5 bg-paper-raised"
        >
          <Search className="h-4 w-4 text-pencil shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              }
            }}
            placeholder={tt('search.placeholder', lang)}
            className="flex-1 bg-transparent text-base text-ink placeholder:text-pencil outline-none min-h-[38px]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={tt('nav.close', lang)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </form>

        <div className="max-h-[65dvh] overflow-y-auto p-3 space-y-4">
          {expanded.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-pencil">
              <span>{tt('search.alsoSearched', lang)}:</span>
              {expanded.slice(0, 6).map((term) => (
                <span
                  key={term}
                  className="rounded-xl border border-rule bg-paper-raised px-2 py-0.5 text-ink"
                >
                  {term}
                </span>
              ))}
            </div>
          ) : null}

          {entities.length > 0 ? (
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-pencil">
                {tt('search.group.entities', lang)}
              </div>
              <ul className="m-0 p-0 list-none">
                {entities.map((ent, idx) => {
                  const name =
                    lang === 'bn'
                      ? ent.canonicalBn || ent.canonicalEn || ent.id
                      : ent.canonicalEn || ent.canonicalBn || ent.id;
                  const tagline =
                    lang === 'bn'
                      ? ent.shortTaglineBn || ent.shortTaglineEn
                      : ent.shortTaglineEn || ent.shortTaglineBn;
                  const active = idx === activeIdx;
                  return (
                    <li key={ent.id}>
                      <button
                        type="button"
                        onClick={() => selectItem({ kind: 'entity', id: ent.id, label: name })}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left cursor-pointer ${
                          active ? 'bg-paper-sunk text-ink' : 'hover:bg-paper-sunk/60 text-ink'
                        }`}
                      >
                        <UserRound className="h-4 w-4 text-pencil shrink-0" strokeWidth={1.5} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{name}</div>
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

          {hits.length > 0 ? (
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-pencil">
                {tt('search.group.articles', lang)}
              </div>
              <ul className="divide-y divide-rule m-0 p-0 list-none">
                {hits.map((hit) => (
                  <li key={hit.articleId} className="px-2 py-2 space-y-0.5">
                    <OutletName id={hit.outlet} lang={lang} className="text-[10px]" />
                    <a
                      href={hit.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-ink hover:underline line-clamp-1"
                    >
                      <Verbatim text={hit.title} outlet={hit.outlet} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {query.trim() ? (
            <button
              type="button"
              onClick={() => selectItem({ kind: 'search', q: query.trim() })}
              className={`flex w-full items-center justify-between rounded-xl border border-rule-strong px-3 py-2 text-xs font-medium text-ink cursor-pointer ${
                activeIdx === entities.length ? 'bg-ink text-paper' : 'bg-paper-raised hover:bg-paper-sunk'
              }`}
            >
              <span>
                {tt('nav.search', lang)}: “{query.trim()}”
              </span>
              <span>↵</span>
            </button>
          ) : (
            <p className="text-xs text-pencil px-2 py-2 m-0">{tt('search.placeholder', lang)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
