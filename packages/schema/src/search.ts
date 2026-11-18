/**
 * @file packages/schema/src/search.ts
 * Request and response schemas for hybrid D1 FTS5 + Vectorize RRF search.
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';

export const SearchModeSchema = z.enum(['hybrid', 'keyword', 'semantic']);
export type SearchMode = z.infer<typeof SearchModeSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  outlet: OutletIdSchema.optional(),
  entityId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  mode: SearchModeSchema.default('hybrid'),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const SearchHitSchema = z.object({
  articleId: z.string(),
  outlet: OutletIdSchema,
  title: z.string(),
  canonicalUrl: z.string(),
  publishedAt: z.string().nullable(),
  snippet: z.string(),
  score: z.number(),
  sources: z.array(z.enum(['keyword', 'semantic'])),
  clusterId: z.string().nullable().optional(),
  clusterOutletCount: z.number().int().nullable().optional(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  expandedTerms: z.array(z.string()).default([]),
  mode: SearchModeSchema,
  fusionK: z.number().int(),
  latencyMs: z.number(),
  hits: z.array(SearchHitSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
