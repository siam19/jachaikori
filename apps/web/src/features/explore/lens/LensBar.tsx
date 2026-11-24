import { Filter } from 'lucide-react';
import { tt, type Lang, type StringKey } from '../../../i18n/tt';
import { isLensActive, type Lens } from '../../../lib/useLens';
import { Chip } from '../../../ui/Chip';

interface LensBarProps {
  lens: Lens;
  setLens: (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => void;
  clearLens: () => void;
  withEntityLabel?: string;
  lang: Lang;
}

export function LensBar({ lens, setLens, clearLens, withEntityLabel, lang }: LensBarProps) {
  const active = isLensActive(lens);

  return (
    <div
      className="sticky top-16 z-20 rounded-full border border-rule/75 bg-paper-raised/95 backdrop-blur-md shadow-xs py-2 px-4"
      aria-label={tt('lens.label', lang)}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-pencil mr-1">
          <Filter className="h-3.5 w-3.5" strokeWidth={1.6} />
          {tt('lens.label', lang)}
        </span>

        {lens.from || lens.to ? (
          <Chip active onRemove={() => setLens({ from: null, to: null })}>
            {tt('lens.dates', lang, { from: lens.from ?? '…', to: lens.to ?? '…' })}
          </Chip>
        ) : null}

        {lens.with ? (
          <Chip active onRemove={() => setLens({ with: null })}>
            {tt('lens.with', lang, { name: withEntityLabel ?? lens.with })}
          </Chip>
        ) : null}

        {lens.role ? (
          <Chip active onRemove={() => setLens({ role: null })}>
            {tt(`ent.art.role.${lens.role}` as StringKey, lang)}
          </Chip>
        ) : null}

        {lens.cat && lens.cat !== 'all' ? (
          <Chip active onRemove={() => setLens({ cat: null })}>
            {tt(`ent.rel.cat.${lens.cat}` as StringKey, lang)}
          </Chip>
        ) : null}

        <Chip
          active={lens.hubs}
          onClick={() => setLens({ hubs: !lens.hubs })}
          title={tt('ent.hub.tip', lang)}
        >
          {tt('ent.hub.toggle', lang)}
        </Chip>

        {active ? (
          <button
            type="button"
            onClick={clearLens}
            className="ml-auto rounded-full px-2.5 py-1 text-xs text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer"
          >
            {tt('lens.clear', lang)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
