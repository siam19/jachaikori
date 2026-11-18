/**
 * @file packages/schema/src/entity.ts
 * Canonical entity, temporal alias, hyperedge membership, and entity-relation hypergraph schemas.
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';

export const EntityTypeSchema = z.enum([
  'person',
  'org',
  'location',
  'role',
  'event_topic',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntityRoleSchema = z.enum([
  'quoted_speaker',
  'actor',
  'subject',
  'location',
  'mentioned',
]);
export type EntityRole = z.infer<typeof EntityRoleSchema>;

export const EntityRelationTypeSchema = z.enum([
  'quoted_about',
  'resigned_from',
  'met_with',
  'legal_action',
  'criticized_or_protested',
  'announced_or_agreed',
  'located_in',
  'co_occurred',
]);
export type EntityRelationType = z.infer<typeof EntityRelationTypeSchema>;

export const EntitySchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable().optional(),
  canonicalEn: z.string().nullable().optional(),
  entityType: EntityTypeSchema,
  metadataJson: z.string().nullable().optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntityAliasSchema = z.object({
  aliasNorm: z.string(),
  aliasRaw: z.string(),
  entityId: z.string(),
  validFrom: z.string().nullable().optional().describe('ISO date start for role-based aliases (e.g. PM)'),
  validTo: z.string().nullable().optional().describe('ISO date end for role-based aliases'),
});
export type EntityAlias = z.infer<typeof EntityAliasSchema>;

export const ArticleEntityMentionSchema = z.object({
  articleId: z.string(),
  entityId: z.string(),
  chunkId: z.string().nullable().optional(),
  surfaceForm: z.string(),
  role: EntityRoleSchema.default('mentioned'),
  confidence: z.number().min(0).max(1).default(1),
});
export type ArticleEntityMention = z.infer<typeof ArticleEntityMentionSchema>;

export const EntityRelationSchema = z.object({
  id: z.string(),
  articleId: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  relationType: EntityRelationTypeSchema,
  evidenceSnippet: z.string(),
  publishedAt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EntitySummarySchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  articleCount: z.number().int().min(0),
  relationCount: z.number().int().min(0).default(0),
});
export type EntitySummary = z.infer<typeof EntitySummarySchema>;

export const EntityGraphNodeSchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  mentionCount: z.number().int().min(1),
  roles: z.array(EntityRoleSchema).default([]),
  isCenter: z.boolean().optional(),
});
export type EntityGraphNode = z.infer<typeof EntityGraphNodeSchema>;

export const EntityRelationEvidenceSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  outlet: OutletIdSchema,
  publishedAt: z.string().nullable(),
  canonicalUrl: z.string(),
  snippet: z.string(),
  relationType: EntityRelationTypeSchema,
});
export type EntityRelationEvidence = z.infer<typeof EntityRelationEvidenceSchema>;

export const EntityGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationType: EntityRelationTypeSchema,
  weight: z.number().int().min(1),
  evidence: z.array(EntityRelationEvidenceSchema).default([]),
});
export type EntityGraphEdge = z.infer<typeof EntityGraphEdgeSchema>;

export const EntityHyperedgeSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  outlet: OutletIdSchema,
  publishedAt: z.string().nullable(),
  canonicalUrl: z.string(),
  entityIds: z.array(z.string()),
  roleByEntity: z.record(z.string(), EntityRoleSchema),
});
export type EntityHyperedge = z.infer<typeof EntityHyperedgeSchema>;

export const EntityGraphResponseSchema = z.object({
  centerEntity: EntityGraphNodeSchema.nullable(),
  clusterLabel: z.string().nullable().optional(),
  nodes: z.array(EntityGraphNodeSchema),
  edges: z.array(EntityGraphEdgeSchema),
  hyperedges: z.array(EntityHyperedgeSchema),
});
export type EntityGraphResponse = z.infer<typeof EntityGraphResponseSchema>;

export const LlmExtractedEntitySchema = z.object({
  entityId: z.string().nullable().describe('Matched ID from KNOWN_CANDIDATES, or null if new entity'),
  canonicalBn: z.string().nullable().optional(),
  canonicalEn: z.string().nullable().optional(),
  entityType: EntityTypeSchema,
  surfaceForm: z.string(),
  role: EntityRoleSchema.default('mentioned'),
  confidence: z.number().min(0).max(1).default(0.85),
});
export type LlmExtractedEntity = z.infer<typeof LlmExtractedEntitySchema>;

export const LlmExtractedClaimSchema = z.object({
  claimText: z.string().min(1),
  claimType: z.string().default('factual'),
  subjectEntityId: z.string().nullable().optional(),
  subjectName: z.string().nullable().optional(),
  objectEntityId: z.string().nullable().optional(),
  objectName: z.string().nullable().optional(),
  evidenceSnippet: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.85),
});
export type LlmExtractedClaim = z.infer<typeof LlmExtractedClaimSchema>;

export const LlmArticleExtractionSchema = z.object({
  articleId: z.string().optional(),
  entities: z.array(LlmExtractedEntitySchema).default([]),
  claims: z.array(LlmExtractedClaimSchema).default([]),
});
export type LlmArticleExtraction = z.infer<typeof LlmArticleExtractionSchema>;
