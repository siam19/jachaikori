/**
 * @file packages/schema/src/entity.ts
 * Forward-compatible schemas for canonical entities, temporal aliases, and article-entity links.
 */

import { z } from 'zod';

export const EntityTypeSchema = z.enum([
  'person',
  'org',
  'location',
  'role',
  'event_topic',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

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
  confidence: z.number().min(0).max(1).default(1),
});
export type ArticleEntityMention = z.infer<typeof ArticleEntityMentionSchema>;
