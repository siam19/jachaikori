/**
 * @file packages/outlets/src/extract-utils.ts
 * Pure, runtime-agnostic HTML & JSON-LD extraction helpers shared across all outlet extractors.
 */

import type { CheerioAPI } from 'cheerio';

export interface JsonLdArticle {
  '@type'?: string | string[];
  headline?: string;
  name?: string;
  datePublished?: string;
  dateCreated?: string;
  dateModified?: string;
  author?: unknown;
  articleBody?: string;
}

/**
 * Normalizes whitespace in a single line/paragraph, converting NBSPs to spaces.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses all `<script type="application/ld+json">` blocks and returns Article/NewsArticle objects.
 */
export function extractJsonLdArticles($: CheerioAPI): JsonLdArticle[] {
  const results: JsonLdArticle[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue;
        const typeVal = (item as JsonLdArticle)['@type'];
        const types = Array.isArray(typeVal) ? typeVal : typeVal ? [typeVal] : [];
        if (types.some((t) => String(t).toLowerCase().includes('article'))) {
          results.push(item as JsonLdArticle);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  });

  return results;
}

/**
 * Extracts a clean author/byline string from a JSON-LD `author` field.
 */
export function extractJsonLdAuthor(author: unknown): string | null {
  if (!author) return null;

  const names: string[] = [];
  const list = Array.isArray(author) ? author : [author];

  for (const entry of list) {
    if (typeof entry === 'string') {
      const clean = normalizeWhitespace(entry);
      if (clean) names.push(clean);
    } else if (entry && typeof entry === 'object' && 'name' in entry) {
      const nameVal = (entry as { name?: unknown }).name;
      if (typeof nameVal === 'string') {
        const clean = normalizeWhitespace(nameVal);
        if (clean) names.push(clean);
      }
    }
  }

  return names.length > 0 ? [...new Set(names)].join(', ') : null;
}

/**
 * Attempts to normalize a raw date string to an ISO 8601 string if parseable by `Date`.
 */
export function tryNormalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Preserve explicit ISO timestamps with timezone offset or Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : trimmed;
  }

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const DEFAULT_PROMO_PATTERNS = [
  /^আরও পড়ুন[:ঃ]/,
  /^Read more[:ঃ]/i,
  /^Follow .+ on Google News/i,
  /^Keep updated, follow/i,
];

export interface ParagraphExtractOptions {
  /**
   * If true, collects paragraphs across all elements matching `containerSelector`
   * (e.g. Prothom Alo `.story-element-text`). Defaults to false (uses `.first()`).
   */
  allContainers?: boolean;
  /**
   * Additional regexes for boilerplate/promo paragraphs to drop.
   */
  ignorePatterns?: RegExp[];
}

/**
 * Extracts clean paragraphs, lead paragraph, and joined `cleanText` from a DOM container.
 */
export function extractParagraphs(
  $: CheerioAPI,
  containerSelector: string,
  options: ParagraphExtractOptions = {}
): { paragraphs: string[]; lead: string | null; cleanText: string } {
  const containers = options.allContainers
    ? $(containerSelector)
    : $(containerSelector).first();

  const paragraphs: string[] = [];
  const seen = new Set<string>();
  const ignorePatterns = [...DEFAULT_PROMO_PATTERNS, ...(options.ignorePatterns ?? [])];

  containers.each((_, container) => {
    const pEls = $(container).find('p');
    if (pEls.length > 0) {
      pEls.each((_, pEl) => {
        // Skip paragraphs nested inside ad/related/figcaption/blockquote-promo widgets
        if (
          $(pEl).closest(
            'script, style, noscript, figcaption, .hide-for-print, [class*="related"], [class*="advertisement"], [class*="promo"]'
          ).length > 0
        ) {
          return;
        }

        const text = normalizeWhitespace($(pEl).text());
        if (!text || text.length < 2) return;
        if (ignorePatterns.some((re) => re.test(text))) return;
        if (seen.has(text)) return;
        seen.add(text);
        paragraphs.push(text);
      });
    } else {
      // Fallback if container holds direct text without <p> tags
      const cloned = $(container).clone();
      cloned.find('script, style, noscript, .hide-for-print').remove();
      const text = normalizeWhitespace(cloned.text());
      if (text && !ignorePatterns.some((re) => re.test(text)) && !seen.has(text)) {
        seen.add(text);
        paragraphs.push(text);
      }
    }
  });

  return {
    paragraphs,
    lead: paragraphs[0] ?? null,
    cleanText: paragraphs.join('\n\n'),
  };
}

/**
 * Splits a plain-text JSON-LD `articleBody` into paragraphs and lead.
 */
export function splitArticleBody(body: string | null | undefined): {
  lead: string | null;
  cleanText: string;
} {
  if (!body) return { lead: null, cleanText: '' };
  const paragraphs = body
    .split(/\r?\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
  return {
    lead: paragraphs[0] ?? null,
    cleanText: paragraphs.join('\n\n'),
  };
}
