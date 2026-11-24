import { Link } from 'react-router';
import { Bookmark, Trash2, X } from 'lucide-react';
import { tt, type Lang } from '../../i18n/tt';
import { useLang } from '../../lib/useLang';
import { formatDhakaDate } from '../../lib/dates';
import { useScrapbook } from './useScrapbook';
import { Clipping } from '../../ui/Clipping';
import { StateCard } from '../../ui/StateCard';
import type { Pin } from './store';

function pinHref(pin: Pin): string {
  if (pin.kind === 'check') return `/checks/${encodeURIComponent(pin.id)}`;
  if (pin.kind === 'entity') return `/entities/${encodeURIComponent(pin.id)}`;
  return `/events/${encodeURIComponent(pin.id)}`;
}

function pinKindLabel(kind: Pin['kind'], lang: Lang): string {
  if (kind === 'check') return tt('nav.check', lang);
  if (kind === 'entity') return tt('nav.people.short', lang);
  return tt('nav.events', lang);
}

export function ScrapbookPage() {
  const [lang] = useLang();
  const { pins, removePin, clearAll } = useScrapbook();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink m-0">
            {tt('scrap.title', lang)}
          </h1>
          <p className="text-sm text-pencil m-0">{tt('scrap.subtitle', lang)}</p>
        </div>
        {pins.length > 0 ? (
          <button
            type="button"
            onClick={() => void clearAll()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rule-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {tt('scrap.clearAll', lang)}
          </button>
        ) : null}
      </header>

      {pins.length === 0 ? (
        <StateCard
          dashed
          icon={<Bookmark className="h-5 w-5" strokeWidth={1.5} />}
          title={tt('scrap.title', lang)}
          body={tt('scrap.empty', lang)}
          action={
            <Link
              to="/"
              className="inline-flex items-center rounded-xl bg-ink text-paper px-3.5 py-2 text-xs font-medium hover:opacity-90"
            >
              {tt('nav.home', lang)}
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pins.map((pin) => (
            <Clipping key={`${pin.kind}-${pin.id}`} className="flex flex-col justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-pencil">
                  <span className="uppercase tracking-wider font-medium">
                    {pinKindLabel(pin.kind, lang)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removePin(pin.id)}
                    aria-label={tt('nav.close', lang)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-xl hover:bg-paper-sunk text-pencil hover:text-ink cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
                <Link
                  to={pinHref(pin)}
                  className="block font-read text-base font-medium text-ink hover:underline leading-snug"
                >
                  {pin.label[lang] || pin.label.en || pin.label.bn}
                </Link>
                {pin.subtitle ? (
                  <p className="text-xs text-pencil m-0 line-clamp-2">{pin.subtitle}</p>
                ) : null}
              </div>
              <div className="text-[11px] text-pencil border-t border-rule pt-2">
                {formatDhakaDate(new Date(pin.at).toISOString(), lang, 'medium')}
              </div>
            </Clipping>
          ))}
        </div>
      )}
    </div>
  );
}
