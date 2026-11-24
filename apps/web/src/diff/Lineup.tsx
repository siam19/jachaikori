import type { VerificationSourceMatch } from '@jachaikori/schema';
import { outletLabel, tt, type Lang } from '../i18n/tt';
import { parseAmount, rulerX } from './amount';
import { Verbatim } from '../ui/Verbatim';

interface LineupProps {
  sources: VerificationSourceMatch[];
  lang: Lang;
}

interface ParsedPoint {
  raw: string;
  value: number;
  outlet?: string;
  isCard: boolean;
}

/**
 * Log-scale numeric ruler ("Where this figure sits").
 * Hollow ring above the line = card figure; filled dots below = outlet reports.
 * Equal values stack vertically. Falls back to calm chips if values cannot be parsed.
 */
export function Lineup({ sources, lang }: LineupProps) {
  const numDiffs = sources.flatMap((src) =>
    (src.diffs ?? [])
      .filter((d) => d.flag === 'mismatch_number' && d.cardSpan && d.articleSpan)
      .map((d) => ({ src, d }))
  );

  if (numDiffs.length === 0) return null;

  const points: ParsedPoint[] = [];
  const cardRaw = numDiffs[0]!.d.cardSpan!;
  const cardVal = parseAmount(cardRaw);
  if (cardVal !== null && cardVal > 0) {
    points.push({ raw: cardRaw, value: cardVal, isCard: true });
  }

  for (const { src, d } of numDiffs) {
    const val = parseAmount(d.articleSpan!);
    if (val !== null && val > 0) {
      points.push({ raw: d.articleSpan!, value: val, outlet: src.outlet, isCard: false });
    }
  }

  const reportPoints = points.filter((p) => !p.isCard);
  const canDrawRuler = cardVal !== null && cardVal > 0 && reportPoints.length > 0;

  if (!canDrawRuler) {
    return (
      <section className="clipping-surface p-4 space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-pencil">
          {tt('lineup.title', lang)}
        </h3>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-xl border border-rust px-2.5 py-1 bg-paper-raised text-rust">
            {tt('lineup.card', lang)}: <Verbatim text={cardRaw} />
          </span>
          {numDiffs.map(({ src, d }, i) => (
            <span
              key={`${src.articleId}-${i}`}
              className="rounded-xl border border-rule-strong px-2.5 py-1 bg-paper-raised text-ink"
            >
              {outletLabel(src.outlet, lang)}: <Verbatim text={d.articleSpan!} outlet={src.outlet} />
            </span>
          ))}
        </div>
      </section>
    );
  }

  const allValues = points.map((p) => p.value);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const lo = minVal * 0.7;
  const hi = maxVal * 1.4;

  const cardPct = 8 + rulerX(cardVal, lo, hi) * 84;

  // Group equal (within 2%) report figures into vertical stacks
  const stacks: Array<{ value: number; pct: number; items: ParsedPoint[] }> = [];
  for (const pt of reportPoints) {
    const existing = stacks.find(
      (s) => Math.abs(s.value - pt.value) / Math.max(s.value, pt.value, 1e-9) <= 0.02
    );
    if (existing) {
      existing.items.push(pt);
    } else {
      stacks.push({
        value: pt.value,
        pct: 8 + rulerX(pt.value, lo, hi) * 84,
        items: [pt],
      });
    }
  }

  return (
    <section
      className="clipping-surface p-4 sm:p-5 space-y-3"
      aria-label={tt('lineup.title', lang)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-pencil">
          {tt('lineup.title', lang)}
        </h3>
        <div className="flex items-center gap-3 text-[11px] text-pencil">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-rust bg-paper-raised" />
            {tt('lineup.card', lang)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" />
            {tt('lineup.reports', lang)}
          </span>
        </div>
      </div>

      {/* Log-scale ruler */}
      <div className="relative pt-8 pb-12 select-none">
        {/* Card marker above the ruler */}
        <div
          className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${cardPct}%` }}
        >
          <span className="whitespace-nowrap rounded-xl border border-rust/50 bg-paper-raised px-1.5 py-0.5 text-[11px] font-medium text-rust">
            <Verbatim text={cardRaw} />
          </span>
          <span className="mt-1 h-3 w-3 rounded-full border-2 border-rust bg-paper-raised" />
        </div>

        {/* Ruler axis */}
        <div className="h-[2px] w-full bg-rule-strong mt-4" />

        {/* Outlet report stacks below the ruler */}
        {stacks.map((stack, idx) => (
          <div
            key={idx}
            className="absolute top-[42px] -translate-x-1/2 flex flex-col items-center gap-1"
            style={{ left: `${stack.pct}%` }}
          >
            <div className="flex items-center gap-0.5">
              {stack.items.map((_, dotIdx) => (
                <span key={dotIdx} className="h-3 w-3 rounded-full bg-ink border border-paper-raised" />
              ))}
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="whitespace-nowrap text-xs font-medium text-ink">
                <Verbatim text={stack.items[0]!.raw} />
              </span>
              <span className="whitespace-nowrap text-[10px] text-pencil max-w-[140px] truncate">
                {stack.items.map((it) => outletLabel(it.outlet ?? '', lang)).join(', ')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
