/**
 * @file packages/schema/src/cluster.ts
 * Schemas for cross-outlet event clusters and force-directed similarity graphs.
 */

import { z } from 'zod';
import { EntitySummarySchema } from './entity';
import { OutletIdSchema } from './outlet';

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
