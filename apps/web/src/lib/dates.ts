import type { Lang } from '../i18n/tt';
import { formatNumber, toBanglaDigits } from '../i18n/format';

const DHAKA_TZ = 'Asia/Dhaka';

export function formatDhakaDate(
  iso: string | null | undefined,
  lang: Lang,
  style: 'short' | 'medium' | 'long' | 'full' | 'datetime' = 'medium'
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  let opts: Intl.DateTimeFormatOptions;
  if (style === 'full') {
    opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: DHAKA_TZ };
  } else if (style === 'long') {
    opts = { day: 'numeric', month: 'long', year: 'numeric', timeZone: DHAKA_TZ };
  } else if (style === 'short') {
    opts = { day: 'numeric', month: 'short', timeZone: DHAKA_TZ };
  } else if (style === 'datetime') {
    opts = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: DHAKA_TZ,
    };
  } else {
    opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: DHAKA_TZ };
  }

  const out = new Intl.DateTimeFormat(locale, opts).format(d);
  return lang === 'bn' ? toBanglaDigits(out) : out;
}

export function formatDhakaDayIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: DHAKA_TZ,
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return y && m && day ? `${y}-${m}-${day}` : null;
}

export function formatLag(minutes: number, lang: Lang): string {
  if (minutes === 0) return lang === 'bn' ? '+০মি' : '+0m';
  if (minutes < 60) {
    const n = formatNumber(minutes, lang);
    return lang === 'bn' ? `+${n}মি` : `+${n}m`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) {
    const hn = formatNumber(h, lang);
    return lang === 'bn' ? `+${hn}ঘ` : `+${hn}h`;
  }
  const hn = formatNumber(h, lang);
  const mn = formatNumber(m, lang);
  return lang === 'bn' ? `+${hn}ঘ ${mn}মি` : `+${hn}h ${mn}m`;
}

export function formatRelativeTime(iso: string | null | undefined, lang: Lang, nowMs = Date.now()): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const diffSec = Math.max(1, Math.floor((nowMs - ms) / 1000));

  if (diffSec < 60) {
    const n = formatNumber(diffSec, lang);
    return lang === 'bn' ? `${n} সেকেন্ড আগে` : `${n} ${diffSec === 1 ? 'second' : 'seconds'} ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    const n = formatNumber(diffMin, lang);
    return lang === 'bn' ? `${n} মিনিট আগে` : `${n} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const n = formatNumber(diffHr, lang);
    return lang === 'bn' ? `${n} ঘণ্টা আগে` : `${n} ${diffHr === 1 ? 'hour' : 'hours'} ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  const n = formatNumber(diffDays, lang);
  return lang === 'bn' ? `${n} দিন আগে` : `${n} ${diffDays === 1 ? 'day' : 'days'} ago`;
}
