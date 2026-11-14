/**
 * @file packages/outlets/src/outlets/business-standard.ts
 * Crawler and pure HTML parser for The Business Standard (TBS).
 * Uses the day-by-day date archive endpoint: https://www.tbsnews.net/archive/<year>/<month>/<date>
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, OutletCrawler } from '../types';

export class BusinessStandardCrawler implements OutletCrawler {
  readonly id = 'business-standard';
  readonly name = 'The Business Standard';
  readonly policy = {
    robotsReviewedOn: '2026-11-14',
    crawlDelayMs: 1000,
    notes: 'Allows crawling archive with reasonable delay. Daily archive lists all articles for that calendar day.',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'archive',
      topic: 'general',
      url: 'https://www.tbsnews.net/archive',
      mode: 'archive',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and section hints from an archive page HTML.
   */
  parseListing(html: string, sourceUrl: string): ListItem[] {
    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    // Extract date from archive URL: e.g. https://www.tbsnews.net/archive/2026/10/30
    const dateMatch = sourceUrl.match(/\/archive\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const dateFallback = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}T12:00:00+06:00`
      : new Date().toISOString();

    // Iterate over cards
    $('.card, .card-list, .archive-contents .card').each((_, el) => {
      const titleLink = $(el).find('.card-title a, h4 a, h3 a').first();
      const href = titleLink.attr('href');
      const title = titleLink.text().trim();

      if (!href || !title) return;

      // Filter out non-article links
      if (href.startsWith('/archive') || href === '#') return;

      const fullUrl = href.startsWith('http') ? href : `https://www.tbsnews.net${href.startsWith('/') ? '' : '/'}${href}`;
      if (seenUrls.has(fullUrl)) return;
      seenUrls.add(fullUrl);

      const category = $(el).find('.date a, .category').first().text().trim() || undefined;

      items.push({
        url: fullUrl,
        title,
        publishedAtRaw: dateFallback,
        category,
      });
    });

    return items;
  }

  /**
   * Walks backwards day by day through the TBS daily archive.
   */
  async *crawl(source: SourceDef, ctx: CrawlContext): AsyncIterable<{
    items: ListItem[];
    nextCursor: string | null;
  }> {
    // Determine start date from cursor or default to current date in Asia/Dhaka
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

    while (!ctx.signal?.aborted) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const targetUrl = `https://www.tbsnews.net/archive/${year}/${month}/${day}`;

      ctx.log.info(`Fetching TBS daily archive for ${dateStr}...`);

      let html: string;
      try {
        html = await ctx.fetchText(targetUrl, { signal: ctx.signal });
      } catch (err: any) {
        ctx.log.error(`Failed to fetch ${targetUrl}: ${err.message}`);
        throw err;
      }

      const items = this.parseListing(html, targetUrl);

      // Advance one day backwards in time
      const nextDate = new Date(currentDate.getTime());
      nextDate.setDate(nextDate.getDate() - 1);
      const nextDateStr = nextDate.toISOString().slice(0, 10);

      yield {
        items,
        nextCursor: JSON.stringify({ date: nextDateStr }),
      };

      currentDate = nextDate;
    }
  }

  canonicalizeUrl(url: string): string {
    return url.replace(/#.*$/, '').replace(/\?.*$/, '');
  }
}
