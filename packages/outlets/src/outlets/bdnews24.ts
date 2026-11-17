/**
 * @file packages/outlets/src/outlets/bdnews24.ts
 * Crawler and pure HTML parser for bdnews24 (Bangla).
 * Uses the public REST pagination endpoint: https://bangla.bdnews24.com/archive/fetch
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, ExtractedArticle, OutletCrawler } from '../types';
import { isAllowedArticleUrl } from '../filters';
import {
  extractJsonLdArticles,
  extractJsonLdAuthor,
  extractParagraphs,
  normalizeWhitespace,
  splitArticleBody,
  tryNormalizeIsoDate,
} from '../extract-utils';

interface BdNewsArchiveResponse {
  html?: string;
}

export class BdNews24Crawler implements OutletCrawler {
  readonly id = 'bdnews24' as const;
  readonly name = 'bdnews24 (Bangla)';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 1200,
    notes: 'Public REST endpoint /archive/fetch. Section IDs: National (39002), Politics (37846), Economy (39123), Commerce (39367), Court (107363).',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'national',
      topic: 'national',
      url: 'https://bangla.bdnews24.com/archive?section_id=39002',
      mode: 'category',
    },
    {
      key: 'politics',
      topic: 'politics',
      url: 'https://bangla.bdnews24.com/archive?section_id=37846',
      mode: 'category',
    },
    {
      key: 'economy',
      topic: 'economy',
      url: 'https://bangla.bdnews24.com/archive?section_id=39123',
      mode: 'category',
    },
    {
      key: 'commerce',
      topic: 'economy',
      url: 'https://bangla.bdnews24.com/archive?section_id=39367',
      mode: 'category',
    },
    {
      key: 'court',
      topic: 'law-courts',
      url: 'https://bangla.bdnews24.com/archive?section_id=107363',
      mode: 'category',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and publication dates from HTML snippet.
   */
  parseListing(html: string): ListItem[] {
    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    $('.SubCat-wrapper, .col-md-3, .col-lg-3, .data-wrapper > div').each((_, el) => {
      const linkEl = $(el).find('a[href*="bangla.bdnews24.com/"], a[href^="/"]').first();
      let href = linkEl.attr('href');
      let title = $(el).find('h5, h6, .news-title, .title').first().text().trim();

      if (!href || !title || href.includes('/archive')) return;

      if (href.startsWith('/')) {
        href = `https://bangla.bdnews24.com${href}`;
      }

      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      if (!isAllowedArticleUrl(this.id, href)) return;

      const dateRaw = $(el).find('.date, span:contains("প্রকাশিত"), time').first().text().trim() || new Date().toISOString();
      const category = $(el).find('span').first().text().trim() || undefined;

      items.push({
        url: href,
        title,
        publishedAtRaw: dateRaw,
        category,
      });
    });

    return items;
  }

  /**
   * Pure extractor: parses full article title, published time, byline, and clean body from bdnews24 HTML.
   */
  extractArticle(html: string, _url: string): ExtractedArticle {
    const $ = cheerio.load(html);
    const ld = extractJsonLdArticles($)[0];

    const title = normalizeWhitespace(
      $('h1').first().text() ||
        ld?.headline ||
        $('meta[property="og:title"]').attr('content') ||
        ''
    );

    const publishedAtRaw = normalizeWhitespace(
      ld?.datePublished ||
        $('meta[property="article:published_time"]').attr('content') ||
        ''
    );

    const domByline = normalizeWhitespace($('.detail-author-name, .pub-up .author').first().text());
    const byline = domByline || extractJsonLdAuthor(ld?.author) || null;

    const domBody = extractParagraphs($, '.details-brief');
    const body = domBody.cleanText ? domBody : splitArticleBody(ld?.articleBody);

    return {
      title,
      publishedAtRaw,
      publishedAtIso: tryNormalizeIsoDate(publishedAtRaw),
      byline,
      lead: body.lead,
      cleanText: body.cleanText,
    };
  }

  /**
   * Canonicalizes a bdnews24 URL.
   */
  canonicalizeUrl(url: string): string {
    let clean = url.trim().replace(/^http:/, 'https:');
    try {
      const u = new URL(clean);
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    } catch {
      return clean.replace(/\/$/, '');
    }
  }

  /**
   * Crawls bdnews24 category sections via /archive/fetch offset pagination.
   */
  async *crawl(source: SourceDef, ctx: CrawlContext): AsyncIterable<{
    items: ListItem[];
    nextCursor: string | null;
  }> {
    let offset = 0;
    if (ctx.cursor) {
      try {
        const parsed = JSON.parse(ctx.cursor);
        offset = parsed.offset ?? 0;
      } catch {
        offset = 0;
      }
    }

    const sourceUrl = new URL(source.url);
    const sectionId = sourceUrl.searchParams.get('section_id') ?? '39002';
    const limit = 12;

    while (!ctx.signal?.aborted) {
      const fetchUrl = `https://bangla.bdnews24.com/archive/fetch?q=&section_id=${sectionId}&limit=${limit}&offset=${offset}`;

      ctx.log.info(`Fetching bdnews24 offset=${offset} (section ${sectionId})...`);

      let response: BdNewsArchiveResponse;
      try {
        response = await ctx.fetchJson<BdNewsArchiveResponse>(fetchUrl);
      } catch (err: any) {
        ctx.log.error(`Failed to fetch bdnews24 offset ${offset}: ${err.message}`);
        break;
      }

      if (!response || !response.html || response.html.trim().length === 0) {
        ctx.log.info(`bdnews24 offset ${offset} returned empty HTML. End of stream.`);
        yield { items: [], nextCursor: null };
        break;
      }

      const hasRawCards = response.html.includes('bangla.bdnews24.com/') || response.html.includes('SubCat-wrapper');
      const items = this.parseListing(response.html);

      if (!hasRawCards && items.length === 0) {
        ctx.log.info(`bdnews24 offset ${offset} yielded 0 items. End of stream.`);
        yield { items: [], nextCursor: null };
        break;
      }

      offset += limit;
      const nextCursor = JSON.stringify({ offset });

      yield {
        items,
        nextCursor,
      };
    }
  }
}
