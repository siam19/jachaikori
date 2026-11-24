import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Link2, Trash2 } from 'lucide-react';
import { tt, type Lang } from '../../../i18n/tt';
import { trailStopHref, useTrail } from './TrailContext';

export function TrailBar({ lang }: { lang: Lang }) {
  const { stops, clearTrail, encodeTrailUrl } = useTrail();
  const [copied, setCopied] = useState(false);

  if (stops.length < 2) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(encodeTrailUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <aside
      aria-label={tt('trail.label', lang)}
      className="fixed bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-3xl rounded-full border border-rule/80 bg-paper-raised/95 backdrop-blur-md shadow-lg px-4 py-2"
    >
      <div className="flex items-center gap-2 text-xs min-w-0">
        <span className="shrink-0 font-medium text-pencil uppercase tracking-wider text-[10px]">
          {tt('trail.label', lang)}
        </span>
        <nav className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden whitespace-nowrap py-0.5">
          {stops.length > 4 ? (
            <span className="text-pencil shrink-0 px-0.5" aria-hidden="true">
              … ›
            </span>
          ) : null}
          {stops.slice(-4).map((stop, idx) => (
            <span key={`${stop.kind}-${stop.id}`} className="inline-flex items-center gap-1 min-w-0 max-w-[155px]">
              {idx > 0 ? <span className="text-rule-strong shrink-0">›</span> : null}
              <Link
                to={trailStopHref(stop)}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ink hover:bg-paper-sunk min-w-0 truncate transition-colors"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-ink/50 shrink-0" />
                <span className="truncate">{stop.label[lang] || stop.label.en || stop.label.bn}</span>
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-1 shrink-0 border-s border-rule/70 pl-2">
          <button
            type="button"
            onClick={handleCopy}
            title={tt('trail.copyLink', lang)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-sage" strokeWidth={1.6} />
            ) : (
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.6} />
            )}
            <span className="hidden sm:inline">
              {copied ? tt('res.copied', lang) : tt('trail.copyLink', lang)}
            </span>
          </button>
          <button
            type="button"
            onClick={clearTrail}
            title={tt('trail.clear', lang)}
            aria-label={tt('trail.clear', lang)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </aside>
  );
}
