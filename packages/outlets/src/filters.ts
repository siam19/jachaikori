/**
 * @file packages/outlets/src/filters.ts
 * Strict category/section URL allowlists per outlet.
 * Ensures sitemaps, daily archives, and cross-tagged feeds only retain in-scope
 * national, district/city, politics, court/governance, economy/business, and print news.
 * Excludes world/international, sports, entertainment, multimedia/video, lifestyle, opinion, and ads.
 */

import type { OutletId } from '@jachaikori/schema';

const KALER_KANTHO_ALLOWED = new Set([
  'online/national',
  'online/politics',
  'online/court',
  'online/business',
]);

const BANGLADESH_PROTIDIN_ALLOWED = new Set([
  'national',
  'minister-speech',
  'economy',
  'current-politics',
]);

const BUSINESS_STANDARD_ALLOWED = new Set([
  'bangladesh',
  'economy',
  'nbr',
  'markets',
  'agriculture',
  'top-news',
  'rohingya-crisis',
  'explainer',
  'analysis',
  'interviews',
  'environment',
]);

const BUSINESS_STANDARD_EXCLUDED_SUBSECTIONS = new Set([
  'economy/corporates',
  'economy/stocks',
]);

const JUGANTOR_ALLOWED = new Set([
  'national',
  'national-others',
  'country-news',
  'capital',
  'politics',
  'politics-others',
  'bnp',
  'ncp',
  'government',
  'crime',
  'court',
  'law',
  'economics',
  'economics-others',
  'corporate-news',
  'bank',
  'report',
  'tp-firstpage',
  'tp-lastpage',
  'tp-news',
]);

const PROTHOM_ALO_ALLOWED = new Set([
  'bangladesh',
  'politics',
  'business',
]);

const BDNEWS24_ALLOWED = new Set([
  'bangladesh',
  'politics',
  'economy',
  'business',
  'commerce',
  'stocks',
  'law-and-justice',
  'court',
  'ctg',
  'samagrabangladesh',
  '13th-parliamentary-election',
  'health',
  'environment',
]);

const DAILY_STAR_ALLOWED = new Set([
  'news/politics',
  'news/governance',
  'news/crime-justice',
  'news/accidents-and-fires',
  'news/accidents-fires',
  'news/bangladesh',
  'news/news',
  'news/power-and-energy',
  'news/transport',
  'news/monsoon-misery',
  'business/economy',
  'business/news',
  'business/startups',
  'business/organisation-news',
  'business/tax-and-customs',
  'business/banking',
  'business/agriculture',
  'tech-startup',
  'news/tech-startup',
]);

export const ITTEFAQ_ALLOWED_CATEGORY_SLUGS = new Set([
  'national',
  'country',
  'politics',
  'capital',
  'business',
  'economy',
  'news',
  'court',
  'law',
  'law-and-justice',
  'crime',
  'print-edition',
  'first-page',
  'last-page',
]);

/**
 * Extracts the normalized section key from an outlet's article URL.
 */
export function extractUrlSection(outlet: OutletId, url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    const first = parts[0].toLowerCase();
    const second = parts[1]?.toLowerCase() ?? '';

    if (outlet === 'kaler-kantho' && (first === 'online' || first === 'print-edition')) {
      return second ? `${first}/${second}` : first;
    }

    if (outlet === 'daily-star' && (first === 'news' || first === 'business')) {
      return second ? `${first}/${second}` : first;
    }

    return first;
  } catch {
    return null;
  }
}

/**
 * Checks whether an article URL belongs to an in-scope section for the given outlet.
 */
export function isAllowedArticleUrl(outlet: OutletId, url: string): boolean {
  const section = extractUrlSection(outlet, url);
  if (!section) return false;

  switch (outlet) {
    case 'kaler-kantho':
      return KALER_KANTHO_ALLOWED.has(section);
    case 'bangladesh-protidin':
      return BANGLADESH_PROTIDIN_ALLOWED.has(section);
    case 'business-standard': {
      if (!BUSINESS_STANDARD_ALLOWED.has(section)) return false;
      try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        if (parts.length >= 3) {
          const sub = `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
          if (BUSINESS_STANDARD_EXCLUDED_SUBSECTIONS.has(sub)) return false;
        }
      } catch {
        return false;
      }
      return true;
    }
    case 'jugantor':
      return JUGANTOR_ALLOWED.has(section);
    case 'prothom-alo':
      return PROTHOM_ALO_ALLOWED.has(section);
    case 'bdnews24':
      return BDNEWS24_ALLOWED.has(section);
    case 'daily-star':
      return DAILY_STAR_ALLOWED.has(section);
    case 'ittefaq':
      // Ittefaq article URLs are numeric-first (/820995/slug); category filtering happens via card DOM slug when present
      return /^\d+$/.test(section);
    default:
      return true;
  }
}
