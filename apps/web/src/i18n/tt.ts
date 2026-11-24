import { en, type StringKey } from './en';
import { bn } from './bn';
import { formatNumber } from './format';

export type Lang = 'en' | 'bn';
export type { StringKey };

const DICTS: Record<Lang, Record<StringKey, string>> = { en, bn };

const PLURAL_RE = /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g;

/**
 * Translates a UI key with `{placeholder}` substitution and English ICU-lite
 * `{n, plural, one {...} other {...}}` support. Numeric values are localized
 * to Bangla digits (`০–৯`) when `lang === 'bn'`.
 */
export function tt(
  key: StringKey,
  lang: Lang,
  vars?: Record<string, string | number | null | undefined>
): string {
  let out = DICTS[lang][key] ?? en[key] ?? key;
  if (!vars) return out;

  out = out.replace(PLURAL_RE, (_, varName: string, oneForm: string, otherForm: string) => {
    const raw = vars[varName];
    const num = typeof raw === 'number' ? raw : Number(raw ?? 0);
    const chosen = num === 1 ? oneForm : otherForm;
    const formatted = formatNumber(num, lang);
    return chosen.replace(/#/g, formatted);
  });

  out = out.replace(/\{(\w+)\}/g, (match, varName: string) => {
    const val = vars[varName];
    if (val === undefined || val === null) return match;
    if (typeof val === 'number') return formatNumber(val, lang);
    return String(val);
  });

  return out;
}

export function outletLabel(outletId: string, lang: Lang): string {
  const key = `outlet.${outletId}` as StringKey;
  if (key in en) return tt(key, lang);
  return outletId;
}
