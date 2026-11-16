/**
 * @file packages/outlets/src/outlets/jugantor.ts
 * Crawler and pure HTML parser for Daily Jugantor (দৈনিক যুগান্তর).
 * Paginates archive queries day-by-day via dateFrom/dateTo and page=N parameters.
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, OutletCrawler } from '../types';
import { extractUrlSection, isAllowedArticleUrl } from '../filters';

export class JugantorCrawler implements OutletCrawler {
  readonly id = 'jugantor' as const;
  readonly name = 'Daily Jugantor';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 2000,
    notes: 'Archive search query (dateFrom, dateTo, page=N). Uses Playwright for Cloudflare bypass with 2000ms delay.',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'archive',
      topic: 'general',
      url: 'https://www.jugantor.com/archive',
      mode: 'archive',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and Bangla publication dates from HTML.
   */
  parseListing(html: string, fallbackDateIso: string): ListItem[] {
    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    $('.media.positionRelative, .media, div:has(> .media-body)').each((_, el) => {
      const linkEl = $(el).find('a.linkOverlay, a[href*="jugantor.com/"], a[href^="/"]').first();
      let href = linkEl.attr('href');
      let title = $(el).find('h4.title10, .media-body a, h4').first().text().trim();

      if (!href || !title || href === '#' || href.includes('/archive')) return;

      if (href.startsWith('/')) {
        href = `https://www.jugantor.com${href}`;
      }

      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      if (!isAllowedArticleUrl(this.id, href)) return;

      const dateRaw = $(el).find('p.desktopTime, .time').first().text().trim() || fallbackDateIso;
      const category =
        $(el).find('.category').first().text().trim() ||
        extractUrlSection(this.id, href) ||
        undefined;

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
   * Canonicalizes a Jugantor article URL.
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
   * Walks backwards day by day through Jugantor archive search queries,
   * paginating all pages for each day until exhausted.
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

    while (!ctx.signal?.aborted) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayIso = `${dateStr}T12:00:00+06:00`;

      ctx.log.info(`Fetching Daily Jugantor archive for ${dateStr}...`);

      const dayItems: ListItem[] = [];
      const seenDayUrls = new Set<string>();
      const seenRawUrls = new Set<string>();

      // Paginate up to 25 pages per day until no new raw cards appear
      for (let page = 1; page <= 25; page++) {
        if (ctx.signal?.aborted) break;

        const targetUrl = `https://www.jugantor.com/archive?search=yes&headline=&dateFrom=${dateStr}+00%3A00&dateTo=${dateStr}+23%3A59&page=${page}`;

        let html: string;
        try {
          if (ctx.fetchPageHtml) {
            html = await ctx.fetchPageHtml(targetUrl, { waitForSelector: '.media' });
          } else {
            html = await ctx.fetchText(targetUrl, { signal: ctx.signal });
          }
        } catch (err: any) {
          ctx.log.warn(`Failed fetching Jugantor page ${page} for ${dateStr}: ${err.message}`);
          break;
        }

        // Check raw links before allowlist filtering so an off-topic page does not prematurely stop pagination
        const rawLinks = [...html.matchAll(/href="(https?:\/\/www\.jugantor\.com\/[^"#?]+|\/[^"#?]+)"/g)]
          .map((m) => m[1])
          .filter((u) => !u.includes('/archive'));
        let newRawOnPage = 0;
        for (const rawLink of rawLinks) {
          if (!seenRawUrls.has(rawLink)) {
            seenRawUrls.add(rawLink);
            newRawOnPage++;
          }
        }
        if (newRawOnPage === 0) break;

        const items = this.parseListing(html, dayIso);
        for (const item of items) {
          if (!seenDayUrls.has(item.url)) {
            seenDayUrls.add(item.url);
            dayItems.push(item);
          }
        }

        // Stop if no "Next" pagination link exists on the page
        if (!html.includes(`page=${page + 1}`)) break;
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
