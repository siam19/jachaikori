/**
 * @file packages/schema/src/crawler.ts
 * Schemas for crawler tasks, list items harvested from archive/listing pages, and job execution states.
 */

import { z } from 'zod';
import { OutletIdSchema, TopicSchema } from './outlet';

/**
 * Definition of a harvestable source section (e.g. politics category or daily archive).
 */
export const SourceDefSchema = z.object({
  key: z.string().describe('Unique source slug within the outlet, e.g. "national" or "archive"'),
  topic: TopicSchema.describe('Standardized shared topic'),
  url: z.string().url().describe('Target base URL for crawling'),
  mode: z.enum(['category', 'archive', 'sitemap', 'api']).default('category').describe('Harvesting strategy mode'),
});
export type SourceDef = z.infer<typeof SourceDefSchema>;

/**
 * An article reference harvested from an index/listing page.
 */
export const ListItemSchema = z.object({
  url: z.string().url().describe('Direct link to the article'),
  title: z.string().min(1).describe('Headline as shown on listing'),
  publishedAtRaw: z.string().describe('Raw timestamp or date string as displayed (Bangla or English)'),
  category: z.string().optional().describe('Listing section or badge label if present'),
});
export type ListItem = z.infer<typeof ListItemSchema>;

/**
 * Status of a crawling job cursor.
 */
export const JobStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'failed',
  'blocked',
  'needs_review',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * Persistent cursor state saved to SQLite after each batch.
 */
export const CrawlJobSchema = z.object({
  id: z.string().describe('Composite job key, e.g. "prothom-alo:national"'),
  outlet: OutletIdSchema,
  sourceKey: z.string(),
  status: JobStatusSchema,
  cursor: z.string().nullable().describe('Serialized cursor JSON for resuming (page number, token, date)'),
  itemsFound: z.number().int().nonnegative().default(0),
  oldestDateReached: z.string().nullable().describe('ISO date of oldest item seen'),
  lastError: z.string().nullable().optional(),
  updatedAt: z.string().describe('ISO timestamp of last update'),
});
export type CrawlJob = z.infer<typeof CrawlJobSchema>;
