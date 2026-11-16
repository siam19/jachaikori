/**
 * @file packages/outlets/src/outlets/bangladesh-protidin.ts
 * Crawler and pure XML/HTML parser for Bangladesh Pratidin (বাংলাদেশ প্রতিদিন).
 * Walks day-by-day backwards through official daily sitemaps:
 * https://www.bd-pratidin.com/daily-sitemap/<YYYY-MM-DD>/sitemap.xml
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, OutletCrawler } from '../types';
import { extractUrlSection, isAllowedArticleUrl } from '../filters';

export class BangladeshProtidinCrawler implements OutletCrawler {
  readonly id = 'bangladesh-protidin' as const;
  readonly name = 'Bangladesh Pratidin';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 1500,
    notes: 'Walks backwards day-by-day through official daily sitemaps (https://www.bd-pratidin.com/daily-sitemap/YYYY-MM-DD/sitemap.xml).',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'archive',
      topic: 'general',
      url: 'https://www.bd-pratidin.com/daily-sitemap',
      mode: 'archive',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and dates from sitemap XML or category HTML.
   */
  parseListing(content: string, fallbackDateIso?: string): ListItem[] {
    const isXml = content.includes('<?xml') || content.includes('<urlset') || content.includes('<sitemap');
    const $ = cheerio.load(content, { xmlMode: isXml });
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    if (isXml) {
      $('url').each((_, el) => {
        const loc = $(el).find('loc').text().trim();
        const title = $(el).find('news\\:title, title').text().trim();
        const dateRaw =
          $(el).find('news\\:publication_date, publication_date').text().trim() ||
          fallbackDateIso ||
          new Date().toISOString();

        if (!loc || !title || loc.includes('/sitemap') || seenUrls.has(loc)) return;
        seenUrls.add(loc);
        if (!isAllowedArticleUrl(this.id, loc)) return;

        const category = extractUrlSection(this.id, loc) ?? undefined;

        items.push({
          url: loc,
          title,
          publishedAtRaw: dateRaw,
          category,
        });
      });
      return items;
    }

    // HTML fallback
    $('a[href*="/202"]').each((_, el) => {
      let href = $(el).attr('href');
      let title = $(el).text().trim();

      if (!href || !title || href === '#' || title.length < 5) return;

      if (href.startsWith('/')) {
        href = `https://www.bd-pratidin.com${href}`;
      }

      if (!href.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/\d+/)) return;
      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      if (!isAllowedArticleUrl(this.id, href)) return;

      const dateMatch = href.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
      const dateIso = dateMatch
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}T12:00:00+06:00`
        : fallbackDateIso ?? new Date().toISOString();

      items.push({
        url: href,
        title,
        publishedAtRaw: dateIso,
      });
    });

    return items;
  }

  /**
   * Canonicalizes a Bangladesh Pratidin article URL.
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
   * Walks backwards day by day through daily sitemaps.
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

    let emptyDays = 0;

    while (!ctx.signal?.aborted && emptyDays < 5) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayIso = `${dateStr}T12:00:00+06:00`;
      const targetUrl = `https://www.bd-pratidin.com/daily-sitemap/${dateStr}/sitemap.xml`;

      ctx.log.info(`Fetching Bangladesh Pratidin daily sitemap for ${dateStr}...`);

      let content: string;
      try {
        if (ctx.fetchPageHtml) {
          content = await ctx.fetchPageHtml(targetUrl);
        } else {
          content = await ctx.fetchText(targetUrl);
        }
      } catch (err: any) {
        ctx.log.warn(`Failed fetching Bangladesh Pratidin sitemap for ${dateStr}: ${err.message}`);
        content = '';
      }

      const items = content ? this.parseListing(content, dayIso) : [];

      if (items.length === 0) {
        emptyDays++;
      } else {
        emptyDays = 0;
      }

      currentDate.setDate(currentDate.getDate() - 1);
      const nextDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      const nextCursor = JSON.stringify({ date: nextDateStr });

      yield {
        items,
        nextCursor,
      };
    }
  }
}
