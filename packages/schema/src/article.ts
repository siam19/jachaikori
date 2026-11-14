/**
 * @file packages/schema/src/article.ts
 * Schemas for articles, ingested states, and catalog rows matching Cloudflare D1.
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';

/**
 * Ingestion lifecycle states for an article in SQLite / D1.
 */
export const ArticleStatusSchema = z.enum([
  'discovered',  // Harvested by crawler list scraper
  'fetched',     // Raw HTML downloaded and stored
  'extracted',   // Clean text, title, date, byline parsed
  'enriched',    // Claims and entities extracted, chunks prepared
  'indexed',     // Written to D1 FTS5 and Vectorize
  'failed',      // Fatal processing error
]);
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>;

/**
 * The canonical Article schema used by SQLite catalog, D1 database, and API.
 */
export const ArticleSchema = z.object({
  id: z.string().describe('Unique identifier, typically sha256 or uuid of canonical URL'),
  outlet: OutletIdSchema,
  canonicalUrl: z.string().url().describe('Normalized clean URL (no tracking params)'),
  originalUrl: z.string().url(),
  title: z.string().min(1).describe('Article headline'),
  publishedAt: z.string().nullable().describe('Normalized ISO 8601 published date in UTC or Asia/Dhaka'),
  publishedAtRaw: z.string().nullable().describe('Exact raw published string found on page'),
  fetchedAt: z.string().nullable().describe('ISO timestamp of download'),
  status: ArticleStatusSchema.default('discovered'),
  rawHtmlPointer: z.string().nullable().describe('R2 or local path to raw HTML'),
  cleanText: z.string().nullable().describe('Extracted main body article text'),
  byline: z.string().nullable().describe('Author or reporter byline'),
  pipelineVersion: z.string().default('v1'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Article = z.infer<typeof ArticleSchema>;

/**
 * Many-to-many relationship tracking which sources/categories an article appeared in.
 */
export const ArticleSourceSchema = z.object({
  articleId: z.string(),
  outlet: OutletIdSchema,
  sourceKey: z.string(),
  discoveredAt: z.string(),
});
export type ArticleSource = z.infer<typeof ArticleSourceSchema>;
