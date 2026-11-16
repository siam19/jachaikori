/**
 * @file packages/outlets/src/outlets/prothom-alo.ts
 * Crawler and pure JSON/HTML parser for Prothom Alo (প্রথম আলো).
 * Steps backwards day-by-day using Unix millisecond timestamps via Quintype's
 * `/api/v1/advanced-search` endpoint (with HTML `/search` fallback).
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, OutletCrawler } from '../types';
import { extractUrlSection, isAllowedArticleUrl } from '../filters';

interface ProthomAloSearchStory {
  headline?: string;
  url?: string;
  slug?: string;
  'published-at'?: number;
}

interface ProthomAloSearchResponse {
  items?: ProthomAloSearchStory[];
  total?: number;
}

export class ProthomAloCrawler implements OutletCrawler {
  readonly id = 'prothom-alo' as const;
  readonly name = 'Prothom Alo';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 1200,
    notes: 'Quintype /api/v1/advanced-search and /search with Unix ms timestamps and offset pagination.',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'bangladesh',
      topic: 'national',
      url: 'https://www.prothomalo.com/search?sort=latest-published&section-id=17533%2C17535%2C17536%2C17538%2C22321%2C22236',
      mode: 'category',
    },
    {
      key: 'politics',
      topic: 'politics',
      url: 'https://www.prothomalo.com/search?sort=latest-published&section-id=22237',
      mode: 'category',
    },
    {
      key: 'economy',
      topic: 'economy',
      url: 'https://www.prothomalo.com/search?sort=latest-published&section-id=17552%2C17553%2C22324%2C22325%2C22326%2C26653%2C17556%2C17555%2C23382%2C23383%2C17560',
      mode: 'category',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and publication dates from
   * Quintype advanced-search JSON or rendered `/search` HTML.
   */
  parseListing(htmlOrJson: string, fallbackDateIso: string): ListItem[] {
    const trimmed = htmlOrJson.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as ProthomAloSearchResponse;
        if (Array.isArray(parsed.items)) {
          const items: ListItem[] = [];
          const seen = new Set<string>();
          for (const story of parsed.items) {
            const title = story.headline?.trim();
            let href = story.url?.trim() || (story.slug ? `https://www.prothomalo.com/${story.slug.replace(/^\//, '')}` : '');
            if (!href || !title) continue;
            if (href.startsWith('/')) href = `https://www.prothomalo.com${href}`;
            if (seen.has(href)) continue;
            seen.add(href);
            if (!isAllowedArticleUrl(this.id, href)) continue;

            const publishedAtRaw =
              typeof story['published-at'] === 'number'
                ? new Date(story['published-at']).toISOString()
                : fallbackDateIso;
            const category = extractUrlSection(this.id, href) ?? undefined;
            items.push({ url: href, title, publishedAtRaw, category });
          }
          return items;
        }
      } catch {
        // Fall back to HTML parser
      }
    }

    const $ = cheerio.load(htmlOrJson);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    $('.news_item_content, .story-card, div:has(> a.title-link)').each((_, el) => {
      const linkEl = $(el).find('a.title-link, a[href*="prothomalo.com/"]').first();
      let href = linkEl.attr('href');
      let title = $(el).find('h3.headline-title, a.title-link, .title').first().text().trim();

      if (!href || !title || href === '#' || href.includes('/search')) return;

      if (href.startsWith('/')) {
        href = `https://www.prothomalo.com${href}`;
      }

      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      if (!isAllowedArticleUrl(this.id, href)) return;

      const timeEl = $(el).find('time.published-time, time').first();
      const dateRaw = timeEl.text().trim() || fallbackDateIso;
      const category = extractUrlSection(this.id, href) ?? undefined;

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
   * Canonicalizes a Prothom Alo article URL.
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
   * Walks backwards day by day using Quintype's `/api/v1/advanced-search` with offset pagination.
   */
  async *crawl(source: SourceDef, ctx: CrawlContext): AsyncIterable<{
    items: ListItem[];
    nextCursor: string | null;
  }> {
    let currentDate: Date;
    if (ctx.cursor) {
      try {
        const parsed = JSON.parse(ctx.cursor);
        currentDate = new Date(parsed.date);
      } catch {
        currentDate = new Date();
      }
    } else {
      currentDate = new Date();
    }

    const sectionIds = new URL(source.url).searchParams.get('section-id') ?? '';
    const limit = 50;

    while (!ctx.signal?.aborted) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayIso = `${dateStr}T12:00:00+06:00`;

      // Asia/Dhaka is UTC+6
      const startOfDay = new Date(`${dateStr}T00:00:00+06:00`).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

      ctx.log.info(`Fetching Prothom Alo for ${dateStr} (${source.key})...`);

      const dayItems: ListItem[] = [];
      const seenDayUrls = new Set<string>();
      let offset = 0;

      while (offset < 500 && !ctx.signal?.aborted) {
        const apiUrl = `https://www.prothomalo.com/api/v1/advanced-search?section-id=${encodeURIComponent(
          sectionIds
        )}&published-after=${startOfDay}&published-before=${endOfDay}&offset=${offset}&limit=${limit}&sort=latest-published`;

        try {
          const rawJson = await ctx.fetchText(apiUrl, { signal: ctx.signal });
          const parsed = JSON.parse(rawJson) as ProthomAloSearchResponse;
          const rawCount = parsed.items?.length ?? 0;
          const total = parsed.total ?? 0;

          const batchItems = this.parseListing(rawJson, dayIso);
          for (const item of batchItems) {
            if (!seenDayUrls.has(item.url)) {
              seenDayUrls.add(item.url);
              dayItems.push(item);
            }
          }

          offset += limit;
          if (rawCount < limit || offset >= total) break;
        } catch (err: any) {
          ctx.log.warn(`Failed fetching Prothom Alo API for ${dateStr} (offset=${offset}): ${err.message}`);
          break;
        }
      }

      currentDate.setDate(currentDate.getDate() - 1);
      const nextDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      const nextCursor = JSON.stringify({ date: nextDateStr });

      yield {
        items: dayItems,
        nextCursor,
      };
    }
  }
}
