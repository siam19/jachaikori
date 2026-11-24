import type { ElementType } from 'react';
import { inferScript, outletScript, scriptRuns, type Script } from '../lib/scripts';

interface VerbatimProps {
  text: string;
  outlet?: string | null;
  base?: Script | 'mixed';
  as?: ElementType;
  className?: string;
}

/**
 * Renders published outlet text or card OCR text in ink (serif), strictly in its
 * original script. Never responds to the UI language toggle. Emits inner `<span lang>`
 * only for opposite-script runs >= 20 characters long (quoted sentences).
 */
export function Verbatim({ text, outlet, base, as: Tag = 'span', className = '' }: VerbatimProps) {
  const resolvedBase: Script =
    base === 'bn' || base === 'en'
      ? base
      : outlet
      ? outletScript(outlet)
      : inferScript(text, 'bn');

  const runs = scriptRuns(text, resolvedBase);
  const hasLongOpposite = runs.some((r) => r.lang !== resolvedBase && r.text.trim().length >= 20);

  return (
    <Tag lang={resolvedBase} className={`ink-text ${className}`.trim()}>
      {hasLongOpposite
        ? runs.map((r, i) =>
            r.lang !== resolvedBase && r.text.trim().length >= 20 ? (
              <span key={i} lang={r.lang}>
                {r.text}
              </span>
            ) : (
              <span key={i}>{r.text}</span>
            )
          )
        : text}
    </Tag>
  );
}
