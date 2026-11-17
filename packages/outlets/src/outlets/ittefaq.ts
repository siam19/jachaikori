/**
 * @file packages/outlets/src/outlets/ittefaq.ts
 * Crawler and pure HTML/JSON parser for Daily Ittefaq (দৈনিক ইত্তেফাক).
 * Walks day-by-day backwards through https://www.ittefaq.com.bd/archive/<YYYY-MM-DD>
 * and paginates through daily contents via /api/theme_engine/get_ajax_contents JSON-wrapped HTML.
 */

import * as cheerio from 'cheerio';
import type { ListItem, SourceDef } from '@jachaikori/schema';
import type { CrawlContext, ExtractedArticle, OutletCrawler } from '../types';
import { ITTEFAQ_ALLOWED_CATEGORY_SLUGS, isAllowedArticleUrl } from '../filters';
import {
  extractJsonLdArticles,
  extractJsonLdAuthor,
  extractParagraphs,
  normalizeWhitespace,
  tryNormalizeIsoDate,
} from '../extract-utils';

interface IttefaqAjaxResponse {
  total?: number;
  finished?: boolean;
  html?: string;
}

export class IttefaqCrawler implements OutletCrawler {
  readonly id = 'ittefaq' as const;
  readonly name = 'Daily Ittefaq';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 1500,
    notes: 'Archive endpoints (/archive/YYYY-MM-DD) + JadeWits AJAX pagination (/api/theme_engine/get_ajax_contents) with 1500ms delay.',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'archive',
      topic: 'general',
      url: 'https://www.ittefaq.com.bd/archive',
      mode: 'archive',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and section hints from an archive page
   * or JSON-wrapped AJAX snippet (`{"total":20,"finished":false,"html":"..."}`).
   */
  parseListing(htmlOrJson: string, fallbackDateIso: string): ListItem[] {
    let html = htmlOrJson;
    const trimmed = htmlOrJson.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as IttefaqAjaxResponse;
        html = parsed.html ?? '';
      } catch {
        // Treat as raw HTML if JSON parsing fails
      }
    }

    if (!html) return [];

    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    // Ittefaq renders articles in card boxes (.each, .archive_post, .news_item, .each_box, or .col-sm-6)
    $('.each, .archive_post, .news_item, .each_news, .each_box, .col-sm-6, .col-md-4, .row > div').each((_, el) => {
      const linkEl = $(el).find('a.link_overlay, a[href*="ittefaq.com.bd/"], a[href^="/"]').first();
      let href = linkEl.attr('href');
      let title =
        $(el).find('h2, h3, h4, .title').first().text().trim() ||
        linkEl.attr('title')?.trim() ||
        linkEl.text().trim();

      if (!href || !title || href === '#' || href.includes('/archive/')) return;

      // Normalize protocol-relative or relative URLs
      if (href.startsWith('//')) {
        href = `https:${href}`;
      } else if (href.startsWith('/')) {
        href = `https://www.ittefaq.com.bd${href}`;
      }

      if (!href.match(/ittefaq\.com\.bd\/\d+\//)) return;
      if (seenUrls.has(href)) return;
      seenUrls.add(href);

      if (!isAllowedArticleUrl(this.id, href)) return;

      const catEl = $(el).find('a.category, .category, .sec_title, .tag').first();
      const catHref = catEl.attr('href');
      if (catHref) {
        try {
          const fullCatUrl = catHref.startsWith('//')
            ? `https:${catHref}`
            : catHref.startsWith('/')
              ? `https://www.ittefaq.com.bd${catHref}`
              : catHref;
          const slug = new URL(fullCatUrl).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
          if (slug && !ITTEFAQ_ALLOWED_CATEGORY_SLUGS.has(slug)) {
            return;
          }
        } catch {
          // Ignore malformed category href
        }
      }

      const category = catEl.text().trim() || undefined;

      items.push({
        url: href,
        title,
        publishedAtRaw: fallbackDateIso,
        category,
      });
    });

    return items;
  }

  /**
   * Pure extractor: parses full article title, published time, byline, and clean body from Daily Ittefaq HTML.
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
        $('.published_time, .time').first().text() ||
        ''
    );

    const domByline = normalizeWhitespace($('.author_n_share .author, .author').first().text());
    const byline = domByline || extractJsonLdAuthor(ld?.author) || null;

    const body = extractParagraphs($, '.jw_article_body, article.jw_detail_content_holder');

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
   * Canonicalizes an Ittefaq article URL.
   */
  canonicalizeUrl(url: string): string {
    let clean = url.trim().replace(/^http:/, 'https:').replace(/^(\/\/)/, 'https://');
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
   * Walks backwards day by day through the Ittefaq daily archive and AJAX batches.
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
      const targetUrl = `https://www.ittefaq.com.bd/archive/${dateStr}`;

      ctx.log.info(`Fetching Daily Ittefaq archive for ${dateStr}...`);

      const dayItems: ListItem[] = [];
      const seenDayUrls = new Set<string>();

      try {
        // 1. Fetch base archive page over plain HTTP
        const html = await ctx.fetchText(targetUrl, { signal: ctx.signal });
        const widgetId = html.match(/ajax_load_more_(\d+)/)?.[1] ?? '565';

        const initialItems = this.parseListing(html, dayIso);
        for (const item of initialItems) {
          if (!seenDayUrls.has(item.url)) {
            seenDayUrls.add(item.url);
            dayItems.push(item);
          }
        }

        // 2. Paginate through all remaining AJAX batches for this day
        const batchSize = 40;
        let offset = 20;

        while (offset <= 300 && !ctx.signal?.aborted) {
          const ajaxUrl = `https://www.ittefaq.com.bd/api/theme_engine/get_ajax_contents?widget=${widgetId}&start=${offset}&count=${batchSize}&page_id=0&subpage_id=0&author=0&tags=&archive_time=${dateStr}&filter=`;
          try {
            const ajaxRaw = await ctx.fetchText(ajaxUrl, { signal: ctx.signal });
            let finished = false;
            let rawHtml = ajaxRaw;
            try {
              const parsed = JSON.parse(ajaxRaw) as IttefaqAjaxResponse;
              finished = Boolean(parsed.finished);
              rawHtml = parsed.html ?? '';
            } catch {
              // Not JSON
            }

            if (!rawHtml || !rawHtml.includes('ittefaq.com.bd/')) break;

            const ajaxItems = this.parseListing(ajaxRaw, dayIso);
            for (const item of ajaxItems) {
              if (!seenDayUrls.has(item.url)) {
                seenDayUrls.add(item.url);
                dayItems.push(item);
              }
            }

            if (finished) break;
          } catch {
            break;
          }
          offset += batchSize;
        }
      } catch (err: any) {
        ctx.log.warn(`Failed fetching Daily Ittefaq for ${dateStr}: ${err.message}`);
      }

      // Step cursor back 1 calendar day
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
