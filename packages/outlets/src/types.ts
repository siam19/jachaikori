/**
 * @file packages/outlets/src/types.ts
 * Defines the contract every news outlet module must implement.
 */

import type { OutletId, OutletPolicy, SourceDef, ListItem } from '@jachaikori/schema';

/**
 * Context provided to an outlet's crawler by the engine.
 * Decouples outlet-specific walking logic from global rate limiting, logging, and browser orchestration.
 */
export interface CrawlContext {
  /**
   * Polite HTTP GET request with retries and domain rate limiting.
   */
  fetchText(url: string, init?: RequestInit): Promise<string>;
  
  /**
   * Polite HTTP JSON request.
   */
  fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T>;

  /**
   * Optional browser-rendered HTML fetch (for Cloudflare-protected or JS-rendered pages).
   */
  fetchPageHtml?(url: string, options?: { waitForSelector?: string }): Promise<string>;

  /**
   * Saved cursor from the last batch or previous run (opaque JSON string).
   */
  cursor?: string | null;

  /**
   * Standardized structured logger.
   */
  log: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    debug(msg: string, meta?: Record<string, unknown>): void;
  };

  /**
   * Abort signal to cancel running batches cleanly.
   */
  signal?: AbortSignal;
}

/**
 * Result of parsing an article detail page.
 */
export interface ExtractedArticle {
  title: string;
  publishedAtRaw: string;
  publishedAtIso?: string | null;
  byline?: string | null;
  lead?: string | null;
  cleanText: string;
}

/**
 * Contract implemented by every outlet module.
 */
export interface OutletCrawler {
  readonly id: OutletId;
  readonly name: string;
  readonly policy: OutletPolicy;
  readonly defaultSources: SourceDef[];

  /**
   * Crawl a specific source backwards in time, yielding batches of list items.
   * Yields items newest to oldest. The engine decides when cutoff is reached.
   */
  crawl(source: SourceDef, ctx: CrawlContext): AsyncIterable<{
    items: ListItem[];
    nextCursor: string | null;
  }>;

  /**
   * Pure function: Parse a listing HTML/JSON response into ListItems without network I/O.
   */
  parseListing?(content: string, sourceUrl: string): ListItem[];

  /**
   * Pure function: Extract full article details from raw HTML.
   */
  extractArticle?(html: string, url: string): ExtractedArticle;

  /**
   * Outlet-specific canonical URL normalization rules (e.g. stripping tracking or print parameters).
   */
  canonicalizeUrl?(url: string): string;
}
