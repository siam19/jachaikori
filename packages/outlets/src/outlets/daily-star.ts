/**
 * @file packages/outlets/src/outlets/daily-star.ts
 * Crawler and pure HTML parser for The Daily Star.
 * Paginates Drupal 10 categories via Drupal Views AJAX endpoint (/views/ajax)
 * and extracts timestamps from time[datetime].
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
  tryNormalizeIsoDate,
} from '../extract-utils';

export class DailyStarCrawler implements OutletCrawler {
  readonly id = 'daily-star' as const;
  readonly name = 'The Daily Star';
  readonly policy = {
    robotsReviewedOn: '2026-11-15',
    crawlDelayMs: 1500,
    notes: 'Drupal categories paginated via /views/ajax endpoint. Clean HTML with exact ISO time[datetime].',
  };

  readonly defaultSources: SourceDef[] = [
    {
      key: 'politics',
      topic: 'politics',
      url: 'https://www.thedailystar.net/news/politics',
      mode: 'category',
    },
    {
      key: 'governance',
      topic: 'national',
      url: 'https://www.thedailystar.net/news/governance',
      mode: 'category',
    },
    {
      key: 'crime-justice',
      topic: 'law-courts',
      url: 'https://www.thedailystar.net/news/crime-justice',
      mode: 'category',
    },
    {
      key: 'economy',
      topic: 'economy',
      url: 'https://www.thedailystar.net/business/economy',
      mode: 'category',
    },
    {
      key: 'startups',
      topic: 'economy',
      url: 'https://www.thedailystar.net/business/startups',
      mode: 'category',
    },
    {
      key: 'accidents-and-fires',
      topic: 'general',
      url: 'https://www.thedailystar.net/news/accidents-and-fires',
      mode: 'category',
    },
  ];

  /**
   * Pure parser: extracts article headlines, URLs, and publication dates from HTML or Drupal AJAX JSON.
   */
  parseListing(htmlOrJson: string): ListItem[] {
    let html = htmlOrJson;
    const trimmed = htmlOrJson.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const showMoreCmd = parsed.find(
            (c: any) => (c.command === 'viewsShowMore' || c.command === 'insert') && c.data
          );
          if (showMoreCmd?.data) {
            html = showMoreCmd.data;
          }
        }
      } catch {
        // Fall back to treating as raw HTML
      }
    }

    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const seenUrls = new Set<string>();

    $('.card, .row, article, div:has(.card-title)').each((_, container) => {
      const linkEl = $(container)
        .find('.card-title a, h5 a, h4 a, h3 a, h2 a, h1 a, .title a')
        .first();
      let href = linkEl.attr('href');
      let title = linkEl.text().trim();

      if (!href || !title || href === '#' || !href.match(/-\d+$/) || title.length < 5) return;

      if (href.startsWith('/')) {
        href = `https://www.thedailystar.net${href}`;
      }

      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      if (!isAllowedArticleUrl(this.id, href)) return;

      // Prefer exact ISO datetime from time attribute: datetime="2026-11-14T18:13:26+06:00"
      const timeAttr = $(container).find('time[datetime]').first().attr('datetime');
      const dateRaw =
        timeAttr ||
        $(container).find('.date, time, span.date').first().text().trim() ||
        new Date().toISOString();

      let category = $(container).find('.card-info span, .category').last().text().trim() || undefined;
      // Exclude strings that look like date representations
      if (
        category &&
        (/\d{4}/.test(category) ||
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
            category
          ))
      ) {
        category = undefined;
      }

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
   * Pure extractor: parses full article title, published time, byline, and clean body from The Daily Star HTML.
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
      $('time.rsi-ago[datetime], time[datetime]').first().attr('datetime') ||
        $('meta[property="article:published_time"]').attr('content') ||
        ld?.datePublished ||
        ''
    );

    const rawDomByline = normalizeWhitespace($('.block-author-info-block').first().text());
    const domByline = rawDomByline.replace(/^(.+?)\s+\1$/, '$1');
    const byline = extractJsonLdAuthor(ld?.author) || domByline || null;

    const body = extractParagraphs($, '.block-field-blocknodenewsbody, .field--name-body');

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
   * Canonicalizes a Daily Star article URL.
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
   * Extracts Drupal Views AJAX configuration from the category page HTML.
   */
  private extractAjaxSettings(html: string): {
    viewName: string;
    viewDisplayId: string;
    viewArgs?: string;
  } {
    const $ = cheerio.load(html);
    let viewName = 'category_show_more';
    let viewDisplayId = 'block_1';
    let viewArgs: string | undefined;

    $('script[data-drupal-selector="drupal-settings-json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text());
        if (data.views?.ajaxViews) {
          const v = Object.values(data.views.ajaxViews)[0] as any;
          if (v) {
            if (v.view_name) viewName = v.view_name;
            if (v.view_display_id) viewDisplayId = v.view_display_id;
            if (v.view_args) viewArgs = String(v.view_args);
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    });

    return { viewName, viewDisplayId, viewArgs };
  }

  /**
   * Walks category pages forwards using Drupal Views AJAX pagination.
   */
  async *crawl(source: SourceDef, ctx: CrawlContext): AsyncIterable<{
    items: ListItem[];
    nextCursor: string | null;
  }> {
    let page = 0;
    let viewName = 'category_show_more';
    let viewDisplayId = 'block_1';
    let viewArgs: string | undefined;

    if (ctx.cursor) {
      try {
        const parsed = JSON.parse(ctx.cursor);
        page = parsed.page ?? 0;
        if (parsed.viewName) viewName = parsed.viewName;
        if (parsed.viewDisplayId) viewDisplayId = parsed.viewDisplayId;
        if (parsed.viewArgs) viewArgs = parsed.viewArgs;
      } catch {
        page = 0;
      }
    }

    while (!ctx.signal?.aborted) {
      if (page === 0) {
        // Initial page: fetch category HTML to get top articles and discover Drupal AJAX view settings
        ctx.log.info(`Fetching initial page for The Daily Star (${source.key}) from ${source.url}...`);
        let html: string;
        try {
          html = await ctx.fetchText(source.url);
        } catch (err: any) {
          ctx.log.error(`Failed to fetch initial The Daily Star page for ${source.key}: ${err.message}`);
          break;
        }

        const settings = this.extractAjaxSettings(html);
        viewName = settings.viewName;
        viewDisplayId = settings.viewDisplayId;
        viewArgs = settings.viewArgs;

        const items = this.parseListing(html);

        if (items.length === 0) {
          ctx.log.info(`The Daily Star category ${source.key} yielded 0 items.`);
          yield { items: [], nextCursor: null };
          break;
        }

        page = 1;
        const nextCursor = viewArgs
          ? JSON.stringify({ page: 1, viewName, viewDisplayId, viewArgs })
          : null;

        yield {
          items,
          nextCursor,
        };

        if (!viewArgs) {
          ctx.log.info(`No Drupal Views AJAX settings found for ${source.key}. Pagination complete.`);
          break;
        }
      } else {
        // Subsequent pages: paginate via Drupal AJAX endpoint
        if (!viewArgs) break;

        const ajaxUrl = `https://www.thedailystar.net/views/ajax?view_name=${encodeURIComponent(
          viewName
        )}&view_display_id=${encodeURIComponent(viewDisplayId)}&view_args=${encodeURIComponent(
          viewArgs
        )}&page=${page}&_drupal_ajax=1`;

        ctx.log.info(`Fetching The Daily Star AJAX page ${page} for ${source.key}...`);

        let ajaxRaw: string;
        try {
          ajaxRaw = await ctx.fetchText(ajaxUrl, {
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*; q=0.01',
            },
          });
        } catch (err: any) {
          ctx.log.error(`Failed to fetch The Daily Star AJAX page ${page} for ${source.key}: ${err.message}`);
          break;
        }

        const items = this.parseListing(ajaxRaw);

        if (items.length === 0) {
          ctx.log.info(`The Daily Star AJAX page ${page} for ${source.key} yielded 0 items. End of category.`);
          yield { items: [], nextCursor: null };
          break;
        }

        page++;
        const nextCursor = JSON.stringify({ page, viewName, viewDisplayId, viewArgs });

        yield {
          items,
          nextCursor,
        };
      }
    }
  }
}
