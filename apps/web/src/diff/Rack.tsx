import { tt, type Lang } from '../i18n/tt';
import { formatNumber } from '../i18n/format';
import { FlagChip } from '../ui/Chip';
import { Verbatim } from '../ui/Verbatim';
import { formatMarker, type RackDiffEntry } from './partition';
import { parseIsoDateDay } from './amount';
import type { Script } from '../lib/scripts';

interface RackProps {
  entries: RackDiffEntry[];
  t: number;
  lang: Lang;
  cardScript: Script;
  articleScript: Script;
}

export function CertaintyGauge({ t, lang }: { t: number; lang: Lang }) {
  // Card sits at certain (100%), article sits at cautious (0%) or states (50%)
  const pos = (1 - t) * 100;
  return (
    <div className="w-full max-w-[260px]" aria-label={tt('flag.hedge', lang)}>
      <div className="relative h-5 flex items-center">
        <div className="h-[2px] w-full bg-rule-strong" />
        <span className="absolute left-0 h-2.5 w-[2px] bg-rule-strong" />
        <span className="absolute left-1/2 -translate-x-1/2 h-2.5 w-[2px] bg-rule-strong" />
        <span className="absolute right-0 h-2.5 w-[2px] bg-rule-strong" />
        {/* Hollow ring = card position */}
        <span
          className="absolute right-0 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-violet bg-paper-raised"
          title={tt('strip.asCard', lang)}
        />
        {/* Sliding dot controlled by scrubber --t */}
        <span
          className="absolute -translate-x-1/2 h-3 w-3 rounded-full bg-violet transition-[left] duration-150"
          style={{ left: `${pos}%` }}
          title={tt('strip.asReported', lang)}
        />
      </div>
      <div className="flex justify-between text-[11px] text-pencil mt-0.5">
        <span>{tt('gauge.cautious', lang)}</span>
        <span>{tt('gauge.stated', lang)}</span>
        <span>{tt('gauge.certain', lang)}</span>
      </div>
    </div>
  );
}

export function DateGapBar({
  cardSpan,
  articleSpan,
  t,
  lang,
}: {
  cardSpan: string;
  articleSpan: string;
  t: number;
  lang: Lang;
}) {
  const cDay = parseIsoDateDay(cardSpan);
  const aDay = parseIsoDateDay(articleSpan);
  const gapDays = cDay !== null && aDay !== null ? Math.abs(cDay - aDay) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono-data text-ink">{cardSpan}</span>
        <div className="relative flex-1 min-w-[80px] max-w-[160px] h-4 flex items-center">
          <div className="h-[2px] w-full border-b-2 border-dashed border-ochre" />
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ochre transition-[left] duration-150"
            style={{ left: `${t * 100}%` }}
          />
        </div>
        <span className="font-mono-data text-ochre font-medium">{articleSpan}</span>
      </div>
      {gapDays !== null && gapDays > 0 ? (
        <div className="text-[11px] text-pencil">{tt('date.gap', lang, { n: gapDays })}</div>
      ) : null}
    </div>
  );
}

/**
 * Non-span Rack directly beneath the Proof Strip.
 * Driven by the same `--t` scrubber value so Strip and Rack move in unison.
 */
export function Rack({ entries, t, lang, cardScript, articleScript }: RackProps) {
  if (entries.length === 0) return null;

  return (
    <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule bg-paper-raised">
      {entries.map(({ d, marker }) => {
        const explanation = lang === 'bn' ? d.explanationBn : d.explanationEn;

        return (
          <li key={`${d.flag}-${marker}`} className="p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-data text-xs text-pencil" aria-hidden="true">
                {formatMarker(marker)}
              </span>
              <FlagChip flag={d.flag} lang={lang} />

              {d.flag === 'missing_context' ? (
                <div className="inline-flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-pencil">{tt('strip.notOnCard', lang)}:</span>
                  <span
                    className="inline-block rounded-xl border border-dashed px-2 py-0.5 transition-all duration-150"
                    data-flag="missing_context"
                    style={{
                      borderColor: 'var(--flag)',
                      backgroundColor:
                        t >= 0.4 ? 'var(--flag-wash)' : 'transparent',
                      opacity: Math.max(0.35, t),
                    }}
                  >
                    <Verbatim
                      text={d.articleSpan || '…'}
                      base={articleScript}
                      className="text-xs font-medium"
                    />
                  </span>
                </div>
              ) : d.flag === 'hedging_shift' ? (
                <div className="flex-1 min-w-[200px]">
                  <CertaintyGauge t={t} lang={lang} />
                </div>
              ) : d.flag === 'mismatch_date' && d.cardSpan && d.articleSpan ? (
                <DateGapBar
                  cardSpan={d.cardSpan}
                  articleSpan={d.articleSpan}
                  t={t}
                  lang={lang}
                />
              ) : d.cardSpan || d.articleSpan ? (
                <div className="inline-flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="swap" data-flag={d.flag}>
                    <span className="swap-card">
                      <Verbatim text={d.cardSpan ?? '—'} base={cardScript} />
                    </span>
                    <span className="swap-reported" aria-hidden={t < 0.5}>
                      <Verbatim text={d.articleSpan ?? '—'} base={articleScript} />
                    </span>
                  </span>
                </div>
              ) : null}
            </div>

            <p className="text-xs text-pencil leading-relaxed pl-5">{explanation}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function diffGapLabel(days: number, lang: Lang): string {
  return tt('date.gap', lang, { n: formatNumber(days, lang) });
}
