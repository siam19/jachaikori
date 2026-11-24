/**
 * @file packages/schema/src/cluster.ts
 * Schemas for cross-outlet event clusters and force-directed similarity graphs.
 */

import { z } from 'zod';
import { EntitySummarySchema } from './entity';
import { OutletIdSchema } from './outlet';
import { StoredArticleClaimSchema } from './verification';

export const EventClusterSchema = z.object({
  id: z.string(),
  label: z.string(),
  leadSnippet: z.string().nullable().optional(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  articleCount: z.number().int().min(1),
  outletCount: z.number().int().min(1),
  outlets: z.array(OutletIdSchema),
});
export type EventCluster = z.infer<typeof EventClusterSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().describe('Article ID'),
  outlet: OutletIdSchema,
  title: z.string(),
  canonicalUrl: z.string(),
  publishedAt: z.string().nullable(),
  lead: z.string().nullable().optional(),
  degree: z.number().int().min(0).default(0),
  clusterId: z.string().nullable().optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  similarity: z.number().min(0).max(1),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const ClusterGraphResponseSchema = z.object({
  cluster: EventClusterSchema.nullable(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  entities: z.array(EntitySummarySchema).optional(),
});
export type ClusterGraphResponse = z.infer<typeof ClusterGraphResponseSchema>;

export const EventOutletCoverageItemSchema = z.object({
  outlet: OutletIdSchema,
  covered: z.boolean(),
  articleCount: z.number().int().min(0),
  firstPublishedAt: z.string().nullable(),
  lagMinutesFromFirst: z.number().int().min(0).nullable(),
  leadArticle: z
    .object({
      id: z.string(),
      title: z.string(),
      canonicalUrl: z.string(),
      publishedAt: z.string().nullable(),
      lead: z.string().nullable(),
    })
    .nullable(),
  claims: z.array(StoredArticleClaimSchema).default([]),
});
export type EventOutletCoverageItem = z.infer<typeof EventOutletCoverageItemSchema>;

export const CrossOutletDifferenceSchema = z.object({
  kind: z.enum(['number_difference', 'hedging_difference', 'date_difference', 'consensus_number']),
  outlets: z.array(OutletIdSchema),
  summaryEn: z.string(),
  summaryBn: z.string(),
  details: z.array(
    z.object({
      outlet: OutletIdSchema,
      articleId: z.string(),
      span: z.string(),
    })
  ),
});
export type CrossOutletDifference = z.infer<typeof CrossOutletDifferenceSchema>;

export const EventComparisonResponseSchema = z.object({
  event: EventClusterSchema.extend({
    redirectedFrom: z.string().optional(),
  }),
  firstToPublish: z
    .object({
      outlet: OutletIdSchema,
      articleId: z.string(),
      title: z.string(),
      publishedAt: z.string(),
      canonicalUrl: z.string(),
    })
    .nullable(),
  timeline: z.array(
    z.object({
      articleId: z.string(),
      outlet: OutletIdSchema,
      title: z.string(),
      publishedAt: z.string().nullable(),
      lagMinutesFromFirst: z.number().int().min(0).nullable(),
      canonicalUrl: z.string(),
    })
  ),
  outletCoverage: z.array(EventOutletCoverageItemSchema),
  crossOutletDifferences: z.array(CrossOutletDifferenceSchema),
  totalClaimsAnalyzed: z.number().int().min(0),
});
export type EventComparisonResponse = z.infer<typeof EventComparisonResponseSchema>;
