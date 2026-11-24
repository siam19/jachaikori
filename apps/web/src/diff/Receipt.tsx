import { useState } from 'react';
import type { ClaimDiffItem, VerificationSourceMatch } from '@jachaikori/schema';
import { ChevronDown, ChevronUp, ExternalLink, Scale, Sparkles } from 'lucide-react';
import { tt, type Lang } from '../i18n/tt';
import { formatDhakaDate } from '../lib/dates';
import { formatPercent } from '../i18n/format';
import { outletScript } from '../lib/scripts';
import { Verbatim } from '../ui/Verbatim';
import { OutletName } from '../ui/OutletName';
import { FlagChip } from '../ui/Chip';

interface ReceiptProps {
  source: VerificationSourceMatch;
  lang: Lang;
  defaultOpen?: boolean;
}

function HighlightedSnippet({
  snippet,
  spans,
  outlet,
}: {
  snippet: string;
  spans: Array<{ text: string; flag: ClaimDiffItem['flag'] }>;
  outlet: string;
}) {
  const valid = spans
    .map((s) => ({ ...s, idx: s.text ? snippet.indexOf(s.text) : -1 }))
    .filter((s) => s.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (valid.length === 0) {
    return <Verbatim text={snippet} outlet={outlet} as="p" className="text-sm leading-relaxed m-0" />;
  }

  const parts: Array<{ text: string; flag?: ClaimDiffItem['flag'] }> = [];
  let cur = 0;
  for (const hit of valid) {
    if (hit.idx < cur) continue;
    if (hit.idx > cur) parts.push({ text: snippet.slice(cur, hit.idx) });
    parts.push({ text: hit.text, flag: hit.flag });
    cur = hit.idx + hit.text.length;
  }
  if (cur < snippet.length) parts.push({ text: snippet.slice(cur) });

  return (
    <p className="ink-text text-sm leading-relaxed m-0" lang={outletScript(outlet)}>
      {parts.map((p, i) =>
        p.flag ? (
          <mark
            key={i}
            data-flag={p.flag}
            className="rounded-lg px-0.5 text-ink"
            style={{
              backgroundColor: 'var(--flag-wash)',
              borderBottom: '2px solid var(--flag)',
            }}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  );
}

/**
 * Expandable evidence Receipt for a matched accredited article.
 * Verbatim snippet stays in ink; our explanations, method badge, and model confidence sit in pencil.
 */
export function Receipt({ source, lang, defaultOpen = false }: ReceiptProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showMeta, setShowMeta] = useState(false);

  const diffs = source.diffs ?? [];
  const mismatches = diffs.filter((d) => d.flag !== 'match');
  const matches = diffs.filter((d) => d.flag === 'match');

  const highlightSpans = mismatches
    .filter((d) => Boolean(d.articleSpan))
    .map((d) => ({ text: d.articleSpan!, flag: d.flag }));

  return (
    <div className="mt-3 border-t border-rule pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline cursor-pointer min-h-[36px]"
      >
        <span>{tt('rec.title', lang)}</span>
        <span className="text-pencil">
          · {open ? tt('rec.hide', lang) : tt('rec.show', lang)}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-pencil" strokeWidth={1.5} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-pencil" strokeWidth={1.5} />
        )}
      </button>

      {open ? (
        <div className="mt-3 space-y-4 rounded-xl border border-rule bg-paper p-3.5 sm:p-4 torn-edge">
          {/* Original verbatim snippet in ink */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-pencil">
              <div className="flex items-center gap-2">
                <span className="uppercase tracking-wider text-[10px] font-medium">
                  {tt('rec.original', lang)}
                </span>
                <span>·</span>
                <OutletName id={source.outlet} lang={lang} />
                {source.publishedAt ? (
                  <>
                    <span>·</span>
                    <span>{formatDhakaDate(source.publishedAt, lang, 'medium')}</span>
                  </>
                ) : null}
              </div>
              <a
                href={source.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-ink underline underline-offset-2 hover:text-pencil"
              >
                <span>{tt('src.open', lang)}</span>
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
              </a>
            </div>

            <div className="clipping-ink-rule py-1">
              <HighlightedSnippet
                snippet={source.snippet}
                spans={highlightSpans}
                outlet={source.outlet}
              />
            </div>
          </div>

          {/* Diff notes in pencil */}
          {mismatches.length > 0 ? (
            <div className="space-y-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-pencil">
                {tt('rec.ours', lang)}
              </div>
              <ul className="space-y-2">
                {mismatches.map((d, idx) => (
                  <li
                    key={`${d.flag}-${idx}`}
                    className="rounded-xl border border-rule bg-paper-raised p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FlagChip flag={d.flag} lang={lang} />
                      <span
                        title={tt(d.deterministic ? 'method.rule.tip' : 'method.model.tip', lang)}
                        className="inline-flex items-center gap-1 text-[11px] text-pencil"
                      >
                        {d.deterministic ? (
                          <Scale className="h-3 w-3" strokeWidth={1.5} />
                        ) : (
                          <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                        )}
                        {tt(d.deterministic ? 'method.rule' : 'method.model', lang)}
                      </span>
                    </div>

                    {d.cardSpan || d.articleSpan ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {d.cardSpan ? (
                          <div className="rounded-lg border border-rule bg-paper px-2.5 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-pencil mb-0.5">
                              {tt('rec.cardSays', lang)}
                            </div>
                            <Verbatim text={d.cardSpan} className="text-sm" />
                          </div>
                        ) : null}
                        {d.articleSpan ? (
                          <div className="rounded-lg border border-rule bg-paper px-2.5 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-pencil mb-0.5">
                              {tt('rec.articleSays', lang)}
                            </div>
                            <Verbatim
                              text={d.articleSpan}
                              outlet={source.outlet}
                              className="text-sm"
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <p className="text-xs text-pencil leading-relaxed m-0">
                      {lang === 'bn' ? d.explanationBn : d.explanationEn}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Quiet "Also matched" row */}
          {matches.length > 0 ? (
            <div className="space-y-1.5 border-t border-rule pt-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-pencil">
                {tt('rec.alsoMatched', lang)}
              </div>
              <div className="flex flex-wrap gap-2">
                {matches.map((m, idx) => (
                  <FlagChip
                    key={idx}
                    flag="match"
                    lang={lang}
                    detail={m.cardSpan ? `· ${m.cardSpan}` : undefined}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Tucked technical details (confidence + relevance) */}
          <div className="border-t border-rule pt-2">
            <button
              type="button"
              onClick={() => setShowMeta((v) => !v)}
              className="text-[11px] text-pencil underline underline-offset-2 hover:text-ink cursor-pointer"
            >
              {showMeta ? tt('rec.hide', lang) : tt('rec.show', lang)} ({tt('src.relevance', lang)})
            </button>
            {showMeta ? (
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-pencil font-mono-data">
                <span title={tt('src.relevance.tip', lang)}>
                  {tt('src.relevance', lang)}: {formatPercent(source.rerankScore, lang)}
                </span>
                {diffs.length > 0 ? (
                  <span>
                    {tt('rec.confidence', lang)}:{' '}
                    {formatPercent(
                      diffs.reduce((sum, d) => sum + d.confidence, 0) / diffs.length,
                      lang
                    )}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
