import type { Lang } from './tt';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

export function toBanglaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function formatNumber(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '—';
  const formatted = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-GB').format(n);
  return lang === 'bn' ? toBanglaDigits(formatted) : formatted;
}

export function formatPercent(ratio: number, lang: Lang): string {
  const pct = Math.round(ratio * 100);
  return `${formatNumber(pct, lang)}%`;
}
