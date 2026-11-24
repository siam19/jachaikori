import { useMemo, useState, type CSSProperties } from 'react';
import type { ClaimDiffItem } from '@jachaikori/schema';
import { tt, type Lang } from '../i18n/tt';
import { Verbatim } from '../ui/Verbatim';
import { formatMarker, partitionDiffs } from './partition';
import { Rack } from './Rack';
import type { Script } from '../lib/scripts';

interface ProofStripProps {
  headline: string;
  diffs: ClaimDiffItem[];
  cardScript: Script;
  articleScript: Script;
  lang: Lang;
}

/**
 * The signature Proof Strip: renders the card's own sentence once.
 * Unchanged words stay perfectly still; only differing spans roll between
 * "As on the card" (t = 0) and "As reported" (t = 1).
 * Always clearly framed as "Card wording, with the outlet's figure".
 */
export function ProofStrip({
  headline,
  diffs,
  cardScript,
  articleScript,
  lang,
}: ProofStripProps) {
  const [t, setT] = useState(0);
  const { inline, rack } = useMemo(() => partitionDiffs(headline, diffs), [headline, diffs]);

  const segments = useMemo(() => {
    if (!headline || inline.length === 0) return null;
    const out: Array<
      | { kind: 'same'; text: string }
      | { kind: 'swap'; text: string; reported: string; diff: ClaimDiffItem; marker: number }
    > = [];
    let cur = 0;
    for (const item of inline) {
      if (item.at > cur) {
        out.push({ kind: 'same', text: headline.slice(cur, item.at) });
      }
      out.push({
        kind: 'swap',
        text: item.d.cardSpan!,
        reported: item.d.articleSpan!,
        diff: item.d,
        marker: item.marker,
      });
      cur = item.at + item.d.cardSpan!.length;
    }
    if (cur < headline.length) {
      out.push({ kind: 'same', text: headline.slice(cur) });
    }
    return out;
  }, [headline, inline]);

  const hasDiffs = inline.length > 0 || rack.length > 0;
  if (!hasDiffs) return null;

  const isReported = t >= 0.5;

  return (
    <figure className="proof m-0 space-y-2.5" style={{ '--t': t } as CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
        <span className="uppercase tracking-wider text-[11px] font-medium">
          {isReported ? tt('strip.caption', lang) : tt('strip.asCard', lang)}
        </span>
        <div
          className="inline-flex rounded-xl border border-rule-strong bg-paper-raised overflow-hidden"
          role="group"
          aria-label={tt('strip.scrub', lang)}
        >
          <button
            type="button"
            onClick={() => setT(0)}
            aria-pressed={!isReported}
            className={`px-2.5 py-1 text-xs cursor-pointer transition-colors ${
              !isReported ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('strip.asCard', lang)}
          </button>
          <button
            type="button"
            onClick={() => setT(1)}
            aria-pressed={isReported}
            className={`px-2.5 py-1 text-xs cursor-pointer transition-colors border-s border-rule-strong ${
              isReported ? 'bg-ink text-paper font-medium' : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            {tt('strip.asReported', lang)}
          </button>
        </div>
      </div>

      {/* Sentence in ink — unchanged words never move */}
      {headline ? (
        <div className="clipping-ink-rule py-1">
          <p className="ink-text text-base sm:text-[17px] leading-relaxed m-0" lang={cardScript}>
            {segments ? (
              segments.map((seg, i) =>
                seg.kind === 'same' ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <span
                    key={i}
                    className="swap"
                    data-flag={seg.diff.flag}
                    title={lang === 'bn' ? seg.diff.explanationBn : seg.diff.explanationEn}
                  >
                    <span className="swap-card">
                      {seg.text}
                      <sup className="font-mono-data text-[10px] ml-0.5 text-pencil">
                        {formatMarker(seg.marker)}
                      </sup>
                    </span>
                    <span className="swap-reported" aria-hidden={!isReported}>
                      {seg.reported}
                      <sup className="font-mono-data text-[10px] ml-0.5">
                        {formatMarker(seg.marker)}
                      </sup>
                    </span>
                  </span>
                )
              )
            ) : (
              <Verbatim text={headline} base={cardScript} />
            )}
          </p>
        </div>
      ) : null}

      {/* Native accessible range scrubber */}
      <div className="flex items-center gap-3 pt-0.5">
        <span className="text-[11px] text-pencil shrink-0">{tt('strip.asCard', lang)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={t}
          className="scrub flex-1"
          aria-label={tt('strip.scrub', lang)}
          onChange={(e) => setT(Number(e.target.value))}
          onPointerUp={() => setT((cur) => (cur < 0.5 ? 0 : 1))}
          onKeyUp={() => setT((cur) => (cur < 0.5 ? 0 : 1))}
        />
        <span className="text-[11px] text-pencil shrink-0">{tt('strip.asReported', lang)}</span>
      </div>

      <figcaption className="sr-only" aria-live="polite">
        {tt(isReported ? 'strip.asReported' : 'strip.asCard', lang)}
      </figcaption>

      {/* Non-span Rack driven by the exact same scrubber */}
      <Rack
        entries={rack}
        t={t}
        lang={lang}
        cardScript={cardScript}
        articleScript={articleScript}
      />
    </figure>
  );
}
